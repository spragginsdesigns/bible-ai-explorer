import Foundation
import UIKit

extension Notification.Name {
    /// Posted on the main actor when APNs delivers (or refreshes) this device's
    /// token, so the shell can re-run `PushRegistration.sync`.
    static let pushTokenDidChange = Notification.Name("sureword.pushTokenDidChange")
}

/// Remote-push registration for the verse-of-the-day cron — the iOS half of
/// `registerPushToken` / `unregisterPushToken` in
/// `mobile/src/features/notifications/api.ts`.
///
/// Everything here is best-effort, mirroring Android: registration needs the
/// `aps-environment` entitlement, which needs a paid-program provisioning
/// profile this project doesn't carry (see the signing notes in
/// `project.yml`). Until then `registerForRemoteNotifications` fails, no token
/// is ever stored, `sync` is a no-op, and the locally scheduled reminder in
/// `DailyCrossNotifications` is the delivery path — the same fallback Android
/// runs today. The code path is complete so that adding the entitlement later
/// is a signing change, not a code change.
@MainActor
enum PushRegistration {
    private static let tokenKey = "push.apnsDeviceToken"

    /// The last token APNs issued, hex-encoded, kept across launches so a
    /// settings change can re-register (or unregister) without waiting for
    /// APNs to call back.
    static var storedToken: String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    /// Ask iOS for a token; the answer arrives on the AppDelegate. Safe to
    /// call liberally — it does not prompt (notification authorization is
    /// requested by `DailyCrossNotifications.sync` instead) and failure is
    /// silent by design.
    static func begin() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// AppDelegate callback entry point.
    static func store(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard hex != storedToken else { return }
        UserDefaults.standard.set(hex, forKey: tokenKey)
        NotificationCenter.default.post(name: .pushTokenDidChange, object: nil)
    }

    /// Keep the server's push-token table in step with the user's settings,
    /// alongside `DailyCrossNotifications.sync` (same call site in TabShell).
    /// No token → kick off registration and leave the local reminder in place.
    static func sync(api: APIClient, enabled: Bool, hour: Int) async {
        guard let token = storedToken else {
            if enabled { begin() }
            return
        }

        struct RegisterBody: Encodable {
            let token: String
            let platform: String
            let timezone: String
            let notifyHour: Int
        }
        struct UnregisterBody: Encodable {
            let token: String
        }

        if enabled {
            try? await api.data(
                "/api/push-tokens",
                method: "POST",
                body: RegisterBody(
                    token: token,
                    platform: "ios",
                    timezone: TimeZone.current.identifier,
                    notifyHour: hour
                )
            )
        } else {
            try? await api.data("/api/push-tokens", method: "DELETE", body: UnregisterBody(token: token))
            UserDefaults.standard.removeObject(forKey: tokenKey)
        }
    }
}
