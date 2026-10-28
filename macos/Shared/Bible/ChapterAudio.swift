import Foundation
import AVFoundation
import MediaPlayer
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Which recording of a chapter to play: the book's usual one, or the Alive
/// production (full cast, on the ASV or the LC Greek) offered beside it on
/// Listen. Same names and wording as `EDITION_CHOICES` and `EDITION_DETAILS` in
/// src/lib/bible/audioBible.ts (LC-15532, LC-17800).
enum AudioEdition: String, CaseIterable, Sendable {
    case regular, alive
    /// Listen recommends Alive wherever a book has it (LC-15842): the choice
    /// lists it first, marked with `recommendedLabel` (`RECOMMENDED_EDITION`,
    /// `RECOMMENDED_LABEL`, `LISTEN_ORDER`).
    static let recommended: AudioEdition = .alive
    static let recommendedLabel = "Recommended"
    static let listenOrder: [AudioEdition] = [.alive, .regular]
    var label: String { self == .alive ? "Alive" : "Regular" }
    /// `editionDetail`: Alive names the text it reads (`ChapterAudio.text`);
    /// nil is a server before LC-17800, which only had the LC Greek.
    func detail(aliveText: String?) -> String {
        guard self == .alive else { return "The King James Version, read aloud" }
        return aliveText == "ASV" ? "Full cast, in the American Standard Version" : "Full cast, in our LC Greek translation"
    }
    var isRecommended: Bool { self == Self.recommended }
}

/// Same public wire contract and timing rules as src/lib/bible/audioBible.ts.
struct ChapterAudio: Decodable, Sendable, Equatable {
    struct Timing: Decodable, Sendable, Equatable { let verse: Int; let start: Double; let end: Double }
    let status: String
    let book: Int?
    let chapter: Int?
    /// "alive" for an Alive recording; absent (regular) from servers before LC-15532.
    let edition: String?
    /// The text an Alive recording reads, "ASV" or "LC Greek" (`AliveText`);
    /// absent on regular, and from servers before LC-17800 (the LC Greek).
    let text: String?
    let audioUrl: String?
    let duration: Double?
    /// One entry per verse read; a verse the text leaves empty (the ASV omits
    /// 16) has none, so the numbers can skip.
    let verses: [Timing]?

    static func hasNarration(_ book: Int) -> Bool { (1...66).contains(book) }
    var kind: AudioEdition { edition == AudioEdition.alive.rawValue ? .alive : .regular }
    func verse(at seconds: Double) -> Int? { verses?.last(where: { $0.start <= seconds })?.verse }
    /// `verseStart`: a verse with no timing starts where the next verse read does.
    func start(of verse: Int) -> Double { verses?.first(where: { $0.verse >= verse })?.start ?? 0 }
    /// `adjacentVerse`: the neighbouring timing entry, so skipping steps over
    /// a verse with no timing; before the first verse, the first verse.
    func adjacent(to verse: Int?, by delta: Int) -> Int? {
        guard let verses, let first = verses.first else { return nil }
        guard let verse else { return first.verse }
        let index = verses.firstIndex(where: { $0.verse == verse }) ?? 0
        return verses[max(0, min(verses.count - 1, index + delta))].verse
    }
    func valid(book: Int, chapter: Int) -> Bool {
        guard status == "ready", self.book == book, self.chapter == chapter,
              let duration, duration.isFinite, duration > 0,
              let audioUrl, let url = URL(string: audioUrl), url.scheme == "https",
              let verses, !verses.isEmpty else { return false }
        var previous = 0
        return verses.allSatisfy { t in
            defer { previous = t.verse }
            return t.verse > previous && t.start.isFinite && t.end.isFinite && t.start >= 0 && t.end >= t.start && t.end <= duration + 1
        }
    }
}

/// The reader scrolls with the verse being read, except for a few seconds
/// after the listener drags the chapter themselves (Android's `lastManualScroll`).
enum ChapterAudioFollow {
    static let pause: TimeInterval = 5
    static func follows(lastManualScroll: Date, now: Date = .now) -> Bool {
        now.timeIntervalSince(lastManualScroll) >= pause
    }
}

