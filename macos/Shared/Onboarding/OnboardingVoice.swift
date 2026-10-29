import AVFoundation
import Foundation

/// "Read it to me" in the welcome conversation: each new SureWord message, and
/// then its card's question, read aloud one after another.
///
/// The server decides how each one is read (`POST /api/onboarding/audio`):
/// "ready" streams shared or generated narration from `streamUrl` with the
/// session's bearer, the way Listen plays its devotional; "device" hands back
/// the words for this device's own voice (`AVSpeechSynthesizer`). A 404 means
/// the message is not saved yet, so it is asked again a few times.
@MainActor
@Observable
final class OnboardingVoice {
    private let api: APIClient
    private(set) var isSpeaking = false
    /// Includes fetches and every queued utterance, not just audible playback.
    private(set) var isBusy = false

    @ObservationIgnored private var queue: [QueuedItem] = []
    private enum QueuedItem { case remote(OnboardingRules.VoiceItem), local(String) }
    @ObservationIgnored private var heard: Set<String> = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var runnerGeneration = UUID()
    @ObservationIgnored private var playbackGeneration = UUID()
    @ObservationIgnored private var currentUtterance: AVSpeechUtterance?
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var endObservers: [any NSObjectProtocol] = []
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var finished: CheckedContinuation<Void, Never>?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private let speechDelegate = SpeechDelegate()

    init(api: APIClient) {
        self.api = api
        synthesizer.delegate = speechDelegate
        speechDelegate.onFinish = { [weak self] utterance in
            guard let current = self?.currentUtterance, ObjectIdentifier(current) == utterance else { return }
            self?.finishCurrent()
        }
    }

    /// Feed the conversation in. The first call after switching on only marks
    /// the history as heard (and reads the newest message); after that, every
    /// settled SureWord message not yet heard is queued.
    func update(messages: [ChatViewMessage]) {
        if !started {
            started = true
            heard.formUnion(OnboardingRules.alreadyHeardOnStart(messages))
        }
        for message in messages where message.role == .assistant && !message.isStreaming {
            guard message.id != "pending-assistant", !heard.contains(message.id) else { continue }
            heard.insert(message.id)
            queue.append(contentsOf: OnboardingRules.voiceItems(for: message).map(QueuedItem.remote))
        }
        drain()
    }

    func enqueueLocal(_ text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        queue.append(.local(text))
        drain()
    }

    /// Off: silence now and forget the session, so switching on again starts
    /// from the newest message rather than replaying what was skipped.
    func stop() {
        runnerGeneration = UUID()
        runner?.cancel()
        runner = nil
        queue = []
        heard = []
        started = false
        stopPlayback()
        isBusy = false
    }

    private func drain() {
        guard runner == nil, !queue.isEmpty else { return }
        isBusy = true
        let generation = UUID()
        runnerGeneration = generation
        runner = Task { [weak self] in
            while let self, !Task.isCancelled, !self.queue.isEmpty {
                let item = self.queue.removeFirst()
                switch item {
                case .remote(let item): await self.read(item)
                case .local(let text):
                    self.isSpeaking = true
                    await self.speak(text)
                    self.isSpeaking = false
                }
            }
            guard self?.runnerGeneration == generation else { return }
            self?.runner = nil
            self?.isBusy = false
        }
    }

    private enum Answer {
        case stream(URL)
        case device(String)
    }

    private func read(_ item: OnboardingRules.VoiceItem) async {
        guard let answer = await fetch(item), !Task.isCancelled else { return }
        isSpeaking = true
        defer { isSpeaking = false }
        switch answer {
        case .stream(let url):
            await play(url)
        case .device(let text):
            await speak(text)
        }
    }

    private struct MessageBody: Encodable { let messageId: String }
    private struct StepBody: Encodable { let step: String }

