import ClerkKit
import ClerkKitUI
import SwiftUI
import UIKit
import UserNotifications

@main
struct SureWordIOSApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var settings = SettingsStore()

    init() {
        // Same configuration as the macOS client (see
        // `SureWord/App/SureWordApp.swift`): the publishable key pins the Clerk
        // instance, and the explicit redirect config matters because Clerk's
        // default `{bundleID}://callback` is not on this instance's allowlist.
        Clerk.configure(
            publishableKey: Config.clerkPublishableKey,
            options: .init(
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
        // StoreKit 2: renewals, Ask to Buy approvals and refunds arrive on
        // Transaction.updates from launch. Anything that lands before an
        // account signs in stays unfinished and is verified on attach.
        ProPurchaseStore.shared.startListening()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .prefetchClerkImages()
                // Clerk's OAuth round-trip returns through the `sureword://`
                // scheme; without this sign-in hangs on the last step. URLs
                // Clerk doesn't claim are the app's own deep links
                // (sureword://cross, sureword://verse?ref=…).
                .onOpenURL { url in
                    Task { @MainActor in
                        let handledByClerk = (try? await Clerk.shared.handle(url)) ?? false
                        guard !handledByClerk else { return }
                        // The share extension saved something to the inbox.
                        // The share itself is on disk, so a signed-out app
                        // loses nothing by ignoring this; the shell looks
                        // again when it appears.
                        if url.scheme == PendingShare.openURL.scheme, url.host == PendingShare.openURL.host {
                            NotificationCenter.default.post(name: .pendingShareArrived, object: nil)
                            return
                        }
                        guard let link = DeepLink.parse(url) else { return }
                        PendingDeepLinks.shared.post(link)
                    }
                }
                // Injected last, so it is the outermost modifier (see the macOS
                // app for why the order matters).
                .environment(Clerk.shared)
                .environment(settings)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Must be set before any notification can be delivered, or a tap on the
        // morning reminder does nothing but foreground the app.
        UNUserNotificationCenter.current().delegate = self
        return true
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Show the reminder even when SureWord is the frontmost app — without this
    /// iOS suppresses it, and a user sitting in the app at 8am would never
    /// learn their day was ready. `nonisolated`: the body only calls the
    /// completion handler and posts a notification, both thread-safe, and the
    /// system invokes these on the main thread anyway.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // "Your answer is ready" for an answer this device stopped or walked
        // away from is noise, as on Android (`chatStopSignals.ts`).
        if ChatStopSignals.shared.isUnwantedChatPush(notification.request.content.userInfo) {
            completionHandler([])
            return
        }
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Where the tap lands, Android's `notificationTapTarget`: the guided
        // day, the conversation whose answer finished while away, or (older
        // verse-only payloads) the reader. A remote payload with nothing to
        // route on navigates nowhere, as on Android; a local reminder with no
        // payload was scheduled by an older build, and it opened the Cross.
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
        // Route through PendingDeepLinks rather than posting the notification
        // bare: on a cold start TabShell doesn't exist yet, and the buffer is
        // what carries the tap across Clerk's session restore.
        Task { @MainActor in PendingDeepLinks.shared.post(link) }
        // Called from here, not inside the Task: capturing the task-isolated
        // handler in a main-actor closure is a data race (and a build error
        // under complete strict concurrency). The post is fire-and-forget, so
        // there is nothing to wait on.
        completionHandler()
    }

    // MARK: - Remote notifications (morning verse, answer ready)

    /// APNs registration for POST /api/push-tokens (see `PushRegistration`).
    /// Requested only once notifications are authorized; the token is
    /// exchanged for an Expo token before it ever reaches the server.
    nonisolated func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushRegistration.store(deviceToken) }
    }

    nonisolated func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        // Best-effort: the local daily reminder covers the morning verse, and
        // nothing needs to surface.
    }
}

/// Chooses between the signed-out and signed-in shells, and owns theme
/// resolution — the iOS counterpart of the macOS `RootView`.
struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(SettingsStore.self) private var settings
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.scenePhase) private var scenePhase

    @State private var app: AppModel?

    private var scheme: ColorScheme {
        settings.appearance.colorScheme ?? systemScheme
    }

    var body: some View {
        Group {
            if UIEvidenceHarness.isEnabled {
                // Debug-only screenshot harness; see `UIEvidenceHarness`.
                UIEvidenceHarness()
            } else if clerk.user == nil {
                SignInView()
            } else if let app {
                TabShell().environment(app)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .sureWordTheme(for: scheme)
        .preferredColorScheme(settings.appearance.colorScheme)
        .environment(\.clerkTheme, .sureWord(scheme: scheme))
        // The API client's token provider needs a live Clerk session, so the
        // model is built on sign-in and torn down on sign-out — that teardown
        // is also what clears the previous user's conversations from memory.
        // Analytics identity, lifecycle and sign-in completions. Identify on a
        // session; reset only when somebody who WAS signed in signs out.
        .onChange(of: clerk.user?.id, initial: true) { _, userID in
            Analytics.shared.sessionChanged(userID: userID)
        }
        .onChange(of: scenePhase) { _, phase in
            Analytics.shared.phaseChanged(to: AnalyticsScenePhase.name(phase))
        }
        .task { await Analytics.shared.observeSignIns() }
        .onChange(of: clerk.user?.id, initial: true) { previousID, userID in
            app?.bible.reading.teardown()
            guard let userID else {
                app = nil
                ProPurchaseStore.shared.detach()
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
            let model = AppModel(settings: settings, userID: userID)
            app = model
            // Binds StoreKit purchases to this account (appAccountToken) and
            // re-verifies anything StoreKit is still holding for it.
            ProPurchaseStore.shared.attach(api: model.api, userID: userID)
        }
    }
}
