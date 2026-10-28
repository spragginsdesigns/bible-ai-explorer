import Foundation
import UIKit
import XCTest
@testable import SureWord

@MainActor
final class NoteSaveDepartureTests: XCTestCase {
    private func editor(host: String) -> (NoteEditorModel, NoteTextView) {
        NoteSaveProtocol.reset(for: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NoteSaveProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://\(host)")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: configuration))
        let model = NoteEditorModel(noteID: "n1", api: NotesAPI(api: client), store: NotesStore(cacheURL: nil))
        // Match NoteEditorTextView's TextKit 1 stack. The controller holds
        // the view weakly; without it, load only queues HTML and flush no-ops.
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        model.controller.textView = textView
        model.controller.load(html: "<p>unsaved</p>")
        textView.selectedRange = NSRange(location: 7, length: 0)
        model.controller.selectionDidChange()
        model.controller.insertText(" words")
        XCTAssertTrue(model.controller.hasLoadedDocument)
        XCTAssertEqual(model.controller.html(), "<p>unsaved words</p>")
        return (model, textView)
    }

    private func fetchedEditor(html: String, holdFetch: Bool = false, cached: Note? = nil) -> (NoteEditorModel, NoteTextView) {
        UntouchedNoteProtocol.reset(html: html, holdFetch: holdFetch)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UntouchedNoteProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://untouched-note-save.invalid")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: configuration))
        let store = NotesStore(cacheURL: nil)
        if let cached { store.upsert(cached) }
        let model = NoteEditorModel(noteID: "n1", api: NotesAPI(api: client), store: store)
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        model.controller.textView = textView
        return (model, textView)
    }

    func testUntouchedFetchedHTMLDoesNotPatchButAnActualEditDoes() async {
        let (model, textView) = fetchedEditor(html: UntouchedNoteProtocol.seedHTML)
        defer { withExtendedLifetime(textView) {} }

        model.start()
        for _ in 0..<250 {
            if !model.isLoading { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.error)
        XCTAssertEqual(model.note?.htmlContent, UntouchedNoteProtocol.seedHTML)
        XCTAssertTrue(model.controller.hasLoadedDocument)
        // Markdown-produced HTML commonly has whitespace between blocks;
        // the native serializer canonicalizes it without a user edit.
        XCTAssertNotEqual(model.controller.html(), UntouchedNoteProtocol.seedHTML)
        let untouched = await model.flush()
        XCTAssertTrue(untouched)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 0, "Viewing an untouched note must not write normalized HTML")

        textView.selectedRange = NSRange(location: textView.textStorage.length, length: 0)
        model.controller.selectionDidChange()
        model.controller.insertText(" Edited.")
        XCTAssertTrue(model.controller.html().contains("Edited."))
        let edited = await model.flush()
        XCTAssertTrue(edited)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 1, "A real edit must still write once")
        let alreadySaved = await model.flush()
        XCTAssertTrue(alreadySaved)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 1, "A successful save must advance the editor baseline")
    }

    func testUntouchedEmptyFetchedDocumentDoesNotPatch() async {
        let (model, textView) = fetchedEditor(html: "<p><br></p>")
        defer { withExtendedLifetime(textView) {} }
        model.start()
        for _ in 0..<250 {
            if !model.isLoading { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.error)
        XCTAssertEqual(model.note?.htmlContent, "<p><br></p>")
        XCTAssertTrue(model.controller.hasLoadedDocument)
        XCTAssertEqual(model.controller.html(), "")
        let unchanged = await model.flush()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 0, "An empty loaded document must not create a write")
    }

    func testAIAppendReloadAdvancesBaselineWithoutAnUntouchedPatch() async {
        let (model, textView) = fetchedEditor(html: UntouchedNoteProtocol.seedHTML)
        defer { withExtendedLifetime(textView) {} }
        model.start()
        for _ in 0..<250 {
            if !model.isLoading { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.error)
        XCTAssertTrue(model.controller.hasLoadedDocument)
        let appendedHTML = "<h2>Study</h2>\n<p>Grace &amp; peace.</p>\n<p>AI addition.</p>\n"
        UntouchedNoteProtocol.replaceFetchedHTML(appendedHTML)
        await model.reloadAfterAIAppend()
        XCTAssertEqual(model.note?.htmlContent, appendedHTML)
        XCTAssertEqual(model.controller.html(), "<h2>Study</h2><p>Grace &amp; peace.</p><p>AI addition.</p>")
        let unchanged = await model.flush()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 0, "Reloading an AI append must advance both baselines without another write")
    }

    func testEditToCachedDocumentSurvivesDelayedFetchAndFlushesOnce() async {
        let remoteHTML = "<p>Updated elsewhere</p>"
        let cached = Note(id: "n1", htmlContent: "<p>Cached words</p>", title: "Synthetic cached", plainText: "Cached words", hasBody: true)
        let (model, textView) = fetchedEditor(html: remoteHTML, holdFetch: true, cached: cached)
        defer {
            UntouchedNoteProtocol.releaseFetch()
            withExtendedLifetime(textView) {}
        }
        model.start()
        for _ in 0..<250 {
            if UntouchedNoteProtocol.hasPendingFetch { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(UntouchedNoteProtocol.hasPendingFetch, "The GET must still be pending when the cached document is edited")
        XCTAssertEqual(model.controller.html(), "<p>Cached words</p>")
        textView.selectedRange = NSRange(location: textView.textStorage.length, length: 0)
        model.controller.selectionDidChange()
        model.controller.insertText(" Edited.")
        let editedHTML = model.controller.html()
        XCTAssertEqual(editedHTML, "<p>Cached words Edited.</p>")

        UntouchedNoteProtocol.releaseFetch()
        for _ in 0..<250 {
            if model.note?.htmlContent == remoteHTML { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(model.note?.htmlContent, remoteHTML, "The delayed GET must actually finish before checking the editor")
        XCTAssertNil(model.error)
        XCTAssertEqual(model.controller.html(), editedHTML, "Revalidation must not replace an edit made to the visible cached document")
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 0)
        let saved = await model.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(UntouchedNoteProtocol.patchCount, 1)
        XCTAssertEqual(model.controller.html(), editedHTML)
    }

    func testFailedFlushRetainsTheBufferAndCanRetryWithoutAnotherEdit() async {
        let (model, textView) = editor(host: "retry-note-save.invalid")
        defer { withExtendedLifetime(textView) {} }
        let before = model.controller.html()
        let failed = await model.flush()
        XCTAssertFalse(failed)
        XCTAssertNotNil(model.error)
        XCTAssertEqual(model.controller.html(), before)
        let retried = await model.flush()
        XCTAssertTrue(retried)
        XCTAssertNil(model.error)
        XCTAssertEqual(model.note?.plainText, "unsaved words")
        XCTAssertEqual(NoteSaveProtocol.count(for: "retry-note-save.invalid"), 2)
    }

    func testConcurrentFlushesShareOneWrite() async {
        let (model, textView) = editor(host: "concurrent-note-save.invalid")
        defer { withExtendedLifetime(textView) {} }
        async let first = model.flush()
        async let second = model.flush()
        let results = await (first, second)
        XCTAssertTrue(results.0)
        XCTAssertTrue(results.1)
        XCTAssertEqual(NoteSaveProtocol.count(for: "concurrent-note-save.invalid"), 1)
    }

    func testOnlyTheCurrentEditorMayUnregisterItsGuard() async {
        let coordinator = NoteDepartureCoordinator()
        let old = UUID(), current = UUID()
        coordinator.register(owner: old) { true }
        coordinator.register(owner: current) { false }
        coordinator.unregister(owner: old)
        XCTAssertTrue(coordinator.hasEditor)
        let blocked = await coordinator.canLeave()
        XCTAssertFalse(blocked)
        coordinator.unregister(owner: current)
        XCTAssertFalse(coordinator.hasEditor)
        let allowed = await coordinator.canLeave()
        XCTAssertTrue(allowed)
    }

    func testRejectedDepartureKeepsItsGuardForTheNextAttempt() async {
        let coordinator = NoteDepartureCoordinator()
        var calls = 0
        coordinator.register(owner: UUID()) {
            calls += 1
            return calls > 1
        }
        let blocked = await coordinator.canLeave()
        XCTAssertFalse(blocked)
        XCTAssertTrue(coordinator.hasEditor)
        let retried = await coordinator.canLeave()
        XCTAssertTrue(retried)
        XCTAssertEqual(calls, 2)
    }

    private func titleEditor(cached: Note? = nil, attachBody: Bool = true) -> (NoteEditorModel, NoteTextView?, NotesStore) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TitleNoteProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://title-note-save.invalid")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: configuration))
        let store = NotesStore(cacheURL: nil)
        if let cached { store.upsert(cached) }
        let model = NoteEditorModel(noteID: "n1", api: NotesAPI(api: client), store: store)
        guard attachBody else { return (model, nil, store) }
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let view = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        model.controller.textView = view
        return (model, view, store)
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<250 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(condition(), "The controlled request did not reach its expected state", file: file, line: line)
    }

    private func appendMarker(_ model: NoteEditorModel, _ view: NoteTextView) {
        view.selectedRange = NSRange(location: view.textStorage.length, length: 0)
        model.controller.selectionDidChange()
        model.controller.insertText(" marker")
        XCTAssertEqual(model.controller.html(), "<p>Body marker</p>")
    }

    func testDepartureSavesPendingTitleAndNativeBodyWithoutSubmitOrBlur() async throws {
        TitleNoteProtocol.reset()
        let (model, view, _) = titleEditor()
        defer { withExtendedLifetime(view) {} }
        model.start()
        await waitUntil { !model.isLoading }
        XCTAssertEqual(model.draftTitle, "Original")
        model.setDraftTitle("  Renamed title  ")
        appendMarker(model, try XCTUnwrap(view))
        let departure = NoteDepartureCoordinator()
        departure.register(owner: UUID()) { await model.flush() }
        let allowed = await departure.canLeave()
        XCTAssertTrue(allowed)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 1)
        XCTAssertEqual(TitleNoteProtocol.patches.first?.title, "Renamed title")
        XCTAssertEqual(TitleNoteProtocol.patches.first?.htmlContent, "<p>Body marker</p>")

        // Reopen through a new GET and a new store, rather than trusting the
        // first editor's optimistic state or a hard-coded PATCH response.
        let (reopened, reopenedView, _) = titleEditor()
        defer { withExtendedLifetime(reopenedView) {} }
        reopened.start()
        await waitUntil { !reopened.isLoading }
        XCTAssertEqual(reopened.draftTitle, "Renamed title")
        XCTAssertEqual(reopened.controller.html(), "<p>Body marker</p>")
        let unchanged = await reopened.flush()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 1)
    }

    func testTitleOnlySaveBeforeBodyAttachmentNeverSendsAnEmptyBody() async {
        TitleNoteProtocol.reset()
        let (model, _, _) = titleEditor(attachBody: false)
        model.start()
        await waitUntil { !model.isLoading }
        XCTAssertFalse(model.controller.hasLoadedDocument)
        let untouched = await model.flush()
        XCTAssertTrue(untouched)
        XCTAssertTrue(TitleNoteProtocol.patches.isEmpty)
        model.setDraftTitle("  Renamed  ")
        let renamed = await model.flush()
        XCTAssertTrue(renamed)
        XCTAssertEqual(TitleNoteProtocol.patches.first?.title, "Renamed")
        XCTAssertNil(TitleNoteProtocol.patches.first?.content)
        XCTAssertNil(TitleNoteProtocol.patches.first?.htmlContent)
        XCTAssertNil(TitleNoteProtocol.patches.first?.plainText)
        XCTAssertNil(TitleNoteProtocol.patches.first?.wordCount)
        XCTAssertEqual(TitleNoteProtocol.row.htmlContent, "<p>Body</p>")
        model.setDraftTitle(" \n ")
        let emptied = await model.flush()
        XCTAssertTrue(emptied)
        XCTAssertEqual(TitleNoteProtocol.row.title, "Untitled Note")
        model.setDraftTitle(" Untitled Note ")
        let normalized = await model.flush()
        XCTAssertTrue(normalized)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 2)
    }

    func testConcurrentFlushesDrainARevertedTitleAndNewBodyAfterHeldWrite() async throws {
        TitleNoteProtocol.reset(holdPatch: true)
        let (model, view, _) = titleEditor()
        defer {
            TitleNoteProtocol.releasePatch()
            withExtendedLifetime(view) {}
        }
        model.start()
        await waitUntil { !model.isLoading }
        model.setDraftTitle("Temporary")
        var firstFinished = false
        let first = Task { let result = await model.flush(); firstFinished = true; return result }
        await waitUntil { TitleNoteProtocol.hasPendingPatch }
        // Reverting to the old baseline is still an edit while Temporary is
        // in flight: its response must not replace this newer raw draft.
        model.setDraftTitle("Original")
        appendMarker(model, try XCTUnwrap(view))
        var secondFinished = false
        let second = Task { let result = await model.flush(); secondFinished = true; return result }
        await Task.yield()
        XCTAssertFalse(firstFinished)
        XCTAssertFalse(secondFinished)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 1)
        TitleNoteProtocol.releasePatch()
        let firstResult = await first.value
        let secondResult = await second.value
        XCTAssertTrue(firstResult)
        XCTAssertTrue(secondResult)
        XCTAssertEqual(TitleNoteProtocol.maxConcurrentPatches, 1)
        XCTAssertEqual(TitleNoteProtocol.patches.map(\.title), ["Temporary", "Original"])
        XCTAssertEqual(TitleNoteProtocol.row.title, "Original")
        XCTAssertEqual(TitleNoteProtocol.row.htmlContent, "<p>Body marker</p>")
        XCTAssertEqual(model.draftTitle, "Original")
        XCTAssertEqual(model.controller.html(), "<p>Body marker</p>")
    }

    func testRejectedTitleAndBodyDepartureRetainsBothDraftsAndRetries() async throws {
        TitleNoteProtocol.reset(rejectPatch: true)
        let (model, view, _) = titleEditor()
        defer { withExtendedLifetime(view) {} }
        model.start()
        await waitUntil { !model.isLoading }
        model.setDraftTitle("Keep this title")
        appendMarker(model, try XCTUnwrap(view))
        let departure = NoteDepartureCoordinator()
        departure.register(owner: UUID()) { await model.flush() }
        let failed = await departure.canLeave()
        XCTAssertFalse(failed)
        XCTAssertNotNil(model.error)
        XCTAssertEqual(model.draftTitle, "Keep this title")
        XCTAssertEqual(model.controller.html(), "<p>Body marker</p>")
        XCTAssertEqual(TitleNoteProtocol.row.title, "Original")
        XCTAssertEqual(TitleNoteProtocol.row.htmlContent, "<p>Body</p>")
        let retried = await departure.canLeave()
        XCTAssertTrue(retried)
        XCTAssertNil(model.error)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 2)
        XCTAssertEqual(TitleNoteProtocol.row.title, "Keep this title")
        XCTAssertEqual(TitleNoteProtocol.row.htmlContent, "<p>Body marker</p>")
    }

    func testOldGetCannotReplaceAnAcceptedTitleInEditorOrCache() async {
        TitleNoteProtocol.reset(holdFetch: true)
        let cached = Note(id: "n1", htmlContent: "<p>Body</p>", title: "Original", plainText: "Body", hasBody: true)
        let (model, view, store) = titleEditor(cached: cached)
        defer {
            TitleNoteProtocol.releaseFetch()
            withExtendedLifetime(view) {}
        }
        model.start()
        await waitUntil { TitleNoteProtocol.hasPendingFetch }
        model.setDraftTitle("Accepted title")
        let saved = await model.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(TitleNoteProtocol.row.title, "Accepted title")
        TitleNoteProtocol.releaseFetch()
        // Tags start only after the load task has consumed the released GET.
        await waitUntil { TitleNoteProtocol.tagFetches > 0 }
        XCTAssertEqual(model.draftTitle, "Accepted title")
        XCTAssertEqual(model.note?.title, "Accepted title")
        XCTAssertEqual(store.cachedNote(id: "n1")?.title, "Accepted title")
        let unchanged = await model.flush()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 1)
    }

    func testTitleAcceptedBeforeInitialGetStillSeedsTheRealBody() async {
        TitleNoteProtocol.reset(holdFetch: true)
        let (model, view, store) = titleEditor()
        defer {
            TitleNoteProtocol.releaseFetch()
            withExtendedLifetime(view) {}
        }
        model.start()
        await waitUntil { TitleNoteProtocol.hasPendingFetch }
        XCTAssertTrue(model.isLoading)
        model.setDraftTitle("Early title")
        let saved = await model.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(model.controller.html(), "<p>Body</p>", "A title-only full response must initialize the body if its GET is still pending")
        XCTAssertNil(TitleNoteProtocol.patches.first?.htmlContent)
        TitleNoteProtocol.releaseFetch()
        await waitUntil { TitleNoteProtocol.tagFetches > 0 }
        XCTAssertEqual(model.draftTitle, "Early title")
        XCTAssertEqual(store.cachedNote(id: "n1")?.title, "Early title")
        XCTAssertEqual(model.controller.html(), "<p>Body</p>")
        let unchanged = await model.flush()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(TitleNoteProtocol.patches.count, 1)
    }

    func testCleanRemoteTitleRefreshesWithSameBodyAndBodyOnlySaveOmitsTitle() async throws {
        TitleNoteProtocol.reset()
        let (model, view, store) = titleEditor()
        defer { withExtendedLifetime(view) {} }
        model.start()
        await waitUntil { !model.isLoading }
        TitleNoteProtocol.replaceTitle("Remote title")
        await model.reloadAfterAIAppend()
        XCTAssertEqual(model.draftTitle, "Remote title")
        XCTAssertEqual(store.cachedNote(id: "n1")?.title, "Remote title")
        let unchanged = await model.flush()
        XCTAssertTrue(unchanged)
        XCTAssertTrue(TitleNoteProtocol.patches.isEmpty)
        appendMarker(model, try XCTUnwrap(view))
        let saved = await model.flush()
        XCTAssertTrue(saved)
        XCTAssertNil(TitleNoteProtocol.patches.first?.title)
        XCTAssertEqual(model.draftTitle, "Remote title")
        XCTAssertEqual(TitleNoteProtocol.row.title, "Remote title")
    }
}

