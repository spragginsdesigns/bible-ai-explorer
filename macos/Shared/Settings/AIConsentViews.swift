import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// MARK: - Sheet

/// "How SureWord answers you" (PRD A4): the title, the disclosure, the Privacy
/// Policy link and the two choices. The copy is `AIConsent`, mirrored from
/// `src/lib/ai-consent.ts`.
///
/// Presented by `AIConsentPresenter` on whatever is frontmost, so a verse
/// sheet, the note AI sheet or Settings' Memories sheet never block it.
struct AIConsentSheet: View {
    @Environment(\.theme) private var theme

    let store: AIConsentStore

    private var isSaving: Bool { store.prompt?.isSaving == true }
    private var isConfirming: Bool { store.prompt?.isConfirmingDecline == true }

    var body: some View {
#if os(iOS)
        VStack(spacing: 0) {
            ScrollView {
                content
                    .padding(.horizontal, Spacing.xl)
                    .padding(.top, Spacing.xxl)
                    .padding(.bottom, Spacing.lg)
            }
            .scrollBounceBehavior(.basedOnSize)
            VStack(spacing: Spacing.sm) {
                errorLine
                Button {
                    Task { await store.agree() }
                } label: {
                    agreeLabel.frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(isSaving)

                Button(role: isConfirming ? .destructive : nil) {
                    if isConfirming { Task { await store.confirmDecline() } } else { store.decline() }
                } label: {
                    Text(isConfirming ? AIConsent.confirmDecline : AIConsent.decline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
                .disabled(isSaving)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.lg)
        }
        .tint(theme.accent)
#else
        VStack(alignment: .leading, spacing: Spacing.lg) {
            content
            errorLine
            HStack {
                Spacer()
                Button(isConfirming ? AIConsent.confirmDecline : AIConsent.decline, role: isConfirming ? .destructive : nil) {
                    if isConfirming { Task { await store.confirmDecline() } } else { store.decline() }
                }
                .disabled(isSaving)
                // Escape never closes the sheet unanswered: it asks to
                // confirm, and on the confirmation goes back.
                Button("") { if isConfirming { store.back() } else { store.decline() } }
                    .keyboardShortcut(.cancelAction)
                    .frame(width: 0, height: 0)
                    .opacity(0)
                    .accessibilityHidden(true)
                Button {
                    Task { await store.agree() }
                } label: {
                    agreeLabel
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(isSaving)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
        .tint(theme.accent)
#endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Image(systemName: "sparkles")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(theme.accent)
                .accessibilityHidden(true)
            Text(isConfirming ? AIConsent.confirmTitle : AIConsent.title)
                .font(.title2.weight(.bold))
                .foregroundStyle(theme.text)
                .accessibilityAddTraits(.isHeader)
            Text(isConfirming ? AIConsent.confirmBody : AIConsent.body)
                .font(.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            // `Link` opens through `openURL`, which is the system browser.
            if !isConfirming, let url = URL(string: AIConsent.privacyURL) {
                Link(AIConsent.privacyLabel, destination: url)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(theme.accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var errorLine: some View {
        if let error = store.prompt?.error {
            Text(error)
                .font(.footnote)
                .foregroundStyle(theme.danger)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    @ViewBuilder
    private var agreeLabel: some View {
        let title = isConfirming ? AIConsent.confirmAllow : AIConsent.agree
        if isSaving {
            HStack(spacing: Spacing.sm) {
                ProgressView().controlSize(.small)
                Text(title)
            }
        } else {
            Text(title)
        }
    }
}

// MARK: - Presenter

extension View {
    /// Mount once near the app root. Every AI entry point then just calls the
    /// gate (`AIConsentGate.ensure()` / `AIConsentStore.require`); this shows
    /// the sheet whenever the store asks for one and takes it down when the
    /// store is answered.
    func aiConsentPresenter(_ store: AIConsentStore) -> some View {
        modifier(AIConsentPresenterModifier(store: store))
    }
}

private struct AIConsentPresenterModifier: ViewModifier {
    @Environment(\.theme) private var theme

    let store: AIConsentStore
    @State private var presenter = AIConsentPresenter()

    func body(content: Content) -> some View {
        content
            .onChange(of: store.prompt?.id, initial: true) { _, id in
                if id != nil {
                    presenter.present(store: store, theme: theme)
                } else {
                    presenter.dismiss()
                }
            }
    }
}

/// Presents the sheet through UIKit / AppKit on the **frontmost** controller or
/// window rather than with a root `.sheet`. A SwiftUI sheet attached at the
/// root cannot appear while another sheet is already up - and the AI actions
/// most likely to need consent (the verse sheet's Explain, note AI, Memories'
/// summary inside Settings) all live in sheets.
@MainActor
private final class AIConsentPresenter {
#if os(iOS)
    private weak var hosting: UIViewController?
    private let delegate = DismissDelegate()

    func present(store: AIConsentStore, theme: SureWordColors, attempt: Int = 0) {
        guard hosting == nil, let promptID = store.prompt?.id else { return }
        guard let top = Self.topViewController(),
              !top.isBeingPresented, !top.isBeingDismissed, top.transitionCoordinator == nil
        else {
            // Something is mid-animation (the verse sheet opening on the same
            // tap that started its explanation). Wait for it; give up only
            // after a couple of seconds, which releases the action unrun.
            guard attempt < 20 else {
                store.cancelPending()
                return
            }
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(150))
                self?.present(store: store, theme: theme, attempt: attempt + 1)
            }
            return
        }

        let controller = AIConsentHostingController(
            rootView: AnyView(AIConsentSheet(store: store).environment(\.theme, theme))
        )
        controller.overrideUserInterfaceStyle = theme.isDark ? .dark : .light
        controller.modalPresentationStyle = .pageSheet
        if let sheet = controller.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }
        delegate.store = store
        controller.presentationController?.delegate = delegate
        // The question is asked once, ever, so it cannot be swiped away
        // unanswered; a swipe attempt moves to the "Turn off AI?" step.
        controller.isModalInPresentation = true
        // If the controller it sits on is dismissed underneath it, release the
        // waiting actions unrun and record nothing.
        controller.onDisappear = { [weak store] in
            guard let store, store.prompt?.id == promptID else { return }
            store.cancelPending()
        }
        top.present(controller, animated: true)
        hosting = controller
    }

    func dismiss() {
        guard let hosting else { return }
        self.hosting = nil
        if hosting.presentingViewController != nil {
            hosting.dismiss(animated: true)
        }
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow) ?? windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    /// The sheet is modal in presentation, so a swipe-down lands here: it
    /// shows the "Turn off AI?" confirmation instead of closing.
    private final class DismissDelegate: NSObject, UIAdaptivePresentationControllerDelegate {
        weak var store: AIConsentStore?

        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            MainActor.assumeIsolated { store?.decline() }
        }
    }
#elseif os(macOS)
    private var sheetWindow: NSWindow?

    func present(store: AIConsentStore, theme: SureWordColors) {
        guard sheetWindow == nil else { return }
        // The key window is the frontmost surface - Settings is a sheet over
        // the main window, and Memories a sheet over that - so walk to the
        // innermost attached sheet and stack on it.
        guard var parent = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: \.isVisible) else {
            store.cancelPending()
            return
        }
        while let attached = parent.attachedSheet { parent = attached }

        let controller = NSHostingController(
            rootView: AIConsentSheet(store: store).environment(\.theme, theme)
        )
        controller.sizingOptions = [.preferredContentSize]
        let window = NSWindow(contentViewController: controller)
        window.styleMask = [.titled]
        window.title = AIConsent.title
        window.appearance = NSAppearance(named: theme.isDark ? .darkAqua : .aqua)
        sheetWindow = window
        parent.beginSheet(window)
    }

    func dismiss() {
        guard let window = sheetWindow else { return }
        sheetWindow = nil
        if let parent = window.sheetParent {
            parent.endSheet(window)
        } else {
            window.orderOut(nil)
        }
    }
#endif
}

#if os(iOS)
/// Reports its own disappearance, however it was caused.
private final class AIConsentHostingController: UIHostingController<AnyView> {
    var onDisappear: (() -> Void)?

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        onDisappear?()
    }
}
#endif

// MARK: - Settings → AI

/// Settings → AI, shared by both Apple clients: the "AI data sharing" row with
/// "Allowed on <date>" or "Off", "Turn off AI" behind a confirm dialog, and
/// "Turn on AI", which shows the disclosure again. Same row as the web and
/// Android settings.
struct AIConsentSettingsSection: View {
    @Environment(\.theme) private var theme

    let store: AIConsentStore

    @State private var isConfirmingWithdraw = false

    var body: some View {
        Section("AI") {
            LabeledContent(AIConsent.settingsTitle, value: store.statusLabel)
            if store.isCurrent {
                Button(AIConsent.withdraw, role: .destructive) { isConfirmingWithdraw = true }
                    .disabled(store.isWithdrawing)
                    .confirmationDialog(
                        "Turn off AI?",
                        isPresented: $isConfirmingWithdraw,
                        titleVisibility: .visible
                    ) {
                        Button(AIConsent.withdraw, role: .destructive) {
                            Task { await store.withdraw() }
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text(
                            "Chat, verse explanations and the other AI features stop working "
                                + "until you turn AI back on here. Your study data is kept."
                        )
                    }
            } else {
                Button(AIConsent.enable) { store.reconsider() }
                    .disabled(store.prompt != nil)
            }
            Text("What SureWord sends to AI providers to answer you, and your permission for it.")
                .font(.system(size: 11))
                .foregroundStyle(theme.textGhost)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            if !store.hasServerState { await store.refresh() }
        }
        .alert(
            "Could not turn off AI",
            isPresented: Binding(
                get: { store.withdrawError != nil },
                set: { if !$0 { store.withdrawError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.withdrawError ?? "")
        }
    }
}
