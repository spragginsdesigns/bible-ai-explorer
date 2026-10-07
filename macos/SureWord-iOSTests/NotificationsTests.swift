import Foundation
import XCTest

@testable import SureWord

/// The deferred permission dialog (PRD B6a) and notification tap routing,
/// case for case `permissionPrompt.test.ts` and `tapTarget.test.ts` in
/// `mobile/src/features/notifications/`, plus the iOS push pieces (PRD B6):
/// the Expo token exchange and the local-reminder fallback rule.
@MainActor
final class NotificationsTests: XCTestCase {
    private let notGranted = NotificationPermissionStatus(granted: false, canAskAgain: true)

    private func decide(
        trigger: NotificationPermissionTrigger = .firstAnswer,
        enabled: Bool = true,
        chatReplies: Bool = true,
        asked: Bool = false,
        status: NotificationPermissionStatus? = nil
    ) -> Bool {
        NotificationPermissionPrompt.shouldRequest(
            verseOfDayEnabled: enabled,
            chatReplies: chatReplies,
            asked: asked,
            status: status ?? notGranted,
            trigger: trigger
        )
    }

    // MARK: shouldRequestPermission

    func testNeverAsksWhenAlreadyGrantedWhateverTheTrigger() {
        for trigger in [NotificationPermissionTrigger.firstAnswer, .crossVisit, .settingsEnabled] {
            XCTAssertFalse(decide(trigger: trigger, status: .init(granted: true, canAskAgain: true)))
        }
    }

    func testAsksOnTheFirstSettledChatAnswer() {
        XCTAssertTrue(decide(trigger: .firstAnswer))
    }

    func testAsksOnTheFirstDailyCrossVisit() {
        XCTAssertTrue(decide(trigger: .crossVisit))
    }

    func testDoesNotAskAgainOnceThisInstallHasShownTheDialog() {
        XCTAssertFalse(decide(trigger: .firstAnswer, asked: true))
        XCTAssertFalse(decide(trigger: .crossVisit, asked: true))
    }

    func testAsksWhenSwitchedOnInSettingsEvenAfterAPriorAsk() {
        XCTAssertTrue(decide(trigger: .settingsEnabled, asked: true))
        XCTAssertTrue(decide(trigger: .settingsEnabled, asked: true, status: .init(granted: false, canAskAgain: false)))
    }

    func testDoesNotAskOnAPassiveMomentWhenBothStreamsAreOff() {
        XCTAssertFalse(decide(trigger: .crossVisit, enabled: false, chatReplies: false))
        XCTAssertTrue(decide(trigger: .firstAnswer, enabled: false, chatReplies: true))
    }

    func testDoesNotAskOnAPassiveMomentTheSystemWouldRefuse() {
        XCTAssertFalse(decide(trigger: .crossVisit, status: .init(granted: false, canAskAgain: false)))
    }

    func testTheAskedFlagPersistsPerInstall() throws {
        let suite = "notification-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertFalse(NotificationPermissionPrompt.hasAsked(defaults))
        NotificationPermissionPrompt.markAsked(defaults)
        XCTAssertTrue(NotificationPermissionPrompt.hasAsked(defaults))
    }

    // MARK: Trigger bus

    func testHoldsATriggerFiredBeforeTheListenerThenDeliversItOnce() {
        let moments = NotificationPermissionMoments()
        moments.signal(.crossVisit)
        var received: [NotificationPermissionTrigger] = []
        let token = moments.subscribe { received.append($0) }
        XCTAssertEqual(received, [.crossVisit])

        moments.signal(.firstAnswer)
        XCTAssertEqual(received, [.crossVisit, .firstAnswer])
        moments.unsubscribe(token)

        var later: [NotificationPermissionTrigger] = []
        let laterToken = moments.subscribe { later.append($0) }
        XCTAssertEqual(later, [])
        moments.unsubscribe(laterToken)
    }

