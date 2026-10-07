import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    /// Posted on the main actor when APNs delivers (or refreshes) this device's
    /// token, so the shell can re-run its notification sync.
    static let pushTokenDidChange = Notification.Name("sureword.pushTokenDidChange")
}

/// Remote push for the morning verse and "your answer is ready" - the iOS half
/// of `usePushNotifications.ts` / `registerPushToken` in
/// `mobile/src/features/notifications/` (PRD B6).
///
/// The device's APNs token is exchanged for an Expo push token in the same EAS
/// project Android uses (`ExpoPushTokenExchange`), and that Expo token is what
/// `POST /api/push-tokens` stores, with `platform: "ios"` and the same body
/// Android sends. The server then needs no iOS-specific code: its one Expo
/// sender reaches both phones, once the APNs key is uploaded to that EAS
/// project. Until then `isServerDeliveryConfigured` is false and nothing is
/// registered, because a token Expo cannot deliver to would still count as
/// this account's newest device and the local reminder would stand down for a
/// push that never comes. See `docs/ios/push-design.md`.
///
/// Everything is best-effort, as on Android: a denial, a missing entitlement,
/// an Expo outage or an offline launch are all swallowed, and
/// `PushDeliveryPlan` decides whether the local daily reminder covers for it.
@MainActor
enum PushRegistration {
    /// Flip to true once the SureWord APNs key is uploaded to the EAS project
    /// (`docs/ios/push-design.md`, step 2). It gates the Expo exchange and the
    /// server registration only; APNs registration itself always runs.
    static let isServerDeliveryConfigured = false

    private static let apnsTokenKey = "push.apnsDeviceToken"
    private static let expoTokenKey = "push.expoToken"
    /// The APNs token `expoTokenKey` was minted from; a new APNs token needs a
    /// new exchange.
    private static let expoTokenSourceKey = "push.expoTokenSource"
    /// Android's `sureword.notifications.remoteLive`: this device registered a
    /// token with the backend, so a later failed registration must not re-arm
    /// the local daily.
    private static let remoteLiveKey = "push.remoteLive"
    /// Expo's `deviceId`, a per-install UUID like `getInstallationIdAsync`.
    private static let installationIDKey = "push.installationId"

    /// The last token APNs issued, hex-encoded, kept across launches so a
    /// settings change can re-register (or unregister) without waiting for
    /// APNs to call back.
    static var storedToken: String? {
        UserDefaults.standard.string(forKey: apnsTokenKey)
    }

    static var isRemoteLive: Bool {
        UserDefaults.standard.bool(forKey: remoteLiveKey)
    }

    /// Ask iOS for a token; the answer arrives on the AppDelegate. Never
    /// prompts, and only called once notifications are authorized, so the
    /// launch path stays free of any dialog (PRD B6a).
    static func begin() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// AppDelegate callback entry point.
    static func store(_ deviceToken: Data) {
        let hex = ExpoPushTokenExchange.hex(deviceToken)
        guard hex != storedToken else { return }
        UserDefaults.standard.set(hex, forKey: apnsTokenKey)
        NotificationCenter.default.post(name: .pushTokenDidChange, object: nil)
    }

    /// Bring both delivery paths in line with the settings: the server's
    /// push-token row, then the local daily reminder. Called on launch, on
    /// every settings change, on a new APNs token and after a permission grant.
    static func syncAll(api: APIClient, settings: SettingsStore) async {
        let authorized = await DailyCrossNotifications.isAuthorized()
        let outcome = await register(
            api: api,
            authorized: authorized,
            verseOfDayEnabled: settings.verseOfDayEnabled,
            chatReplies: settings.notifyChatReplies,
            hour: settings.verseOfDayHour
        )
        let plan = PushDeliveryPlan.plan(
            verseOfDayEnabled: settings.verseOfDayEnabled,
            authorized: authorized,
            outcome: outcome,
            remoteLive: isRemoteLive
        )
        UserDefaults.standard.set(plan.remoteLive, forKey: remoteLiveKey)
        if plan.scheduleLocalReminder {
            await DailyCrossNotifications.sync(
                enabled: true,
                hour: settings.verseOfDayHour,
                mayRequestAuthorization: false
            )
        } else {
            DailyCrossNotifications.cancel()
        }
    }

