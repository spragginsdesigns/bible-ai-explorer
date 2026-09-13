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
    @Test("Malformed snapshots are ignored")
    func ignoresMalformed() { #expect(ChatProgress(.object(["version": .number(1)])) == nil) }
}
