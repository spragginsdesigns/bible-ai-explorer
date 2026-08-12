import Foundation
import Testing
@testable import SureWord

/// Replays **real** `POST /api/ask-question` responses, byte for byte, through the
/// exact path `ChatViewModel` uses.
///
/// `UIMessageStreamTests` feeds the decoder hand-split lines, which is why it
/// stayed green while chat rendered nothing at all: the bug lived in the step
/// those tests skipped — turning response *bytes* into lines. Foundation's
/// `AsyncLineSequence` drops empty lines, and in SSE the empty line is the event
/// terminator, so `bytes.lines` never dispatched a single event.
///
/// The fixtures in `Fixtures/` were captured with `curl -N` against
/// `https://sureword.app/api/ask-question` on 2026-08-12 with a live Clerk session
/// token, using request bodies shaped exactly as `UIMessage+Encoding.swift`
/// encodes them.
@Suite("Recorded ask-question streams")
struct RecordedStreamTests {

    // MARK: Fixtures

    /// Loaded relative to this source file rather than from a bundle, so the
    /// recording is unambiguously *the file in the repo* and needs no resource
    /// wiring in `project.yml`.
    private static func fixture(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(name)
        return try Data(contentsOf: url)
    }

    /// Stands in for `URLSession.AsyncBytes`: an `AsyncSequence` of the response
    /// bytes with the same element and failure types.
    private struct ByteStream: AsyncSequence, Sendable {
        typealias Element = UInt8
        let bytes: [UInt8]

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

    private static func stream(_ name: String) throws -> ByteStream {
        ByteStream(bytes: Array(try fixture(name)))
    }

    private static func assemble(_ name: String) async throws -> UIMessage {
        var accumulator = UIMessageAccumulator(id: "assistant-local")
        for try await chunk in UIMessageChunk.stream(fromBytes: try stream(name)) {
            accumulator.apply(chunk)
        }
        return accumulator.message
    }

    // MARK: The regression itself

    /// Reproduces the original bug at its source. If this ever fails, Foundation
    /// changed and `ServerSentEvents.lines(from:)` may no longer be needed —
    /// until then, `bytes.lines` must never be used on an SSE body.
    @Test("Foundation's bytes.lines swallows the blank lines that frame SSE events")
    func foundationLinesDropBlankLines() async throws {
        let raw = "data: {\"type\":\"start\"}\n\ndata: {\"type\":\"finish\"}\n\n"
        let source = ByteStream(bytes: Array(raw.utf8))

        var foundationLines: [String] = []
        for try await line in source.lines { foundationLines.append(line) }
        #expect(foundationLines == [#"data: {"type":"start"}"#, #"data: {"type":"finish"}"#])
        #expect(!foundationLines.contains(""))

        // Our own splitter keeps them, which is the whole point.
        var ourLines: [String] = []
        for try await line in ServerSentEvents.lines(from: ByteStream(bytes: Array(raw.utf8))) {
            ourLines.append(line)
        }
        #expect(ourLines == [#"data: {"type":"start"}"#, "", #"data: {"type":"finish"}"#, ""])
    }

    /// The user-visible shape of the bug: a real 200 response decoding to nothing.
    @Test("Replayed through bytes.lines the real recording yields no chunks at all")
    func recordingCollapsesUnderFoundationLines() async throws {
        var decoded: [UIMessageChunk] = []
        let source = try Self.stream("ask-question-scripture-and-web.sse")
        for try await chunk in UIMessageChunk.stream(from: source.lines) {
            decoded.append(chunk)
        }
        // 508 real chunks in, zero out — no text, no tools, and no error either.
        #expect(decoded.isEmpty)
    }

    @Test("Replayed through the shipping path the same recording yields every chunk")
    func recordingDecodesThroughByteStream() async throws {
        var decoded: [UIMessageChunk] = []
        for try await chunk in UIMessageChunk.stream(
            fromBytes: try Self.stream("ask-question-scripture-and-web.sse")
        ) {
            decoded.append(chunk)
        }
        #expect(decoded.count == 508)
        #expect(decoded.first == .start(messageId: "msg-aNCd4VWqpUVk38B2ntjHDgtt"))
        #expect(decoded.last == .finish)
        #expect(!decoded.contains { if case .unknown = $0 { return true } else { return false } })
    }

    // MARK: Assembly of a real tool-using answer

