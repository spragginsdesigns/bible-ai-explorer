import Foundation
import Testing
@testable import SureWord

/// The wire shapes `PATCH /api/notes/{id}` accepts. The route writes only the
/// keys that are *present* (`body.folderId !== undefined && …`), so which keys
/// get encoded is the contract, not an implementation detail.
@Suite("Note patch encoding")
struct NotePatchTests {

    private func encode(_ patch: NotePatch) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return String(decoding: try encoder.encode(patch), as: UTF8.self)
    }

    @Test("Sends only the field being changed")
    func sendsOnlyTheChangedField() throws {
        #expect(try encode(.title("Romans 8")) == #"{"title":"Romans 8"}"#)
        #expect(try encode(.pinned(true)) == #"{"isPinned":true}"#)
    }

    /// The one that needs the custom encoder: unfiling a note has to send an
    /// explicit `null`, and `JSONEncoder` drops a nil-wrapped optional outright.
    @Test("Unfiling a note sends an explicit null folderId")
    func unfilingSendsNull() throws {
        #expect(try encode(.folder(nil)) == #"{"folderId":null}"#)
        #expect(try encode(.folder("f1")) == #"{"folderId":"f1"}"#)
    }

    @Test("Decodes a summary row, which omits the body columns")
    func decodesSummaryRow() throws {
        let json = """
            {"id":"n1","title":"Romans","plainText":"faith","folderId":null,
             "isPinned":false,"wordCount":1,"createdAt":"2026-01-01T00:00:00.000Z",
             "updatedAt":"2026-01-02T00:00:00.000Z",
             "tags":[{"tag":{"id":"t1","name":"Grace","color":"#f59e0b",
                             "createdAt":"2026-01-01T00:00:00.000Z"}}]}
            """
        let row = try JSONDecoder().decode(NoteAPIResponse.self, from: Data(json.utf8))
        let note = Note(api: row)

        #expect(note.id == "n1")
        #expect(note.htmlContent == "")
        #expect(note.tagIds == ["t1"])
        // Summary rows are not bodies, and must not be mistaken for one.
        #expect(!note.hasBody)
        #expect(Note.loaded(from: row).hasBody)
    }

    /// Both content columns get the HTML, matching what the Android client
    /// saves. `JSONEncoder` escapes forward slashes (`<\/p>`), which is valid
    /// JSON and decodes back to `</p>` — the assertion keeps that visible rather
    /// than hiding it behind `.withoutEscapingSlashes`, because the shared
    /// `APIClient` encodes every request this way.
    @Test("Encodes the autosave payload with both content columns")
    func encodesSavePayload() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let payload = NoteSavePayload(
            content: "<p>a</p>",
            htmlContent: "<p>a</p>",
            plainText: "a",
            wordCount: 1
        )
        let json = String(decoding: try encoder.encode(payload), as: UTF8.self)
        #expect(
            json == #"{"content":"<p>a<\/p>","htmlContent":"<p>a<\/p>","plainText":"a","wordCount":1}"#
        )

        // …and it decodes back to the exact HTML that was serialised.
        struct Decoded: Decodable { let content: String }
        let decoded = try JSONDecoder().decode(Decoded.self, from: Data(json.utf8))
        #expect(decoded.content == "<p>a</p>")
    }
}

/// Completed append and rewrite tool calls notify the open note's editor.
/// Every call must fire exactly once — restoring history re-delivers the same
/// tool calls, and re-applying them would duplicate verses in the document.
@Suite("Note AI mutation calls")
struct NoteAICallTests {

    private func assistantMessage(
        id: String,
        toolCallID: String,
        toolName: String = "addToNote",
        state: ToolState = .outputAvailable,
        output: JSONValue?
    ) -> UIMessage {
        UIMessage(
            id: id,
            role: .assistant,
            parts: [
                .tool(
                    ToolPart(
                        toolCallId: toolCallID,
                        toolName: toolName,
                        state: state,
                        input: nil,
                        output: output
                    )
                )
            ]
        )
    }

    @Test("Collects completed addToNote calls")
    func collectsCompletedCalls() {
        let messages = [
            assistantMessage(
                id: "m1",
                toolCallID: "call-1",
                output: .object([
                    "noteId": .string("n1"),
                    "noteTitle": .string("Romans"),
                    "appendedHtml": .string("<p>verse</p>"),
                ])
            )
        ]
        let calls = NoteAIModel.noteChangeCalls(in: messages)
        #expect(calls.count == 1)
        #expect(calls[0].toolCallID == "call-1")
        #expect(calls[0].noteID == "n1")
    }

