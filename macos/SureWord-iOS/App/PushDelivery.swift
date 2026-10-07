import Foundation

/// The pure halves of iOS push (PRD B6): the Expo token exchange's wire shape
/// and the rule for when the local daily reminder must stand down. No UIKit,
/// no network, so both are unit-tested (`PushDeliveryTests`).
///
/// Why Expo at all: the server delivers to phones only through the Expo push
/// API (`src/lib/push.ts`), and `splitRecipients` in `src/lib/push-routing.ts`
/// drops any stored token that is not `ExponentPushToken[...]`. A raw APNs
/// device token registered as-is would never be sent to, and worse, as the
/// account's newest token it would decide the morning hour for its Android
/// phone too (`planMorningAudience` follows the newest device). So iOS does
/// what `expo-notifications` does inside `getExpoPushTokenAsync`: it hands its
/// APNs token to Expo and registers the Expo token it gets back.
enum ExpoPushTokenExchange {
    static let url = URL(string: "https://exp.host/--/api/v2/push/getExpoPushToken")!

    /// The body `expo-notifications` sends (`getExpoPushTokenAsync.ts`), field
    /// for field. `development` picks APNs sandbox vs production for the
    /// token, so it must match the build's `aps-environment`.
    struct Request: Encodable, Equatable {
        let type: String
        let deviceId: String
        let development: Bool
        let appId: String
        let deviceToken: String
        let projectId: String

        init(apnsToken: String, deviceID: String, development: Bool, bundleID: String, projectID: String) {
            type = "apns"
            deviceId = deviceID.lowercased()
            self.development = development
            appId = bundleID
            deviceToken = apnsToken
            self.projectId = projectID
        }
    }

    struct MalformedResponse: LocalizedError {
        var errorDescription: String? { "Expo did not return a push token." }
    }

    /// `{ "data": { "expoPushToken": "ExponentPushToken[...]" } }`, the only
    /// shape `getExpoPushToken` in expo-notifications accepts.
    static func parse(_ data: Data) throws -> String {
        struct Envelope: Decodable {
            struct Payload: Decodable { let expoPushToken: String }
            let data: Payload
        }
        guard let token = try? JSONDecoder().decode(Envelope.self, from: data).data.expoPushToken,
              isExpoToken(token)
        else { throw MalformedResponse() }
        return token
    }

    /// Same pattern the server's `isExpoPushToken` checks before sending.
    static func isExpoToken(_ token: String) -> Bool {
        token.range(of: #"^Expo(nent)?PushToken\[.+\]$"#, options: .regularExpression) != nil
    }

    /// APNs hands the token over as bytes; Expo and the server want lowercase hex.
    static func hex(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }
}

/// What the server registration came to, as far as the local reminder cares.
enum PushRegistrationOutcome: Equatable, Sendable {
    /// `POST /api/push-tokens` accepted this device; the server now pushes.
    case registered
    /// Neither stream is wanted, so the device was unregistered (or never was).
    case unregistered
    /// No Expo token yet, server delivery not configured, or the request
    /// failed. The local reminder may be the only delivery path.
    case unavailable
}

/// Android's local-fallback rule from `usePushNotifications.ts`, verbatim:
///
/// - remote delivery live → cancel the local daily (both firing is the
///   duplicate-notification bug);
/// - a failed registration while the server still holds this device's token
///   (`remoteLive`) also cancels it, so an offline launch cannot re-arm it;
/// - otherwise the local daily runs whenever the morning verse is on and the
///   app may show notifications.
enum PushDeliveryPlan {
    struct Plan: Equatable {
        let scheduleLocalReminder: Bool
        /// The new value of the persisted remote-live flag.
        let remoteLive: Bool
    }

    static func plan(
        verseOfDayEnabled: Bool,
        authorized: Bool,
        outcome: PushRegistrationOutcome,
        remoteLive: Bool
    ) -> Plan {
        guard authorized else { return Plan(scheduleLocalReminder: false, remoteLive: false) }
        switch outcome {
        case .registered:
            return Plan(scheduleLocalReminder: false, remoteLive: true)
        case .unregistered:
            return Plan(scheduleLocalReminder: false, remoteLive: false)
        case .unavailable:
            return Plan(scheduleLocalReminder: verseOfDayEnabled && !remoteLive, remoteLive: remoteLive)
        }
    }
}
