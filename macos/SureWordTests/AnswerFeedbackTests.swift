import Foundation
import Testing
@testable import SureWord

/// The contract is `docs/FEATURES.md` -> "Answer feedback, and how it reaches
/// the doctrinal eval harness". Two things are pinned here: the PATCH body,
/// where an omitted `feedback` key and a null one mean opposite things, and the
/// decode, where the rating has to survive a history restore.
@Suite("Answer feedback")
struct AnswerFeedbackTests {

    // MARK: Request body

    @Test("Clearing posts feedback null rather than dropping the key")
    func clearingEncodesNull() throws {
        let body = try encode(AnswerFeedbackRequest(feedback: nil))
        // The key must be present: an absent one reads as "leave the rating
        // alone" and the thumb would never come off.
        #expect(body.keys.sorted() == ["feedback"])
        #expect(body["feedback"] is NSNull)
    }

    @Test("A thumbs up posts the raw wire value and no reason")
    func upEncodesValue() throws {
        let body = try encode(AnswerFeedbackRequest(feedback: .up))
        #expect(body.keys.sorted() == ["feedback"])
        #expect(body["feedback"] as? String == "up")
    }

    @Test("A thumbs down carries its reason")
    func downCarriesReason() throws {
        let body = try encode(AnswerFeedbackRequest(feedback: .down, reason: "  It skipped the verse  "))
        #expect(body["feedback"] as? String == "down")
        #expect(body["feedbackReason"] as? String == "It skipped the verse")
    }

    @Test("A reason is dropped for anything but a thumbs down")
    func reasonOnlyMeaningfulWithDown() throws {
        // The route ignores one sent with "up" or with a clear, so it is never
        // sent to be ignored.
        #expect(try encode(AnswerFeedbackRequest(feedback: .up, reason: "good")).keys.sorted() == ["feedback"])
        #expect(try encode(AnswerFeedbackRequest(feedback: nil, reason: "good")).keys.sorted() == ["feedback"])
    }

    @Test("A blank or whitespace-only reason is left out")
    func blankReasonIsOmitted() throws {
        #expect(try encode(AnswerFeedbackRequest(feedback: .down, reason: "   ")).keys.sorted() == ["feedback"])
        #expect(try encode(AnswerFeedbackRequest(feedback: .down, reason: nil)).keys.sorted() == ["feedback"])
    }

    @Test("A reason over 500 characters is truncated rather than 400ing")
    func longReasonIsTruncated() throws {
        let body = try encode(
            AnswerFeedbackRequest(feedback: .down, reason: String(repeating: "x", count: 900))
        )
        #expect((body["feedbackReason"] as? String)?.count == AnswerFeedback.maxReasonLength)
    }

    // MARK: Response

    @Test("The updated row decodes, and an unreadable rating is simply no rating")
    func responseDecodesLeniently() throws {
        let decoded = try decode(#"{"id":"msg_1","feedback":"down","feedbackReason":"Missed the point","feedbackAt":"2026-09-16T00:00:00.000Z"}"#)
        #expect(decoded.feedback == .down)
        #expect(decoded.feedbackReason == "Missed the point")
        #expect(decoded.feedbackAt == "2026-09-16T00:00:00.000Z")

        // A cleared rating, and a value this build has no case for, both mean
        // "no thumb" - neither may fail a request the user already saw succeed.
        #expect(try decode(#"{"id":"msg_1","feedback":null}"#).feedback == nil)
        #expect(try decode(#"{"id":"msg_1","feedback":"sideways"}"#).feedback == nil)
        #expect(try decode(#"{"id":"msg_1"}"#).feedback == nil)
    }

    // MARK: Decode into the view model

    @Test("A stored row replays its thumb")
    func storedRowCarriesFeedback() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("msg_1"),
            "role": .string("assistant"),
            "content": .string("Answer"),
            "feedback": .string("up"),
        ])))
        #expect(message.feedback == "up")
        #expect(ChatViewMessage(message: message, isStreaming: false).feedback == .up)
    }

    @Test("A row from a server without the columns has no thumb")
    func storedRowWithoutFeedback() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("msg_2"),
            "role": .string("assistant"),
            "content": .string("Answer"),
        ])))
        #expect(message.feedback == nil)
        #expect(ChatViewMessage(message: message, isStreaming: false).feedback == nil)
    }

    @Test("An unrecognised wire value narrows to no thumb without losing the message")
    func unknownFeedbackValueIsIgnored() {
        let message = UIMessage(
            id: "msg_3",
            role: .assistant,
            parts: [.text(id: "t", text: "Answer")],
            feedback: "sideways"
        )
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.feedback == nil)
        #expect(view.content == "Answer")
    }

    // MARK: helpers

    private func encode(_ request: AnswerFeedbackRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(request)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func decode(_ json: String) throws -> AnswerFeedbackResult {
        try JSONDecoder().decode(AnswerFeedbackResult.self, from: Data(json.utf8))
    }
}
