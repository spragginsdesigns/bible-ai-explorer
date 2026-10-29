import AVFoundation
import Foundation
import Speech

/// A foreground-only, final-result-only microphone. Generation tokens fence
/// delayed permission and recognition callbacks after stop/account teardown.
@MainActor
@Observable
final class NativeVoiceInput {
    private(set) var isEligible = false
    private(set) var isEnabled = false
    private(set) var isListening = false
    private(set) var isPreparing = false
    private(set) var status = "Voice controls are off."
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var recognition: SFSpeechRecognitionTask?
    @ObservationIgnored private var timeout: Task<Void, Never>?
    @ObservationIgnored private var quietEndpoint: Task<Void, Never>?
    @ObservationIgnored private var tapInstalled = false
    @ObservationIgnored private var ownsAudioSession = false
    @ObservationIgnored private var receivedSpeech = false
    @ObservationIgnored private var endedWithoutSpeech = false
    @ObservationIgnored var onFinal: ((String) -> Void)?
    @ObservationIgnored var onFailure: ((String) -> Void)?
    @ObservationIgnored var onIdle: (() -> Void)?

    func checkEligibility(api: APIClient, account: String?) async {
        let current = generation
        guard let account, await ClerkAuth.refreshVoiceOwner(for: account), current == generation else {
            if current == generation { isEligible = false; stop() }
            return
        }
        let result = try? await api.response("/api/billing/status", method: "GET")
        guard current == generation, !Task.isCancelled else { return }
        let value = result.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0.data) }
        isEligible = result?.status == 200 && value?["plan"]?.stringValue == "pro"
            && ClerkAuth.isVoiceOwner(for: account)
        if !isEligible { stop() }
    }

    func enable() async {
        guard isEligible, !isPreparing else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else {
            status = "On-device English speech recognition is unavailable. You can still use Read it to me and VoiceOver."
            return
        }
        let current = UUID()
        generation = current
        receivedSpeech = false
        endedWithoutSpeech = false
        isPreparing = true
        status = "Waiting for microphone and speech permission."
        defer { if current == generation { isPreparing = false } }
        let speech = await withCheckedContinuation { continuation in
            // Speech calls this legacy block on a background queue. Explicit
            // Sendable prevents it inheriting this model's MainActor executor.
            SFSpeechRecognizer.requestAuthorization { @Sendable status in
                continuation.resume(returning: status)
            }
        }
        guard current == generation else { return }
        guard speech == .authorized else { status = "Speech recognition permission is required. Enable it in system privacy settings."; return }
        let microphone = await AVCaptureDevice.requestAccess(for: .audio)
        guard current == generation else { return }
        guard microphone else { status = "Microphone permission is required. Enable it in system privacy settings."; return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else {
            status = "On-device English speech recognition is unavailable. You can still use Read it to me and VoiceOver."
            return
        }
        isEnabled = true
        status = "Voice controls ready."
    }

    func wait(_ message: String = "Waiting for SureWord to finish.") {
        cancelCapture()
        if isEnabled { status = message }
    }

    func listen(context: [String]) {
        guard isEnabled, !isListening, !isPreparing else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable,
              recognizer.supportsOnDeviceRecognition else { fail("On-device speech recognition is unavailable. Start voice controls to retry."); return }
        let current = UUID()
        generation = current
        receivedSpeech = false
        endedWithoutSpeech = false
        do {
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true)
            ownsAudioSession = true
            #endif
            let engine = AVAudioEngine()
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            request.contextualStrings = Array(context.prefix(100))
            let node = engine.inputNode
            let format = node.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { fail("No microphone is available. Start voice controls to retry."); return }
            self.engine = engine
            self.request = request
            let sink = SpeechBufferSink(request: request)
            node.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in sink.append(buffer) }
            tapInstalled = true
            recognition = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
                // Never expose or dispatch a partial hypothesis.
                let final = result?.isFinal == true ? result?.bestTranscription.formattedString : nil
                let partialReceived = result?.isFinal == false && !(result?.bestTranscription.formattedString.isEmpty ?? true)
                let failed = error != nil
                Task { @MainActor [weak self] in
                    guard let self, self.generation == current else { return }
                    if let final {
                        guard !final.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                            self.resumeAfterSilence()
                            return
                        }
                        self.cancelCapture()
                        self.status = "Processing your request."
                        self.onFinal?(final)
                    } else if partialReceived {
                        self.receivedSpeech = true
                        self.scheduleQuietFinish(generation: current)
                    } else if failed {
                        if self.endedWithoutSpeech { self.resumeAfterSilence() }
                        else { self.fail("Speech could not be recognized. Start voice controls to try again.") }
                    }
                }
            }
            engine.prepare()
            try engine.start()
            isListening = true
            status = "Listening. Say an option, open a screen, or stop voice."
            // Ending audio asks Apple for a final result; partial text is never
            // promoted to final by a timer. Finish is also always available.
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(12))
                guard !Task.isCancelled, self?.generation == current else { return }
                // A quiet listening window can restart without requiring a
                // blind reader to find Start again. Give an actual question
                // up to a minute; the quiet endpoint still finishes it sooner.
                if self?.receivedSpeech == true {
                    try? await Task.sleep(for: .seconds(48))
                    guard !Task.isCancelled, self?.generation == current else { return }
                }
                self?.finish()
            }
        } catch { fail("The microphone could not start. Start voice controls to try again.") }
    }

    private func scheduleQuietFinish(generation current: UUID) {
        quietEndpoint?.cancel()
        quietEndpoint = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1100))
            guard !Task.isCancelled, self?.generation == current else { return }
            // Silence only closes the microphone input. Apple must still
            // deliver isFinal before any option or message can be dispatched.
            self?.finish()
        }
    }

    func finish() {
        guard isListening else { return }
        endedWithoutSpeech = !receivedSpeech
        quietEndpoint?.cancel(); quietEndpoint = nil
        engine?.stop()
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
        isListening = false
        isPreparing = true
        status = "Finishing your words."
        timeout?.cancel()
        let current = generation
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled, self?.generation == current else { return }
            if self?.endedWithoutSpeech == true { self?.resumeAfterSilence() }
            else { self?.fail("No final speech result arrived. Start voice controls to retry.") }
        }
    }

    private func resumeAfterSilence() {
        cancelCapture()
        guard isEnabled else { return }
        isPreparing = true
        status = "Ready for your next request."
        let current = generation
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, let self, self.generation == current, self.isEnabled else { return }
            self.isPreparing = false
            self.onIdle?()
        }
    }

    func stop() {
        isEnabled = false
        cancelCapture()
        status = "Voice controls are off."
    }

    func fail(_ message: String) {
        isEnabled = false
        cancelCapture()
        status = message
        onFailure?(message)
    }

    private func cancelCapture() {
        generation = UUID()
        timeout?.cancel(); timeout = nil
        quietEndpoint?.cancel(); quietEndpoint = nil
        engine?.stop()
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }
        tapInstalled = false
        request?.endAudio()
        recognition?.cancel()
        request = nil; recognition = nil; engine = nil
        isListening = false
        isPreparing = false
        #if os(iOS)
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
        #endif
    }
}

/// The audio engine owns this callback on its render thread. Speech accepts
/// appended buffers there; all model state stays on MainActor. Capture ends
/// only after the engine stops and the tap is removed.
private final class SpeechBufferSink: @unchecked Sendable {
    private let request: SFSpeechAudioBufferRecognitionRequest

    init(request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }

    func append(_ buffer: AVAudioPCMBuffer) { request.append(buffer) }
}
