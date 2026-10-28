import Foundation

/// The pure half of direct APNs registration for both Apple apps: the wire
/// shape `POST /api/push-tokens` takes for a
/// raw APNs token, and the environment the token belongs to. No AppKit and no
/// network, so it compiles into both apps and is unit-tested on the iOS
/// simulator (`APNsRegistrationTests`). Legacy iOS Expo rows remain supported
/// by the server; current iOS builds register their raw APNs token.
///
/// Why direct at all: Expo mints and delivers push tokens for phones only, so
/// a Mac's APNs token has no Expo equivalent. The Mac registers the token as
/// APNs issued it, with `platform: "macos"` and the APNs environment, and the
/// server sends to Apple itself (`src/lib/apns.ts`), storing the row as
/// `apns:<environment>:<hex>`.
enum APNsRegistration {
    struct AuthSession: Equatable, Sendable {
        let accountID: String
        let sessionID: String
    }

    static func canResumeAfterFailedSignOut(current: AuthSession?, signingOut: AuthSession?, expected: AuthSession) -> Bool {
        current == expected && signingOut == expected
    }

    /// The server's `platform` for a raw APNs token.
    static let platform = "macos"

    /// The entitlement that both turns remote push on and says which APNs host
    /// this build's tokens belong to.
    static let entitlementKey = "com.apple.developer.aps-environment"
    /// iOS has no public SecTask entitlement API. Xcode signs this bundle
    /// metadata from the same build setting used by its aps-environment
    /// entitlement, so the profile's environment never comes from DEBUG.
    static let iosEnvironmentInfoKey = "SureWordAPNsEnvironment"

    static func iosEnvironment(infoDictionary: [String: Any]?) -> Environment? {
        Environment(entitlement: infoDictionary?[iosEnvironmentInfoKey])
    }

    /// Which APNs host a token belongs to: Debug builds (and Mac Development
    /// profiles) get sandbox tokens, Release with a Developer ID profile gets
    /// production ones. A token sent to the wrong host is refused as
    /// `BadDeviceToken`, which costs the device its row.
    enum Environment: String, Codable, Equatable, Sendable {
        case development
        case production

        /// The value of the signed `aps-environment` entitlement, or nil when
        /// the build carries none (or an unknown value): remote push is then
        /// off and the local notifications stay the only delivery path.
        init?(entitlement: Any?) {
            guard let value = entitlement as? String, let environment = Environment(rawValue: value) else {
                return nil
            }
            self = environment
        }
    }

