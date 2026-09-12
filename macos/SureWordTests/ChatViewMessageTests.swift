import Testing
@testable import SureWord

/// Ported one-for-one from `mobile/src/lib/chatView.test.ts` so the Mac client's
/// message reduction is pinned to the Android/web behaviour rather than
/// re-derived. If a case here changes, the TS suite must change with it.
@Suite("ChatViewMessage")
struct ChatViewMessageTests {

    private func textMessage(_ id: String, _ role: UIMessage.Role, _ text: String) -> UIMessage {
        UIMessage(id: id, role: role, parts: [.text(id: "t", text: text)])
    }

    @Test("A settled empty assistant shell has no renderable content")
    func emptyAssistantShellIsHidden() {
        let empty = ChatViewMessage(id: "a", role: .assistant, content: "")
        #expect(!empty.hasRenderableContent)
        #expect(ChatViewMessage(id: "a", role: .assistant, content: "", isStreaming: true).hasRenderableContent)
        #expect(ChatViewMessage(id: "a", role: .assistant, content: "", activity: "Thinking").hasRenderableContent)
        #expect(ChatViewMessage(id: "a", role: .assistant, content: "Answer").hasRenderableContent)
        #expect(ChatViewMessage(id: "u", role: .user, content: "").hasRenderableContent)
    }

    // MARK: visibleResponseContent

    @Test("Strips the follow-up block from the end")
    func stripsFollowUpBlock() {
        #expect(
            ChatViewMessage.visibleResponseContent("Answer text.\n[FOLLOWUP] Next?") == "Answer text."
        )
    }

    @Test("Strips everything from the first follow-up onward")
    func stripsFromFirstFollowUp() {
        #expect(
            ChatViewMessage.visibleResponseContent("Body\n[FOLLOWUP] One\n[FOLLOWUP] Two") == "Body"
        )
    }

    @Test("Leaves ordinary text untouched")
    func leavesPlainText() {
        #expect(ChatViewMessage.visibleResponseContent("Plain answer.") == "Plain answer.")
    }

    // MARK: parseFollowUps

    @Test("Extracts up to two unique follow-ups")
    func extractsTwoFollowUps() {
        let content = "A\n[FOLLOWUP] First?\n[FOLLOWUP] Second?\n[FOLLOWUP] Third?"
        #expect(ChatViewMessage.parseFollowUps(content) == ["First?", "Second?"])
    }

    @Test("Dedupes case-insensitively")
    func dedupesFollowUps() {
        #expect(ChatViewMessage.parseFollowUps("[FOLLOWUP] Same?\n[FOLLOWUP] same?") == ["Same?"])
    }

    @Test("Returns nothing when there are no follow-ups")
    func noFollowUps() {
        #expect(ChatViewMessage.parseFollowUps("No follow-ups here.").isEmpty)
    }

    // MARK: toViewMessage

    @Test("Maps a plain assistant text message")
    func mapsPlainMessage() {
        let view = ChatViewMessage(message: textMessage("m1", .assistant, "Hello"), isStreaming: false)
        #expect(view.id == "m1")
        #expect(view.role == .assistant)
        #expect(view.content == "Hello")
        #expect(view.retrievedVerses.isEmpty)
    }

    @Test("Collects verses and averages similarity from searchScripture output")
    func collectsVerses() throws {
        let message = UIMessage(
            id: "m2",
            role: .assistant,
            parts: [
                .tool(ToolPart(
                    toolCallId: "c1",
                    toolName: "searchScripture",
                    state: .outputAvailable,
                    output: .object([
                        "verses": .array([
                            .object([
                                "reference": .string("John 3:16"),
                                "similarity": .number(0.9),
                                "text": .string("For God so loved…"),
                                "translation": .string("NKJV"),
                            ]),
                            .object([
                                "reference": .string("John 3:17"),
                                "similarity": .number(0.7),
                            ]),
                        ])
                    ])
                )),
                .text(id: "t", text: "Answer"),
            ]
        )
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.retrievedVerses.count == 2)
        #expect(view.retrievedVerses.first?.translation == .nkjv)
        let average = try #require(view.averageSimilarity)
        #expect(abs(average - 0.8) < 0.0001)
    }

    @Test("Drops malformed verses instead of failing the message")
    func dropsMalformedVerses() {
        let message = UIMessage(
            id: "m3",
            role: .assistant,
            parts: [
                .tool(ToolPart(
                    toolCallId: "c1",
                    toolName: "searchScripture",
                    state: .outputAvailable,
                    output: .object([
                        "verses": .array([
                            .object(["reference": .number(42)]),
                            .string("junk"),
                            .object([
                                "reference": .string("Psalm 23:1"),
                                "similarity": .number(0.8),
                            ]),
                        ])
                    ])
                ))
            ]
        )
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.retrievedVerses == [RetrievedVerse(reference: "Psalm 23:1", similarity: 0.8)])
    }

    @Test("Shows tool activity only while streaming")
    func activityOnlyWhileStreaming() {
        let message = UIMessage(
            id: "m4",
            role: .assistant,
            parts: [.tool(ToolPart(toolCallId: "c1", toolName: "getPassage", state: .inputAvailable))]
        )
        #expect(ChatViewMessage(message: message, isStreaming: true).activity == "Opening the passage")
        #expect(ChatViewMessage(message: message, isStreaming: false).activity == nil)
    }

    @Test("Maps note-writing tool output to a note action")
    func mapsNoteAction() {
        let message = UIMessage(
            id: "m5",
            role: .assistant,
            parts: [
                .tool(ToolPart(
                    toolCallId: "c1",
                    toolName: "addToNote",
                    state: .outputAvailable,
                    output: .object([
                        "noteId": .string("n1"),
                        "noteTitle": .string("Study"),
                        "created": .bool(true),
                    ])
                ))
            ]
        )
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.noteActions == [NoteAction(noteID: "n1", noteTitle: "Study", created: true)])
    }

    @Test("Maps a replaced daily cross to a cross action, and reads to nothing")
    func mapsCrossAction() {
        let replaced = UIMessage(
            id: "m6",
            role: .assistant,
            parts: [
                .tool(ToolPart(
                    toolCallId: "c1",
                    toolName: "setDailyCross",
                    state: .outputAvailable,
                    output: .object([
                        "reference": .string("James 1:4"),
                        "text": .string("But let patience have her perfect work…"),
                        "reason": .string("For the waiting you are in."),
                        "previousReference": .string("Hebrews 12:2"),
                    ])
                ))
            ]
        )
        #expect(
            ChatViewMessage(message: replaced, isStreaming: false).crossActions == [
                CrossAction(
                    reference: "James 1:4",
                    text: "But let patience have her perfect work…",
                    reason: "For the waiting you are in.",
                    previousReference: "Hebrews 12:2"
                )
            ]
        )

        // Reading the day is silent: no receipt card for getDailyCross.
        let read = UIMessage(
            id: "m7",
            role: .assistant,
            parts: [
                .tool(ToolPart(
                    toolCallId: "c2",
                    toolName: "getDailyCross",
                    state: .outputAvailable,
                    output: .object([
                        "reference": .string("James 1:4"),
                        "text": .string("But let patience…"),
                    ])
                ))
            ]
        )
        #expect(ChatViewMessage(message: read, isStreaming: false).crossActions.isEmpty)
    }

    @Test("Badges match strength on the shared thresholds")
    func matchStrengthThresholds() {
        #expect(MatchStrength(average: 0.76) == .strong)
        #expect(MatchStrength(average: 0.75) == .moderate)
        #expect(MatchStrength(average: 0.61) == .moderate)
        #expect(MatchStrength(average: 0.6) == .broad)
    }
}