@MainActor @Observable
final class ChapterAudioModel {
    private(set) var audio: ChapterAudio?
    /// Every recording of the chapter; two means Listen asks which.
    private(set) var recordings: [AudioEdition: ChapterAudio] = [:]
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
    /// The chapter's recordings in `listenOrder`, the recommended one first.
    var editions: [AudioEdition] { AudioEdition.listenOrder.filter { recordings[$0] != nil } }
    var edition: AudioEdition { audio?.kind ?? .regular }
    /// The text this chapter's Alive recording reads; nil when it has none.
    var aliveText: String? { recordings[.alive].map { $0.text ?? "LC Greek" } }
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
    /// The listener's Listen choice; it carries into the next chapter, or falls back to regular there.
    @ObservationIgnored private var chosenEdition: AudioEdition = .regular
    /// The last `load` request, so Retry can repeat it after a failed fetch.
    @ObservationIgnored private var lastLoad: (book: Int, chapter: Int, reference: String, enabled: Bool, next: (@MainActor () -> Void)?)?

    init(api: APIClient, settings: SettingsStore) { self.api = api; self.settings = settings }

    func load(book: Int, chapter: Int, reference: String, enabled: Bool, next: (@MainActor () -> Void)?) async {
        let key = "\(enabled):\(book):\(chapter)"
        lastLoad = (book, chapter, reference, enabled, next)
        guard sourceKey != key || audio == nil else { return }
        sourceKey = key
        generation += 1
        let run = generation
        let continuePlaying = isPlaying || pendingStart != nil
        clearItem()
        audio = nil; recordings = [:]; elapsed = 0; error = nil; stillListening = false
        self.reference = reference; nextChapter = next
        pendingStart = continuePlaying ? 0 : nil
        guard enabled, ChapterAudio.hasNarration(book) else { close(); return }
        do {
            let response = try await api.json("/api/bible/audio?book=\(book)&chapter=\(chapter)", as: ChapterAudio.self)
            var found: [AudioEdition: ChapterAudio] = [:]
            if response.valid(book: book, chapter: chapter) { found[.regular] = response }
            // Any chapter may have Alive; the API knows (LC-17800).
            if let alive = try? await api.json("/api/bible/audio?book=\(book)&chapter=\(chapter)&edition=alive", as: ChapterAudio.self),
               alive.valid(book: book, chapter: chapter) {
                found[.alive] = alive
            }
            guard run == generation, !Task.isCancelled else { return }
            guard let picked = found[chosenEdition] ?? found[.regular] else { close(); return }
            recordings = found
            audio = picked
            if isOpen { installItem() }
        } catch {
            guard run == generation, !Task.isCancelled else { return }
            pendingStart = nil
            self.error = "Couldn't load narration. Check your connection and try again."
        }
    }

    /// Fetch the chapter's narration again after a failure - the readers'
    /// "Retry chapter narration" (Android's `retryLoad`). The source key is
    /// cleared so the load cannot short-circuit on the chapter it already holds.
    func retryLoad() async {
        guard let request = lastLoad else { return }
        sourceKey = ""
        await load(book: request.book, chapter: request.chapter, reference: request.reference,
                   enabled: request.enabled, next: request.next)
    }

    /// The bar's Retry after a play or load error: replay from the verse it
    /// reached when the recording is in hand (Android's `play(verse)`), and
    /// fetch it again when it is not.
    func retry() async {
        if audio == nil { await retryLoad() } else { start(from: verse ?? 0) }
    }

    func start(from verse: Int = 0, edition: AudioEdition? = nil) {
        if let edition, let picked = recordings[edition] { chosenEdition = edition; audio = picked }
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
        let installed = (player.currentItem?.asset as? AVURLAsset)?.url.absoluteString
        if player.currentItem == nil || player.currentItem?.status == .failed || installed != audio.audioUrl { installItem() }
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
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                guard let self, self.generation == run else { return }
                // Read the player after the hop: a queued playing event may
                // arrive after Pause. Reapplying its old rate would resume it.
                let playing = self.player.timeControlStatus == .playing && self.player.rate != 0
                self.isPlaying = playing
                let rate = Float(self.settings.listenRate)
                // Writing even the same rate triggers another status event.
                if playing, self.player.rate != rate { self.player.rate = rate }
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
        guard let audio, let target = audio.adjacent(to: verse, by: delta) else { return }
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
    /// The app icon on the lock screen and the OS media card, as the spoken
    /// devotional shows it (Android hands its player the same 512px mark).
    private static let artwork: MPMediaItemArtwork? = {
        #if os(macOS)
        let image = NSImage(named: NSImage.applicationIconName)
        #else
        let image = UIImage(named: "AppIcon")
        #endif
        guard let image else { return nil }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }()

    private func updateNowPlaying() {
        guard isOpen, audio != nil else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: reference, MPMediaItemPropertyArtist: edition == .alive ? "SureWord · Alive" : "SureWord · KJV",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? settings.listenRate : 0,
        ]
        if let artwork = Self.artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
