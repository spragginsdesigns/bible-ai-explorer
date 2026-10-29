#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
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
    private static func model(noteID: String = "note-under-test") -> NoteAIModel {
        NoteAIModel(
            noteID: noteID,
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

        let model = Self.model(noteID: "cmsqd5yew0001l1044xappbwo")
        var changes: [NoteAIModel.ChangeEvent] = []
        model.onNoteChanged = { changes.append($0) }

        let (stream, continuation) = AsyncThrowingStream<UInt8, any Error>.makeStream()
        let consuming = Task { @MainActor in await model.consume(stream) }

        func feed(_ range: Range<Int>) {
            for event in events[range] {
                for byte in Array("\(event)\n\n".utf8) { continuation.yield(byte) }
            }
        }

        // 1 — through the addToNote tool output.
        feed(0..<(receiptEvent + 1))
        await Self.wait(for: { !changes.isEmpty }, "the addToNote receipt")
        let atReceipt = try #require(model.messages.last)
        #expect(model.isStreaming)
        #expect(atReceipt.role == .assistant)
        #expect(atReceipt.noteActions.count == 1)
        #expect(!atReceipt.retrievedVerses.isEmpty)
        // The editor is told to reload while the answer is still being written,
        // not after the stream closes.
        #expect(changes.count == 1)
        #expect(changes.first?.noteID == "cmsqd5yew0001l1044xappbwo")

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
        #expect(changes.count == 1)
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

    /// The live endpoint returns only ids and word counts for updateNote.
    /// In particular there is no appendedHtml for an append-only collector to
    /// recognize. Feed that protocol shape through the real byte consumer.
    @MainActor
    @Test("A rewrite of the open note notifies once before the answer finishes")
    func rewriteNotifiesDuringStream() async {
        let model = Self.model()
        var changes: [NoteAIModel.ChangeEvent] = []
        var atChange: [(streaming: Bool, text: String)] = []
        model.onNoteChanged = { [weak model] event in
            guard let model else { return }
            changes.append(event)
            atChange.append((model.isStreaming, model.messages.last?.content ?? ""))
        }
        let events = [
            #"{"type":"start","messageId":"rewrite-answer"}"#,
            #"{"type":"text-start","id":"text"}"#,
            #"{"type":"text-delta","id":"text","delta":"Reformatting."}"#,
            #"{"type":"tool-input-available","toolCallId":"other-note","toolName":"updateNote","input":{"markdown":"Other note"}}"#,
            #"{"type":"tool-output-available","toolCallId":"other-note","output":{"noteId":"another-note","noteTitle":"Other","previousWordCount":2,"wordCount":2}}"#,
            #"{"type":"tool-input-available","toolCallId":"rewrite-1","toolName":"updateNote","input":{"markdown":"Peace with God"}}"#,
            #"{"type":"tool-output-available","toolCallId":"rewrite-1","output":{"noteId":"note-under-test","noteTitle":"Study","previousWordCount":12,"wordCount":12}}"#,
            // A repeated result and subsequent chunks must not re-notify.
            #"{"type":"tool-output-available","toolCallId":"rewrite-1","output":{"noteId":"note-under-test","noteTitle":"Study","previousWordCount":12,"wordCount":12}}"#,
            #"{"type":"text-delta","id":"text","delta":" Finished."}"#,
            #"{"type":"text-end","id":"text"}"#,
            #"{"type":"finish"}"#,
        ]
        let wire = events.map { "data: \($0)\n\n" }.joined() + "data: [DONE]\n\n"
        await model.consume(ByteStream(bytes: Array(wire.utf8)))

        #expect(changes == [NoteAIModel.ChangeEvent(noteID: "note-under-test")])
        #expect(atChange.count == 1)
        #expect(atChange.first?.streaming == true)
        #expect(atChange.first?.text == "Reformatting.")
        #expect(model.messages.last?.content == "Reformatting. Finished.")
        #expect(model.error == nil)
        #expect(!model.isStreaming)
    }

    @MainActor
    @Test("Restoring a rewrite never notifies or replays its change")
    func restoredRewriteDoesNotNotify() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RestoredRewriteProtocol.self]
        let model = NoteAIModel(noteID: "note-under-test", api: APIClient(
            baseURL: URL(string: "https://restored-note-rewrite.invalid")!,
            token: { _ in nil },
            onAuthFailure: {},
            session: URLSession(configuration: configuration)
        ))
        var changes: [NoteAIModel.ChangeEvent] = []
        model.onNoteChanged = { changes.append($0) }
        await model.loadHistory()
        #expect(changes.isEmpty)
        #expect(model.messages.last?.content == "Reformatted the note.")

        let wire = """
            data: {"type":"start","messageId":"replayed-result"}

            data: {"type":"tool-input-available","toolCallId":"restored-rewrite","toolName":"updateNote","input":{"markdown":"Already saved"}}

            data: {"type":"tool-output-available","toolCallId":"restored-rewrite","output":{"noteId":"note-under-test","noteTitle":"Study","previousWordCount":2,"wordCount":2}}

            data: {"type":"finish"}

            data: [DONE]


            """
        await model.consume(ByteStream(bytes: Array(wire.utf8)))
        #expect(changes.isEmpty)
    }

    @MainActor
    @Test("A rewrite refreshes the editor baseline before the next manual save")
    func rewriteSurvivesTheNextManualEdit() async throws {
        RewriteEditorProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RewriteEditorProtocol.self]
        let api = APIClient(
            baseURL: URL(string: "https://note-rewrite-editor.invalid")!,
            token: { _ in nil }, onAuthFailure: {},
            session: URLSession(configuration: configuration)
        )
        let editor = NoteEditorModel(noteID: "note-under-test", api: NotesAPI(api: api), store: NotesStore(cacheURL: nil, allowsEphemeralLedger: true))
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let textView = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        #if os(macOS)
        textView.applyDefaults()
        let coordinator = NoteEditorTextView.Coordinator(controller: editor.controller)
        #else
        let coordinator = NoteEditorTextView<EmptyView>.Coordinator(controller: editor.controller)
        #endif
        textView.delegate = coordinator
        editor.controller.textView = textView
        defer { withExtendedLifetime((textView, storage, coordinator)) {} }
        editor.start()
        await Self.wait(for: { !editor.isLoading }, "the original note")
        #expect(editor.error == nil)
        #expect(editor.controller.html() == RewriteEditorProtocol.originalHTML)

        let ai = NoteAIModel(noteID: "note-under-test", api: api)
        var reload: Task<Void, Never>?
        ai.onNoteChanged = { _ in reload = Task { await editor.reloadAfterAIAppend() } }
        RewriteEditorProtocol.applyRewrite()
        let wire = """
            data: {"type":"start","messageId":"rewritten"}

            data: {"type":"tool-input-available","toolCallId":"editor-rewrite","toolName":"updateNote","input":{"markdown":"## Peace with God"}}

            data: {"type":"tool-output-available","toolCallId":"editor-rewrite","output":{"noteId":"note-under-test","noteTitle":"Study","previousWordCount":3,"wordCount":6}}

            data: {"type":"finish"}

            data: [DONE]


            """
        await ai.consume(ByteStream(bytes: Array(wire.utf8)))
        let reloading = try #require(reload, "A completed rewrite must tell the editor to reload")
        await reloading.value
        #expect(editor.controller.html() == RewriteEditorProtocol.rewrittenHTML)
        let untouched = await editor.flush()
        #expect(untouched)
        #expect(RewriteEditorProtocol.savedHTML == nil, "Loading a server write must not PATCH it back")

        #if os(macOS)
        textView.setSelectedRange(NSRange(location: storage.length, length: 0))
        #else
        textView.selectedRange = NSRange(location: storage.length, length: 0)
        #endif
        editor.controller.selectionDidChange()
        editor.controller.insertText(" Manual follow-up.")
        let saved = await editor.flush()
        #expect(saved)
        #expect(RewriteEditorProtocol.savedHTML == "<h2>Peace with God</h2><p>QA original marker: cedar-742. Manual follow-up.</p>")
    }
}