    func testKeepsAQueuedSettingsRequestOverALaterPassiveMoment() {
        let moments = NotificationPermissionMoments()
        moments.signal(.settingsEnabled)
        moments.signal(.firstAnswer)
        var received: [NotificationPermissionTrigger] = []
        _ = moments.subscribe { received.append($0) }
        XCTAssertEqual(received, [.settingsEnabled])
    }

    func testAStaleUnsubscribeDoesNotRemoveTheNewerListener() {
        let moments = NotificationPermissionMoments()
        let old = moments.subscribe { _ in }
        var received: [NotificationPermissionTrigger] = []
        _ = moments.subscribe { received.append($0) }
        moments.unsubscribe(old)
        moments.signal(.crossVisit)
        XCTAssertEqual(received, [.crossVisit])
    }

    // MARK: notificationTapTarget

    func testRoutesCrossPayloadsToTheDailyCross() {
        XCTAssertEqual(
            NotificationTapTarget(userInfo: ["screen": "cross", "book": "John", "chapter": 3, "verse": 16]),
            .cross
        )
        XCTAssertEqual(NotificationTapTarget(userInfo: ["screen": "cross"]), .cross)
    }

    func testRoutesChatPayloadsToTheirConversation() {
        XCTAssertEqual(
            NotificationTapTarget(userInfo: ["screen": "chat", "conversationId": "conv_123"]),
            .chat(conversationID: "conv_123")
        )
    }

    func testNavigatesNowhereForAChatPayloadWithNoConversation() {
        XCTAssertNil(NotificationTapTarget(userInfo: ["screen": "chat"]))
        XCTAssertNil(NotificationTapTarget(userInfo: ["screen": "chat", "conversationId": ""]))
    }

    func testFallsBackToTheReaderForLegacyVerseOnlyPayloads() {
        XCTAssertEqual(
            NotificationTapTarget(userInfo: ["book": "John", "chapter": 3, "verse": 16]),
            .reference("John 3:16")
        )
    }

    func testAcceptsNumericStrings() {
        XCTAssertEqual(
            NotificationTapTarget(userInfo: ["book": "Psalms", "chapter": "23", "verse": "1"]),
            .reference("Psalms 23:1")
        )
    }

    func testNavigatesNowhereOnMalformedOrEmptyPayloads() {
        XCTAssertNil(NotificationTapTarget(userInfo: [:]))
        XCTAssertNil(NotificationTapTarget(userInfo: ["screen": "other"]))
        XCTAssertNil(NotificationTapTarget(userInfo: ["book": "John", "chapter": "three", "verse": 16]))
        XCTAssertNil(NotificationTapTarget(userInfo: ["chapter": 3, "verse": 16]))
    }

