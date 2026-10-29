import Foundation
import SwiftUI
import Testing
#if os(macOS)
import AppKit
#else
import UIKit
#endif
@testable import SureWord

/// Held responses exercise ordering through the real models and native text
/// storage. Every URL is synthetic; no test opens a real account or note.
@Suite("Note AI integrity", .serialized)
@MainActor
struct NoteAIIntegrityTests {
    private struct Editor {
        let host: String
        let api: APIClient
        let store: NotesStore
        let model: NoteEditorModel
        let view: NoteTextView
        let storage: NSTextStorage
        let coordinator: AnyObject
    }

    private func editor(store supplied: NotesStore? = nil, holdInitial: Bool = false) -> Editor {
        let host = "note-integrity-\(UUID().uuidString.lowercased()).invalid"
        IntegrityServer.configure(host, holdInitial: holdInitial)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [IntegrityServer.self]
        let api = APIClient(baseURL: URL(string: "https://\(host)")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: config))
        let store = supplied ?? NotesStore(cacheURL: nil, allowsEphemeralLedger: true)
        if store.accountID == nil { store.bindAccount("synthetic-owner") }
        let model = NoteEditorModel(noteID: "n1", api: NotesAPI(api: api), store: store)
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let view = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        #if os(macOS)
        view.applyDefaults()
        let coordinator = NoteEditorTextView.Coordinator(controller: model.controller)
        #else
        let coordinator = NoteEditorTextView<EmptyView>.Coordinator(controller: model.controller)
        #endif
        view.delegate = coordinator
        model.controller.textView = view
        return Editor(host: host, api: api, store: store, model: model, view: view, storage: storage, coordinator: coordinator)
    }

    private func wait(_ condition: @MainActor () -> Bool, _ message: String, sourceLocation: SourceLocation = #_sourceLocation) async {
        let deadline = ContinuousClock.now + .seconds(4)
        while !condition(), ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(5)) }
        if !condition() { Issue.record("Timed out waiting for \(message)", sourceLocation: sourceLocation) }
    }

    private func attempt(_ id: String = "attempt") -> NotesStore.AIAttempt {
        NotesStore.AIAttempt(id: id, userMessageID: "question-\(id)")
    }

    private func insert(_ text: String, into e: Editor) {
        #if os(macOS)
        e.view.setSelectedRange(NSRange(location: e.storage.length, length: 0))
        #else
        e.view.selectedRange = NSRange(location: e.storage.length, length: 0)
        #endif
        e.model.controller.selectionDidChange()
        e.model.controller.insertText(text)
    }

    #if os(macOS)
    @Test("A disabled native surface stays read-only across model unlocks and canonical loads")
    func disabledSurfaceSurvivesModelUnlock() async {
        let e = editor()
        await e.model.start().value
        let controller = e.model.controller
        #expect(e.model.allowsUserEditing && e.view.isEditable)

        controller.isEditingSurfaceEnabled = false
        controller.allowsUserEditing = false
        controller.allowsUserEditing = true
        #expect(e.model.allowsUserEditing, "Presentation must not change AI readiness")
        #expect(!e.view.isEditable, "A model unlock cannot override the disabled SwiftUI surface")

        controller.textView = nil
        controller.textView = e.view
        #expect(!e.view.isEditable, "Attaching a view must honor both permission gates")
        controller.load(html: "<p>canonical while hidden</p>")
        #expect(controller.html() == "<p>canonical while hidden</p>")
        #expect(!e.view.isEditable, "Canonical replacement must preserve the surface lock")
        e.view.setSelectedRange(NSRange(location: e.storage.length, length: 0))
        e.view.insertText(" forbidden", replacementRange: e.view.selectedRange())
        #expect(controller.html() == "<p>canonical while hidden</p>", "Native user input must be rejected")

        controller.allowsUserEditing = false
        controller.isEditingSurfaceEnabled = true
        #expect(!e.view.isEditable, "Enabling the surface cannot override a model lock")
        controller.allowsUserEditing = true
        #expect(e.view.isEditable)
        e.view.setSelectedRange(NSRange(location: e.storage.length, length: 0))
        e.view.insertText(" allowed", replacementRange: e.view.selectedRange())
        #expect(controller.html() == "<p>canonical while hidden allowed</p>")
    }
    #endif

    @Test("A failed canonical GET blocks edits, PATCH and departure until a successful check")
    func failedRefreshBlocksStaleSave() async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.holdNextGET(e.host, html: "<p>rewritten</p>", status: 503)
        e.model.noteDidChangeFromAI()
        #expect(!e.view.isEditable, "Receipt marks the native lock synchronously")
        await IntegrityServer.waitForHeld(e.host)
        IntegrityServer.release(e.host)
        await wait({ e.model.integrity == .failed }, "the canonical read should fail visibly")
        insert(" stale edit", into: e)
        e.model.setDraftTitle("stale title")
        #expect(e.model.controller.html() == "<p>original</p>")
        #expect(e.model.draftTitle == "Study")
        let leave = NoteDepartureCoordinator()
        leave.register(owner: UUID()) { await e.model.flush() }
        let allowed = await leave.canLeave()
        #expect(!allowed)
        #expect(IntegrityServer.patches(e.host).isEmpty)
        IntegrityServer.setHTML(e.host, "<p>rewritten</p>")
        let checked = await e.model.retryCanonicalCheck()
        #expect(checked && e.view.isEditable)
        #expect(e.model.controller.html() == "<p>rewritten</p>")
        #expect(IntegrityServer.patches(e.host).isEmpty)
    }

    @Test("A newer receipt discards a held old GET and serializes the next canonical read")
    func overlappingReceiptsCannotRollBack() async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.holdNextGET(e.host, html: "<p>revision one</p>")
        e.model.noteDidChangeFromAI()
        await IntegrityServer.waitForHeld(e.host)
        e.model.noteDidChangeFromAI()
        IntegrityServer.holdNextGET(e.host, html: "<p>revision two</p>")
        #expect(IntegrityServer.noteGets(e.host) == 2, "Only one canonical request may be active")
        IntegrityServer.release(e.host)
        await IntegrityServer.waitForHeld(e.host)
        #expect(e.model.controller.html() == "<p>original</p>", "The older response must never install")
        IntegrityServer.release(e.host)
        await wait({ e.model.allowsUserEditing }, "the latest generation should finish")
        #expect(e.model.controller.html() == "<p>revision two</p>")
    }

    @Test("AI preflight locks the real editor while draining the latest local title and body")
    func preflightFlushAndNativeLock() async {
        let e = editor()
        await e.model.start().value
        insert(" local draft", into: e)
        e.model.setDraftTitle("Local title")
        IntegrityServer.holdNextPATCH(e.host)
        let preparing = Task { await e.model.prepareForAI(attempt()) }
        await IntegrityServer.waitForHeld(e.host)
        #expect(!e.view.isEditable)
        let retained = e.model.controller.html()
        insert(" forbidden", into: e)
        e.model.controller.toggle(.bold)
        e.model.controller.toggleTask(atParagraphOffset: 0)
        e.model.controller.indentList()
        #if !os(macOS)
        e.model.controller.undo()
        #else
        #expect(e.view.undoManager == nil)
        #endif
        e.model.setDraftTitle("Forbidden title")
        #expect(e.model.controller.html() == retained)
        #expect(e.model.draftTitle == "Local title")
        IntegrityServer.release(e.host)
        #expect(await preparing.value)
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>original local draft</p>")
        #expect(!e.model.allowsUserEditing)
        #expect(await e.model.noteAIFinished(attemptID: "attempt", terminal: true))
        #expect(e.model.allowsUserEditing)
    }

    @Test("Unexpected dirty state retains both drafts and never authorizes a stale PATCH")
    func dirtyGuardBecomesVisibleConflict() async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.holdNextGET(e.host, html: "<p>remote rewrite</p>")
        e.model.noteDidChangeFromAI()
        await IntegrityServer.waitForHeld(e.host)
        // Bypass user input to simulate a divergence the dirty guard must retain.
        e.storage.replaceCharacters(in: NSRange(location: 0, length: e.storage.length), with: "retained local draft")
        IntegrityServer.release(e.host)
        await wait({ e.model.integrity == .conflict }, "dirty canonical adoption should report conflict")
        #expect(e.model.controller.html().contains("retained local draft"))
        #expect(e.model.remoteConflict?.htmlContent == "<p>remote rewrite</p>")
        #expect(!(await e.model.flush()))
        #expect(IntegrityServer.patches(e.host).isEmpty)
    }

    @Test("Old account GET and failed metadata rollback cannot repopulate the new store")
    func accountEpochDropsLateReadAndRollback() async {
        let e = editor(holdInitial: true)
        let loading = e.model.start()
        await IntegrityServer.waitForHeld(e.host)
        e.store.clearCache()
        e.store.bindAccount("new-owner")
        e.store.upsert(Note(id: "n1", htmlContent: "<p>new owner</p>", title: "New owner", hasBody: true))
        IntegrityServer.release(e.host)
        await loading.value
        #expect(e.store.cachedNote(id: "n1")?.title == "New owner")

        let fresh = editor()
        await fresh.model.start().value
        IntegrityServer.holdNextPATCH(fresh.host, status: 503)
        let changing = Task { await fresh.model.togglePin() }
        await IntegrityServer.waitForHeld(fresh.host)
        fresh.store.clearCache()
        fresh.store.bindAccount("another-owner")
        fresh.store.upsert(Note(id: "n1", title: "Second account", isPinned: true))
        IntegrityServer.release(fresh.host)
        await changing.value
        #expect(fresh.store.cachedNote(id: "n1")?.title == "Second account")
        #expect(fresh.store.cachedNote(id: "n1")?.isPinned == true)
        #expect(fresh.model.error == nil)
    }

    @Test("Unknown attempts survive cache clear and restart; one GET cannot unlock them")
    func durableUnknownFence() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("cache.json")
        let ledger = directory.appendingPathComponent("pending.json")
        let first = NotesStore(cacheURL: cache, ledgerURL: ledger)
        first.bindAccount("owner")
        #expect(first.recordAttempt(attempt("unknown"), noteID: "n1", epoch: first.epoch))
        first.clearCache()
        let restarted = NotesStore(cacheURL: cache, ledgerURL: ledger)
        restarted.bindAccount("owner")
        let e = editor(store: restarted)
        await e.model.start().value
        #expect(e.model.pendingAttempt?.id == "unknown")
        #expect(!e.view.isEditable)
        #expect(e.model.controller.html() == "<p>original</p>", "Read-only canonical preview remains copyable")
        let gets = IntegrityServer.noteGets(e.host)
        #expect(!(await e.model.retryCanonicalCheck()))
        #expect(IntegrityServer.noteGets(e.host) == gets, "Unknown response identity is not settled by another GET")
        #expect(!(await e.model.flush()))
    }

    @Test("Only the exact persisted assistant response settles a disconnected attempt")
    func exactHistoryRecovery() async {
        let store = NotesStore(cacheURL: nil, allowsEphemeralLedger: true)
        store.bindAccount("owner")
        var pending = attempt("known")
        pending.responseMessageID = "expected-response"
        #expect(store.recordAttempt(pending, noteID: "n1", epoch: store.epoch))
        let e = editor(store: store)
        await e.model.start().value
        IntegrityServer.setHistory(e.host, id: "unrelated-response")
        #expect(!(await e.model.retryCanonicalCheck()))
        IntegrityServer.setHTML(e.host, "<p>committed despite disconnect</p>")
        IntegrityServer.setHistory(e.host, id: "expected-response")
        #expect(await e.model.retryCanonicalCheck())
        #expect(e.model.controller.html() == "<p>committed despite disconnect</p>")
        #expect(store.pendingAttempt(noteID: "n1") == nil)
        #expect(IntegrityServer.cancels(e.host) == 0, "Legacy IDs have no server operation to cancel")
    }

    @Test("A restarted operation without a response ID cancels then adopts the saved note")
    func durableOperationRecoveryWithoutResponse() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("cache.json")
        let ledger = directory.appendingPathComponent("pending.json")
        let first = NotesStore(cacheURL: cache, ledgerURL: ledger)
        first.bindAccount("owner")
        let pending = NotesStore.AIAttempt(id: UUID().uuidString, userMessageID: "lost-question", operationProtocol: .operationReceipt)
        #expect(first.recordAttempt(pending, noteID: "n1", epoch: first.epoch))
        first.clearCache()
        let restarted = NotesStore(cacheURL: cache, ledgerURL: ledger)
        restarted.bindAccount("owner")
        let e = editor(store: restarted)
        await e.model.start().value
        #expect(e.model.pendingAttempt?.operationProtocol == .operationReceipt && !e.model.allowsUserEditing)
        IntegrityServer.setHTML(e.host, "<p>canonical after restart</p>")
        #expect(await e.model.retryCanonicalCheck())
        #expect(e.model.controller.html() == "<p>canonical after restart</p>")
        #expect(IntegrityServer.cancels(e.host) == 1 && IntegrityServer.aiRequests(e.host) == 0)
        #expect(IntegrityServer.historyGets(e.host) == 0)
        #expect(restarted.pendingAttempt(noteID: "n1") == nil)
        insert(" Manual follow-up.", into: e)
        #expect(await e.model.flush())
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>canonical after restart Manual follow-up.</p>")
    }

    @Test("Cancellation invalidates a canonical GET that started before the server fence")
    func cancellationDropsPreFenceSnapshot() async {
        let e = editor()
        await e.model.start().value
        let pending = NotesStore.AIAttempt(id: UUID().uuidString, userMessageID: "question", operationProtocol: .operationReceipt)
        #expect(await e.model.prepareForAI(pending))
        IntegrityServer.holdNextGET(e.host, html: "<p>snapshot before cancel</p>")
        e.model.noteDidChangeFromAI()
        await IntegrityServer.waitForHeld(e.host)
        IntegrityServer.setHTML(e.host, "<p>saved when cancellation fenced writes</p>")
        let finishing = Task { await e.model.noteAIFinished(attemptID: pending.id, terminal: false) }
        await wait({ e.store.pendingAttempt(noteID: "n1")?.terminal == true }, "authoritative cancellation receipt")
        #expect(!e.model.allowsUserEditing)
        IntegrityServer.release(e.host)
        #expect(await finishing.value)
        #expect(e.model.controller.html() == "<p>saved when cancellation fenced writes</p>")
        #expect(IntegrityServer.noteGets(e.host) == 3, "Initial, discarded pre-fence, and post-fence canonical GET")
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
    }

    private func assistant(_ e: Editor) -> NoteAIModel {
        let ai = NoteAIModel(noteID: "n1", api: e.api, store: e.store)
        ai.bindEditor(e.model)
        return ai
    }

    @Test("DONE checks the settled operation then adopts the canonical rewrite before manual PATCH")
    func transportEndSettlesMergedStream() async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        IntegrityServer.finishStream(e.host, finishChunk: false)
        await wait({ !ai.isBusy }, "the SDK's DONE sentinel")
        #expect(!ai.needsReconciliation)
        #expect(e.model.allowsUserEditing && e.view.isEditable)
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
        #expect(IntegrityServer.operationGets(e.host) == 1)
        #expect(IntegrityServer.cancels(e.host) == 0)
        let reserved = IntegrityServer.reservations(e.host)
        let streamed = IntegrityServer.aiBodies(e.host)
        #expect(reserved.count == 1 && streamed.count == 1)
        #expect(NSDictionary(dictionary: reserved[0]).isEqual(to: streamed[0]), "Reserve and stream must fingerprint the same request")
        #expect(e.model.controller.html() == "<p>server rewrite</p>")
        insert(" Manual after DONE.", into: e)
        #expect(await e.model.flush())
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>server rewrite Manual after DONE.</p>")
    }

    @Test("An unmarked EOF cancels its operation before canonical recovery")
    func unmarkedEOFUsesCancellationReceipt() async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        IntegrityServer.finishStream(e.host, finishChunk: false, endMarker: false)
        await wait({ !ai.isBusy }, "unmarked EOF")
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing && e.view.isEditable)
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
        #expect(IntegrityServer.cancels(e.host) == 1)
        #expect(e.model.controller.html() == "<p>server rewrite</p>")
        #expect(IntegrityServer.patches(e.host).isEmpty)
    }

    @Test("An SSE error or abort plus DONE requires cancellation and canonical recovery", arguments: [false, true])
    func failedTransportEndUsesCancellationReceipt(aborted: Bool) async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        IntegrityServer.finishStream(e.host, finishChunk: false, terminalFailure: aborted
            ? #"{"type":"abort","reason":"Synthetic abort"}"#
            : #"{"type":"error","errorText":"Synthetic failure after a write"}"#)
        await wait({ !ai.isBusy }, "error or abort plus DONE")
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing && e.view.isEditable)
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
        #expect(IntegrityServer.cancels(e.host) == 1)
        #expect(e.model.controller.html() == "<p>server rewrite</p>")
        #expect(IntegrityServer.patches(e.host).isEmpty)
    }

    @Test("Stop freezes presentation but drains late note receipts and terminal reconciliation")
    func stopDrainsTheExistingStream() async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        #expect(!e.view.isEditable)
        ai.stop()
        #expect(ai.status == .stopping)
        let displayed = ai.messages
        IntegrityServer.finishStream(e.host)
        await wait({ !ai.isBusy }, "the original stream's terminal receipt")
        #expect(e.model.allowsUserEditing)
        #expect(e.model.controller.html() == "<p>server rewrite</p>")
        #expect(ai.messages == displayed, "Stop must not resume presenting drained text")
        #expect(IntegrityServer.aiRequests(e.host) == 1)
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
        IntegrityServer.holdNextHistoryDelete(e.host)
        let clearing = Task { await ai.clearHistory() }
        await IntegrityServer.waitForHeld(e.host)
        #expect(ai.isBusy)
        #expect(!(await ai.send("Must not race the held Clear")))
        #expect(ai.messages == displayed, "A pending Clear preserves its stopped display")
        IntegrityServer.release(e.host)
        await clearing.value
        #expect(ai.messages.isEmpty, "A successful Clear must remove the stopped presentation too")
        #expect(IntegrityServer.aiRequests(e.host) == 1)
    }

    @Test("History is not proof for operation attempts; Check cancels without resending")
    func transportFailureDoesNotUnlockOrResend() async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        IntegrityServer.refuseCancel(e.host)
        IntegrityServer.disconnectStream(e.host)
        await wait({ !ai.isBusy }, "transport failure")
        #expect(ai.needsReconciliation)
        #expect(e.model.integrity == .ambiguous)
        #expect(!(await e.model.flush()))
        #expect(await e.model.canLeaveEditor(), "A durable clean pending note does not trap navigation")
        await ai.retry()
        #expect(ai.needsReconciliation)
        #expect(IntegrityServer.aiRequests(e.host) == 1)
        IntegrityServer.setHistory(e.host, id: "synthetic-response")
        await ai.retry()
        #expect(ai.needsReconciliation && !e.model.allowsUserEditing)
        #expect(IntegrityServer.historyGets(e.host) == 0, "An assistant row cannot fence a later write")
        IntegrityServer.allowCancel(e.host)
        IntegrityServer.setHTML(e.host, "<p>committed after disconnect</p>")
        await ai.retry()
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing)
        #expect(e.model.controller.html() == "<p>committed after disconnect</p>")
        #expect(IntegrityServer.aiRequests(e.host) == 1)
        insert(" Manual after cancel.", into: e)
        #expect(await e.model.flush())
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>committed after disconnect Manual after cancel.</p>")
    }

    @Test("A running operation after DONE stays locked until Check obtains a cancellation receipt")
    func doneIsNotOperationSettlement() async {
        let e = editor()
        await e.model.start().value
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ ai.messages.last?.content == "Partial answer" }, "partial SSE text")
        IntegrityServer.finishStream(e.host, settle: false)
        await wait({ !ai.isBusy }, "operation state check")
        #expect(ai.needsReconciliation && !e.model.allowsUserEditing)
        #expect(IntegrityServer.operationGets(e.host) == 1 && IntegrityServer.cancels(e.host) == 0)
        await ai.clearHistory()
        #expect(e.store.pendingAttempt(noteID: "n1") != nil, "Clear must retain the operation fence")
        await ai.retry()
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing)
        #expect(IntegrityServer.cancels(e.host) == 1 && IntegrityServer.aiRequests(e.host) == 1)
    }

    @Test("A 500 cannot unlock an operation while its cancellation receipt is unavailable")
    func serverErrorRequiresCancellationReceipt() async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.refuseAI(e.host, status: 500)
        IntegrityServer.refuseCancel(e.host)
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ !ai.isBusy }, "500 and failed cancellation")
        #expect(ai.needsReconciliation && !e.model.allowsUserEditing)
        #expect(e.store.pendingAttempt(noteID: "n1")?.operationProtocol == .operationReceipt)
        #expect(!(await e.model.flush()))
        IntegrityServer.setHTML(e.host, "<p>write hidden by 500</p>")
        IntegrityServer.allowCancel(e.host)
        await ai.retry()
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing)
        #expect(e.model.controller.html() == "<p>write hidden by 500</p>")
        #expect(IntegrityServer.aiRequests(e.host) == 1)
        insert(" Follow-up.", into: e)
        #expect(await e.model.flush())
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>write hidden by 500 Follow-up.</p>")
    }

    @Test("A lost reserve response cancels an existing reservation or creates its tombstone", arguments: [false, true])
    func lostReserveResponseIsFenced(reservationArrived: Bool) async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.loseReserve(e.host, createsRow: reservationArrived)
        let ai = assistant(e)
        #expect(await ai.send("Rewrite the synthetic note"))
        await wait({ !ai.isBusy }, "lost reserve response recovery")
        #expect(!ai.needsReconciliation && e.model.allowsUserEditing)
        #expect(IntegrityServer.reservations(e.host).count == 1)
        #expect(IntegrityServer.aiRequests(e.host) == 0, "An uncertain reservation must never open the AI stream")
        #expect(IntegrityServer.cancels(e.host) == 1)
        #expect(IntegrityServer.operationStates(e.host) == [.cancelled])
        #expect(e.store.pendingAttempt(noteID: "n1") == nil)
        #expect(e.model.controller.html() == "<p>original</p>")
        insert(" Safe manual edit.", into: e)
        #expect(await e.model.flush())
        #expect(IntegrityServer.patches(e.host).last?["htmlContent"] as? String == "<p>original Safe manual edit.</p>")
    }

    @Test("Every send, retry and suggestion flushes current manual edits before transport")
    func everySendRunsPreflight() async {
        let e = editor()
        await e.model.start().value
        IntegrityServer.refuseAI(e.host)
        let ai = assistant(e)
        var preflights = 0
        ai.beforeSend = { attempt in preflights += 1; return await e.model.prepareForAI(attempt) }
        insert(" first", into: e)
        #expect(await ai.send("Synthetic question"))
        await wait({ !ai.isBusy }, "initial refusal and canonical check")
        insert(" second", into: e)
        await ai.retry()
        await wait({ !ai.isBusy }, "retry refusal and canonical check")
        insert(" third", into: e)
        await ai.suggestVerses()
        await wait({ !ai.isBusy }, "suggestion refusal and canonical check")
        #expect(preflights == 3 && IntegrityServer.aiRequests(e.host) == 3)
        let snapshots = IntegrityServer.htmlAtAIRequest(e.host)
        #expect(snapshots == ["<p>original first</p>", "<p>original first second</p>", "<p>original first second third</p>"])
    }

    @Test("A corrupt recovery ledger fails closed, remains retryable and prevents AI")
    func corruptLedgerFailsClosed() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let ledger = directory.appendingPathComponent("pending.json")
        try Data("broken ledger".utf8).write(to: ledger)
        let store = NotesStore(cacheURL: directory.appendingPathComponent("cache.json"), ledgerURL: ledger)
        store.bindAccount("owner")
        let e = editor(store: store)
        await e.model.start().value
        #expect(e.model.integrity == .ledgerFailed && !e.view.isEditable)
        #expect(e.model.integrityMessage != nil && e.model.canCheckCanonical)
        #expect(!(await e.model.prepareForAI(attempt())))
        #expect(!(await e.model.retryCanonicalCheck()))
        // Restoring a valid ledger is explicit recovery, never deleting it in the app.
        try JSONEncoder().encode(["owner": ["n1": attempt("retained")]]).write(to: ledger, options: .atomic)
        #expect(!(await e.model.retryCanonicalCheck()))
        #expect(e.model.pendingAttempt?.id == "retained")
        #expect(!e.model.allowsUserEditing)
    }

    @Test("A bound owner needs durable storage unless a test explicitly opts into an ephemeral ledger")
    func missingDurableLedgerRejectsAI() async {
        let store = NotesStore(cacheURL: nil)
        store.bindAccount("owner")
        let e = editor(store: store)
        await e.model.start().value
        #expect(e.model.integrity == .ledgerFailed)
        #expect(!(await e.model.prepareForAI(attempt())))
        #expect(!store.recordAttempt(attempt(), noteID: "n1", epoch: store.epoch))
    }

    @Test("A direct account switch cannot hydrate the previous owner's disk cache")
    func accountOwnedDiskCache() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NotesStore(cacheURL: directory.appendingPathComponent("cache.json"))
        store.bindAccount("first-owner")
        store.upsert(Note(id: "private", title: "Previous account"))
        store.bindAccount("second-owner")
        await store.hydrate()
        #expect(store.notes.isEmpty)
    }

    @Test("Only one model per note can edit or send; older attempts cannot overwrite or clear a newer fence")
    func sameNoteHasOneEditingLease() async {
        let first = editor()
        await first.model.start().value
        let second = editor(store: first.store)
        await second.model.start().value
        #expect(first.model.allowsUserEditing)
        #expect(second.model.integrity == .otherEditor && !second.view.isEditable)
        insert(" blocked", into: second)
        second.model.setDraftTitle("Blocked title")
        #expect(!(await second.model.flush()))
        #expect(await second.model.canLeaveEditor())
        let secondAI = assistant(second)
        #expect(!(await secondAI.send("This must not reach transport")))
        #expect(IntegrityServer.aiRequests(second.host) == 0)
        #expect(IntegrityServer.patches(second.host).isEmpty)
        #expect(await first.model.prepareForAI(attempt("owner-attempt")))
        #expect(!first.store.recordAttempt(attempt("other-attempt"), noteID: "n1", epoch: first.store.epoch))
        #expect(!first.store.recordAttempt(nil, noteID: "n1", epoch: first.store.epoch, expectedAttemptID: "other-attempt"))
        #expect(first.store.pendingAttempt(noteID: "n1")?.id == "owner-attempt")
        await first.model.finishEditing()
        let reopened = editor(store: first.store)
        await reopened.model.start().value
        #expect(reopened.model.integrity == .ambiguous && !reopened.view.isEditable)
        #expect(reopened.model.pendingAttempt?.id == "owner-attempt")
        // The original owner may settle its durable fence, but the newer
        // editor owns canonical adoption even before the old GET starts.
        #expect(!(await first.model.noteAIFinished(attemptID: "owner-attempt", terminal: true)))
        #expect(first.store.pendingAttempt(noteID: "n1")?.terminal == true)
        #expect(await reopened.model.canLeaveEditor(), "The terminal fence remains durable until the current owner checks")
        #expect(await reopened.model.retryCanonicalCheck())
        await reopened.model.finishEditing()
        let writable = editor(store: first.store)
        await writable.model.start().value
        #expect(writable.model.allowsUserEditing && writable.view.isEditable)
    }

    @Test("A released editor's held canonical GET cannot replace a reopened owner's saved body",
          arguments: [false, true])
    func releasedCanonicalReadCannotOverwriteReopenedOwnerSave(successorCloses: Bool) async throws {
        let first = editor()
        await first.model.start().value
        let pending = attempt("released-owner-A")
        let prepared = await first.model.prepareForAI(pending)
        try #require(prepared)
        await first.model.finishEditing()
        #expect(!first.model.allowsUserEditing && !first.view.isEditable)

        let canonicalA = "<p>AI baseline A before reopening</p>"
        let initialGets = IntegrityServer.noteGets(first.host)
        IntegrityServer.holdNextGET(first.host, html: canonicalA)
        var oldFinishCompleted = false
        let finishing = Task {
            let result = await first.model.noteAIFinished(attemptID: pending.id, terminal: true)
            oldFinishCompleted = true
            return result
        }
        defer {
            // Release even when an earlier requirement fails; never strand the
            // old model's URLProtocol response behind the test's assertions.
            IntegrityServer.release(first.host)
            finishing.cancel()
        }
        await wait({
            IntegrityServer.noteGets(first.host) == initialGets + 1
                && first.store.pendingAttempt(noteID: "n1")?.terminal == true
        }, "the released owner's held terminal canonical GET")
        try #require(IntegrityServer.noteGets(first.host) == initialGets + 1)
        try #require(first.store.pendingAttempt(noteID: "n1")?.terminal == true)
        #expect(!oldFinishCompleted)

        let reopened = editor(store: first.store)
        IntegrityServer.setHTML(reopened.host, canonicalA)
        await reopened.model.start().value
        let checked = await reopened.model.retryCanonicalCheck()
        try #require(checked && reopened.model.allowsUserEditing && reopened.view.isEditable)
        try #require(first.store.pendingAttempt(noteID: "n1") == nil)
        #expect(reopened.model.controller.html() == canonicalA)

        let markerB = " Reopened owner B " + UUID().uuidString
        insert(markerB, into: reopened)
        let saved = await reopened.model.flush()
        try #require(saved)
        let savedB = try #require(first.store.cachedNote(id: "n1")?.htmlContent)
        try #require(savedB.contains(markerB))
        #expect(reopened.model.controller.html() == savedB)
        let firstPatchCount = IntegrityServer.patches(first.host).count
        let reopenedPatchCount = IntegrityServer.patches(reopened.host).count
        #expect(IntegrityServer.patches(reopened.host).last?["htmlContent"] as? String == savedB)
        if successorCloses { await reopened.model.finishEditing() }

        IntegrityServer.release(first.host)
        await wait({ oldFinishCompleted }, "the released owner's old callback to finish")
        try #require(oldFinishCompleted)
        _ = await finishing.value

        #expect(first.store.cachedNote(id: "n1")?.htmlContent == savedB,
                "A late canonical GET from the released editor must not replace the new owner's saved cache body")
        #expect(reopened.model.controller.html() == savedB)
        #expect(reopened.model.allowsUserEditing == !successorCloses)
        #expect(reopened.view.isEditable == !successorCloses)
        #expect(IntegrityServer.patches(first.host).count == firstPatchCount)
        #expect(IntegrityServer.patches(reopened.host).count == reopenedPatchCount)
        #expect(first.store.pendingAttempt(noteID: "n1") == nil)
        #expect(reopened.model.pendingAttempt == nil, "The late callback must not resurrect the cleared AI ledger")
    }

    @Test("Real AI callback wiring and weak wikilink capture release both models and the editing lease")
    func callbackWiringReleasesTheLease() async {
        let store = NotesStore(cacheURL: nil, allowsEphemeralLedger: true)
        store.bindAccount("synthetic-owner")
        var loaded: Editor? = editor(store: store)
        await loaded!.model.start().value
        let controller = loaded!.model.controller
        let library = NotesLibraryModel(api: NotesAPI(api: loaded!.api), store: store)
        var assistant: NoteAIModel? = NoteAIModel(noteID: "n1", api: loaded!.api, store: store)
        weak var editorReference: NoteEditorModel? = loaded!.model
        weak var assistantReference: NoteAIModel? = assistant
        assistant!.bindEditor(loaded!.model)
        // Exercise the Mac destination contract; iOS destination Binding
        // ownership still requires the actual linked-note push/pop journey.
        do {
            let editor = loaded!.model
            controller.onOpenWikilink = { [weak editor, library] id in
                Task { @MainActor [weak editor, library] in
                    guard let editor, await editor.canLeaveEditor() else { return }
                    library.selectedNoteID = id
                }
            }
        }
        controller.onOpenWikilink?("linked-note")
        await wait({ library.selectedNoteID == "linked-note" }, "wired wikilink navigation")
        loaded = nil
        #expect(editorReference != nil, "The live assistant legitimately retains its bound editor")
        assistant = nil
        await wait({ assistantReference == nil && editorReference == nil }, "callback owner deallocation")
        #expect(store.canMutateUnopenedNote(noteID: "n1", epoch: store.epoch))
        let reopened = editor(store: store)
        await reopened.model.start().value
        #expect(reopened.model.allowsUserEditing && reopened.view.isEditable)
        withExtendedLifetime(controller) {}
    }

    @Test("An explicit closed editor can remain retained while a reopened model acquires the lease")
    func explicitCloseReleasesARetainedEditorsLease() async {
        let retained = editor()
        await retained.model.start().value
        insert(" saved follow-up", into: retained)
        #expect(await retained.model.canLeaveEditor())
        await retained.model.finishEditing()
        #expect(!retained.model.allowsUserEditing && !retained.view.isEditable)
        let reopened = editor(store: retained.store)
        await reopened.model.start().value
        #expect(reopened.model.allowsUserEditing && reopened.view.isEditable)
        let oldHTML = retained.model.controller.html()
        insert(" forbidden old-owner edit", into: retained)
        #expect(retained.model.controller.html() == oldHTML)
        #expect(!(await retained.model.flush()))
        withExtendedLifetime(retained) {}
    }

    @Test("Accepted deletion revokes editing before a held save can reinsert the deleted cache row")
    func lateSaveAfterDeleteCannotRepopulateTheCache() async {
        let e = editor()
        await e.model.start().value
        insert(" pending save", into: e)
        IntegrityServer.holdNextPATCH(e.host)
        let saving = Task { await e.model.flush() }
        await IntegrityServer.waitForHeld(e.host)
        #expect(await e.model.delete())
        #expect(!e.model.allowsUserEditing && !e.view.isEditable)
        #expect(e.store.cachedNote(id: "n1") == nil)
        await e.model.finishEditing(flushPendingChanges: false)
        #expect(IntegrityServer.patches(e.host).count == 1, "Closing an accepted deletion must not send another PATCH")
        IntegrityServer.release(e.host)
        #expect(!(await saving.value), "The old writer no longer owns the editor")
        #expect(e.store.cachedNote(id: "n1") == nil)
        #expect(IntegrityServer.patches(e.host).count == 1)
        #expect(!(await e.model.flush()))
    }

    @Test("A late library snapshot cannot install across an account epoch")
    func lateLibrarySnapshotIsDropped() async {
        let e = editor()
        IntegrityServer.holdNextList(e.host)
        let library = NotesLibraryModel(api: NotesAPI(api: e.api), store: e.store)
        let loading = Task { await library.load(.initial) }
        await IntegrityServer.waitForHeld(e.host)
        e.store.clearCache()
        e.store.bindAccount("new-owner")
        e.store.upsert(Note(id: "new", title: "New account only"))
        IntegrityServer.release(e.host)
        await loading.value
        #expect(e.store.notes.map(\.id) == ["new"])
        #expect(library.notes.isEmpty)
    }

}