    /// A 404 on a message is a reply that has not been saved yet; asked again
    /// for about three seconds. A step never 404s for the welcome.
    private func fetch(_ item: OnboardingRules.VoiceItem) async -> Answer? {
        let body: any Encodable
        switch item {
        case .message(let id): body = MessageBody(messageId: id)
        case .step(let step): body = StepBody(step: step.rawValue)
        }
        for attempt in 0..<4 {
            if attempt > 0 { try? await Task.sleep(for: .milliseconds(900)) }
            guard !Task.isCancelled,
                  let result = try? await api.response("/api/onboarding/audio", method: "POST", body: body)
            else { return nil }
            if result.status == 404 { continue }
            guard (200..<300).contains(result.status),
                  let value = try? JSONDecoder().decode(JSONValue.self, from: result.data)
            else { return nil }
            switch value["status"]?.stringValue {
            case "ready":
                guard let path = value["streamUrl"]?.stringValue,
                      let url = URL(string: path, relativeTo: Config.apiURL)?.absoluteURL
                else { return nil }
                return .stream(url)
            case "device":
                guard let text = value["text"]?.stringValue, !text.isEmpty else { return nil }
                return .device(text)
            default:
                return nil
            }
        }
        return nil
    }

    // MARK: Playback

    private func play(_ url: URL) async {
        let generation = UUID()
        playbackGeneration = generation
        activateAudioSession()
        let request = try? await api.makeRequest(url.absoluteString, method: "GET", fresh: true)
        guard !Task.isCancelled else { return }
        var options: [String: Any] = [:]
        if let authorization = request?.value(forHTTPHeaderField: "Authorization") {
            options["AVURLAssetHTTPHeaderFieldsKey"] = ["Authorization": authorization]
        }
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
        item.audioTimePitchAlgorithm = .timeDomain
        let player = AVPlayer(playerItem: item)
        self.player = player
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                finished = continuation
                // Played through, or failed: either way the next item may go.
                for name in [Notification.Name.AVPlayerItemDidPlayToEndTime, .AVPlayerItemFailedToPlayToEndTime] {
                    endObservers.append(NotificationCenter.default.addObserver(
                        forName: name, object: item, queue: .main
                    ) { [weak self] _ in
                        MainActor.assumeIsolated {
                            if self?.playbackGeneration == generation { self?.finishCurrent() }
                        }
                    })
                }
                statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                    guard item.status == .failed else { return }
                    Task { @MainActor [weak self] in
                        if self?.playbackGeneration == generation { self?.finishCurrent() }
                    }
                }
                player.playImmediately(atRate: NativeVoiceRules.playbackRate)
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                if self?.playbackGeneration == generation { self?.stopPlayback() }
            }
        }
        if playbackGeneration == generation { stopPlayer() }
    }

    private func speak(_ text: String) async {
        guard !Task.isCancelled else { return }
        let generation = UUID()
        playbackGeneration = generation
        activateAudioSession()
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                finished = continuation
                let utterance = AVSpeechUtterance(string: text)
                currentUtterance = utterance
                utterance.rate = AVSpeechUtteranceDefaultSpeechRate * NativeVoiceRules.playbackRate
                utterance.pitchMultiplier = 1
                synthesizer.speak(utterance)
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                if self?.playbackGeneration == generation { self?.stopPlayback() }
            }
        }
        if playbackGeneration == generation { currentUtterance = nil }
    }

    private func finishCurrent() {
        let continuation = finished
        finished = nil
        continuation?.resume()
    }

    private func stopPlayer() {
        for observer in endObservers { NotificationCenter.default.removeObserver(observer) }
        endObservers = []
        statusObservation = nil
        player?.pause()
        player = nil
    }

    private func stopPlayback() {
        playbackGeneration = UUID()
        currentUtterance = nil
        stopPlayer()
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        isSpeaking = false
        finishCurrent()
    }

    private func activateAudioSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
        #endif
    }
}

/// The synthesizer's end-of-utterance callbacks, forwarded to the main actor.
private final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    /// Set once, before the first utterance.
    @MainActor var onFinish: (@MainActor (ObjectIdentifier) -> Void)?

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let identity = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in self?.onFinish?(identity) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let identity = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in self?.onFinish?(identity) }
    }
}
