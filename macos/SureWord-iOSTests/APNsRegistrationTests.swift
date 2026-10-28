import Foundation
import XCTest

@testable import SureWord

/// Both Apple apps' direct APNs registration: the body must be exactly what
/// `POST /api/push-tokens` validates for platform macos or ios (see
/// tests/apns.test.mjs on the server), and a remote payload built by
/// `src/lib/apns.ts` must route like a phone's.
final class APNsRegistrationTests: XCTestCase {
    private let hex = String(repeating: "a1b2c3d4", count: 8)

    func testFailedSignOutCanOnlyResumeItsStillCurrentFencedOwner() {
        let owner = APNsRegistration.AuthSession(accountID: "account-a", sessionID: "session-a")
        let otherAccount = APNsRegistration.AuthSession(accountID: "account-b", sessionID: "session-a")
        let otherSession = APNsRegistration.AuthSession(accountID: "account-a", sessionID: "session-b")
        XCTAssertTrue(APNsRegistration.canResumeAfterFailedSignOut(current: owner, signingOut: owner, expected: owner))
        for current in [nil, otherAccount, otherSession] as [APNsRegistration.AuthSession?] {
            XCTAssertFalse(APNsRegistration.canResumeAfterFailedSignOut(current: current, signingOut: owner, expected: owner))
        }
        for fenced in [nil, otherAccount, otherSession] as [APNsRegistration.AuthSession?] {
            XCTAssertFalse(APNsRegistration.canResumeAfterFailedSignOut(current: owner, signingOut: fenced, expected: owner))
        }
        XCTAssertFalse(APNsRegistration.canResumeAfterFailedSignOut(current: owner, signingOut: owner, expected: otherSession))
    }

