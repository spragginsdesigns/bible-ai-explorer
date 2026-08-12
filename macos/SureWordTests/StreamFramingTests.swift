import Foundation
import Testing
@testable import SureWord

/// Covers the parts of the SSE contract the recorded fixtures cannot reach.
///
/// Both fixtures are LF-only single-`data:` streams, because that is what Vercel
/// serves today. The line splitter and the payload joiner document more than
/// that — CR and CRLF terminators, and multi-`data:` events — and undocumented,
/// untested behaviour is how the original framing bug stayed invisible.
@Suite("SSE framing")
struct StreamFramingTests {

    /// Stands in for `URLSession.AsyncBytes`.
    struct ByteStream: AsyncSequence, Sendable {
        typealias Element = UInt8
        let bytes: [UInt8]

        init(_ text: String) { bytes = Array(text.utf8) }
        init(bytes: [UInt8]) { self.bytes = bytes }

        struct Iterator: AsyncIteratorProtocol {
            let bytes: [UInt8]
            var index = 0
            mutating func next() async throws -> UInt8? {
                guard index < bytes.count else { return nil }
                defer { index += 1 }
                return bytes[index]
            }
        }

        func makeAsyncIterator() -> Iterator { Iterator(bytes: bytes) }
    }

    private func lines(_ raw: String) async throws -> [String] {
        var result: [String] = []
        for try await line in ServerSentEvents.lines(from: ByteStream(raw)) { result.append(line) }
        return result
    }

    private func payloads(_ raw: String) async throws -> [String] {
        var result: [String] = []
        for try await payload in ServerSentEvents.payloads(from: ServerSentEvents.lines(from: ByteStream(raw))) {
            result.append(payload)
        }
        return result
    }

    private func chunks(_ raw: String) async throws -> [UIMessageChunk] {
        var result: [UIMessageChunk] = []
        for try await chunk in UIMessageChunk.stream(fromBytes: ByteStream(raw)) { result.append(chunk) }
        return result
    }

    // MARK: (i) Line terminators

    @Test("LF terminates a line and keeps the blank one")
    func lineFeed() async throws {
        #expect(try await lines("a\n\nb\n") == ["a", "", "b"])
    }

    @Test("CRLF terminates a line exactly once")
    func carriageReturnLineFeed() async throws {
        // The classic failure here is a phantom empty line per CRLF, which would
        // split every SSE event in two.
        #expect(try await lines("a\r\n\r\nb\r\n") == ["a", "", "b"])
    }

    @Test("A bare CR terminates a line")
    func carriageReturnOnly() async throws {
        #expect(try await lines("a\r\rb\r") == ["a", "", "b"])
    }

    @Test("A trailing line with no terminator is still delivered")
    func unterminatedTail() async throws {
        #expect(try await lines("a\nb") == ["a", "b"])
    }

    @Test("Mixed terminators in one body all frame correctly")
    func mixedTerminators() async throws {
        #expect(try await lines("a\r\nb\nc\rd") == ["a", "b", "c", "d"])
    }

    @Test("A CR at a read boundary does not swallow the next line")
    func carriageReturnAcrossChunks() async throws {
        // Exercises the `lastWasCarriageReturn` latch: CR then LF is one break,
        // but CR then a normal byte must start a new line immediately.
        #expect(try await lines("a\rb\r\nc") == ["a", "b", "c"])
    }

    @Test("A whole CRLF stream decodes to the same chunks as its LF twin")
    func crlfStreamDecodes() async throws {
        let lf = "data: {\"type\":\"start\",\"messageId\":\"m1\"}\n\ndata: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"Hi\"}\n\ndata: [DONE]\n\n"
        let crlf = lf.replacingOccurrences(of: "\n", with: "\r\n")
        let expected: [UIMessageChunk] = [.start(messageId: "m1"), .textDelta(id: "0", delta: "Hi")]
        #expect(try await chunks(lf) == expected)
        #expect(try await chunks(crlf) == expected)
    }

    // MARK: (ii) Multi-`data:` events

    @Test("Several data lines in one event join with newlines")
    func multipleDataLinesJoin() async throws {
        #expect(try await payloads("data: one\ndata: two\n\n") == ["one\ntwo"])
    }

