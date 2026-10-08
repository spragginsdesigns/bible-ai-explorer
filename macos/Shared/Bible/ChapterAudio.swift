import Foundation
import AVFoundation
import MediaPlayer

/// Same public wire contract and timing rules as src/lib/bible/audioBible.ts.
struct ChapterAudio: Decodable, Sendable, Equatable {
    struct Timing: Decodable, Sendable, Equatable { let verse: Int; let start: Double; let end: Double }
    let status: String
    let book: Int?
    let chapter: Int?
    let audioUrl: String?
    let duration: Double?
    let verses: [Timing]?

    static func hasNarration(_ book: Int) -> Bool { (40...66).contains(book) }
    func verse(at seconds: Double) -> Int? { verses?.last(where: { $0.start <= seconds })?.verse }
    func start(of verse: Int) -> Double { verses?.first(where: { $0.verse == verse })?.start ?? 0 }
    func valid(book: Int, chapter: Int) -> Bool {
        guard status == "ready", self.book == book, self.chapter == chapter,
              let duration, duration.isFinite, duration > 0,
              let audioUrl, let url = URL(string: audioUrl), url.scheme == "https",
              let verses, !verses.isEmpty else { return false }
        return verses.enumerated().allSatisfy { index, t in
            t.verse == index + 1 && t.start.isFinite && t.end.isFinite && t.start >= 0 && t.end >= t.start && t.end <= duration + 1
        }
    }
}

@MainActor @Observable
final class ChapterAudioModel {
    private(set) var audio: ChapterAudio?
    private(set) var isOpen = false
    private(set) var isPlaying = false
    private(set) var isReady = false
    private(set) var elapsed = 0.0
    private(set) var error: String?
    private(set) var stillListening = false
    private(set) var reference = ""
    var verse: Int? { isReady ? audio?.verse(at: elapsed) : nil }
    var duration: Double { audio?.duration ?? 0 }
    var available: Bool { audio != nil }
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let settings: SettingsStore
    @ObservationIgnored private var player = AVPlayer()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var endObserver: (any NSObjectProtocol)?
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var lastAction = Date.now
    @ObservationIgnored private var nextChapter: (@MainActor () -> Void)?
    @ObservationIgnored private var sourceKey = ""
    @ObservationIgnored private var pendingStart: Double?

    init(api: APIClient, settings: SettingsStore) { self.api = api; self.settings = settings }

    func load(book: Int, chapter: Int, reference: String, enabled: Bool, next: (@MainActor () -> Void)?) async {
        let key = "\(enabled):\(book):\(chapter)"
        guard sourceKey != key || audio == nil else { return }
        sourceKey = key
        generation += 1
        let run = generation
        let continuePlaying = isPlaying || pendingStart != nil
        clearItem()
        audio = nil; elapsed = 0; error = nil; stillListening = false
        self.reference = reference; nextChapter = next
        pendingStart = continuePlaying ? 0 : nil
        guard enabled, ChapterAudio.hasNarration(book) else { close(); return }
        do {
            let response = try await api.json("/api/bible/audio?book=\(book)&chapter=\(chapter)", as: ChapterAudio.self)
            guard run == generation, !Task.isCancelled else { return }
            guard response.valid(book: book, chapter: chapter) else { close(); return }
            audio = response
            if isOpen { installItem() }
        } catch {
            guard run == generation, !Task.isCancelled else { return }
            pendingStart = nil
            self.error = "Couldn't load narration. Check your connection and try again."
        }
    }

    func start(from verse: Int = 0) {
        guard let audio else { return }
        markAction(); error = nil; stillListening = false
        pendingStart = verse > 0 ? audio.start(of: verse) : 0
        isOpen = true
        #if os(iOS)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { self.error = "Couldn't start audio. Try again."; return }
        #endif
        if player.currentItem == nil || player.currentItem?.status == .failed { installItem() }
        else if isReady { seek(to: pendingStart ?? 0); pendingStart = nil; play() }
    }

