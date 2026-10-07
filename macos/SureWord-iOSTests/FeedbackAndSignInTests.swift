import Foundation
import XCTest

@testable import SureWord

/// PRD B4 (Send feedback) and the B3 sign-in funnel.
final class FeedbackAndSignInTests: XCTestCase {
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

    // MARK: Feedback rules mirror the server

    func testCategoriesAndLimitsMatchTheServerRules() throws {
        let server = try String(
            contentsOf: Self.repoRoot.appending(path: "src/lib/feedback/in-app-feedback.ts"),
            encoding: .utf8
        )
        var pairs: [String] = []
        for match in server.matches(of: /\{\s*id:\s*"(\w+)",\s*label:\s*"([^"]+)"\s*\}/) {
            pairs.append("\(match.output.1)=\(match.output.2)")
        }
        XCTAssertEqual(pairs, InAppFeedback.categories.map { "\($0.id)=\($0.label)" })
        XCTAssertTrue(server.contains("MAX_FEEDBACK_MESSAGE_LENGTH = \(InAppFeedback.maxMessageLength)"))
        XCTAssertTrue(server.contains("MAX_REPLY_EMAIL_LENGTH = \(InAppFeedback.maxReplyEmailLength)"))
    }

    func testDraftRules() {
        XCTAssertEqual(InAppFeedback.draft(category: "bug", message: "  \n ", replyEmail: "", appVersion: "1.10.0"), .empty)
        XCTAssertEqual(InAppFeedback.draft(category: "bug", message: "Broken", replyEmail: "not-an-email", appVersion: nil), .badEmail)
        XCTAssertEqual(
            InAppFeedback.draft(category: "idea", message: "  More plans  ", replyEmail: " a@b.co ", appVersion: "1.10.0"),
            .ready(.init(category: "idea", message: "More plans", appVersion: "1.10.0", replyEmail: "a@b.co"))
        )
        XCTAssertTrue(InAppFeedback.looksLikeEmail("someone@example.com"))
        XCTAssertFalse(InAppFeedback.looksLikeEmail("someone@example"))
        XCTAssertFalse(InAppFeedback.looksLikeEmail("two words@example.com"))
    }

    func testRequestIsAndroidsPostWithOptionalKeysLeftOut() async throws {
        let client = APIClient(baseURL: URL(string: "https://example.test")!, token: { _ in "jwt" }, onAuthFailure: {})
        let request = try await client.makeRequest(
            InAppFeedback.path,
            method: "POST",
            body: InAppFeedback.Body(category: "bug", message: "Listen stalls", appVersion: "1.10.0", replyEmail: nil),
            fresh: false
        )
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://example.test/api/feedback")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-sureword-client"), "ios")
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json, ["category": "bug", "message": "Listen stalls", "appVersion": "1.10.0"])
    }

    @MainActor
    func testModelSendsThenThanks() async {
        let transport = RecordingFeedbackTransport()
        let model = FeedbackModel(appVersion: "1.10.0")
        model.category = "praise"
        model.message = "Love the reader"
        XCTAssertTrue(model.canSend)
        await model.send(using: transport)
        XCTAssertTrue(model.isSent)
        XCTAssertEqual(model.message, "")
        let sent = await transport.bodies
        XCTAssertEqual(sent, [.init(category: "praise", message: "Love the reader", appVersion: "1.10.0", replyEmail: nil)])
    }

    @MainActor
    func testModelShowsTheServerError() async {
        let model = FeedbackModel(appVersion: nil)
        model.message = "x"
        await model.send(using: FailingFeedbackTransport())
        XCTAssertFalse(model.isSent)
        XCTAssertEqual(model.error, "That is a lot of feedback at once. Try again in a few minutes.")
        XCTAssertEqual(model.message, "x", "a failed send keeps what was written")
    }

    @MainActor
    func testMessageIsClampedInUTF16UnitsLikeTheServerCounts() {
        let model = FeedbackModel(appVersion: nil)
        model.message = String(repeating: "🙏", count: 1500) // 3000 UTF-16 units
        XCTAssertEqual(model.message.utf16.count, 2000)
        XCTAssertEqual(model.counter, "2000 / 2000")
    }

    // MARK: Sign-in funnel

    private func signals(_ path: String, _ body: String?, _ status: Int, _ response: String = "{}") -> [SignInAnalytics.Signal] {
        SignInAnalytics.signals(method: "POST", path: path, body: body, status: status, response: Data(response.utf8))
    }

    func testStartsAreNamedLikeAndroid() {
        XCTAssertEqual(
            signals("/v1/client/sign_ins", "identifier=someone%40example.com", 200),
            [.init(event: "sign_in_started", properties: ["method": "email"])]
        )
        XCTAssertEqual(
            signals("/v1/client/sign_ins", "strategy=oauth_google&redirect_url=sureword%3A%2F%2Fsso-callback", 200),
            [.init(event: "sign_in_started", properties: ["method": "google"])]
        )
        XCTAssertEqual(
            signals("/v1/client/sign_ins", "strategy=oauth_token_apple&token=abc", 200),
            [.init(event: "sign_in_started", properties: ["method": "apple"])]
        )
    }

    func testFailuresCarryTheCodeAndNeverWhatWasTyped() {
        let wrongPassword = #"{"errors":[{"code":"form_password_incorrect","message":"Password is incorrect. Try again, or use another method.","long_message":"hunter2"}]}"#
        let failed = signals("/v1/client/sign_ins/sia_123/attempt_first_factor", "strategy=password&password=hunter2", 422, wrongPassword)
        XCTAssertEqual(failed, [.init(event: "sign_in_failed", properties: ["method": "password", "reason": "form_password_incorrect", "step": "verify"])])

        let notFound = #"{"errors":[{"code":"form_identifier_not_found","message":"Couldn't find someone@example.com"}]}"#
        XCTAssertEqual(
            signals("/v1/client/sign_ins", "identifier=someone%40example.com", 422, notFound),
            [
                .init(event: "sign_in_started", properties: ["method": "email"]),
                .init(event: "sign_in_failed", properties: ["method": "email", "reason": "form_identifier_not_found", "step": "lookup"]),
            ]
        )
        XCTAssertEqual(
            signals("/v1/client/sign_ins/sia_1/attempt_first_factor", "strategy=email_code&code=123456", 500, "oops"),
            [.init(event: "sign_in_failed", properties: ["method": "email_code", "reason": "http_500", "step": "verify"])]
        )

        let all = [failed, signals("/v1/client/sign_ins", "identifier=someone%40example.com", 422, notFound)]
            .flatMap { $0 }
            .flatMap { $0.properties.values }
        for value in all {
            if case .string(let text) = value {
                XCTAssertFalse(text.contains("hunter2"))
                XCTAssertFalse(text.contains("example.com"))
                XCTAssertFalse(text.contains("123456"))
            }
        }
    }

    func testIrrelevantRequestsAreIgnored() {
        XCTAssertEqual(signals("/v1/client/sign_ins/sia_1/attempt_first_factor", "strategy=password", 200), [])
        XCTAssertEqual(signals("/v1/client/sessions/sess_1/tokens", nil, 401), [])
        XCTAssertEqual(signals("/v1/environment", nil, 200), [])
        XCTAssertEqual(
            SignInAnalytics.signals(method: "GET", path: "/v1/client/sign_ins", body: nil, status: 200, response: Data()),
            []
        )
    }

    func testCompletionIsFiledUnderTheFactorThatFinishedIt() {
        XCTAssertEqual(SignInAnalytics.completion(forStrategy: "oauth_google", openMethod: "google").properties, ["method": "google"])
        XCTAssertEqual(SignInAnalytics.completion(forStrategy: "password", openMethod: "email").properties, ["method": "password"])
        XCTAssertEqual(SignInAnalytics.completion(forStrategy: "email_code", openMethod: "email").properties, ["method": "email_code"])
        XCTAssertEqual(SignInAnalytics.completion(forStrategy: nil, openMethod: "google").properties, ["method": "google"])
        XCTAssertEqual(SignInAnalytics.completion(forStrategy: nil, openMethod: nil).event, "sign_in_completed")
    }
}

private actor RecordingFeedbackTransport: FeedbackTransport {
    private(set) var bodies: [InAppFeedback.Body] = []

    func sendFeedback(_ body: InAppFeedback.Body) async throws {
        bodies.append(body)
    }
}

private struct FailingFeedbackTransport: FeedbackTransport {
    func sendFeedback(_ body: InAppFeedback.Body) async throws {
        throw APIError.server(status: 429, message: "That is a lot of feedback at once. Try again in a few minutes.")
    }
}