/// Ported from the `dbMessageToUIMessage` block of the same TS suite.
@Suite("History restore")
struct HistoryRestoreTests {

    @Test("Wraps legacy content rows into a text part")
    func wrapsLegacyContent() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("d1"),
            "role": .string("user"),
            "content": .string("Hi"),
        ])))
        #expect(message.parts.count == 1)
        #expect(message.parts[0].textContent == "Hi")
    }

    @Test("Restores durable attachment file parts and ids")
    func restoresAttachments() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("with-file"),
            "role": .string("user"),
            "content": .string("What is shown here?"),
            "attachments": .array([
                .object([
                    "id": .string("att-1"),
                    "filename": .string("screenshot.png"),
                    "mediaType": .string("image/png"),
                    "size": .number(1200),
                    "previewUrl": .string("https://example.test/private-signed"),
                    "previewExpiresAt": .string("2030-01-01T00:00:00.000Z"),
                ])
            ]),
        ])))

        let file = try #require(message.parts.first?.filePart)
        #expect(file.filename == "screenshot.png")
        #expect(file.mediaType == "image/png")
        #expect(file.url == "https://example.test/private-signed")
        #expect(message.metadata?["attachmentIds"] == .array([.string("att-1")]))
    }

    @Test("Preserves stored parts and strips them from metadata")
    func preservesStoredParts() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("d2"),
            "role": .string("assistant"),
            "content": .string(""),
            "metadata": .object([
                "parts": .array([.object(["type": .string("text"), "text": .string("Saved")])]),
                "followUps": .array([.string("Next?")]),
            ]),
        ])))
        #expect(message.parts.count == 1)
        #expect(message.parts[0].textContent == "Saved")
        #expect(message.metadata == .object(["followUps": .array([.string("Next?")])]))
    }

    @Test("Rejects malformed rows")
    func rejectsMalformedRows() {
        #expect(UIMessage(storedRow: .object([
            "id": .string("d3"),
            "role": .string("system"),
            "content": .string("x"),
        ])) == nil)
        #expect(UIMessage(storedRow: .null) == nil)
    }

    @Test("A restored tool call is not left looking like it is still running")
    func restoredToolStateDefaultsToComplete() throws {
        let message = try #require(UIMessage(storedRow: .object([
            "id": .string("d4"),
            "role": .string("assistant"),
            "content": .string(""),
            "metadata": .object([
                "parts": .array([
                    .object([
                        "type": .string("tool-webSearch"),
                        "toolCallId": .string("c9"),
                        "output": .object(["results": .array([])]),
                    ])
                ])
            ]),
        ])))
        let tool = try #require(message.parts.first?.toolPart)
        #expect(tool.state == .outputAvailable)
        #expect(tool.toolName == "webSearch")
        #expect(ChatViewMessage(message: message, isStreaming: false).activity == nil)
    }
}

