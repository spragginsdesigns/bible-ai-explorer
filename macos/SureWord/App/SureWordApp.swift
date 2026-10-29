import ClerkKit
import ClerkKitUI
import SwiftUI
import UserNotifications

@main
struct SureWordApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var settings = SettingsStore()
    @State private var root = RootModel()

    /// Debug builds keep their Clerk session under their own keychain service,
    /// so they never read the installed app's items. Agent worktrees build
    /// Debug, often unsigned (`CODE_SIGNING_ALLOWED=NO` test hosts), and every
    /// such build that read the shared items raised a login-password prompt;
    /// approving one rewrote the items' partition list and locked out
    /// `/Applications/SureWord.app` until Austin typed his password again
    /// (2026-10-25). ClerkKit only reads the bundle-id service as a legacy
    /// fallback when shared session sync is on, which SureWord does not use.
    private static let keychainService: String = {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.spragginsdesigns.sureword"
        #if DEBUG
        return bundleID + ".debug"
        #else
        return bundleID
        #endif
    }()

    init() {
        Clerk.configure(
            publishableKey: Config.clerkPublishableKey,
            options: .init(
                // No access group on purpose. Naming one would select the
                // data-protection keychain, but that needs a
                // `keychain-access-groups` entitlement, which a sandboxed macOS
                // app can only carry with an embedded provisioning profile — and
                // that needs a paid membership. Adding it unauthorized hangs the
                // app in `_libsecinit_initializer` before main(); adding it while
                // ad-hoc signed fails every keychain call with OSStatus -34018.
                //
                // So ClerkKit uses the legacy keychain here. That is only safe
                // because the app has a *stable* signing identity: the keychain
                // ACL is bound to the app's designated requirement, and an ad-hoc
                // signature changes it on every build, which is what made
                // `configure()` block on a consent prompt during development.
                keychainConfig: .init(service: Self.keychainService),
                // Clerk's default redirect is `{bundleID}://callback`, which is
                // NOT on this instance's allowlist. Production Clerk rejects
                // unlisted redirects *silently*, so leaving this at the default
                // would fail sign-in with no error — the exact failure mode
                // recorded in CLAUDE.md. These two values must stay in sync with
                // the dashboard's allowlist and with Info.plist's URL scheme.
                redirectConfig: .init(
                    redirectUrl: Config.ssoCallbackURL,
                    callbackUrlScheme: Config.redirectScheme
                ),
                // The sign-in funnel reads Clerk's responses (see
                // `SignInAnalytics`); it never alters or throws on one.
                middleware: .init(response: [SignInAnalyticsMiddleware()])
            )
        )
        // Install/update, then Application Opened (Android's
        // `captureAppLifecycleEvents`).
        Analytics.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView(root: root)
                .sureWordLaunchSplash()
                .prefetchClerkImages()
                // Clerk's OAuth round-trip returns through the `sureword://`
                // scheme; without this the browser hands back a callback the app
                // never consumes and sign-in hangs on the last step. A file URL
                // is a file dropped on the Dock icon (or opened with SureWord):
                // "Share into SureWord" (`MacShareInbox`). A `sureword://` URL
                // Clerk does not claim is the app's own deep link
                // (sureword://cross, sureword://verse?ref=…), buffered for the
                // signed-in window as on iOS.
                .onOpenURL { url in
                    if url.isFileURL {
                        Task { @MainActor in MacShareInbox.shared.open(fileURL: url) }
                        return
                    }
                    if url.scheme?.lowercased() == "sureword", url.host?.lowercased() == "share" {
                        MacShareInbox.shared.extensionShareArrived()
                        return
                    }
                    Task { @MainActor in
                        let handledByClerk = (try? await Clerk.shared.handle(url)) ?? false
                        guard !handledByClerk, let link = DeepLink.parse(url) else { return }
                        PendingDeepLinks.shared.post(link)
                    }
                }
                .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
                // Injected last, so it is the outermost modifier: anything
                // applied *after* `.environment` wraps the injection instead of
                // sitting inside it, and Clerk's own modifiers read
                // `@Environment(Clerk.self)` — getting this order wrong traps at
                // launch with "No Observable object of type Clerk found".
                .environment(Clerk.shared)
                .environment(settings)
        }
        .defaultSize(width: 1180, height: 820)
        .windowToolbarStyle(.unified)
        .commands { AppCommands(app: root.app) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Must be set before any notification can be delivered, or a click on
        // the morning reminder does nothing but foreground the app.
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(NotificationArt.categories)
        // "Share into SureWord" in other apps' Services menus (`NSServices` in
        // project.yml, handled in `MacShareInbox.swift`). Requests can arrive
        // as soon as this is set.
        NSApp.servicesProvider = self
    }

    /// Reopen a window when the app is activated with none open. If SureWord is
    /// force-quit, macOS saves "no windows" and the next launch restores exactly
    /// that — the app runs with no UI at all and looks broken. Clicking the Dock
    /// icon is then the recovery, and this is what makes it work.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Show the reminder even when SureWord is the frontmost app — without
    /// this macOS suppresses it, and a user sitting in the app at 8am would
    /// never learn their day was ready.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(ChatStopSignals.shared.isUnwantedChatPush(notification.request.content.userInfo) ? [] : [.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Every destination must enter the cold-start buffer. The window's
        // live observers also drain that buffer, so a bare wake-up event has
        // no destination to open. Match iOS's remote/legacy-local semantics.
        let request = response.notification.request
        let link: DeepLink
        switch NotificationTapTarget(userInfo: request.content.userInfo) {
        case .chat(let conversationID): link = .chat(conversationID)
        case .reference(let reference): link = .verse(reference)
        case .cross: link = .cross
        case nil:
            guard request.trigger is UNCalendarNotificationTrigger else {
                completionHandler()
                return
            }
            link = .cross
        }
        Task { @MainActor in PendingDeepLinks.shared.post(link) }
        completionHandler()
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in MacPushRegistration.store(deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {}
}

