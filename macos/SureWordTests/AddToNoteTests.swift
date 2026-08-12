import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/chat/addToNote.test.ts`.
@Suite("Add answer to notes")
struct AddToNoteTests {

    private func note(
        id: String = "n1",
        title: String = "Romans study",
        plainText: String = "Justification by faith alone",
        updatedAt: String = "2026-08-09T00:00:00.000Z"
    ) -> NoteSummary {
        NoteSummary(id: id, title: title, plainText: plainText, updatedAt: updatedAt)
    }

    // MARK: filter

    private var notes: [NoteSummary] {
        [
            note(id: "a", title: "Romans study", plainText: "Justification by faith"),
            note(id: "b", title: "Prayer list", plainText: "For the elders"),
        ]
    }

    @Test("Returns every note for a blank query")
    func blankQueryKeepsEverything() {
        #expect(AddToNote.filter(notes, query: "") == notes)
        #expect(AddToNote.filter(notes, query: "   ") == notes)
    }

    @Test("Matches on title, case-insensitively")
    func matchesTitle() {
        #expect(AddToNote.filter(notes, query: "romans").map(\.id) == ["a"])
    }

    @Test("Matches on the body preview")
    func matchesBody() {
        #expect(AddToNote.filter(notes, query: "elders").map(\.id) == ["b"])
    }

    @Test("Returns nothing when no note matches")
    func matchesNothing() {
        #expect(AddToNote.filter(notes, query: "genesis").isEmpty)
    }

    // MARK: request shaping

    @Test("Posts markdown plus the note id when appending")
    func appendBody() throws {
        let body = try encode(AppendToNoteRequest(markdown: "**Answer**", noteId: "n1"))
        #expect(body.keys.sorted() == ["markdown", "noteId"])
        #expect(body["markdown"] as? String == "**Answer**")
        #expect(body["noteId"] as? String == "n1")
    }

    @Test("Sends noteId null plus the title when creating")
    func createBody() throws {
        let body = try encode(
            AppendToNoteRequest(markdown: "text", noteId: nil, defaultTitle: "Romans 8")
        )
        #expect(body["markdown"] as? String == "text")
        #expect(body["title"] as? String == "Romans 8")
        #expect(body["noteId"] is NSNull)
    }

    @Test("Trims the default title before sending it")
    func trimsTitle() throws {
        let body = try encode(
            AppendToNoteRequest(markdown: "text", noteId: nil, defaultTitle: "  Romans 8  ")
        )
        #expect(body["title"] as? String == "Romans 8")
    }

    @Test("Omits an empty or whitespace-only title")
    func omitsBlankTitle() throws {
        for title in [nil, "", "   "] as [String?] {
            let body = try encode(
                AppendToNoteRequest(markdown: "text", noteId: nil, defaultTitle: title)
            )
            #expect(body["title"] == nil)
            #expect(body["noteId"] is NSNull)
        }
    }

    @Test("Never sends a title on the append path — the server ignores it")
    func noTitleWhenAppending() throws {
        let body = try encode(
            AppendToNoteRequest(markdown: "text", noteId: "n1", defaultTitle: "Romans 8")
        )
        #expect(body["title"] == nil)
        #expect(body["noteId"] as? String == "n1")
    }

    // MARK: response decoding

    @Test("Decodes the append response")
    func decodesResult() throws {
        let json = #"{"noteId":"n1","noteTitle":"T","created":false}"#
        let result = try JSONDecoder().decode(
            AppendToNoteResult.self,
            from: Data(json.utf8)
        )
        #expect(result == AppendToNoteResult(noteId: "n1", noteTitle: "T", created: false))
    }

    // MARK: note summaries

    @Test("Decodes the summary list, which omits content")
    func decodesSummaries() throws {
        let json = """
        [{"id":"n1","title":"Romans study","plainText":"Justification",\
        "folderId":null,"isPinned":false,"wordCount":1,\
        "createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-09T00:00:00.000Z",\
        "tags":[{"tag":{"id":"t1","name":"study","color":"#fff",\
        "createdAt":"2026-08-01T00:00:00.000Z"}}]}]
        """
        let rows = try JSONDecoder().decode([NoteSummary].self, from: Data(json.utf8))
        #expect(rows.count == 1)
        #expect(rows[0].id == "n1")
        #expect(rows[0].title == "Romans study")
        #expect(rows[0].plainText == "Justification")
    }

    @Test("Survives a null title or body")
    func decodesNullFields() throws {
        let json = #"[{"id":"n1","title":null,"plainText":null,"updatedAt":null}]"#
        let rows = try JSONDecoder().decode([NoteSummary].self, from: Data(json.utf8))
        #expect(rows[0].displayTitle == "Untitled Note")
        #expect(rows[0].preview == "Empty note")
        #expect(AddToNote.relativeTime(rows[0].updatedAt).isEmpty)
    }

    // MARK: relative time

    @Test("Formats recency the way the Android notes list does")
    func relativeTime() {
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        func at(_ secondsAgo: TimeInterval) -> String {
            let iso = ISO8601DateFormatter().string(from: now.addingTimeInterval(-secondsAgo))
            return AddToNote.relativeTime(iso, now: now)
        }
        #expect(at(10) == "Just now")
        #expect(at(300) == "5m ago")
        #expect(at(7200) == "2h ago")
        #expect(at(3 * 86400) == "3d ago")
        #expect(!at(60 * 86400).contains("ago"))
    }

    // MARK: helpers

    private func encode(_ request: AppendToNoteRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(request)
        return try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }
}