    @Test("A completed rewrite refreshes the note without an appendedHtml field")
    func collectsCompletedRewrite() {
        let message = assistantMessage(
            id: "rewrite",
            toolCallID: "rewrite-1",
            toolName: "updateNote",
            output: .object([
                "noteId": .string("n1"),
                "noteTitle": .string("Romans"),
                "previousWordCount": .number(6),
                "wordCount": .number(6),
            ])
        )
        #expect(NoteAIModel.noteChangeCalls(in: [message]) == [
            NoteAIModel.NoteChangeCall(toolCallID: "rewrite-1", noteID: "n1"),
        ])
    }

    @Test("In-flight, failed and malformed rewrites never claim a note changed")
    func ignoresUnconfirmedRewrites() {
        let messages = [
            assistantMessage(id: "pending", toolCallID: "pending", toolName: "updateNote", state: .inputAvailable, output: nil),
            assistantMessage(id: "failed", toolCallID: "failed", toolName: "updateNote", output: .object(["error": .string("Write refused"), "noteId": .string("n1")])),
            assistantMessage(id: "partial", toolCallID: "partial", toolName: "updateNote", output: .object(["noteId": .string("n1")])),
            assistantMessage(id: "empty-note", toolCallID: "empty-note", toolName: "updateNote", output: .object(["noteId": .string("")])),
            assistantMessage(id: "empty-call", toolCallID: "", toolName: "updateNote", output: .object(["noteId": .string("n1")])),
            UIMessage(id: "prose", role: .assistant, parts: [.text(id: "0", text: "I updated your note.")]),
        ]
        #expect(NoteAIModel.noteChangeCalls(in: messages).isEmpty)
    }

    @Test("Ignores calls that have not produced output yet")
    func ignoresInFlightCalls() {
        let messages = [
            assistantMessage(id: "m1", toolCallID: "call-1", state: .inputAvailable, output: nil)
        ]
        #expect(NoteAIModel.noteChangeCalls(in: messages).isEmpty)
    }

    @Test("Ignores malformed output rather than failing the message")
    func ignoresMalformedOutput() {
        let messages = [
            assistantMessage(
                id: "m1",
                toolCallID: "call-1",
                output: .object(["noteId": .string("n1")])
            )
        ]
        #expect(NoteAIModel.noteChangeCalls(in: messages).isEmpty)
    }

    @Test("Ignores user messages and other tools")
    func ignoresOtherParts() {
        let messages = [
            UIMessage(id: "u1", role: .user, parts: [.text(id: "0", text: "hi")]),
            UIMessage(
                id: "m1",
                role: .assistant,
                parts: [
                    .tool(
                        ToolPart(
                            toolCallId: "call-2",
                            toolName: "searchScripture",
                            state: .outputAvailable,
                            input: nil,
                            output: .object(["verses": .array([])])
                        )
                    )
                ]
            ),
        ]
        #expect(NoteAIModel.noteChangeCalls(in: messages).isEmpty)
    }

    @Test("Encodes the note-ai request the route expects")
    func encodesRequest() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        // `timezone` feeds the route's `readingRequestContext` (reading-session
        // day boundaries). It defaults to the device zone, so pin it here.
        let request = NoteAIRequest(
            timezone: "America/Los_Angeles",
            messages: [.object(["role": .string("user")])],
            noteId: "n1"
        )
        let json = String(decoding: try encoder.encode(request), as: UTF8.self)
        #expect(json == #"{"messages":[{"role":"user"}],"noteId":"n1","timezone":"America\/Los_Angeles"}"#)
    }

    @Test("Operation requests encode the UUID alongside the same reading context and messages")
    func encodesOperationRequest() throws {
        let operationID = UUID().uuidString
        let request = NoteAIRequest(
            timezone: "America/Los_Angeles",
            messages: [.object(["id": .string("question"), "role": .string("user")])],
            noteId: "n1",
            operationId: operationID
        )
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        #expect(json["operationId"] as? String == operationID)
        #expect(json["timezone"] as? String == "America/Los_Angeles")
        #expect(json["noteId"] as? String == "n1")
        #expect((json["messages"] as? [[String: String]])?.first?["id"] == "question")
    }

    @Test("Only settled and cancelled operation receipts fence future writes")
    func decodesOperationReceipts() throws {
        for state in ["reserved", "running", "settled", "cancelled"] {
            let receipt = try JSONDecoder().decode(NoteAIOperation.self, from: Data("{\"id\":\"operation\",\"state\":\"\(state)\"}".utf8))
            #expect(receipt.isTerminal == ["settled", "cancelled"].contains(state))
        }
    }

    @Test("Existing ledger attempts decode as legacy and operation markers survive restart")
    func decodesAttemptProtocol() throws {
        let legacy = try JSONDecoder().decode(NotesStore.AIAttempt.self, from: Data(#"{"id":"old-id","userMessageID":"question","terminal":false}"#.utf8))
        #expect(legacy.operationProtocol == .legacy)
        let operation = NotesStore.AIAttempt(id: UUID().uuidString, userMessageID: "question", operationProtocol: .operationReceipt)
        let restored = try JSONDecoder().decode(NotesStore.AIAttempt.self, from: JSONEncoder().encode(operation))
        #expect(restored == operation)
    }
}
