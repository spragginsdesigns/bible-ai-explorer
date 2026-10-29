import SwiftUI
#if os(macOS)
import AppKit
#endif

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
                await input.checkEligibility(api: app.api, account: app.userID)
            }
            .onChange(of: stateKey) { _, _ in session.synchronize(app: app) }
            .onChange(of: scenePhase, initial: true) { _, phase in
                #if os(macOS)
                let active = phase == .active && NSApp.isActive
                #else
                let active = phase == .active
                #endif
                session.setForeground(active, app: app, permissionPrompt: phase == .inactive)
            }
            .onDisappear { session.stop(app: app) }
            #if os(macOS)
            // A visible Mac window can keep an active scene while another
            // application owns input. AppKit activation must fence capture too.
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)
                .receive(on: DispatchQueue.main)) { _ in
                session.setForeground(false, app: app, permissionPrompt: true)
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
                .receive(on: DispatchQueue.main)) { _ in
                session.setForeground(true, app: app)
                Task { await input.checkEligibility(api: app.api, account: app.userID) }
            }
            .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didActivateApplicationNotification)
                .receive(on: DispatchQueue.main)) { notification in
                guard let activated = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
                if activated.processIdentifier == ProcessInfo.processInfo.processIdentifier {
                    session.setForeground(true, app: app)
                } else {
                    // Preserve only the initial system permission continuation.
                    // Switching to a normal app cancels it even during setup.
                    let permissionHost = ["com.apple.usernotificationcenter", "com.apple.securityagent"]
                        .contains(activated.bundleIdentifier?.lowercased() ?? "")
                    session.setForeground(false, app: app, permissionPrompt: permissionHost)
                }
            }
            #endif
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .font(.callout)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .foregroundStyle(theme.text)
        .background(theme.surface)
    }
}