    private func json(_ value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testTheEnvironmentComesFromTheSignedEntitlement() {
        XCTAssertEqual(APNsRegistration.Environment(entitlement: "development"), .development)
        XCTAssertEqual(APNsRegistration.Environment(entitlement: "production"), .production)
        XCTAssertNil(APNsRegistration.Environment(entitlement: nil))
        XCTAssertNil(APNsRegistration.Environment(entitlement: ""))
        XCTAssertNil(APNsRegistration.Environment(entitlement: "sandbox"))
        XCTAssertNil(APNsRegistration.Environment(entitlement: true))
        XCTAssertEqual(APNsRegistration.entitlementKey, "com.apple.developer.aps-environment")
    }

    func testIOSReadsTheEnvironmentFromSignedBundleMetadataAndFailsClosed() {
        let key = APNsRegistration.iosEnvironmentInfoKey
        XCTAssertEqual(key, "SureWordAPNsEnvironment")
        XCTAssertEqual(APNsRegistration.iosEnvironment(infoDictionary: [key: "development"]), .development)
        XCTAssertEqual(APNsRegistration.iosEnvironment(infoDictionary: [key: "production"]), .production)
        XCTAssertNil(APNsRegistration.iosEnvironment(infoDictionary: nil))
        XCTAssertNil(APNsRegistration.iosEnvironment(infoDictionary: [:]))
        let invalid: [Any] = ["", "sandbox", "$(SUREWORD_APS_ENVIRONMENT)", true, NSNull()]
        for value in invalid {
            XCTAssertNil(APNsRegistration.iosEnvironment(infoDictionary: [key: value]))
        }
    }

    func testHexEncodesTheTokenTheWayTheServerStoresIt() {
        let token = Data([0x00, 0x0f, 0xa0, 0xff] + Array(repeating: 0xab, count: 28))
        let encoded = APNsRegistration.hex(token)
        XCTAssertEqual(encoded, "000fa0ff" + String(repeating: "ab", count: 28))
        XCTAssertTrue(APNsRegistration.isDeviceToken(encoded))
    }

    func testOnlyHexTokensTheServerAcceptsAreDeviceTokens() {
        XCTAssertTrue(APNsRegistration.isDeviceToken(hex))
        XCTAssertTrue(APNsRegistration.isDeviceToken(hex.uppercased()))
        XCTAssertFalse(APNsRegistration.isDeviceToken(""))
        XCTAssertFalse(APNsRegistration.isDeviceToken("abc"))
        XCTAssertFalse(APNsRegistration.isDeviceToken(hex + "a"))
        XCTAssertFalse(APNsRegistration.isDeviceToken(String(repeating: "zz", count: 32)))
        XCTAssertFalse(APNsRegistration.isDeviceToken(String(repeating: "ab", count: 101)))
        // Fullwidth digits count as hex digits to Swift, never to the server.
        XCTAssertFalse(APNsRegistration.isDeviceToken(String(repeating: "\u{FF10}", count: 64)))
        XCTAssertFalse(APNsRegistration.isDeviceToken("ExponentPushToken[abc]"))
    }

    func testTheRegisterBodyIsAndroidsPlusTheEnvironment() throws {
        let body = APNsRegistration.RegisterBody(
            token: hex,
            environment: .production,
            timezone: "America/Chicago",
            notifyHour: 7,
            verseOfDayEnabled: true,
            chatReplies: false,
            proof: nil
        )
        let encoded = try json(body)
        XCTAssertEqual(Set(encoded.keys), ["token", "platform", "apnsEnvironment", "timezone", "notifyHour", "enabled", "chatReplies"])
        XCTAssertEqual(encoded["token"] as? String, hex)
        XCTAssertEqual(encoded["platform"] as? String, "macos")
        XCTAssertEqual(encoded["apnsEnvironment"] as? String, "production")
        XCTAssertEqual(encoded["timezone"] as? String, "America/Chicago")
        XCTAssertEqual(encoded["notifyHour"] as? Int, 7)
        XCTAssertEqual(encoded["enabled"] as? Bool, true)
        XCTAssertEqual(encoded["chatReplies"] as? Bool, false)

        let withProof = try json(APNsRegistration.RegisterBody(
            token: hex,
            environment: .development,
            timezone: "UTC",
            notifyHour: 31,
            verseOfDayEnabled: false,
            chatReplies: true,
            proof: "PROOF"
        ))
        XCTAssertEqual(withProof["proof"] as? String, "PROOF")
        XCTAssertEqual(withProof["apnsEnvironment"] as? String, "development")
        // The server refuses an hour outside 0-23 outright.
        XCTAssertEqual(withProof["notifyHour"] as? Int, 23)
    }

    func testUnregisteringNamesThePlatformSoEitherEnvironmentsRowGoes() throws {
        let encoded = try json(APNsRegistration.UnregisterBody(token: hex))
        XCTAssertEqual(encoded as? [String: String], ["token": hex, "platform": "macos"])
    }

    func testIOSRegistersTheRawTokenWithItsPlatformEnvironmentAndProof() throws {
        let encoded = try json(APNsRegistration.RegisterBody(
            token: hex,
            platform: "ios",
            environment: .development,
            timezone: "America/Los_Angeles",
            notifyHour: 8,
            verseOfDayEnabled: false,
            chatReplies: true,
            proof: "DEVICE-PROOF"
        ))
        XCTAssertEqual(Set(encoded.keys), ["token", "platform", "apnsEnvironment", "timezone", "notifyHour", "enabled", "chatReplies", "proof"])
        XCTAssertEqual(encoded["token"] as? String, hex)
        XCTAssertEqual(encoded["platform"] as? String, "ios")
        XCTAssertEqual(encoded["apnsEnvironment"] as? String, "development")
        XCTAssertEqual(encoded["enabled"] as? Bool, false)
        XCTAssertEqual(encoded["chatReplies"] as? Bool, true)
        XCTAssertEqual(encoded["proof"] as? String, "DEVICE-PROOF")
        let removal = try json(APNsRegistration.UnregisterBody(token: hex, platform: "ios"))
        XCTAssertEqual(removal as? [String: String], ["token": hex, "platform": "ios"])
    }

    func testAProofBelongsToOneEnvironmentsStoredToken() {
        XCTAssertEqual(APNsRegistration.proofOwner(token: hex, environment: .production), "apns:production:\(hex)")
        XCTAssertNotEqual(
            APNsRegistration.proofOwner(token: hex, environment: .production),
            APNsRegistration.proofOwner(token: hex, environment: .development)
        )
    }

    func testTheProofIsOptionalInTheAnswer() throws {
        let bound = try JSONDecoder().decode(APNsRegistration.RegisterResponse.self, from: Data(#"{"id":"r","proof":"P"}"#.utf8))
        XCTAssertEqual(bound.proof, "P")
        let plain = try JSONDecoder().decode(APNsRegistration.RegisterResponse.self, from: Data(#"{"id":"r"}"#.utf8))
        XCTAssertNil(plain.proof)
    }

    func testOnlyA503MeansTheServerCannotPushToMacs() {
        XCTAssertTrue(APNsRegistration.isServerUnconfigured(status: 503))
        for status in [nil, 400, 401, 500, 502] {
            XCTAssertFalse(APNsRegistration.isServerUnconfigured(status: status), "\(String(describing: status))")
        }
    }

    /// `buildApnsPayload` puts the push's data at the top level beside `aps`.
    func testDirectAPNsPayloadsRouteLikeAPhonesPush() {
        let morning: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "✝ Pick up your cross", "body": "“…” - John 3:16"], "sound": "default"],
            "screen": "cross", "book": "John", "chapter": 3, "verse": 16,
        ]
        XCTAssertEqual(NotificationTapTarget(userInfo: morning), .cross)
        let answer: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Your answer is ready", "body": "Grace…"], "sound": "default"],
            "screen": "chat", "conversationId": "conv_1",
        ]
        XCTAssertEqual(NotificationTapTarget(userInfo: answer), .chat(conversationID: "conv_1"))
    }

    /// The identifier is useful for local replacement. APNs collapse IDs do
    /// not suppress a separate local request; completion-source dedup belongs
    /// to the Mac's notifier.
    func testTheLocalAnswerUsesTheConversationIdentifier() {
        XCTAssertEqual(AnswerReadyNotification.identifier(conversationID: "conv_1"), "chat-conv_1")
    }

    private func identity(
        account: String = "user_a",
        session: String = "session_a",
        environment: APNsRegistration.Environment? = .production,
        token: String? = nil
    ) -> APNsRegistration.DeliveryIdentity? {
        APNsRegistration.DeliveryIdentity(
            accountID: account,
            sessionID: session,
            environment: environment,
            token: token ?? hex
        )
    }

    func testRemoteDeliveryRequiresTheCurrentAccountSessionEnvironmentAndToken() throws {
        let registered = try XCTUnwrap(identity())
        XCTAssertTrue(APNsRegistration.isRemoteLive(registered: registered, current: identity()))
        for current in [
            identity(account: "user_b"),
            identity(session: "session_b"),
            identity(environment: .development),
            identity(token: String(repeating: "cd", count: 32)),
            identity(environment: nil),
            nil,
        ] {
            XCTAssertFalse(APNsRegistration.isRemoteLive(registered: registered, current: current))
        }
        XCTAssertFalse(APNsRegistration.isRemoteLive(registered: nil, current: identity()))
    }

    func testDeliveryIdentityRequiresARealAccountSessionEntitlementAndToken() {
        XCTAssertNil(identity(account: ""))
        XCTAssertNil(identity(session: ""))
        XCTAssertNil(identity(environment: nil))
        XCTAssertNil(identity(token: "not-a-device-token"))
        XCTAssertEqual(identity(token: hex.uppercased()), identity())
    }

    func testMissingEntitlementAndChangedIdentityRestoreTheLocalFallback() {
        for current in [identity(environment: nil), identity(account: "user_b"), identity(session: "session_b")] {
            let plan = APNsRegistration.deliveryPlan(
                verseOfDayEnabled: true,
                authorized: true,
                outcome: .unavailable,
                registered: identity(),
                current: current
            )
            XCTAssertTrue(plan.scheduleLocalReminder)
            XCTAssertFalse(plan.remoteLive)
        }
    }

    func testFailedRemovalKeepsMatchingRemoteDeliveryAndSuccessfulRemovalClearsIt() {
        let failed = APNsRegistration.deliveryPlan(
            verseOfDayEnabled: true,
            authorized: true,
            outcome: APNsRegistration.unregisterOutcome(succeeded: false),
            registered: identity(),
            current: identity()
        )
        XCTAssertFalse(failed.scheduleLocalReminder)
        XCTAssertTrue(failed.remoteLive)
        let removed = APNsRegistration.deliveryPlan(
            verseOfDayEnabled: false,
            authorized: true,
            outcome: APNsRegistration.unregisterOutcome(succeeded: true),
            registered: identity(),
            current: identity()
        )
        XCTAssertFalse(removed.scheduleLocalReminder)
        XCTAssertFalse(removed.remoteLive)
    }

    func testUnconfiguredServerOverridesEvenAMatchingRegistration() {
        let plan = APNsRegistration.deliveryPlan(
            verseOfDayEnabled: true,
            authorized: true,
            outcome: .unavailable,
            registered: identity(),
            current: identity(),
            serverUnconfigured: true
        )
        XCTAssertTrue(plan.scheduleLocalReminder)
        XCTAssertFalse(plan.remoteLive)
    }

    @MainActor
    func testFailedLegacyDisableNeverDeletesOrEnablesRawAndPreservesAcknowledgedDelivery() async throws {
        var calls: [String] = []
        var cachedToken: String? = "ExponentPushToken[legacy]"
        let result = await APNsRegistration.syncIOSLegacyMigration(
            legacy: .init(token: cachedToken!, proof: "LEGACY-PROOF", remoteLive: true), timezone: "UTC", hour: 8,
            transport: { method, body in
                calls.append(method)
                let sent = try self.json(body)
                XCTAssertEqual(sent["token"] as? String, "ExponentPushToken[legacy]")
                XCTAssertEqual(sent["platform"] as? String, "ios")
                XCTAssertEqual(sent["proof"] as? String, "LEGACY-PROOF")
                XCTAssertEqual(sent["enabled"] as? Bool, false)
                XCTAssertEqual(sent["chatReplies"] as? Bool, false)
                throw APIError(message: "Offline")
            },
            didDisable: { calls.append("disabled") }, rememberProof: { _ in calls.append("proof") },
            didRemove: { cachedToken = nil },
            rawOperation: { calls.append("raw"); return (.registered, false) }
        )
        XCTAssertEqual(calls, ["POST"])
        XCTAssertNotNil(cachedToken)
        XCTAssertEqual(result.outcome, .unavailable)
        XCTAssertTrue(result.legacyRemoteLive)
        let plan = APNsRegistration.deliveryPlan(
            verseOfDayEnabled: true, authorized: true, outcome: result.outcome,
            registered: nil, current: nil, legacyRemoteLive: result.legacyRemoteLive
        )
        XCTAssertEqual(plan, .init(scheduleLocalReminder: false, remoteLive: true))
    }

    @MainActor
    func testDisabledLegacyAllowsRawAfterFailedDeleteAndKeepsSeparateProofAndRetryCache() async {
        var calls: [String] = []
        var cachedToken: String? = "ExponentPushToken[legacy]"
        var legacyProof = "LEGACY-PROOF"
        let rawProof = "RAW-PROOF"
        var legacyLive = true
        let result = await APNsRegistration.syncIOSLegacyMigration(
            legacy: .init(token: cachedToken!, proof: legacyProof, remoteLive: true), timezone: "UTC", hour: 8,
            transport: { method, _ in
                calls.append(method)
                if method == "DELETE" { throw APIError(message: "Offline") }
                return Data(#"{"proof":"NEW-LEGACY-PROOF"}"#.utf8)
            },
            didDisable: { legacyLive = false; calls.append("disabled") },
            rememberProof: { legacyProof = $0 }, didRemove: { cachedToken = nil },
            rawOperation: { calls.append("raw"); return (.registered, false) }
        )
        XCTAssertEqual(calls, ["POST", "disabled", "DELETE", "raw"])
        XCTAssertFalse(legacyLive)
        XCTAssertFalse(result.legacyRemoteLive)
        XCTAssertEqual(result.outcome, .registered)
        XCTAssertNotNil(cachedToken)
        XCTAssertEqual(legacyProof, "NEW-LEGACY-PROOF")
        XCTAssertEqual(rawProof, "RAW-PROOF")
    }

    @MainActor
    func testBothOffRetriesLegacyDeletionWithoutAnyCurrentRawToken() async {
        var cachedToken: String? = "ExponentPushToken[legacy]"
        var failDelete = true
        var calls: [String] = []
        func syncBothOff() async -> APNsRegistration.IOSSyncResult {
            await APNsRegistration.syncIOSLegacyMigration(
                legacy: cachedToken.map { .init(token: $0, proof: "LEGACY-PROOF", remoteLive: false) },
                timezone: "UTC", hour: 8,
                transport: { method, _ in
                    calls.append(method)
                    if method == "DELETE" && failDelete { throw APIError(message: "Offline") }
                    return Data("{}".utf8)
                },
                didDisable: {}, rememberProof: { _ in }, didRemove: { cachedToken = nil },
                // No raw token/environment is needed to reach legacy cleanup.
                rawOperation: { calls.append("both-off"); return (.unregistered, false) }
            )
        }
        let first = await syncBothOff()
        XCTAssertEqual(first.outcome, .unregistered)
        XCTAssertNotNil(cachedToken)
        failDelete = false
        let retry = await syncBothOff()
        XCTAssertEqual(retry.outcome, .unregistered)
        XCTAssertNil(cachedToken)
        XCTAssertEqual(calls, ["POST", "DELETE", "both-off", "POST", "DELETE", "both-off"])
    }
}