    /// Expo delivers the sender's `data` under `body` in the APNs payload.
    func testReadsTheDataExpoNestsUnderBody() {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Your answer is ready"]],
            "body": ["screen": "chat", "conversationId": "conv_9"],
        ]
        XCTAssertEqual(NotificationTapTarget(userInfo: userInfo), .chat(conversationID: "conv_9"))
    }

    func testAChatTapIsBufferedForAColdStart() {
        let links = PendingDeepLinks.shared
        _ = links.drain()
        links.post(.chat("conv_1"))
        XCTAssertEqual(links.drain(), [.chat("conv_1")])
    }

    // MARK: Expo token exchange (getExpoPushTokenAsync's body)

    func testExchangeBodyMatchesExpoNotifications() throws {
        let request = ExpoPushTokenExchange.Request(
            apnsToken: "a1b2",
            deviceID: "ABCDEF-0123",
            development: true,
            bundleID: "com.spragginsdesigns.sureword",
            projectID: Config.expoProjectID
        )
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(json["type"] as? String, "apns")
        XCTAssertEqual(json["deviceId"] as? String, "abcdef-0123")
        XCTAssertEqual(json["development"] as? Bool, true)
        XCTAssertEqual(json["appId"] as? String, "com.spragginsdesigns.sureword")
        XCTAssertEqual(json["deviceToken"] as? String, "a1b2")
        XCTAssertEqual(json["projectId"] as? String, "2dc61e76-c7c0-4e8b-be89-0c7e0b4ce379")
        XCTAssertEqual(Set(json.keys), ["type", "deviceId", "development", "appId", "deviceToken", "projectId"])
    }

    /// The same project Android registers under, read from `mobile/app.json`.
    func testExpoProjectMatchesAndroid() throws {
        let appJSON = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "mobile/app.json")
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: appJSON)) as? [String: Any]
        )
        let expo = try XCTUnwrap(root["expo"] as? [String: Any])
        let extra = try XCTUnwrap(expo["extra"] as? [String: Any])
        let eas = try XCTUnwrap(extra["eas"] as? [String: Any])
        XCTAssertEqual(eas["projectId"] as? String, Config.expoProjectID)
    }

    func testParsesExposAnswerAndRejectsAnythingElse() throws {
        let ok = Data(#"{"data":{"expoPushToken":"ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"}}"#.utf8)
        XCTAssertEqual(try ExpoPushTokenExchange.parse(ok), "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")
        for body in [#"{"data":{}}"#, #"{"errors":[{"code":"VALIDATION_ERROR"}]}"#, #"{"data":{"expoPushToken":"a1b2c3"}}"#] {
            XCTAssertThrowsError(try ExpoPushTokenExchange.parse(Data(body.utf8)))
        }
    }

    func testHexEncodesTheAPNsToken() {
        XCTAssertEqual(ExpoPushTokenExchange.hex(Data([0x00, 0x0f, 0xa0, 0xff])), "000fa0ff")
    }

    // MARK: Local reminder fallback (usePushNotifications.ts)

    func testRemoteDeliveryLiveCancelsTheLocalDaily() {
        let plan = PushDeliveryPlan.plan(verseOfDayEnabled: true, authorized: true, outcome: .registered, remoteLive: false)
        XCTAssertEqual(plan, .init(scheduleLocalReminder: false, remoteLive: true))
    }

    func testAFailedRegistrationWhileTheServerHoldsTheTokenDoesNotReArmTheLocalDaily() {
        let plan = PushDeliveryPlan.plan(verseOfDayEnabled: true, authorized: true, outcome: .unavailable, remoteLive: true)
        XCTAssertEqual(plan, .init(scheduleLocalReminder: false, remoteLive: true))
    }

    func testWithoutRemotePushTheLocalDailyRunsWhileTheVerseIsOn() {
        XCTAssertEqual(
            PushDeliveryPlan.plan(verseOfDayEnabled: true, authorized: true, outcome: .unavailable, remoteLive: false),
            .init(scheduleLocalReminder: true, remoteLive: false)
        )
        XCTAssertEqual(
            PushDeliveryPlan.plan(verseOfDayEnabled: false, authorized: true, outcome: .unavailable, remoteLive: false),
            .init(scheduleLocalReminder: false, remoteLive: false)
        )
    }

    func testUnregisteringOrLosingPermissionClearsEverything() {
        XCTAssertEqual(
            PushDeliveryPlan.plan(verseOfDayEnabled: false, authorized: true, outcome: .unregistered, remoteLive: true),
            .init(scheduleLocalReminder: false, remoteLive: false)
        )
        XCTAssertEqual(
            PushDeliveryPlan.plan(verseOfDayEnabled: true, authorized: false, outcome: .registered, remoteLive: true),
            .init(scheduleLocalReminder: false, remoteLive: false)
        )
    }

    /// Until the APNs key is in Expo, nothing may be registered: a token the
    /// server cannot deliver to would still be this account's newest device.
    func testServerRegistrationStaysOffUntilDeliveryIsConfigured() {
        XCTAssertFalse(PushRegistration.isServerDeliveryConfigured)
    }
}
