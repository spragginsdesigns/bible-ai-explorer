import Foundation
import Testing
@testable import SureWord

/// The contract is `docs/FEATURES.md` -> "Share an answer: a public page, and a
/// card image". Two things are pinned here: the POST body, whose two key names
/// are the only ones `src/app/api/shared/route.ts` reads, and the list decode,
/// where a row has to survive a server that is older or stranger than this
/// build rather than emptying the whole Settings section.
@Suite("Share an answer")
struct SharedAnswerTests {

    // MARK: Request body

    @Test("The share request carries exactly the conversation and message ids")
    func requestEncodesBothIds() throws {
        let body = try encode(
            ShareAnswerRequest(conversationId: "conv_1", messageId: "msg_1")
        )
        // The route 400s without either, and reads no other key. An extra field
        // here would be silently ignored; a renamed one would 400 every share.
        #expect(body.keys.sorted() == ["conversationId", "messageId"])
        #expect(body["conversationId"] as? String == "conv_1")
        #expect(body["messageId"] as? String == "msg_1")
    }

    // MARK: Mint response

    @Test("The minted link decodes and yields a URL for ShareLink")
    func linkDecodes() throws {
        let link = try JSONDecoder().decode(
            SharedAnswerLink.self,
            from: Data(
                #"{"id":"abc123","url":"https://sureword.app/shared/abc123","createdAt":"2026-09-16T00:00:00.000Z"}"#
                    .utf8
            )
        )
        #expect(link.id == "abc123")
        #expect(link.shareURL == URL(string: "https://sureword.app/shared/abc123"))
        #expect(link.createdAt == "2026-09-16T00:00:00.000Z")
    }

    @Test("A link with no usable URL reports no URL rather than crashing")
    func linkWithoutURLIsNil() throws {
        // `shareURL` is what the ShareLink is handed, so it has to be safe to
        // ask for on a response that never carried one.
        let link = try JSONDecoder().decode(
            SharedAnswerLink.self,
            from: Data(#"{"id":"abc123"}"#.utf8)
        )
        #expect(link.url.isEmpty)
        #expect(link.shareURL == nil)
    }

    // MARK: List rows

    @Test("A live row decodes with no revocation")
    func liveRowDecodes() throws {
        let rows = try decodeList(
            """
            {"shares":[{"id":"abc123","url":"https://sureword.app/shared/abc123",
            "question":"Who was Melchisedec?","createdAt":"2026-09-16T00:00:00.000Z","revokedAt":null}]}
            """
        )
        let row = try #require(rows.first)
        #expect(row.id == "abc123")
        #expect(row.title == "Who was Melchisedec?")
        #expect(row.createdAt == "2026-09-16T00:00:00.000Z")
        #expect(row.revokedAt == nil)
        #expect(row.isRevoked == false)
    }

    @Test("A revoked row carries its stamp and reads as revoked")
    func revokedRowDecodes() throws {
        let rows = try decodeList(
            """
            {"shares":[{"id":"abc123","url":"https://sureword.app/shared/abc123",
            "question":"Who was Melchisedec?","createdAt":"2026-09-16T00:00:00.000Z",
            "revokedAt":"2026-09-17T00:00:00.000Z"}]}
            """
        )
        let row = try #require(rows.first)
        #expect(row.isRevoked)
        #expect(row.revokedAt == "2026-09-17T00:00:00.000Z")
    }

    @Test("A shared answer whose turn had no question is named, not blank")
    func emptyQuestionFallsBackToATitle() throws {
        // The server stores `shareQuestion(prompt?.content ?? "")`, so an empty
        // question is a real row, not a broken one.
        let rows = try decodeList(
            #"{"shares":[{"id":"abc123","url":"https://sureword.app/shared/abc123","question":"   "}]}"#
        )
        let row = try #require(rows.first)
        #expect(row.title == SharedAnswerRow.untitled)
    }

    @Test("Missing optional fields leave a usable row")
    func sparseRowDecodes() throws {
        let rows = try decodeList(#"{"shares":[{"id":"abc123"}]}"#)
        let row = try #require(rows.first)
        #expect(row.id == "abc123")
        #expect(row.url.isEmpty)
        #expect(row.createdAt == nil)
        #expect(row.isRevoked == false)
    }

    @Test("A response with no shares key is an empty list, not a failure")
    func missingSharesKeyIsEmpty() throws {
        // A server that predates the route answers something else entirely, and
        // the Settings section must show its empty state rather than an error.
        #expect(try decodeList("{}").isEmpty)
    }

    // MARK: helpers

    private func encode(_ request: ShareAnswerRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(request)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func decodeList(_ json: String) throws -> [SharedAnswerRow] {
        try JSONDecoder().decode(SharedAnswersResponse.self, from: Data(json.utf8)).shares
    }
}