    @Test("A JSON object split across data lines still decodes")
    func splitJSONObjectDecodes() async throws {
        // The AI SDK sends one line per event today; this is the guard for if it
        // ever wraps, which would otherwise silently drop every chunk.
        let raw = "data: {\"type\":\"text-delta\",\n" +
            "data: \"id\":\"0\",\"delta\":\"Hi\"}\n\n"
        #expect(try await chunks(raw) == [.textDelta(id: "0", delta: "Hi")])
    }

    @Test("Each event's data lines stay with their own event")
    func eventsDoNotBleed() async throws {
        #expect(try await payloads("data: a1\ndata: a2\n\ndata: b1\n\n") == ["a1\na2", "b1"])
    }

    @Test("Exactly one space after the colon is framing, the rest is payload")
    func leadingSpaceHandling() async throws {
        #expect(try await payloads("data:  two spaces\n\n") == [" two spaces"])
        #expect(try await payloads("data:no space\n\n") == ["no space"])
    }

    @Test("A final event with no trailing blank line is still flushed")
    func trailingEventFlushed() async throws {
        #expect(try await payloads("data: {\"type\":\"finish\"}") == [#"{"type":"finish"}"#])
    }
}

// MARK: - Empty-stream guard

/// (iii) The guard that turns a silent dead end into a visible error. It exists
/// because the SSE framing bug produced a 200 that decoded to nothing at all and
/// the user saw no answer *and* no error.
@Suite("Empty stream guard")
@MainActor
struct EmptyStreamGuardTests {

    private func makeViewModel() -> ChatViewModel {
        // The client is never called: these tests drive `consume` directly.
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        return ChatViewModel(api: api, settings: SettingsStore())
    }

    @Test("A non-SSE body raises the empty-stream error")
    func nonSSEBodyErrors() async {
        let chat = makeViewModel()
        // What a misconfigured edge or an HTML error page would deliver with a 200.
        await chat.consume(StreamFramingTests.ByteStream("<!doctype html><h1>502</h1>"))

        #expect(chat.sendError == ChatViewModel.emptyStreamError)
        #expect(chat.status == .idle)
        #expect(chat.messages.isEmpty)
    }

    @Test("An empty body raises the empty-stream error")
    func emptyBodyErrors() async {
        let chat = makeViewModel()
        await chat.consume(StreamFramingTests.ByteStream(""))
        #expect(chat.sendError == ChatViewModel.emptyStreamError)
    }

    @Test("A body of only the DONE sentinel raises the empty-stream error")
    func doneOnlyErrors() async {
        let chat = makeViewModel()
        await chat.consume(StreamFramingTests.ByteStream("data: [DONE]\n\n"))
        #expect(chat.sendError == ChatViewModel.emptyStreamError)
    }

    /// The false-positive guard: a model that answers with no text is a valid,
    /// if empty, turn — it must not be reported as a broken stream.
    @Test("A legitimate start and finish only stream raises nothing")
    func startFinishOnlyIsSilent() async {
        let chat = makeViewModel()
        let raw = "data: {\"type\":\"start\",\"messageId\":\"msg_1\"}\n\n" +
            "data: {\"type\":\"finish\"}\n\n" +
            "data: [DONE]\n\n"
        await chat.consume(StreamFramingTests.ByteStream(raw))

        #expect(chat.sendError == nil)
        #expect(chat.status == .idle)
        // The assistant turn was still appended, carrying the server's id.
        #expect(chat.messages.count == 1)
        #expect(chat.messages.first?.id == "msg_1")
        #expect(chat.messages.first?.role == .assistant)
    }

    @Test("A normal answer raises nothing")
    func normalAnswerIsSilent() async {
        let chat = makeViewModel()
        let raw = "data: {\"type\":\"start\",\"messageId\":\"msg_2\"}\n\n" +
            "data: {\"type\":\"text-start\",\"id\":\"0\"}\n\n" +
            "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"Grace be unto you.\"}\n\n" +
            "data: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
        await chat.consume(StreamFramingTests.ByteStream(raw))

        #expect(chat.sendError == nil)
        #expect(chat.messages.first?.content == "Grace be unto you.")
    }

    /// A mid-stream `error` chunk must win over the empty-stream text — the
    /// server's own message is more useful than our generic one.
    @Test("A server error chunk is reported instead of the generic message")
    func serverErrorWins() async {
        let chat = makeViewModel()
        let raw = "data: {\"type\":\"error\",\"errorText\":\"Upstream refused\"}\n\ndata: [DONE]\n\n"
        await chat.consume(StreamFramingTests.ByteStream(raw))

        #expect(chat.sendError == "Upstream refused")
    }
}