    private static func register(
        api: APIClient,
        authorized: Bool,
        verseOfDayEnabled: Bool,
        chatReplies: Bool,
        hour: Int
    ) async -> PushRegistrationOutcome {
        guard authorized else { return .unavailable }
        // Safe to repeat: iOS answers from its cache once it has a token.
        begin()
        guard isServerDeliveryConfigured, let apnsToken = storedToken else { return .unavailable }

        // The device registers whenever ANY stream is wanted; the two
        // preferences travel with the token rather than deciding whether it
        // exists, so silencing one never silences the other.
        let wantsPush = verseOfDayEnabled || chatReplies
        guard let expoToken = await expoToken(for: apnsToken) else { return .unavailable }

        if !wantsPush {
            struct UnregisterBody: Encodable { let token: String }
            _ = try? await api.data("/api/push-tokens", method: "DELETE", body: UnregisterBody(token: expoToken))
            return .unregistered
        }

        struct RegisterBody: Encodable {
            let token: String
            let platform: String
            let timezone: String
            let notifyHour: Int
            let enabled: Bool
            let chatReplies: Bool
        }
        do {
            try await api.data(
                "/api/push-tokens",
                method: "POST",
                body: RegisterBody(
                    token: expoToken,
                    platform: "ios",
                    timezone: TimeZone.current.identifier,
                    notifyHour: hour,
                    enabled: verseOfDayEnabled,
                    chatReplies: chatReplies
                )
            )
            return .registered
        } catch {
            return .unavailable
        }
    }

    /// The Expo token for this APNs token, exchanged once and then reused.
    private static func expoToken(for apnsToken: String) async -> String? {
        let defaults = UserDefaults.standard
        if defaults.string(forKey: expoTokenSourceKey) == apnsToken,
           let cached = defaults.string(forKey: expoTokenKey) {
            return cached
        }
        let request = ExpoPushTokenExchange.Request(
            apnsToken: apnsToken,
            deviceID: installationID(),
            development: apsEnvironmentIsDevelopment,
            bundleID: Bundle.main.bundleIdentifier ?? "com.spragginsdesigns.sureword",
            projectID: Config.expoProjectID
        )
        var urlRequest = URLRequest(url: ExpoPushTokenExchange.url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.timeoutInterval = 30
        guard let body = try? JSONEncoder().encode(request) else { return nil }
        urlRequest.httpBody = body
        guard let (data, response) = try? await URLSession.shared.data(for: urlRequest),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let token = try? ExpoPushTokenExchange.parse(data)
        else { return nil }
        defaults.set(token, forKey: expoTokenKey)
        defaults.set(apnsToken, forKey: expoTokenSourceKey)
        return token
    }

    private static func installationID() -> String {
        let defaults = UserDefaults.standard
        if let existing = defaults.string(forKey: installationIDKey) { return existing }
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: installationIDKey)
        return fresh
    }

    /// Debug builds are signed with `aps-environment = development` and
    /// Release (TestFlight, App Store) with `production`; see the entitlement
    /// in `project.yml`. Expo routes the token to the matching APNs host.
    private static var apsEnvironmentIsDevelopment: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}

/// The deferred permission dialog (PRD B6a), owned by the signed-in shell.
/// Launch only ever reads the status; the dialog opens at a moment reported to
/// `NotificationPermissionMoments`, and a grant re-runs the sync so the
/// reminder and the push token arrive straight away.
@MainActor
enum NotificationPermissionCoordinator {
    private static var isAsking = false

    /// Returns true when the dialog was shown and granted.
    static func handle(_ trigger: NotificationPermissionTrigger, settings: SettingsStore) async -> Bool {
        // One dialog at a time: an answer settling while the Cross sheet's
        // trigger is mid-check must not queue a second prompt behind it.
        guard !isAsking else { return false }
        isAsking = true
        defer { isAsking = false }
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings().authorizationStatus
        let status = NotificationPermissionStatus(
            granted: current == .authorized || current == .provisional || current == .ephemeral,
            canAskAgain: current == .notDetermined
        )
        guard NotificationPermissionPrompt.shouldRequest(
            verseOfDayEnabled: settings.verseOfDayEnabled,
            chatReplies: settings.notifyChatReplies,
            asked: NotificationPermissionPrompt.hasAsked(),
            status: status,
            trigger: trigger
        ) else { return false }
        NotificationPermissionPrompt.markAsked()
        return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }
}