/// Which answer counts as "still being written".
///
/// The render list asks this once per rebuild, and the old form - "the newest
/// assistant message anywhere in the list" - is wrong for the whole window
/// between pressing send and the first chunk arriving, when the list ends in a
/// *user* turn. It re-marked the previous, finished answer as streaming, which
/// tore its follow-up chips and its "Add to notes" button out of a row that was
/// already on screen, on every second send of every conversation.
@Suite("Streaming answer identity")
@MainActor
struct StreamingAssistantIDTests {

    private func message(_ id: String, _ role: UIMessage.Role) -> UIMessage {
        UIMessage(id: id, role: role, parts: [.text(id: "t", text: "…")])
    }

    @Test("Nothing is streaming while the model is idle")
    func idleStreamsNothing() {
        let list = [message("u1", .user), message("a1", .assistant)]
        #expect(ChatViewModel.streamingAssistantID(in: list, isBusy: false) == nil)
    }

    @Test("The assistant turn at the end of the list is the one streaming")
    func trailingAssistantStreams() {
        let list = [message("u1", .user), message("a1", .assistant)]
        #expect(ChatViewModel.streamingAssistantID(in: list, isBusy: true) == "a1")
    }

    @Test("A settled earlier answer stays settled while a new send is in flight")
    func earlierAnswerStaysSettled() {
        let list = [
            message("u1", .user),
            message("a1", .assistant),
            message("u2", .user),
        ]
        #expect(ChatViewModel.streamingAssistantID(in: list, isBusy: true) == nil)
    }

    @Test("Only the newest answer streams once its own turn has opened")
    func onlyNewestAnswerStreams() {
        let list = [
            message("u1", .user),
            message("a1", .assistant),
            message("u2", .user),
            message("a2", .assistant),
        ]
        #expect(ChatViewModel.streamingAssistantID(in: list, isBusy: true) == "a2")
    }

    @Test("An empty list has nothing streaming")
    func emptyListStreamsNothing() {
        #expect(ChatViewModel.streamingAssistantID(in: [], isBusy: true) == nil)
    }
}

/// Receipts, case for case with `tests/fixtures/chat-receipts.json`, the fixture
/// the web and Android suites share. The fixture is outside `macos/`, which is
/// all a Mac build sees, so the cases are restated here; change them together.
@Suite("Chat receipts")
struct ChatReceiptTests {

    private func tool(
        _ name: String,
        _ callID: String,
        state: ToolState = .outputAvailable,
        input: [String: JSONValue] = [:],
        output: [String: JSONValue]? = nil
    ) -> UIMessagePart {
        .tool(ToolPart(
            toolCallId: callID,
            toolName: name,
            state: state,
            input: .object(input),
            output: output.map { .object($0) }
        ))
    }

    private func receipts(_ parts: [UIMessagePart]) -> [ChatReceipt] {
        ChatViewMessage(
            message: UIMessage(id: "m", role: .assistant, parts: parts),
            isStreaming: false
        ).receipts
    }

    private func planOutput() -> [String: JSONValue] {
        ["hasPlan": .bool(true), "title": .string("The Gospels in 30 Days"), "dayCount": .number(30)]
    }