/// Synthetic persisted tool history only; this never contacts a real note.
private final class RestoredRewriteProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "restored-note-rewrite.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body = #"[{"id":"saved-answer","role":"assistant","content":"Reformatted the note.","metadata":{"parts":[{"type":"text","text":"Reformatted the note."},{"type":"tool-updateNote","toolCallId":"restored-rewrite","state":"output-available","input":{"markdown":"Already saved"},"output":{"noteId":"note-under-test","noteTitle":"Study","previousWordCount":2,"wordCount":2}}]}}]"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// Canonical GET/PATCH state for the rewrite-to-editor regression. A custom
/// URLProtocol keeps the entire persisted round trip away from real notes.
private final class RewriteEditorProtocol: URLProtocol, @unchecked Sendable {
    static let originalHTML = "<p>QA original marker: cedar-742.</p>"
    static let rewrittenHTML = "<h2>Peace with God</h2><p>QA original marker: cedar-742.</p>"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var html = originalHTML
    nonisolated(unsafe) private static var lastSavedHTML: String?
    static var savedHTML: String? { lock.withLock { lastSavedHTML } }
    static func reset() { lock.withLock { html = originalHTML; lastSavedHTML = nil } }
    static func applyRewrite() { lock.withLock { html = rewrittenHTML } }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "note-rewrite-editor.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body: Data
        if request.url?.path == "/api/tags" || request.url?.path == "/api/folders" {
            body = Data("[]".utf8)
        } else {
            if request.httpMethod == "PATCH", let data = Self.requestBody(request),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let html = json["htmlContent"] as? String {
                Self.lock.withLock { Self.html = html; Self.lastSavedHTML = html }
            }
            let html = Self.lock.withLock { Self.html }
            body = try! JSONSerialization.data(withJSONObject: [
                "id": "note-under-test", "title": "Study", "htmlContent": html,
                "plainText": "QA original marker: cedar-742.", "wordCount": 6,
                "isPinned": false, "createdAt": "2026-10-29T00:00:00Z", "updatedAt": "2026-10-29T00:00:01Z",
            ])
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    private static func requestBody(_ request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
    override func stopLoading() {}
}
