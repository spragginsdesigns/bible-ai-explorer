import Foundation
import Testing
@testable import SureWord

/// Live status narration, ported one-for-one from the `data-status` cases in
/// `mobile/src/lib/chatView.test.ts`. The server writes a single stable-id
/// `data-status` part ("Getting ready" → "Reading <file>" → "Thinking") before
/// the first token, so the assistant bubble can say what it is doing instead of
/// showing an unexplained pause.
@Suite("Status narration")
struct ChatStatusTests {

    private func statusPart(_ label: String, id: String? = "status") -> UIMessagePart {
        .data(DataPart(name: "status", id: id, value: .object(["label": .string(label)])))
    }

    private func runningTool(_ name: String) -> UIMessagePart {
        .tool(ToolPart(toolCallId: "c1", toolName: name, state: .inputAvailable))
    }

    // MARK: Reduction

    @Test("Shows the server status label while streaming, and never after")
    func showsStatusWhileStreaming() {
        let message = UIMessage(
            id: "m4a",
            role: .assistant,
            parts: [statusPart("Reading Church-Notes.pdf")]
        )
        #expect(
            ChatViewMessage(message: message, isStreaming: true).activity
                == "Reading Church-Notes.pdf"
        )
        #expect(ChatViewMessage(message: message, isStreaming: false).activity == nil)
    }

    @Test("A running tool outranks the status line")
    func toolWinsOverStatus() {
        let message = UIMessage(
            id: "m4b",
            role: .assistant,
            parts: [statusPart("Thinking"), runningTool("getPassage")]
        )
        #expect(
            ChatViewMessage(message: message, isStreaming: true).activity == "Opening the passage"
        )
    }

    /// Once the answer itself is on screen the status line is stale — it
    /// narrated the wait, and the wait is over.
    @Test("Drops the status line once answer text has streamed")
    func statusYieldsToAnswerText() {
        let message = UIMessage(
            id: "m4d",
            role: .assistant,
            parts: [statusPart("Thinking"), .text(id: "t", text: "For God so loved the world")]
        )
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == nil)
    }

    @Test("Keeps an in-flight tool label even after answer text has streamed")
    func toolSurvivesAnswerText() {
        let message = UIMessage(
            id: "m4e",
            role: .assistant,
            parts: [
                statusPart("Thinking"),
                .text(id: "t", text: "Let me look that up."),
                runningTool("searchScripture"),
            ]
        )
        #expect(
            ChatViewMessage(message: message, isStreaming: true).activity
                == "Searching the Scriptures"
        )
    }

    @Test("Ignores a malformed status part")
    func ignoresMalformedStatus() {
        let message = UIMessage(
            id: "m4c",
            role: .assistant,
            parts: [.data(DataPart(name: "status", id: "status", value: .object(["label": .number(7)])))]
        )
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == nil)
    }

    /// `data-status` is the only data part any SureWord client renders.
    @Test("Ignores data parts that are not the status line")
    func ignoresOtherDataParts() {
        let message = UIMessage(
            id: "m4f",
            role: .assistant,
            parts: [.data(DataPart(name: "weather", id: "w", value: .object(["label": .string("Sunny")])))]
        )
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == nil)
    }

    /// The reading-plan and entity tools back the `/plan` and `/who` commands;
    /// without labels they would narrate themselves as a bare "Working".
    @Test("Labels every tool the TypeScript table labels")
    func toolLabelsCoverTheTable() {
        for name in [
            "tool-lookupBibleEntity", "tool-getBibleTimeline", "tool-getReadingPlan",
            "tool-startReadingPlan", "tool-markReadingPlanDay",
        ] {
            #expect(ChatViewMessage.toolActivityLabels[name] != nil, "\(name) has no label")
        }
    }

    // MARK: Stream folding

    /// The route reuses the id `"status"` for every write, so the labels must
    /// reconcile into one part that updates in place. Appending instead would
    /// leave the first label ("Getting ready") permanently on screen behind the
    /// current one.
    @Test("Folds every status write into one part that updates in place")
    func statusPartUpdatesInPlace() {
        var accumulator = UIMessageAccumulator(id: "a1")
        accumulator.apply(.data(name: "status", id: "status", value: .object(["label": .string("Getting ready")]), transient: false))
        accumulator.apply(.data(name: "status", id: "status", value: .object(["label": .string("Thinking")]), transient: false))

        #expect(accumulator.message.parts.count == 1)
        #expect(ChatViewMessage(message: accumulator.message, isStreaming: true).activity == "Thinking")
    }

    /// An id-less data part has nothing to reconcile against, so it appends -
    /// the AI SDK's own rule.
    @Test("Appends data parts that carry no id")
    func anonymousDataPartsAppend() {
        var accumulator = UIMessageAccumulator(id: "a2")
        accumulator.apply(.data(name: "status", id: nil, value: .object(["label": .string("One")]), transient: false))
        accumulator.apply(.data(name: "status", id: nil, value: .object(["label": .string("Two")]), transient: false))
        #expect(accumulator.message.parts.count == 2)
    }

    @Test("Decodes a data chunk's part id off the wire")
    func decodesDataChunkID() {
        let chunk = UIMessageChunk.decode(
            payload: #"{"type":"data-status","id":"status","data":{"label":"Getting ready"}}"#
        )
        #expect(chunk == .data(name: "status", id: "status", value: .object(["label": .string("Getting ready")]), transient: false))
    }

    /// The label has to be on screen before the first token, or the bubble sits
    /// blank through the whole pre-stream wait.
    @Test("Carries a status label on a message that has no text yet")
    func statusArrivesBeforeTheFirstToken() {
        var accumulator = UIMessageAccumulator(id: "a3")
        accumulator.apply(.start(messageId: "assistant-1"))
        accumulator.apply(.data(name: "status", id: "status", value: .object(["label": .string("Getting ready")]), transient: false))

        let view = ChatViewMessage(message: accumulator.message, isStreaming: true)
        #expect(view.content.isEmpty)
        #expect(view.activity == "Getting ready")
    }

    // MARK: Persistence

    /// Status parts narrate one turn's wait. Replaying a stored one would show a
    /// finished answer as though it were still working — the same reason the
    /// server strips them in `persistableParts`.
    @Test("Drops stored status parts on restore")
    func dropsStoredStatusParts() throws {
        let row = try JSONDecoder().decode(
            JSONValue.self,
            from: Data(
                """
                {"id": "d4", "role": "assistant", "content": "",
                 "metadata": {"parts": [
                   {"type": "data-status", "id": "status", "data": {"label": "Thinking"}},
                   {"type": "text", "text": "Saved"}
                 ]}}
                """.utf8
            )
        )
        let message = try #require(UIMessage(storedRow: row))
        #expect(message.parts == [.text(id: "restored", text: "Saved")])
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == nil)
    }

    /// `validateUIMessages` runs without data schemas, so replaying a status
    /// part on the next question risks a 400 and buys nothing.
    @Test("Never sends a status part back to the server")
    func statusPartsAreNotEncoded() {
        let message = UIMessage(
            id: "m6",
            role: .assistant,
            parts: [statusPart("Thinking"), .text(id: "t", text: "Answer")]
        )
        let parts = message.json["parts"]?.arrayValue ?? []
        #expect(parts.count == 1)
        #expect(parts.first?["type"]?.stringValue == "text")
    }

    /// A turn whose only part was narration encodes as `parts: []`. Sending that
    /// back asks `validateUIMessages` to accept an empty assistant message and
    /// asks the model to continue from a blank reply, so the turn is skipped
    /// entirely instead.
    @Test("Skips an assistant turn that is nothing but a status part")
    func emptyAssistantTurnIsNotSent() {
        let narrationOnly = UIMessage(id: "m7", role: .assistant, parts: [statusPart("Thinking")])
        #expect(narrationOnly.outgoingJSON == nil)
        #expect(UIMessage(id: "m8", role: .assistant).outgoingJSON == nil)

        // A turn with anything real in it still goes.
        let answered = UIMessage(
            id: "m9",
            role: .assistant,
            parts: [statusPart("Thinking"), .text(id: "t", text: "Answer")]
        )
        #expect(answered.outgoingJSON != nil)
        // A user turn is never skipped: an empty one is the caller's business.
        #expect(UIMessage(id: "m10", role: .user).outgoingJSON != nil)
    }

    // MARK: Transient parts

    /// `transient` is the AI SDK's own flag for a part the UI is shown but the
    /// message never keeps. Folding one into `parts` would leave it on screen
    /// after the turn finished and replay it on the next question.
    @Test("Decodes the transient flag off the wire")
    func decodesTransientFlag() {
        #expect(
            UIMessageChunk.decode(
                payload: #"{"type":"data-status","id":"status","data":{"label":"Thinking"},"transient":true}"#
            ) == .data(
                name: "status",
                id: "status",
                value: .object(["label": .string("Thinking")]),
                transient: true
            )
        )
        // Absent means false: the SureWord route writes its status line without
        // the flag today, and that part must keep rendering.
        #expect(
            UIMessageChunk.decode(payload: #"{"type":"data-status","data":{"label":"Thinking"}}"#)
                == .data(
                    name: "status",
                    id: nil,
                    value: .object(["label": .string("Thinking")]),
                    transient: false
                )
        )
    }

    @Test("Never folds a transient data part into the message")
    func transientPartsAreNotStored() {
        var accumulator = UIMessageAccumulator(id: "a4")
        accumulator.apply(
            .data(
                name: "status",
                id: "status",
                value: .object(["label": .string("Thinking")]),
                transient: true
            )
        )
        accumulator.apply(.textDelta(id: "0", delta: "He is the king of Salem."))

        #expect(accumulator.message.parts.count == 1)
        #expect(accumulator.message.parts.first?.dataPart == nil)
        #expect(ChatViewMessage(message: accumulator.message, isStreaming: true).content
            == "He is the king of Salem.")
    }
}
