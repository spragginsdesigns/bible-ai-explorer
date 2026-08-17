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
