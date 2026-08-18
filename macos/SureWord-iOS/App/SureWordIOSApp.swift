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
                )
            )
        )
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
                        guard !handledByClerk, let link = DeepLink.parse(url) else { return }
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
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Route through PendingDeepLinks rather than posting the notification
        // bare: on a cold start TabShell doesn't exist yet, and the buffer is
        // what carries the tap across Clerk's session restore.
        Task { @MainActor in PendingDeepLinks.shared.post(.cross) }
        // Called from here, not inside the Task: capturing the task-isolated
        // handler in a main-actor closure is a data race (and a build error
        // under complete strict concurrency). The post is fire-and-forget, so
        // there is nothing to wait on.
        completionHandler()
    }

    // MARK: - Remote notifications (verse-of-the-day cron)

    /// Best-effort APNs registration for POST /api/push-tokens. Without the
    /// `aps-environment` entitlement — which needs a paid-program provisioning
    /// profile this project doesn't carry — iOS never delivers a token and the
    /// failure callback fires instead; that is the normal path today, on
    /// device and simulator alike, and the locally scheduled reminder in
    /// `DailyCrossNotifications` keeps the feature working (the same fallback
    /// Android runs while it has no EAS projectId).
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
        // Expected without the entitlement; the local daily reminder is the
        // delivery path and nothing needs to surface.
    }
}

/// Chooses between the signed-out and signed-in shells, and owns theme
/// resolution — the iOS counterpart of the macOS `RootView`.
struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(SettingsStore.self) private var settings
    @Environment(\.colorScheme) private var systemScheme

    @State private var app: AppModel?

    private var scheme: ColorScheme {
        settings.appearance.colorScheme ?? systemScheme
    }

    var body: some View {
        Group {
            if clerk.user == nil {
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
        .onChange(of: clerk.user?.id, initial: true) { _, userID in
            app = userID == nil ? nil : AppModel(settings: settings)
        }
    }
}
