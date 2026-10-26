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

    @ObservationIgnored private var queue: [OnboardingRules.VoiceItem] = []
    @ObservationIgnored private var heard: Set<String> = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var endObservers: [any NSObjectProtocol] = []
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var finished: CheckedContinuation<Void, Never>?
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private let speechDelegate = SpeechDelegate()

    init(api: APIClient) {
        self.api = api
        synthesizer.delegate = speechDelegate
        speechDelegate.onFinish = { [weak self] in self?.finishCurrent() }
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
            queue.append(contentsOf: OnboardingRules.voiceItems(for: message))
        }
        drain()
    }

    /// Off: silence now and forget the session, so switching on again starts
    /// from the newest message rather than replaying what was skipped.
    func stop() {
        runner?.cancel()
        runner = nil
        queue = []
        heard = []
        started = false
        stopPlayback()
    }

    private func drain() {
        guard runner == nil, !queue.isEmpty else { return }
        runner = Task { [weak self] in
            while let self, !Task.isCancelled, !self.queue.isEmpty {
                let item = self.queue.removeFirst()
                await self.read(item)
            }
            self?.runner = nil
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
        activateAudioSession()
        let request = try? await api.makeRequest(url.absoluteString, method: "GET", fresh: true)
        guard !Task.isCancelled else { return }
        var options: [String: Any] = [:]
        if let authorization = request?.value(forHTTPHeaderField: "Authorization") {
            options["AVURLAssetHTTPHeaderFieldsKey"] = ["Authorization": authorization]
        }
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
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
                        MainActor.assumeIsolated { self?.finishCurrent() }
                    })
                }
                statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                    guard item.status == .failed else { return }
                    Task { @MainActor [weak self] in self?.finishCurrent() }
                }
                player.play()
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.stopPlayback() }
        }
        stopPlayer()
    }

    private func speak(_ text: String) async {
        activateAudioSession()
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                finished = continuation
                synthesizer.speak(AVSpeechUtterance(string: text))
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.stopPlayback() }
        }
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
    @MainActor var onFinish: (@MainActor () -> Void)?

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.onFinish?() }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.onFinish?() }
    }
}
