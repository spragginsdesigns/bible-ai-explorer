import Testing
@testable import SureWord

/// The stream decoder is the one piece of the port with no TypeScript
/// counterpart to lean on — the AI SDK's transport does this job in the other two
/// clients. So it is tested against recorded chunk sequences in the exact shape
/// `createUIMessageStreamResponse` emits.
@Suite("UI message stream")
struct UIMessageStreamTests {

    /// Turn recorded SSE text into the line sequence `ServerSentEvents` expects.
    private func lines(_ raw: String) -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { continuation in
            for line in raw.components(separatedBy: "\n") { continuation.yield(line) }
            continuation.finish()
        }
    }

    private func chunks(from raw: String) async throws -> [UIMessageChunk] {
        var result: [UIMessageChunk] = []
        for try await chunk in UIMessageChunk.stream(from: lines(raw)) { result.append(chunk) }
        return result
    }

    // MARK: SSE framing

    @Test("Parses data lines and stops at the DONE sentinel")
    func parsesDataLines() async throws {
        let raw = """
        data: {"type":"start","messageId":"msg_abc"}

        data: {"type":"text-start","id":"0"}

        data: {"type":"text-delta","id":"0","delta":"Hello"}

        data: [DONE]

        """
        let decoded = try await chunks(from: raw)
        #expect(decoded == [
            .start(messageId: "msg_abc"),
            .textStart(id: "0"),
            .textDelta(id: "0", delta: "Hello"),
        ])
    }

    @Test("Ignores comments, event names and blank frames")
    func ignoresNonDataFields() async throws {
        let raw = """
        : keep-alive
        event: message
        data: {"type":"finish"}

        """
        #expect(try await chunks(from: raw) == [.finish])
    }

    @Test("An unrecognised chunk type decodes rather than killing the stream")
    func unknownChunkSurvives() async throws {
        let raw = """
        data: {"type":"text-delta","id":"0","delta":"A"}

        data: {"type":"some-future-chunk","payload":1}

        data: {"type":"text-delta","id":"0","delta":"B"}

        """
        let decoded = try await chunks(from: raw)
        #expect(decoded.count == 3)
        #expect(decoded[1] == .unknown(type: "some-future-chunk"))
    }

    @Test("Malformed JSON is skipped, not fatal")
    func malformedJSONSkipped() async throws {
        let raw = """
        data: {"type":"text-delta","id":"0","delta":"A"}

        data: {not json at all

        data: {"type":"finish"}

        """
        #expect(try await chunks(from: raw) == [
            .textDelta(id: "0", delta: "A"),
            .finish,
        ])
    }

    // MARK: Accumulation

    @Test("Assembles text deltas into a single part")
    func assemblesText() {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.start(messageId: "msg_1"))
        accumulator.apply(.textStart(id: "0"))
        accumulator.apply(.textDelta(id: "0", delta: "Melchizedek "))
        accumulator.apply(.textDelta(id: "0", delta: "was king of Salem."))
        accumulator.apply(.textEnd(id: "0"))
        accumulator.apply(.finish)

        #expect(accumulator.message.id == "msg_1")
        #expect(accumulator.message.parts.count == 1)
        #expect(accumulator.message.parts[0].textContent == "Melchizedek was king of Salem.")
    }

    @Test("Interleaved text ids stay in separate parts")
    func interleavedTextParts() {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.textDelta(id: "0", delta: "first "))
        accumulator.apply(.textDelta(id: "1", delta: "second "))
        accumulator.apply(.textDelta(id: "0", delta: "one"))
        accumulator.apply(.textDelta(id: "1", delta: "one"))

        #expect(accumulator.message.parts.count == 2)
        #expect(accumulator.message.parts[0].textContent == "first one")
        #expect(accumulator.message.parts[1].textContent == "second one")
    }

    @Test("Drives a tool call through its full lifecycle")
    func toolLifecycle() throws {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.toolInputStart(toolCallId: "call_1", toolName: "searchScripture"))

        var tool = try #require(accumulator.message.parts.first?.toolPart)
        #expect(tool.state == .inputStreaming)
        #expect(tool.type == "tool-searchScripture")

        accumulator.apply(.toolInputAvailable(
            toolCallId: "call_1",
            toolName: "searchScripture",
            input: .object(["query": .string("Melchizedek")])
        ))
        tool = try #require(accumulator.message.parts.first?.toolPart)
        #expect(tool.state == .inputAvailable)
        #expect(tool.input?["query"]?.stringValue == "Melchizedek")

        accumulator.apply(.toolOutputAvailable(
            toolCallId: "call_1",
            output: .object(["verses": .array([])])
        ))
        tool = try #require(accumulator.message.parts.first?.toolPart)
        #expect(tool.state == .outputAvailable)
        // The call stays a single part throughout — three lifecycle chunks must
        // not become three cards in the UI.
        #expect(accumulator.message.parts.count == 1)
    }

    @Test("Two concurrent tool calls stay distinct")
    func concurrentToolCalls() {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.toolInputStart(toolCallId: "a", toolName: "searchScripture"))
        accumulator.apply(.toolInputStart(toolCallId: "b", toolName: "webSearch"))
        accumulator.apply(.toolOutputAvailable(toolCallId: "b", output: .object([:])))

        let tools = accumulator.message.parts.compactMap(\.toolPart)
        #expect(tools.count == 2)
        #expect(tools[0].state == .inputStreaming)
        #expect(tools[1].state == .outputAvailable)
    }

    @Test("Captures a mid-stream error without discarding what arrived")
    func midStreamError() {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.textDelta(id: "0", delta: "Partial"))
        accumulator.apply(.error(text: "Upstream failed"))

        #expect(accumulator.errorText == "Upstream failed")
        #expect(accumulator.message.parts[0].textContent == "Partial")
    }

    @Test("Records an abort")
    func abortIsRecorded() {
        var accumulator = UIMessageAccumulator()
        accumulator.apply(.abort(reason: "user stopped"))
        #expect(accumulator.isAborted)
    }

    // MARK: End to end

    @Test("A recorded tool-using answer reduces to the right cards")
    func endToEndAnswer() async throws {
        let raw = """
        data: {"type":"start","messageId":"msg_end"}

        data: {"type":"start-step"}

        data: {"type":"tool-input-start","toolCallId":"c1","toolName":"searchScripture"}

        data: {"type":"tool-input-available","toolCallId":"c1","toolName":"searchScripture","input":{"query":"Melchizedek"}}

        data: {"type":"tool-output-available","toolCallId":"c1","output":{"verses":[{"reference":"Hebrews 7:1","similarity":0.91,"text":"For this Melchisedec, king of Salem…"}]}}

        data: {"type":"finish-step"}

        data: {"type":"text-start","id":"0"}

        data: {"type":"text-delta","id":"0","delta":"Melchizedek was king of Salem."}

        data: {"type":"text-delta","id":"0","delta":"\\n[FOLLOWUP] Who was Abraham?"}

        data: {"type":"text-end","id":"0"}

        data: {"type":"finish"}

        data: [DONE]

        """

        var accumulator = UIMessageAccumulator()
        for try await chunk in UIMessageChunk.stream(from: lines(raw)) {
            accumulator.apply(chunk)
        }

        let view = ChatViewMessage(message: accumulator.message, isStreaming: false)
        #expect(view.id == "msg_end")
        #expect(view.content == "Melchizedek was king of Salem.")
        #expect(view.followUps == ["Who was Abraham?"])
        #expect(view.retrievedVerses.count == 1)
        #expect(view.retrievedVerses[0].reference == "Hebrews 7:1")
        #expect(view.matchStrength == .strong)
        #expect(view.activity == nil)
    }
}