    @Test("Scripture search and web search assemble into their cards")
    func scriptureAndWebAnswer() async throws {
        let message = try await Self.assemble("ask-question-scripture-and-web.sse")
        let view = ChatViewMessage(message: message, isStreaming: false)

        #expect(view.id == "msg-aNCd4VWqpUVk38B2ntjHDgtt")
        #expect(view.role == .assistant)

        // Four tool calls stayed four parts across their full lifecycle. These ran
        // in parallel, so part order follows `tool-input-start`, not the order the
        // outputs came back — the same ordering the AI SDK gives the TS clients.
        let tools = message.parts.compactMap(\.toolPart)
        #expect(tools.count == 4)
        #expect(tools.allSatisfy { $0.state == .outputAvailable })
        #expect(tools.map(\.toolName) == ["webSearch", "searchScripture", "searchScripture", "searchScripture"])

        // Retrieved-verses card, in part order, with the match-strength badge.
        #expect(view.retrievedVerses.map(\.reference) == [
            "James 1:22", "James 1:23", "James 1:25",
            "Luke 11:28", "Revelation 1:3", "Luke 8:15",
            "John 5:39", "Luke 24:27", "Luke 24:44",
        ])
        #expect(view.retrievedVerses.allSatisfy { $0.text?.isEmpty == false })
        let average = try #require(view.averageSimilarity)
        #expect(abs(average - 0.80640857) < 0.000001)
        #expect(view.matchStrength == .strong)

        // Tavily web-results card.
        #expect(view.tavilyResults.count == 5)
        #expect(view.tavilyResults.first?.url.hasPrefix("https://premierchristian.news/") == true)
        #expect(view.tavilyResults.allSatisfy { !$0.title.isEmpty && !$0.content.isEmpty })

        // Answer text, reassembled from 400-odd deltas.
        #expect(view.content.count == 2172)
        #expect(view.content.hasPrefix("Recent reporting on Bible-reading trends"))
        #expect(view.content.hasSuffix("submit themselves to Jesus Christ as Lord."))

        // Reasoning is kept as its own part and never leaks into the answer.
        #expect(message.parts.contains { if case .reasoning = $0 { return true } else { return false } })
        #expect(!view.content.contains("reasoningEncryptedContent"))

        #expect(view.followUps.isEmpty)
        #expect(view.activity == nil)
    }

    @Test("Follow-up chips and a getPassage card come off a real stream")
    func followUpAnswer() async throws {
        let message = try await Self.assemble("ask-question-followups.sse")
        let view = ChatViewMessage(message: message, isStreaming: false)

        #expect(view.id == "msg-PJTkJVDrrDRwajatjhHGz2m0")
        // `getPassage` reports similarity as the JSON integer 1 — it must decode
        // as a number, or every one of these verses is silently dropped.
        #expect(view.retrievedVerses.count == 4)
        #expect(view.retrievedVerses.map(\.reference)
            == ["Romans 8:28", "Romans 8:28", "Romans 8:29", "Romans 8:30"])
        #expect(view.retrievedVerses.allSatisfy { $0.similarity == 1 })
        // getPassage similarities are exact lookups, not search scores, so they
        // must not produce a match-strength badge.
        #expect(view.averageSimilarity == nil)
        #expect(view.matchStrength == nil)

        #expect(view.followUps == [
            "How can suffering help conform a Christian to the image of Christ?",
            "What is the difference between God causing evil and God working through evil for good?",
        ])
        // The `[FOLLOWUP]` block drives the chips and never renders as answer text.
        #expect(!view.content.contains("[FOLLOWUP]"))
        #expect(view.content.count == 1188)
        #expect(view.content.hasSuffix("He is accomplishing His good purpose in them."))
    }

    // MARK: Progressive rendering

    @Test("Text and tool activity appear progressively, not only at the end")
    func progressiveAssembly() async throws {
        var accumulator = UIMessageAccumulator(id: "assistant-local")
        var activityWhileSearching: String?
        var partialTextLengths: [Int] = []

        for try await chunk in UIMessageChunk.stream(
            fromBytes: try Self.stream("ask-question-scripture-and-web.sse")
        ) {
            accumulator.apply(chunk)
            let view = ChatViewMessage(message: accumulator.message, isStreaming: true)

            // The label the user sees while a tool is in flight.
            if case .toolInputAvailable(_, let toolName, _) = chunk, toolName == "searchScripture" {
                activityWhileSearching = view.activity
            }
            if case .textDelta = chunk, !view.content.isEmpty {
                partialTextLengths.append(view.content.count)
            }
        }

        #expect(activityWhileSearching == "Searching the Scriptures")
        // Many intermediate renders, each longer than the last — a progressively
        // written answer rather than one that lands whole at the end.
        #expect(partialTextLengths.count > 100)
        #expect(partialTextLengths.first! < 100)
        #expect(zip(partialTextLengths, partialTextLengths.dropFirst()).allSatisfy { $0 <= $1 })
        #expect(partialTextLengths.last == 2172)
    }
}