private final class IntegrityServer: URLProtocol, @unchecked Sendable {
    private struct Plan { var html: String; var status: Int; var patch: Bool; var title: String? = nil }
    private struct Held { var server: IntegrityServer; var plan: Plan }
    private struct State {
        var html = "<p>original</p>"
        var title = "Study"
        var gets = 0
        var nextGET: Plan?
        var nextPATCH: Plan?
        var nextList: Plan?
        var nextHistoryDelete: Plan?
        var aiRequests = 0
        var aiStatus = 200
        var reserveCreatesRowOnLoss: Bool?
        var cancelStatus = 200
        var reservations: [[String: Any]] = []
        var aiBodies: [[String: Any]] = []
        var operations: [String: NoteAIOperation.State] = [:]
        var operationGets = 0
        var cancels = 0
        var historyGets = 0
        var htmlAtAIRequest: [String] = []
        var stream: IntegrityServer?
        var held: [Held] = []
        var waiters: [CheckedContinuation<Void, Never>] = []
        var patches: [[String: Any]] = []
        var history: String = "[]"
    }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var states: [String: State] = [:]
    static func configure(_ host: String, holdInitial: Bool) {
        lock.withLock {
            var value = State()
            if holdInitial { value.nextGET = Plan(html: value.html, status: 200, patch: false) }
            states[host] = value
        }
    }
    static func holdNextGET(_ host: String, html: String, status: Int = 200) { lock.withLock { states[host]?.nextGET = Plan(html: html, status: status, patch: false) } }
    static func holdNextPATCH(_ host: String, status: Int = 200) { lock.withLock { states[host]?.nextPATCH = Plan(html: "", status: status, patch: true) } }
    static func holdNextHistoryDelete(_ host: String) { lock.withLock { states[host]?.nextHistoryDelete = Plan(html: "", status: 200, patch: false) } }
    static func holdNextList(_ host: String) { lock.withLock { states[host]?.nextList = Plan(html: "<p>old account</p>", status: 200, patch: false) } }
    static func refuseAI(_ host: String, status: Int = 503) { lock.withLock { states[host]?.aiStatus = status } }
    static func refuseCancel(_ host: String) { lock.withLock { states[host]?.cancelStatus = 503 } }
    static func allowCancel(_ host: String) { lock.withLock { states[host]?.cancelStatus = 200 } }
    static func loseReserve(_ host: String, createsRow: Bool) { lock.withLock { states[host]?.reserveCreatesRowOnLoss = createsRow } }
    static func reservations(_ host: String) -> [[String: Any]] { lock.withLock { states[host]?.reservations ?? [] } }
    static func aiBodies(_ host: String) -> [[String: Any]] { lock.withLock { states[host]?.aiBodies ?? [] } }
    static func operationGets(_ host: String) -> Int { lock.withLock { states[host]?.operationGets ?? 0 } }
    static func cancels(_ host: String) -> Int { lock.withLock { states[host]?.cancels ?? 0 } }
    static func historyGets(_ host: String) -> Int { lock.withLock { states[host]?.historyGets ?? 0 } }
    static func operationStates(_ host: String) -> [NoteAIOperation.State] { lock.withLock { states[host].map { Array($0.operations.values) } ?? [] } }
    static func aiRequests(_ host: String) -> Int { lock.withLock { states[host]?.aiRequests ?? 0 } }
    static func htmlAtAIRequest(_ host: String) -> [String] { lock.withLock { states[host]?.htmlAtAIRequest ?? [] } }
    static func finishStream(_ host: String, finishChunk: Bool = true, endMarker: Bool = true, terminalFailure: String? = nil, settle: Bool = true) {
        let stream = lock.withLock { () -> IntegrityServer? in
            states[host]?.html = "<p>server rewrite</p>"
            if settle, let id = states[host]?.aiBodies.last?["operationId"] as? String {
                states[host]?.operations[id.lowercased()] = .settled
            }
            let value = states[host]?.stream; states[host]?.stream = nil
            return value
        }
        var events = [
            #"{"type":"tool-input-available","toolCallId":"rewrite","toolName":"updateNote","input":{"markdown":"Synthetic rewrite"}}"#,
            #"{"type":"tool-output-available","toolCallId":"rewrite","output":{"noteId":"n1","noteTitle":"Study","previousWordCount":1,"wordCount":2}}"#,
            #"{"type":"text-delta","id":"text","delta":" then hidden completion"}"#,
            #"{"type":"text-end","id":"text"}"#,
        ]
        if finishChunk { events.append(#"{"type":"finish"}"#) }
        if let terminalFailure { events.append(terminalFailure) }
        if endMarker { events.append("[DONE]") }
        stream?.sendSSE(events)
        if let stream { stream.client?.urlProtocolDidFinishLoading(stream) }
    }
    static func disconnectStream(_ host: String) {
        let stream = lock.withLock { () -> IntegrityServer? in
            let value = states[host]?.stream; states[host]?.stream = nil
            return value
        }
        if let stream { stream.client?.urlProtocol(stream, didFailWithError: URLError(.networkConnectionLost)) }
    }
    private func sendSSE(_ events: [String]) {
        client?.urlProtocol(self, didLoad: Data(events.map { "data: \($0)\n\n" }.joined().utf8))
    }
    static func setHTML(_ host: String, _ html: String) { lock.withLock { states[host]?.html = html } }
    static func noteGets(_ host: String) -> Int { lock.withLock { states[host]?.gets ?? 0 } }
    static func patches(_ host: String) -> [[String: Any]] { lock.withLock { states[host]?.patches ?? [] } }
    static func setHistory(_ host: String, id: String) {
        lock.withLock { states[host]?.history = "[{\"id\":\"\(id)\",\"role\":\"assistant\",\"content\":\"Finished\"}]" }
    }
    static func waitForHeld(_ host: String) async {
        await withCheckedContinuation { continuation in
            let ready = lock.withLock {
                if states[host]?.held.isEmpty == false { return true }
                states[host]?.waiters.append(continuation)
                return false
            }
            if ready { continuation.resume() }
        }
    }
    static func release(_ host: String) {
        let held = lock.withLock { () -> Held? in
            guard states[host]?.held.isEmpty == false else { return nil }
            return states[host]?.held.removeFirst()
        }
        if let held { held.server.respond(held.plan) }
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasPrefix("note-integrity-") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let host = request.url!.host!
        let path = request.url!.path
        if path.hasPrefix("/api/note-ai/operations") {
            let json = Self.body(request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            var loseResponse = false
            let result = Self.lock.withLock { () -> (String, NoteAIOperation.State, Int) in
                if path == "/api/note-ai/operations" {
                    let id = (json?["operationId"] as? String ?? "missing-id").lowercased()
                    Self.states[host]?.reservations.append(json ?? [:])
                    if let createsRow = Self.states[host]?.reserveCreatesRowOnLoss {
                        loseResponse = true
                        Self.states[host]?.reserveCreatesRowOnLoss = nil
                        if createsRow { Self.states[host]?.operations[id] = .reserved }
                    } else if Self.states[host]?.operations[id] == nil {
                        Self.states[host]?.operations[id] = .reserved
                    }
                    return (id, Self.states[host]?.operations[id] ?? .reserved, 200)
                }
                let pieces = path.split(separator: "/")
                let id = String(pieces[3]).lowercased()
                if path.hasSuffix("/cancel") {
                    Self.states[host]?.cancels += 1
                    let status = Self.states[host]!.cancelStatus
                    if status == 200, Self.states[host]?.operations[id] != .settled {
                        Self.states[host]?.operations[id] = .cancelled
                    }
                    return (id, Self.states[host]?.operations[id] ?? .running, status)
                }
                Self.states[host]?.operationGets += 1
                return (id, Self.states[host]?.operations[id] ?? .running, 200)
            }
            if loseResponse {
                client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            } else {
                let data = try! JSONSerialization.data(withJSONObject: ["id": result.0, "state": result.1.rawValue])
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: result.2, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            }
            return
        }
        if request.url!.path == "/api/note-ai" {
            let json = Self.body(request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let status = Self.lock.withLock { () -> Int in
                Self.states[host]?.aiRequests += 1
                Self.states[host]?.aiBodies.append(json ?? [:])
                if let id = json?["operationId"] as? String { Self.states[host]?.operations[id.lowercased()] = .running }
                let snapshot = Self.states[host]!.html
                Self.states[host]?.htmlAtAIRequest.append(snapshot)
                Self.states[host]?.stream = self
                return Self.states[host]!.aiStatus
            }
            if status != 200 { respond(Plan(html: "", status: status, patch: false)); return }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"])!, cacheStoragePolicy: .notAllowed)
            sendSSE([
                #"{"type":"start","messageId":"synthetic-response"}"#,
                #"{"type":"text-start","id":"text"}"#,
                #"{"type":"text-delta","id":"text","delta":"Partial answer"}"#
            ])
            return
        }
        let isNote = request.url!.path == "/api/notes/n1"
        let isList = request.url!.path == "/api/notes"
        let isHistoryDelete = request.url!.path.hasSuffix("/ai-messages") && request.httpMethod == "DELETE"
        let patch = request.httpMethod == "PATCH"
        let json = patch ? Self.body(request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } : nil
        var waiters: [CheckedContinuation<Void, Never>] = []
        let plan = Self.lock.withLock { () -> Plan? in
            if request.url!.path.hasSuffix("/ai-messages"), request.httpMethod != "DELETE" { Self.states[host]?.historyGets += 1 }
            if isNote && !patch { Self.states[host]?.gets += 1 }
            if let json { Self.states[host]?.patches.append(json) }
            if (isNote || isList || isHistoryDelete), let pending = isHistoryDelete ? Self.states[host]?.nextHistoryDelete : (isList ? Self.states[host]?.nextList : (patch ? Self.states[host]?.nextPATCH : Self.states[host]?.nextGET)) {
                if isHistoryDelete { Self.states[host]?.nextHistoryDelete = nil }
                else if isList { Self.states[host]?.nextList = nil }
                else if patch { Self.states[host]?.nextPATCH = nil } else { Self.states[host]?.nextGET = nil }
                var captured = pending
                if patch {
                    captured.html = json?["htmlContent"] as? String ?? Self.states[host]!.html
                    captured.title = json?["title"] as? String
                }
                Self.states[host]?.held.append(Held(server: self, plan: captured))
                waiters = Self.states[host]?.waiters ?? []
                Self.states[host]?.waiters = []
                return nil
            }
            if patch, let json {
                if let html = json["htmlContent"] as? String { Self.states[host]?.html = html }
                if let title = json["title"] as? String { Self.states[host]?.title = title }
            }
            return Plan(html: Self.states[host]!.html, status: 200, patch: patch)
        }
        waiters.forEach { $0.resume() }
        if let plan { respond(plan) }
    }
    private func respond(_ plan: Plan) {
        let host = request.url!.host!
        let data: Data
        if plan.status != 200 { data = Data(#"{"message":"controlled refusal"}"#.utf8) }
        else if request.url!.path.hasSuffix("ai-messages") {
            data = Data(Self.lock.withLock { Self.states[host]!.history }.utf8)
        } else if request.url!.path == "/api/tags" || request.url!.path == "/api/folders" { data = Data("[]".utf8) }
        else {
            if plan.patch { Self.lock.withLock {
                Self.states[host]?.html = plan.html
                if let title = plan.title { Self.states[host]?.title = title }
            } }
            let title = Self.lock.withLock { Self.states[host]!.title }
            let row: [String: Any] = ["id": "n1", "title": title, "htmlContent": plan.html, "plainText": "synthetic", "wordCount": 1, "isPinned": false, "createdAt": "2026-10-29T00:00:00Z", "updatedAt": "2026-10-29T00:00:01Z"]
            data = try! JSONSerialization.data(withJSONObject: request.url!.path == "/api/notes" ? [row] : row)
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: plan.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    private static func body(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
    override func stopLoading() {}
}