    private func installItem() {
        guard let raw = audio?.audioUrl, let url = URL(string: raw) else { return }
        clearItem()
        generation += 1
        let run = generation
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        observations.append(item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor in
                guard let self, self.generation == run else { return }
                self.isReady = status == .readyToPlay
                if status == .failed { self.error = "Couldn't play narration. Try Listen again."; self.pause() }
                if self.isReady, let position = self.pendingStart {
                    self.pendingStart = nil
                    self.player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) { [weak self] complete in
                        Task { @MainActor in
                            guard complete, let self, self.generation == run, self.isOpen else { return }
                            self.play(userInitiated: false)
                        }
                    }
                }
            }
        })
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let playing = player.timeControlStatus == .playing
            Task { @MainActor in
                guard let self, self.generation == run else { return }
                self.isPlaying = playing
                if playing { self.player.rate = Float(self.settings.listenRate) }
                self.updateNowPlaying()
            }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, self.generation == run else { return }
                self.elapsed = time.seconds.isFinite ? time.seconds : 0
                if self.isPlaying && Date.now.timeIntervalSince(self.lastAction) >= 3600 {
                    self.pause(); self.stillListening = true
                }
                self.updateNowPlaying()
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.generation == run else { return }
                self.isPlaying = false
                if let next = self.nextChapter { self.pendingStart = 0; next() }
                else { self.seek(to: 0) }
            }
        }
        registerRemoteCommands()
    }

    func markAction() { lastAction = .now }
    func play(userInitiated: Bool = true) {
        guard isReady, isOpen, !stillListening else { return }
        if userInitiated { markAction() }; player.playImmediately(atRate: Float(settings.listenRate))
    }
    func pause() { player.pause(); isPlaying = false; updateNowPlaying() }
    func toggle() { markAction(); if isPlaying { pause() } else { play() } }
    func keepListening() { stillListening = false; play() }
    func seek(to seconds: Double) {
        guard isReady, seconds.isFinite else { return }
        markAction(); player.seek(to: CMTime(seconds: max(0, min(duration, seconds)), preferredTimescale: 600))
    }
    func skipVerse(_ delta: Int) {
        guard let audio, let verses = audio.verses else { return }
        let target = max(1, min(verses.count, (verse ?? 1) + delta))
        seek(to: audio.start(of: target))
    }
    func cycleRate() { markAction(); settings.listenRate = Listen.nextRate(settings.listenRate); if isPlaying { player.rate = Float(settings.listenRate) }; updateNowPlaying() }
    func close() {
        let ownedMedia = !remoteTargets.isEmpty
        generation += 1; pendingStart = nil; isOpen = false; stillListening = false
        clearItem()
        for (command, target) in remoteTargets { command.removeTarget(target) }
        remoteTargets = []
        if ownedMedia { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil }
    }
    private func clearItem() {
        player.pause(); isPlaying = false; isReady = false
        if let timeObserver { player.removeTimeObserver(timeObserver) }; timeObserver = nil
        observations = []
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }; endObserver = nil
        player.replaceCurrentItem(with: nil)
    }
    private func updateNowPlaying() {
        guard isOpen, audio != nil else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: reference, MPMediaItemPropertyArtist: "SureWord · KJV",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? settings.listenRate : 0,
        ]
    }
    private func registerRemoteCommands() {
        guard remoteTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping @MainActor (ChapterAudioModel) -> Void) {
            let target = command.addTarget { [weak self] _ in
                Task { @MainActor in if let self { action(self) } }; return .success
            }
            command.isEnabled = true; remoteTargets.append((command, target))
        }
        add(center.playCommand) { $0.play() }; add(center.pauseCommand) { $0.pause() }
        add(center.togglePlayPauseCommand) { $0.toggle() }
        center.skipBackwardCommand.preferredIntervals = [10]; center.skipForwardCommand.preferredIntervals = [10]
        add(center.skipBackwardCommand) { $0.seek(to: $0.elapsed - 10) }
        add(center.skipForwardCommand) { $0.seek(to: $0.elapsed + 10) }
        let target = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let seconds = event.positionTime
            Task { @MainActor in self?.seek(to: seconds) }; return .success
        }
        center.changePlaybackPositionCommand.isEnabled = true
        remoteTargets.append((center.changePlaybackPositionCommand, target))
    }
    isolated deinit {
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        for (command, target) in remoteTargets { command.removeTarget(target) }
    }
}