/// Holds the signed-in `AppModel` so the menu commands can reach it from the
/// scene, outside the view hierarchy.
@MainActor
@Observable
final class RootModel {
    var app: AppModel?
}

/// Chooses between the signed-out and signed-in shells, and owns theme resolution.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(Clerk.self) private var clerk
    @Environment(SettingsStore.self) private var settings
    @Environment(\.colorScheme) private var systemScheme

    @Bindable var root: RootModel

    private var scheme: ColorScheme {
        settings.appearance.colorScheme ?? systemScheme
    }

    var body: some View {
        Group {
            if clerk.user == nil {
                SignInView()
            } else if let app = root.app {
                MainWindow().environment(app).aiConsentPresenter(app.aiConsent).whatsNewPresenter(app)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        // "Share into SureWord": files, or a web page's link, dropped anywhere
        // on the window, signed in or out (`MacShareInbox`). A drop on the
        // composer still attaches to the open chat; that target is innermost.
        .dropDestination(for: URL.self) { urls, _ in
            let items = MacSharedItems(urls: urls)
            guard !items.isEmpty else { return false }
            Task { @MainActor in MacShareInbox.shared.receive(items) }
            return true
        }
        .onChange(of: scenePhase) { _, phase in root.app?.bible.reading.setForeground(phase == .active) }
        // Analytics identity, lifecycle and sign-in completions. Identify on a
        // session; reset only when somebody who WAS signed in signs out.
        .onChange(of: scenePhase) { _, phase in
            Analytics.shared.phaseChanged(to: AnalyticsScenePhase.name(phase))
        }
        .onChange(of: clerk.user?.id, initial: true) { _, userID in
            Analytics.shared.sessionChanged(userID: userID)
        }
        .task { await Analytics.shared.observeSignIns() }
        // SDK profile sign-out/account switching can bypass ClerkAuth.signOut.
        // Clerk's actual session transition is the authoritative local fence;
        // remote dispatch independently checks that same server-side session.
        .onChange(of: clerk.session?.id) { previousID, sessionID in
            guard previousID != nil, previousID != sessionID else { return }
            AnswerReadyNotifier.invalidateForAccountChange()
            MacPushRegistration.clearLocalDeliveryForAccountChange()
            _ = PendingDeepLinks.shared.drain()
            if let app = root.app, app.userID == clerk.user?.id, sessionID != nil {
                Task { await MacPushRegistration.syncAll(api: app.api, settings: settings, accountID: app.userID) }
            }
        }
        // The account's text size, on top of the system's (Walk with me).
        .textScaled(settings.textScale)
        .sureWordTheme(for: scheme)
        .preferredColorScheme(settings.appearance.colorScheme)
        .environment(\.clerkTheme, .sureWord(scheme: scheme))
        // The API client's token provider needs a live Clerk session, so the
        // model is built on sign-in and torn down on sign-out — that teardown
        // is also what clears the previous user's conversations from memory.
        .onChange(of: clerk.user?.id, initial: true) { previousID, userID in
            root.app?.bible.reading.teardown()
            guard let userID else {
                root.app = nil
                // Only a *real* sign-out clears the per-account caches.
                // `initial: true` also fires with nil at launch, before Clerk
                // has restored the session, and clearing there would throw away
                // the cache on every cold start - the opposite of what a
                // first-paint cache is for.
                if previousID != nil {
                    PreferencesSyncModel.clearAccountCaches(settings: settings, highlights: nil)
                }
                return
            }
            root.app = AppModel(settings: settings, userID: userID)
            root.app?.bible.reading.setForeground(scenePhase == .active)
        }
    }
}
