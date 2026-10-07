import Foundation
import Testing
@testable import SureWord

@Suite("Work history")
struct ChatProgressTests {
    private func snapshot(_ state: String = "complete") -> JSONValue {
        .object([
            "version": .number(1), "runId": .string("run"), "sequence": .number(4),
            "elapsedMs": .number(62000), "lastActivityMs": .number(60000),
            "state": .string(state), "phase": .string("tool"), "label": .string("Opening John 2:1–11"),
            "entries": .array([.object(["id": .string("p"), "kind": .string("tool"),
                                      "state": .string("complete"), "label": .string("Read John 2:1–11")])])
        ])
    }
    @Test("A completed message retains its work history without an active status")
    func retainsCompletedHistory() {
        let message = UIMessage(id: "a", role: .assistant, parts: [
            .data(DataPart(name: "progress", id: "progress", value: snapshot())),
            .text(id: "t", text: "Answer")
        ])
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.progress?.entries.first?.label == "Read John 2:1–11")
        #expect(view.activity == nil)
        #expect(ChatProgress.duration(view.progress?.elapsedMs ?? 0) == "1m 2s")
    }
    @Test("A preamble does not hide live progress")
    func preambleKeepsProgress() {
        let message = UIMessage(id: "a", role: .assistant, parts: [
            .text(id: "t", text: "Let me check."),
            .data(DataPart(name: "progress", id: "progress", value: snapshot("running")))
        ])
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == "Opening John 2:1–11")
    }
    /// Through the real history path, as Android's `chatProgress.test.ts` does:
    /// a stored row's `metadata.parts` carries the finished snapshot, and the
    /// reopened answer must still say "Worked for".
    @Test("A stored row restores its work history")
    func restoresFromStoredRow() throws {
        let row = try JSONDecoder().decode(
            JSONValue.self,
            from: Data(
                """
                {"id": "a", "role": "assistant", "content": "Answer",
                 "metadata": {"parts": [
                   {"type": "data-progress", "id": "progress", "data": {
                     "version": 1, "runId": "run", "sequence": 4, "elapsedMs": 62000,
                     "lastActivityMs": 60000, "state": "complete", "phase": "answering",
                     "label": "Work completed",
                     "entries": [{"id": "tool", "kind": "tool", "state": "complete", "label": "Read John 2:1-11"}]
                   }},
                   {"type": "data-status", "id": "status", "data": {"label": "Thinking"}},
                   {"type": "text", "text": "Answer"}
                 ]}}
                """.utf8
            )
        )
        let message = try #require(UIMessage(storedRow: row))
        // Only the progress snapshot survives; status narration is still dropped.
        #expect(message.parts.count == 2)
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.progress?.entries.first?.label == "Read John 2:1-11")
        #expect(view.progress?.state == "complete")
        #expect(view.activity == nil)
        #expect(ChatProgress.duration(view.progress?.elapsedMs ?? 0) == "1m 2s")
        // Never sent back: the outgoing encoding drops every data part.
        let encoded = message.json["parts"]?.arrayValue ?? []
        #expect(encoded.allSatisfy { $0["type"]?.stringValue == "text" })
    }

    @Test("A stored snapshot this build cannot read is dropped")
    func dropsMalformedStoredSnapshot() throws {
        let row = try JSONDecoder().decode(
            JSONValue.self,
            from: Data(
                """
                {"id": "b", "role": "assistant", "content": "Answer",
                 "metadata": {"parts": [
                   {"type": "data-progress", "id": "progress", "data": {"version": 2}},
                   {"type": "text", "text": "Answer"}
                 ]}}
                """.utf8
            )
        )
        let message = try #require(UIMessage(storedRow: row))
        #expect(message.parts.count == 1)
        #expect(ChatViewMessage(message: message, isStreaming: false).progress == nil)
    }

    @Test("Malformed snapshots are ignored")
    func ignoresMalformed() { #expect(ChatProgress(.object(["version": .number(1)])) == nil) }
}
