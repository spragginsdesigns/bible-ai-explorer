import SwiftUI

extension View {
    /// Mounted on the account shell, so commands keep working after leaving Chat.
    func nativeVoiceControls(app: AppModel) -> some View {
        modifier(NativeVoiceDriver(app: app))
    }
}

private struct NativeVoiceDriver: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let app: AppModel
    private var session: NativeVoiceSession { app.onboarding.voiceControls }
    private var input: NativeVoiceInput { session.input }
    private var stateKey: String {
        [app.chat.activeConversationID ?? "", app.chat.messages.last?.id ?? "",
         String(app.chat.isBusy), String(app.chat.historyLoading), String(app.chat.uploadingAttachments), String(app.chat.isCreatingConversation), String(app.onboarding.isSendingAnswer),
         app.section.rawValue, String(app.isSettingsPresented), String(app.onboarding.voice.isBusy),
         String(input.isEnabled), String(session.isStarting), String(app.dailyCross.listen.isPlaying), String(app.chapterAudio.isPlaying),
         String(app.aiConsent.isCurrent), String(app.aiConsent.prompt != nil), app.onboarding.hourPickerMessageID ?? "", app.onboarding.spotlight?.id.uuidString ?? "", String(app.onboarding.isSpotlightTransitioning)].joined(separator: ":")
    }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if input.isEligible { NativeVoiceControlBar(app: app) }
            }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                await input.checkEligibility(api: app.api)
            }
            .onChange(of: stateKey) { _, _ in session.synchronize(app: app) }
            .onChange(of: scenePhase, initial: true) { _, phase in session.setForeground(phase == .active, app: app, permissionPrompt: phase == .inactive) }
            .onDisappear { session.stop(app: app) }
    }
}

private struct NativeVoiceControlBar: View {
    @Environment(\.theme) private var theme
    let app: AppModel
    private var session: NativeVoiceSession { app.onboarding.voiceControls }
    private var input: NativeVoiceInput { session.input }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 16) {
                Button {
                    if input.isEnabled || input.isPreparing || session.isStarting { session.stop(app: app) }
                    else { Task { await session.start(app: app) } }
                } label: {
                    Label(input.isEnabled || input.isPreparing || session.isStarting ? "Stop voice controls" : "Start voice controls",
                          systemImage: input.isEnabled ? "mic.slash" : "mic")
                        .frame(minHeight: 44)
                }
                .accessibilityHint("Use your voice to choose options and open screens. Microphone access starts only when you activate this button.")
                if input.isListening {
                    Button("Finish speaking") { input.finish() }.frame(minHeight: 44)
                }
                Spacer(minLength: 0)
            }
            Text(input.status)
                .font(.caption)
                .accessibilityLabel("Voice status. \(input.status)")
                .accessibilityAddTraits(.updatesFrequently)
        }
        .font(.callout)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .foregroundStyle(theme.text)
        .background(theme.surface)
    }
}