    /// The device token as APNs hands it over, as the lowercase hex the
    /// server stores.
    static func hex(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    /// The server's `isApnsDeviceToken`: hex, even length, 32 to 100 bytes.
    static func isDeviceToken(_ hex: String) -> Bool {
        (64...200).contains(hex.count) && hex.count.isMultiple(of: 2) && hex.allSatisfy { $0.isASCII && $0.isHexDigit }
    }

    /// The token the server derives the device proof from. A sandbox and a
    /// production token are different rows, so a proof belongs to one of them.
    static func proofOwner(token: String, environment: Environment) -> String {
        "apns:\(environment.rawValue):\(token)"
    }

    /// A successful registration belongs to this account's current session
    /// and this build's actual APNs token, never to another signed-in user or
    /// an unsigned build sharing the same defaults domain.
    struct DeliveryIdentity: Codable, Equatable, Sendable {
        let accountID: String
        let sessionID: String
        let environment: Environment
        let token: String

        init?(accountID: String?, sessionID: String?, environment: Environment?, token: String?) {
            guard let accountID, !accountID.isEmpty,
                  let sessionID, !sessionID.isEmpty,
                  let environment, let token, isDeviceToken(token)
            else { return nil }
            self.accountID = accountID
            self.sessionID = sessionID
            self.environment = environment
            self.token = token.lowercased()
        }
    }

    static func isRemoteLive(registered: DeliveryIdentity?, current: DeliveryIdentity?) -> Bool {
        guard let registered, let current else { return false }
        return registered == current
    }

    /// A failed DELETE leaves the server row intact. In particular it must
    /// not clear the matching remote-live state and re-arm a local reminder.
    static func unregisterOutcome(succeeded: Bool) -> PushRegistrationOutcome {
        succeeded ? .unregistered : .unavailable
    }

    static func deliveryPlan(
        verseOfDayEnabled: Bool,
        authorized: Bool,
        outcome: PushRegistrationOutcome,
        registered: DeliveryIdentity?,
        current: DeliveryIdentity?,
        serverUnconfigured: Bool = false,
        legacyRemoteLive: Bool = false
    ) -> PushDeliveryPlan.Plan {
        PushDeliveryPlan.plan(
            verseOfDayEnabled: verseOfDayEnabled,
            authorized: authorized,
            outcome: current == nil ? .unavailable : outcome,
            remoteLive: legacyRemoteLive || (!serverUnconfigured && isRemoteLive(registered: registered, current: current))
        )
    }

    struct IOSLegacyToken {
        let token: String
        let proof: String?
        let remoteLive: Bool
    }

    struct IOSSyncResult {
        let outcome: PushRegistrationOutcome
        let serverUnconfigured: Bool
        let legacyRemoteLive: Bool
    }

    /// Disable the old transport before enabling the new one. DELETE is
    /// cleanup: once disabled, its failure cannot produce duplicate pushes.
    @MainActor
    static func syncIOSLegacyMigration(
        legacy: IOSLegacyToken?,
        timezone: String,
        hour: Int,
        transport: (_ method: String, _ body: any Encodable & Sendable) async throws -> Data,
        didDisable: () -> Void,
        rememberProof: (String) -> Void,
        didRemove: () -> Void,
        rawOperation: () async -> (PushRegistrationOutcome, serverUnconfigured: Bool)
    ) async -> IOSSyncResult {
        if let legacy {
            struct DisableBody: Encodable, Sendable {
                let token: String
                let platform = "ios"
                let timezone: String
                let notifyHour: Int
                let enabled = false
                let chatReplies = false
                let proof: String?
            }
            do {
                let data = try await transport("POST", DisableBody(
                    token: legacy.token, timezone: timezone, notifyHour: min(max(hour, 0), 23), proof: legacy.proof
                ))
                didDisable()
                if let proof = (try? JSONDecoder().decode(RegisterResponse.self, from: data))?.proof, !proof.isEmpty {
                    rememberProof(proof)
                }
            } catch {
                return IOSSyncResult(outcome: .unavailable, serverUnconfigured: false, legacyRemoteLive: legacy.remoteLive)
            }
            do {
                _ = try await transport("DELETE", UnregisterBody(token: legacy.token, platform: "ios"))
                didRemove()
            } catch {
                // Keep the cached token and retry deletion on the next sync.
            }
        }
        let raw = await rawOperation()
        return IOSSyncResult(outcome: raw.0, serverUnconfigured: raw.serverUnconfigured, legacyRemoteLive: false)
    }

    /// Android's registration body, field for field, plus `apnsEnvironment`.
    struct RegisterBody: Encodable, Equatable, Sendable {
        let token: String
        let platform: String
        let apnsEnvironment: Environment
        let timezone: String
        let notifyHour: Int
        let enabled: Bool
        let chatReplies: Bool
        /// Omitted while nil, as on the phones.
        let proof: String?

        init(
            token: String,
            platform: String = APNsRegistration.platform,
            environment: Environment,
            timezone: String,
            notifyHour: Int,
            verseOfDayEnabled: Bool,
            chatReplies: Bool,
            proof: String?
        ) {
            self.token = token
            self.platform = platform
            apnsEnvironment = environment
            self.timezone = timezone
            self.notifyHour = min(max(notifyHour, 0), 23)
            enabled = verseOfDayEnabled
            self.chatReplies = chatReplies
            self.proof = proof
        }
    }

    /// `DELETE /api/push-tokens` for a raw token: the server removes the row
    /// under either environment.
    struct UnregisterBody: Encodable, Equatable, Sendable {
        let token: String
        let platform: String

        init(token: String, platform: String = APNsRegistration.platform) {
            self.token = token
            self.platform = platform
        }
    }

    /// Only `proof` is read, and it is optional: a server with the device
    /// proof off answers `{ id }` alone.
    struct RegisterResponse: Decodable {
        let proof: String?
    }

    /// The server answers 503 when it holds no APNs key. That is a statement
    /// that it cannot push to this Mac at all, so the local reminder must not
    /// stand down for a remote push that will never come.
    static func isServerUnconfigured(status: Int?) -> Bool {
        status == 503
    }
}
