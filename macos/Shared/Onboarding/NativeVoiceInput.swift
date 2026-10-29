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
    @ObservationIgnored var onFinal: ((String) -> Void)?
    @ObservationIgnored var onFailure: ((String) -> Void)?

    func checkEligibility(api: APIClient) async {
        let current = generation
        let result = try? await api.response("/api/voice/live", method: "GET")
        guard current == generation, !Task.isCancelled else { return }
        let value = result.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0.data) }
        isEligible = NativeVoiceRules.authorized(status: result?.status ?? 0, value: value)
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
        isPreparing = true
        status = "Waiting for microphone and speech permission."
        defer { if current == generation { isPreparing = false } }
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
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
            node.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            tapInstalled = true
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
                // Never expose or dispatch a partial hypothesis.
                let final = result?.isFinal == true ? result?.bestTranscription.formattedString : nil
                let partialReceived = result?.isFinal == false && !(result?.bestTranscription.formattedString.isEmpty ?? true)
                let failed = error != nil
                Task { @MainActor [weak self] in
                    guard let self, self.generation == current else { return }
                    if let final {
                        self.cancelCapture()
                        self.status = "Processing your request."
                        self.onFinal?(final)
                    } else if partialReceived {
                        self.scheduleQuietFinish(generation: current)
                    } else if failed {
                        self.fail("Speech could not be recognized. Start voice controls to try again.")
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
            self?.fail("No final speech result arrived. Start voice controls to retry.")
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
