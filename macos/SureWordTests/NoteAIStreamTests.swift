import Foundation
import Testing
@testable import SureWord

/// Replays a **real** `POST /api/note-ai` response through the exact path
/// `NoteAIModel` uses, and asserts the panel state moves *while* the stream runs.
///
/// This pins the defect fixed on 2026-08-12: `NoteAIModel` fed
/// `URLSession.AsyncBytes.lines` into the SSE framer. Foundation's
/// `AsyncLineSequence` discards empty lines, and in SSE the empty line is the
/// event terminator, so no event was ever dispatched — every payload piled up
/// and was emitted at end-of-stream as one un-parseable blob. The panel showed
/// the user's question and then nothing at all: no text, no verse card, no
/// `addToNote` receipt, and no error either. Reopening the panel looked correct
/// only because the server had persisted the exchange all along.
///
/// `UIMessageStreamTests` could not catch it: it hands the decoder pre-split
/// lines that *do* include the blanks, which is the one step the bug lived in.
///
/// The fixture was captured from the live API on 2026-08-12 by recording the
/// response bytes of a real "Add Ephesians 2:8-9 to this note." request.
@Suite("Recorded note-ai stream")
struct NoteAIStreamTests {

    // MARK: Fixture plumbing

    /// Loaded relative to this source file, so the recording is unambiguously
    /// *the file in the repo* and needs no resource wiring in `project.yml` —
    /// same approach as `RecordedStreamTests`.
    private static func fixtureEvents() throws -> [String] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("note-ai-add-to-note.sse")
        let raw = String(decoding: try Data(contentsOf: url), as: UTF8.self)
        return raw.components(separatedBy: "\n\n").filter { !$0.isEmpty }
    }

    /// Stands in for `URLSession.AsyncBytes`: same element and failure types.
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

    @MainActor
    private static func model() -> NoteAIModel {
        NoteAIModel(
            noteID: "note-under-test",
            api: APIClient(
                baseURL: URL(string: "https://example.invalid")!,
                token: { _ in nil },
                onAuthFailure: {}
            )
        )
    }

    /// Wait for what has been fed so far to reach the model. The decoder is three
    /// chained tasks (byte splitter → payload framer → chunk decoder) running off
    /// this actor, so `Task.yield()` is not a barrier — poll instead.
    @MainActor
    private static func wait(
        for condition: @MainActor () -> Bool,
        _ what: String,
        sourceLocation: SourceLocation = #_sourceLocation
    ) async {
        for _ in 0..<600 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
    }

    // MARK: The regression

    /// The wiring, stated as an assertion: the same recording is worthless
    /// through `bytes.lines` and complete through the byte entry point.
    @Test("The recording decodes to nothing through bytes.lines")
    func recordingCollapsesUnderFoundationLines() async throws {
        let bytes = Array(try Self.fixtureEvents().joined(separator: "\n\n").utf8)

        var throughLines = 0
        for try await _ in UIMessageChunk.stream(from: ByteStream(bytes: bytes).lines) {
            throughLines += 1
        }
        #expect(throughLines == 0)

        var throughBytes = 0
        for try await _ in UIMessageChunk.stream(fromBytes: ByteStream(bytes: bytes)) {
            throughBytes += 1
        }
        #expect(throughBytes > 200)
    }

    /// Feeds the recording in three stages and looks at the panel between them.
    /// The two mid-stream snapshots are the whole point: before the fix they were
    /// both empty, and everything only appeared on a reload.
    @MainActor
    @Test("Text, the verse card and the addToNote receipt all land mid-stream")
    func panelUpdatesDuringTheStream() async throws {
        let events = try Self.fixtureEvents()

        // Split at the two moments that matter, located by content rather than by
        // index so re-recording the fixture does not silently move them.
        let receiptEvent = try #require(
            events.firstIndex { $0.contains("tool-output-available") && $0.contains("appendedHtml") }
        )
        let midTextEvent = try #require(
            events.indices.last { $0 > receiptEvent && events[$0].contains("text-delta") }
        ) - 8

        let model = Self.model()
        var appends: [NoteAIModel.AppendEvent] = []
        model.onNoteAppended = { appends.append($0) }

        let (stream, continuation) = AsyncThrowingStream<UInt8, any Error>.makeStream()
        let consuming = Task { @MainActor in await model.consume(stream) }

        func feed(_ range: Range<Int>) {
            for event in events[range] {
                for byte in Array("\(event)\n\n".utf8) { continuation.yield(byte) }
            }
        }

        // 1 — through the addToNote tool output.
        feed(0..<(receiptEvent + 1))
        await Self.wait(for: { !appends.isEmpty }, "the addToNote receipt")
        let atReceipt = try #require(model.messages.last)
        #expect(model.isStreaming)
        #expect(atReceipt.role == .assistant)
        #expect(atReceipt.noteActions.count == 1)
        #expect(!atReceipt.retrievedVerses.isEmpty)
        // The editor is told to reload while the answer is still being written,
        // not after the stream closes.
        #expect(appends.count == 1)
        #expect(appends.first?.noteID == "cmsqd5yew0001l1044xappbwo")
        #expect(appends.first?.appendedHTML.contains("Ephesians 2:8 KJV") == true)

        // 2 — partway through the answer text.
        feed((receiptEvent + 1)..<midTextEvent)
        await Self.wait(
            for: { model.messages.last?.content.isEmpty == false },
            "the first of the answer text"
        )
        let midText = try #require(model.messages.last)

        // 3 — the rest.
        feed(midTextEvent..<events.count)
        continuation.finish()
        await consuming.value

        let final = try #require(model.messages.last)
        // Strictly more text arrived after each snapshot: the panel was painting
        // as the answer came in, which is exactly what the bug prevented.
        #expect(atReceipt.content.count < midText.content.count)
        #expect(midText.content.count < final.content.count)
        #expect(final.content.contains("Ephesians"))
        #expect(!final.isStreaming)
        #expect(model.error == nil)
        // Still exactly one append: the receipt must not re-fire at end of stream.
        #expect(appends.count == 1)
    }

    /// The silent dead end the framing bug produced had no error card to retry
    /// from. A body that yields no chunk now says so.
    @MainActor
    @Test("A stream that yields no chunk surfaces an error")
    func emptyStreamIsAnError() async throws {
        let model = Self.model()
        await model.consume(ByteStream(bytes: []))
        #expect(model.error == NoteAIModel.emptyStreamError)
        #expect(!model.isStreaming)
    }
}