    @Test("addToNote that created a note says Saved to")
    func noteCreated() {
        let parts = [tool("addToNote", "call_note_created", output: [
            "noteId": .string("note_1"), "noteTitle": .string("Romans study"),
            "appendedHtml": .string("<h2>Grace</h2>"), "created": .bool(true), "matchedExisting": .bool(false),
        ])]
        #expect(receipts(parts) == [
            ChatReceipt(id: "call_note_created", kind: .note, label: "Saved to Romans study", target: .note(noteID: "note_1")),
        ])
    }

    @Test("addToNote that appended, with or without matchedExisting, says Added to")
    func noteAppended() {
        let legacy = tool("addToNote", "call_note_appended", output: [
            "noteId": .string("note_2"), "noteTitle": .string("Prayer journal"), "created": .bool(false),
        ])
        let matched = tool("addToNote", "call_note_matched", output: [
            "noteId": .string("note_1"), "noteTitle": .string("Romans study"),
            "created": .bool(false), "matchedExisting": .bool(true),
        ])
        #expect(receipts([legacy, matched]) == [
            ChatReceipt(id: "call_note_appended", kind: .note, label: "Added to Prayer journal", target: .note(noteID: "note_2")),
            ChatReceipt(id: "call_note_matched", kind: .note, label: "Added to Romans study", target: .note(noteID: "note_1")),
        ])
    }

    @Test("A tool that threw or declined leaves no receipt")
    func failuresLeaveNoReceipt() {
        let threw = tool("addToNote", "call_note_error", state: .outputError)
        let declined = tool("saveMemory", "call_mem_failed", output: [
            "success": .bool(false), "error": .string("Memory is full."),
        ])
        let refused = tool("startReadingPlan", "call_plan_refused", state: .outputError)
        #expect(receipts([threw, declined, refused]).isEmpty)
    }

    @Test("updateNote says Updated")
    func noteUpdated() {
        let parts = [tool("updateNote", "call_note_updated", output: [
            "noteId": .string("note_3"), "noteTitle": .string("Sermon notes"),
            "previousWordCount": .number(120), "wordCount": .number(140),
        ])]
        #expect(receipts(parts) == [
            ChatReceipt(id: "call_note_updated", kind: .note, label: "Updated Sermon notes", target: .note(noteID: "note_3")),
        ])
    }

    @Test("Each saved memory is Remembered with an undo")
    func memoriesSaved() {
        func saved(_ callID: String, _ memoryID: String, created: Bool) -> UIMessagePart {
            tool("saveMemory", callID, output: [
                "success": .bool(true), "created": .bool(created),
                "memory": .object(["id": .string(memoryID), "content": .string("Fact"), "category": .string("personal")]),
            ])
        }
        let parts: [UIMessagePart] = [
            saved("call_mem_a", "mem_a", created: true),
            .text(id: "t", text: "I will remember both."),
            saved("call_mem_b", "mem_b", created: false),
        ]
        #expect(receipts(parts) == [
            ChatReceipt(id: "call_mem_a", kind: .memory, label: "Remembered",
                        target: .memories(memoryID: "mem_a"), undo: .forgetMemory(memoryID: "mem_a")),
            ChatReceipt(id: "call_mem_b", kind: .memory, label: "Remembered",
                        target: .memories(memoryID: "mem_b"), undo: .forgetMemory(memoryID: "mem_b")),
        ])
    }

    @Test("updateMemory and deleteMemories")
    func memoriesChanged() {
        let updated = tool("updateMemory", "call_mem_updated", output: [
            "success": .bool(true), "memory": .object(["id": .string("mem_1")]),
        ])
        let deletedThree = tool("deleteMemories", "call_mem_deleted", output: ["success": .bool(true), "deleted": .number(3)])
        let deletedOne = tool("deleteMemories", "call_mem_deleted_one", output: ["success": .bool(true), "deleted": .number(1)])
        let deletedNone = tool("deleteMemories", "call_mem_deleted_none", output: ["success": .bool(true), "deleted": .number(0)])
        #expect(receipts([updated, deletedThree, deletedOne, deletedNone]) == [
            ChatReceipt(id: "call_mem_updated", kind: .memory, label: "Memory updated", target: .memories(memoryID: "mem_1")),
            ChatReceipt(id: "call_mem_deleted", kind: .memory, label: "Forgot 3 memories", target: .memories(memoryID: nil)),
            ChatReceipt(id: "call_mem_deleted_one", kind: .memory, label: "Forgot 1 memory", target: .memories(memoryID: nil)),
        ])
    }

    @Test("setDailyCross keeps its cross card and adds a receipt")
    func dailyCross() {
        let parts = [tool("setDailyCross", "call_cross", output: [
            "reference": .string("James 1:4"), "text": .string("But let patience have her perfect work"),
            "reason": .string("Patience"), "previousReference": .string("Romans 5:3"),
        ])]
        let view = ChatViewMessage(message: UIMessage(id: "m", role: .assistant, parts: parts), isStreaming: false)
        #expect(view.crossActions.count == 1)
        #expect(view.receipts == [
            ChatReceipt(id: "call_cross", kind: .cross, label: "Today's cross: James 1:4", target: .cross),
        ])
    }

    @Test("Reading plan start and day mark; an untick leaves no receipt")
    func readingPlan() {
        let started = tool("startReadingPlan", "call_plan_started", input: ["confirmed": .bool(true)], output: planOutput())
        let marked = tool("markReadingPlanDay", "call_plan_marked", input: ["day": .number(4)], output: planOutput())
        let unmarked = tool("markReadingPlanDay", "call_plan_unmarked",
                            input: ["day": .number(4), "done": .bool(false)], output: planOutput())
        #expect(receipts([started, marked, unmarked]) == [
            ChatReceipt(id: "call_plan_started", kind: .plan, label: "Started The Gospels in 30 Days", target: .plan),
            ChatReceipt(id: "call_plan_marked", kind: .plan, label: "Marked day 4", target: .plan),
        ])
    }

    @Test("highlightVerse names a colour only when it is not the default")
    func highlights() {
        let yellow = tool("highlightVerse", "call_highlight_default", output: [
            "success": .bool(true), "reference": .string("Romans 8:28"), "book": .string("Romans"),
            "bookNumber": .number(45), "chapter": .number(8), "verse": .number(28),
            "color": .string("#F5D76E"), "colorName": .string("Yellow"), "translation": .string("KJV"),
        ])
        let green = tool("highlightVerse", "call_highlight_green", output: [
            "success": .bool(true), "reference": .string("Psalms 23:1-3"), "book": .string("Psalms"),
            "bookNumber": .number(19), "chapter": .number(23), "verse": .number(1),
            "color": .string("#27AE60"), "colorName": .string("Green"), "translation": .string("NKJV"),
        ])
        #expect(receipts([yellow, green]) == [
            ChatReceipt(id: "call_highlight_default", kind: .highlight, label: "Marked Romans 8:28",
                        target: .chapter(book: 45, chapter: 8, verse: 28, translation: .kjv)),
            ChatReceipt(id: "call_highlight_green", kind: .highlight, label: "Marked Psalms 23:1-3 as Green",
                        target: .chapter(book: 19, chapter: 23, verse: 1, translation: .nkjv)),
        ])
    }

    @Test("organizeNote says Filed")
    func organizeNote() {
        let parts = [tool("organizeNote", "call_note_organized", output: [
            "success": .bool(true), "noteId": .string("note_1"), "title": .string("Romans study"),
            "folder": .string("Romans"), "tags": .array([.string("grace")]), "pinned": .bool(false),
        ])]
        #expect(receipts(parts) == [
            ChatReceipt(id: "call_note_organized", kind: .note, label: "Filed Romans study", target: .note(noteID: "note_1")),
        ])
    }

    @Test("A passive memory extraction looks like a tool save")
    func memoryExtracted() {
        let parts: [UIMessagePart] = [
            .text(id: "t", text: "Amen."),
            .data(DataPart(name: "memoryExtracted", id: nil, value: .object([
                "memoryId": .string("mem_passive"), "content": .string("Attends a Baptist church"),
            ]))),
        ]
        #expect(receipts(parts) == [
            ChatReceipt(id: "memoryExtracted:mem_passive", kind: .memory, label: "Remembered",
                        target: .memories(memoryID: "mem_passive"), undo: .forgetMemory(memoryID: "mem_passive")),
        ])
    }

    @Test("Read tools, status narration and in-flight writes leave no receipt")
    func readsLeaveNoReceipt() {
        let parts: [UIMessagePart] = [
            .data(DataPart(name: "status", id: "status", value: .object(["label": .string("Thinking")]))),
            tool("getPassage", "call_read_passage", output: ["verses": .array([])]),
            tool("findNotes", "call_read_notes", output: ["notes": .array([])]),
            tool("listMemories", "call_read_memories", output: ["success": .bool(true), "memories": .array([])]),
            tool("getDailyCross", "call_read_cross", output: ["reference": .string("James 1:4"), "text": .string("x")]),
            tool("saveMemory", "call_mem_streaming", state: .inputAvailable),
        ]
        #expect(receipts(parts).isEmpty)
    }
}