/// A tiny mutable server, so reopen assertions prove the exact PATCH keys
/// were accepted. Requests can be held deterministically, without sleeps in
/// URLProtocol or requests to any production/private note endpoint.
private final class TitleNoteProtocol: URLProtocol, @unchecked Sendable {
    struct Row: Codable, Sendable {
        var id = "n1"
        var title = "Original"
        var content = "<p>Body</p>"
        var htmlContent = "<p>Body</p>"
        var plainText = "Body"
        var isPinned = false
        var wordCount = 1
        var createdAt = "2026-10-28T00:00:00Z"
        var updatedAt = "2026-10-28T00:00:00Z"
    }
    struct Patch: Decodable, Sendable {
        let title: String?
        let content: String?
        let htmlContent: String?
        let plainText: String?
        let wordCount: Int?
    }
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var row = Row()
        var patches: [Patch] = []
        var holdPatch = false
        var rejectPatch = false
        var holdFetch = false
        var pendingPatch: (TitleNoteProtocol, Patch)?
        var pendingFetch: (TitleNoteProtocol, Row)?
        var activePatches = 0
        var maxConcurrentPatches = 0
        var tagFetches = 0
    }
    private static let state = State()
    static var row: Row { state.lock.withLock { state.row } }
    static var patches: [Patch] { state.lock.withLock { state.patches } }
    static var maxConcurrentPatches: Int { state.lock.withLock { state.maxConcurrentPatches } }
    static var tagFetches: Int { state.lock.withLock { state.tagFetches } }
    static var hasPendingPatch: Bool { state.lock.withLock { state.pendingPatch != nil } }
    static var hasPendingFetch: Bool { state.lock.withLock { state.pendingFetch != nil } }
    static func replaceTitle(_ title: String) { state.lock.withLock { state.row.title = title } }
    static func reset(holdPatch: Bool = false, rejectPatch: Bool = false, holdFetch: Bool = false) {
        state.lock.withLock {
            state.row = Row()
            state.patches = []
            state.holdPatch = holdPatch
            state.rejectPatch = rejectPatch
            state.holdFetch = holdFetch
            state.pendingPatch = nil
            state.pendingFetch = nil
            state.activePatches = 0
            state.maxConcurrentPatches = 0
            state.tagFetches = 0
        }
    }
    static func releasePatch() {
        let pending = state.lock.withLock {
            let pending = state.pendingPatch
            state.pendingPatch = nil
            return pending
        }
        if let (request, patch) = pending { request.finishPatch(patch) }
    }
    static func releaseFetch() {
        let pending = state.lock.withLock {
            let pending = state.pendingFetch
            state.pendingFetch = nil
            return pending
        }
        if let (request, row) = pending { request.respond(try! JSONEncoder().encode(row)) }
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "title-note-save.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.path == "/api/tags" || request.url?.path == "/api/folders" {
            if request.url?.path == "/api/tags" { Self.state.lock.withLock { Self.state.tagFetches += 1 } }
            respond(Data("[]".utf8))
        } else if request.httpMethod == "PATCH" {
            let patch = try! JSONDecoder().decode(Patch.self, from: requestBody())
            let held = Self.state.lock.withLock {
                Self.state.patches.append(patch)
                Self.state.activePatches += 1
                Self.state.maxConcurrentPatches = max(Self.state.maxConcurrentPatches, Self.state.activePatches)
                guard Self.state.holdPatch else { return false }
                Self.state.holdPatch = false
                Self.state.pendingPatch = (self, patch)
                return true
            }
            if !held { finishPatch(patch) }
        } else {
            let snapshot = Self.state.lock.withLock { Self.state.row }
            let held = Self.state.lock.withLock {
                guard Self.state.holdFetch else { return false }
                Self.state.holdFetch = false
                Self.state.pendingFetch = (self, snapshot)
                return true
            }
            if !held { respond(try! JSONEncoder().encode(snapshot)) }
        }
    }
    private func requestBody() -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
    private func finishPatch(_ patch: Patch) {
        let result = Self.state.lock.withLock {
            Self.state.activePatches -= 1
            if Self.state.rejectPatch {
                Self.state.rejectPatch = false
                return (Self.state.row, false)
            }
            if let title = patch.title { Self.state.row.title = title }
            if let content = patch.content { Self.state.row.content = content }
            if let html = patch.htmlContent { Self.state.row.htmlContent = html }
            if let plain = patch.plainText { Self.state.row.plainText = plain }
            if let count = patch.wordCount { Self.state.row.wordCount = count }
            return (Self.state.row, true)
        }
        respond(result.1 ? try! JSONEncoder().encode(result.0) : Data(#"{"error":"Changes could not be saved."}"#.utf8), status: result.1 ? 200 : 503)
    }
    private func respond(_ data: Data, status: Int = 200) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class NoteSaveProtocol: URLProtocol, @unchecked Sendable {
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var counts: [String: Int] = [:]
    }
    private static let state = State()

    static func reset(for host: String) { state.lock.withLock { state.counts[host] = 0 } }
    static func count(for host: String) -> Int { state.lock.withLock { state.counts[host] ?? 0 } }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasSuffix("note-save.invalid") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let host = request.url!.host!
        let count = Self.state.lock.withLock {
            Self.state.counts[host, default: 0] += 1
            return Self.state.counts[host]!
        }
        let rejected = host == "retry-note-save.invalid" && count == 1
        let response = HTTPURLResponse(url: request.url!, statusCode: rejected ? 503 : 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        let body = rejected ? #"{"error":"Changes could not be saved."}"#
            : #"{"id":"n1","title":"Note","htmlContent":"<p>unsaved words</p>","plainText":"unsaved words","isPinned":false,"wordCount":2,"createdAt":"2026-10-28T00:00:00Z","updatedAt":"2026-10-28T00:00:00Z"}"#
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A synthetic fetched note, isolated from the retry/departure mocks above.
private final class UntouchedNoteProtocol: URLProtocol, @unchecked Sendable {
    static let seedHTML = "<h2>Study</h2>\n<p>Grace &amp; peace.</p>\n"
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var patches = 0
        var html = ""
        var holdFetch = false
        var pendingFetch: UntouchedNoteProtocol?
    }
    private static let state = State()
    static var patchCount: Int { state.lock.withLock { state.patches } }
    static var hasPendingFetch: Bool { state.lock.withLock { state.pendingFetch != nil } }
    static func replaceFetchedHTML(_ html: String) { state.lock.withLock { state.html = html } }
    static func reset(html: String, holdFetch: Bool) {
        state.lock.withLock {
            state.patches = 0
            state.html = html
            state.holdFetch = holdFetch
            state.pendingFetch = nil
        }
    }
    static func releaseFetch() {
        let pending = state.lock.withLock {
            let pending = state.pendingFetch
            state.pendingFetch = nil
            state.holdFetch = false
            return pending
        }
        pending?.respond()
    }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "untouched-note-save.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.httpMethod == "GET", request.url?.path == "/api/notes/n1" {
            let held = Self.state.lock.withLock {
                guard Self.state.holdFetch else { return false }
                Self.state.pendingFetch = self
                return true
            }
            if held { return }
        }
        respond()
    }
    private func respond() {
        let patched = request.httpMethod == "PATCH"
        if patched { Self.state.lock.withLock { Self.state.patches += 1 } }
        let body: Data
        if request.url?.path == "/api/tags" || request.url?.path == "/api/folders" {
            body = Data("[]".utf8)
        } else {
            let html = patched ? "<h2>Study</h2><p>Grace &amp; peace. Edited.</p>" : Self.state.lock.withLock { Self.state.html }
            let row: [String: Any] = [
                "id": "n1", "title": "Synthetic study", "htmlContent": html,
                "plainText": patched ? "Study Grace & peace. Edited." : "Study Grace & peace.",
                "isPinned": false, "wordCount": patched ? 5 : 4,
                "createdAt": "2026-10-28T00:00:00Z", "updatedAt": "2026-10-28T00:00:00Z",
            ]
            body = try! JSONSerialization.data(withJSONObject: row)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
