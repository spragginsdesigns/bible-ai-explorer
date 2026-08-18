import Foundation
import XCTest

@testable import SureWord

/// Lane 3 (iOS chat) wired the model picker through the shared settings and
/// the ask-question request — the pieces the Mac never needed. These pin the
/// persistence keys and the wire shape Android's
/// `prepareSendMessagesRequest` already sends.
@MainActor
final class ChatModelSettingsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "settings.chat.modelId")
        defaults.removeObject(forKey: "settings.chat.effort")
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "settings.chat.modelId")
        defaults.removeObject(forKey: "settings.chat.effort")
        super.tearDown()
    }

    func testModelAndEffortDefaultToNil() {
        let settings = SettingsStore()
        XCTAssertNil(settings.chatModelId)
        XCTAssertNil(settings.chatEffort)
    }

    func testModelAndEffortPersistAcrossInstances() {
        let settings = SettingsStore()
        settings.chatModelId = "anthropic/claude-sonnet-4"
        settings.chatEffort = "high"

        let reloaded = SettingsStore()
        XCTAssertEqual(reloaded.chatModelId, "anthropic/claude-sonnet-4")
        XCTAssertEqual(reloaded.chatEffort, "high")
    }

    func testClearingModelAndEffortRemovesThem() {
        let settings = SettingsStore()
        settings.chatModelId = "openai/gpt-5"
        settings.chatEffort = "low"
        settings.chatModelId = nil
        settings.chatEffort = nil

        let reloaded = SettingsStore()
        XCTAssertNil(reloaded.chatModelId)
        XCTAssertNil(reloaded.chatEffort)
    }

    func testAskQuestionRequestCarriesModelAndEffort() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: "c1",
            translation: "KJV",
            modelId: "openai/gpt-5",
            effort: "medium"
        )
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        XCTAssertEqual(object?["modelId"] as? String, "openai/gpt-5")
        XCTAssertEqual(object?["effort"] as? String, "medium")
        XCTAssertEqual(object?["conversationId"] as? String, "c1")
        XCTAssertEqual(object?["translation"] as? String, "KJV")
    }

    func testAskQuestionRequestOmitsUnsetModelAndEffort() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: nil,
            translation: "KJV",
            modelId: nil,
            effort: nil
        )
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        // Nil optionals synthesise to absent keys; the server treats a missing
        // or null modelId/effort as "account default", so both are safe.
        XCTAssertNil(object?["modelId"])
        XCTAssertNil(object?["effort"])
        XCTAssertNil(object?["conversationId"])
    }
}
