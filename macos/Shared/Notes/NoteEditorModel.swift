import Foundation

/// Editor-pane data layer for a single note — a port of
/// `mobile/src/features/notes/useNoteEditorData.ts` plus the autosave that
/// lives in `NoteRichEditor.tsx` on Android.
///
/// The note is seeded synchronously from the shared `NotesStore`, so one whose
/// body has been loaded before opens instantly and the fetch revalidates behind
/// it. Every mutation writes through to the store, which is what keeps the list
/// pane in step with no refresh.
@MainActor
@Observable
final class NoteEditorModel {
    /// The debounce Android uses. Matching it is not cosmetic: all three
    /// clients write the same note, and a shorter window here would make this
    /// client win merge races it should not.
    static let autosaveDelay: Duration = .milliseconds(1500)

    /// The rich-text editing surface. Each platform target ships its own
    /// `NoteRichTextController` with the same API (NSTextStorage-backed on
    /// macOS, UITextView-backed on iOS), so the model compiles identically on
    /// both and everything below — loading, autosave debounce, metadata
    /// mutations — is shared.
    let controller = NoteRichTextController()

    private(set) var note: Note?
    /// Kept outside the returned note row so a save response cannot replace
    /// a title the user is still typing. Text fields update this synchronously.
    private(set) var draftTitle = ""
    private(set) var isLoading = true
    private(set) var isSaving = false
    private(set) var error: String?

    private let api: NotesAPI
    private let store: NotesStore
    private let noteID: String
    private let sessionEpoch: UUID

    enum Integrity: Equatable { case editable, preparing, running, refreshing, failed, ambiguous, conflict, ledgerFailed, otherEditor }
    private(set) var integrity: Integrity = .editable
    private(set) var integrityMessage: String?
    private(set) var pendingAttempt: NotesStore.AIAttempt?
    private(set) var remoteConflict: Note?
    private var ownsEditingLease: Bool { store.ownsEditingLease(editingLease, noteID: noteID, epoch: sessionEpoch) }
    var allowsUserEditing: Bool { ownsEditingLease && integrity == .editable && store.pendingAttempt(noteID: noteID) == nil && store.recoveryLedgerError == nil }
    var canCheckCanonical: Bool { store.isCurrent(sessionEpoch) && [.failed, .ambiguous, .ledgerFailed].contains(integrity) }
    @ObservationIgnored private var editingLease: NotesStore.EditingLease?
    private let canonicalLeaseID: UUID?
    private var canAdoptCanonical: Bool {
        store.canAdoptCanonical(leaseID: canonicalLeaseID, noteID: noteID, epoch: sessionEpoch)
    }
    @ObservationIgnored private var copiedDraft: (title: String, html: String)?
    @ObservationIgnored private var canonicalGeneration: UInt64 = 0
    @ObservationIgnored private var canonicalTask: Task<Bool, Never>?

    private func setIntegrity(_ state: Integrity, _ message: String? = nil) {
        integrity = state
        integrityMessage = message
        controller.allowsUserEditing = allowsUserEditing
    }

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var persistTask: (id: UUID, task: Task<Bool, Never>)?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    /// The HTML last written to the server, so an unchanged document never
    /// costs a PATCH.
    @ObservationIgnored private var savedHTML = ""
    /// The same saved content in the editor's serialization format. Server
    /// HTML may contain harmless whitespace between blocks; loading alone
    /// must not turn that normalization into a pending write.
    @ObservationIgnored private var savedEditorHTML = ""
    @ObservationIgnored private var savedTitle = "Untitled Note"
    @ObservationIgnored private var titleRevision: UInt64 = 0
    @ObservationIgnored private var writeRevision: UInt64 = 0

    init(noteID: String, api: NotesAPI, store: NotesStore = .shared) {
        self.noteID = noteID
        self.api = api
        self.store = store
        self.sessionEpoch = store.epoch
        let lease = store.claimEditingLease(noteID: noteID, epoch: sessionEpoch)
        editingLease = lease
        canonicalLeaseID = lease?.id
        pendingAttempt = store.pendingAttempt(noteID: noteID)
        if editingLease == nil {
            integrity = .otherEditor
            integrityMessage = "This note is being edited in another window. Close that editor, then reopen this note to edit here."
            controller.allowsUserEditing = false
        } else if let ledgerError = store.recoveryLedgerError {
            integrity = .ledgerFailed
            integrityMessage = ledgerError
            controller.allowsUserEditing = false
        } else if pendingAttempt != nil {
            integrity = .ambiguous
            integrityMessage = Self.uncertainNotice
            controller.allowsUserEditing = false
        }

        let cached = store.cachedNote(id: noteID)
        note = cached
        draftTitle = cached?.title ?? ""
        savedTitle = Self.normalizedTitle(draftTitle)
        // A cached summary row can fill the title bar, but the editor waits for
        // the real body — seeding an empty document over a note that has
        // content would autosave that emptiness straight back.
        isLoading = !(cached?.hasBody ?? false)

        controller.onChange = { [weak self] in
            self?.scheduleSave()
        }
        // In-text `[[links]]` resolve against the cached library, the web
        // editor's `linkTargets`, so drawing them costs no request.
        controller.resolveWikilink = { [weak store] target in
            NoteWikilinks.resolve(target, in: store?.notes ?? [])
        }
    }

    // MARK: - Loading

    @discardableResult
    func start() -> Task<Void, Never> {
        if let loadTask { return loadTask }
        let task = Task { [weak self] in
            guard let self else { return }
            let hydrationTitleRevision = titleRevision
            let hydrationWriteRevision = writeRevision
            await store.hydrate()
            guard store.isCurrent(sessionEpoch) else { return }

            if let cached = store.cachedNote(id: noteID), cached.hasBody {
                await applyFetchedNote(cached, titleRevision: hydrationTitleRevision, writeRevision: hydrationWriteRevision)
                isLoading = false
            }

            do {
                let requestTitleRevision = titleRevision
                let requestWriteRevision = writeRevision
                let generation = canonicalGeneration
                let loaded = try await api.note(id: noteID)
                guard store.isCurrent(sessionEpoch), generation == canonicalGeneration, [.editable, .ambiguous, .failed, .ledgerFailed, .otherEditor].contains(integrity) else { isLoading = false; return }
                await applyFetchedNote(loaded, titleRevision: requestTitleRevision, writeRevision: requestWriteRevision)
                if !hasPendingChanges { error = nil }
            } catch {
                guard store.isCurrent(sessionEpoch) else { return }
                self.error = (error as? APIError)?.message ?? "Could not open this note."
            }
            isLoading = false

            // Secondary data — failing here must not block editing.
            if let tags = try? await api.tags(), let folders = try? await api.folders() {
                guard store.isCurrent(sessionEpoch) else { return }
                store.applyFoldersAndTags(folders: folders, tags: tags, epoch: sessionEpoch)
            }
        }
        loadTask = task
        return task
    }

    private static func normalizedTitle(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled Note" : trimmed
    }

    func setDraftTitle(_ title: String) {
        guard allowsUserEditing, draftTitle != title else { return }
        draftTitle = title
        titleRevision &+= 1
    }

    private var hasPendingChanges: Bool {
        Self.normalizedTitle(draftTitle) != savedTitle ||
            (controller.hasLoadedDocument && controller.html() != savedEditorHTML)
    }

    private func applyFetchedNote(_ loaded: Note, titleRevision requestedTitleRevision: UInt64, writeRevision requestedWriteRevision: UInt64) async {
        // A read must not install a competing baseline while the single
        // writer is awaiting its response. A failed write still permits this
        // GET to initialize an unopened body while retaining its dirty title.
        let generation = canonicalGeneration
        if let active = persistTask { _ = await active.task.value }
        guard store.isCurrent(sessionEpoch), generation == canonicalGeneration, [.editable, .ambiguous, .failed, .ledgerFailed, .otherEditor].contains(integrity) else { return }
        // A GET started before an accepted write must not reinstall its older
        // title/body in either the editor or the shared library cache.
        guard writeRevision == requestedWriteRevision else { return }
        let titleWasClean = Self.normalizedTitle(draftTitle) == savedTitle
        savedTitle = Self.normalizedTitle(loaded.title)
        if titleRevision == requestedTitleRevision, titleWasClean {
            draftTitle = loaded.title
        }
        note = loaded
        if ownsEditingLease { store.upsert(loaded, epoch: sessionEpoch) }
        // Title-only changes must reconcile even when HTML is unchanged.
        seedEditor(with: loaded)
    }

    private func seedEditor(with note: Note) {
        let html = NoteUtils.initialHTML(for: note)
        guard html != savedHTML || savedHTML.isEmpty else { return }
        // A revalidation must not replace edits made after a cached document
        // became visible while the request was still in flight.
        guard !controller.hasLoadedDocument || controller.html() == savedEditorHTML else { return }
        let document = NoteHTMLParser.parse(html)
        savedHTML = html
        savedEditorHTML = document.isEmpty ? "" : NoteHTMLSerializer.serialize(document)
        saveTask?.cancel()
        saveTask = nil
        controller.load(html: html)
    }

    // MARK: - Autosave

    private func scheduleSave() {
        guard allowsUserEditing else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: NoteEditorModel.autosaveDelay)
            guard !Task.isCancelled else { return }
            _ = await self?.persist()
        }
    }

    /// Cancel the pending debounce and write immediately — used when the pane
    /// closes, when another note is selected, and before opening the AI panel
    /// so the assistant reads the current text rather than the last autosave.
    @discardableResult
    func flush() async -> Bool {
        saveTask?.cancel()
        saveTask = nil
        guard store.isCurrent(sessionEpoch) else { return false }
        if let canonicalTask { _ = await canonicalTask.value }
        guard allowsUserEditing else { return false }
        return await persist()
    }

    /// Read-only pending notes may be left once their fence is durable. Never
    /// confuse permission to navigate with permission to PATCH a stale body.
    func canLeaveEditor() async -> Bool {
        guard store.isCurrent(sessionEpoch) else { return true }
        if allowsUserEditing { return await flush() }
        guard integrity != .preparing else { return false }
        let clean = !hasPendingChanges
        let copied = copiedDraft?.title == draftTitle && copiedDraft?.html == controller.html()
        guard clean || copied else { return false }
        if integrity == .ledgerFailed || integrity == .otherEditor { return clean }
        guard let pendingAttempt else { return false }
        return store.hasRetainedFence(noteID: noteID, attemptID: pendingAttempt.id) || store.wasReconciled(noteID: noteID, attemptID: pendingAttempt.id)
    }

    /// Explicit permanent exits release even when SwiftUI retains the model.
    /// Ordinary disappearance keeps its lease for a linked-note/tab return.
    func finishEditing(flushPendingChanges: Bool = true) async {
        if flushPendingChanges, allowsUserEditing { _ = await flush() }
        revokeEditingLease()
    }

    private func revokeEditingLease() {
        saveTask?.cancel()
        saveTask = nil
        controller.allowsUserEditing = false
        editingLease = nil
    }

    /// Called only after a successful pasteboard copy, not merely opening a
    /// share sheet. Retained conflicts stay read-only even after safe departure.
    func didCopyRetainedDraft() {
        guard !allowsUserEditing else { return }
        copiedDraft = (draftTitle, controller.html())
    }

    private func persist(allowPreparing: Bool = false) async -> Bool {
        // A departure must await an in-flight autosave, not mistake its
        // snapshot for a successful write. One writer drains newer edits too.
        while true {
            guard store.isCurrent(sessionEpoch), allowsUserEditing || (allowPreparing && ownsEditingLease && integrity == .preparing) else { return false }
            if let active = persistTask {
                let success = await active.task.value
                if persistTask?.id == active.id { persistTask = nil }
                guard store.isCurrent(sessionEpoch), success else { return false }
                continue
            }
            guard hasPendingChanges else { return true }
            let task = Task { @MainActor [weak self] in
                await self?.persistPendingChanges() ?? false
            }
            persistTask = (UUID(), task)
        }
    }

    private func persistPendingChanges() async -> Bool {
        defer { isSaving = false }
        while true {
            guard ownsEditingLease else { return false }
            let title = Self.normalizedTitle(draftTitle)
            let titleChanged = title != savedTitle
            let requestTitleRevision = titleRevision
            // A title can be saved before the body view attaches. Never send
            // that view's empty buffer over a body it has not received.
            let html = controller.hasLoadedDocument ? controller.html() : nil
            let bodyChanged = html.map { $0 != savedEditorHTML } ?? false
            guard titleChanged || bodyChanged else { return true }
            isSaving = true
            do {
                let updated: Note
                if bodyChanged, let html {
                    let plainText = NoteUtils.htmlToPlainText(html)
                    updated = try await api.saveNote(id: noteID, NoteSavePayload(
                        content: html,
                        htmlContent: html,
                        plainText: plainText,
                        wordCount: NoteUtils.countWords(plainText),
                        title: titleChanged ? title : nil
                    ))
                } else {
                    updated = try await api.patchNote(id: noteID, .title(title))
                }
                guard ownsEditingLease else { return false }
                // Advance only after the server accepted this snapshot. On a
                // failure both drafts survive and the next flush retries.
                writeRevision &+= 1
                if bodyChanged, let html {
                    savedHTML = html
                    savedEditorHTML = html
                }
                savedTitle = titleChanged ? title : Self.normalizedTitle(updated.title)
                if titleRevision == requestTitleRevision {
                    draftTitle = updated.title
                }
                note = updated
                store.upsert(updated, epoch: sessionEpoch)
                // A title may be accepted before the initial GET or before
                // the body view attaches. Its full response can seed that
                // body, while seedEditor's dirty guard preserves newer edits.
                if !bodyChanged { seedEditor(with: updated) }
                error = nil
            } catch {
                guard ownsEditingLease else { return false }
                self.error = (error as? APIError)?.message ?? "Changes could not be saved."
                return false
            }
        }
    }

    // MARK: - Metadata

    /// Title commits use the same awaited writer as body autosaves/departure.
    func rename(to title: String) async {
        setDraftTitle(title)
        _ = await flush()
    }

    /// Optimistic, rolling back to the pre-change note when the server rejects
    /// the write — the same shape as every mutation in the Android hook.
    func togglePin() async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        let previous = note
        let next = !(note?.isPinned ?? false)
        note?.isPinned = next
        store.patch(id: noteID, epoch: sessionEpoch) { $0.isPinned = next }
        do {
            _ = try await api.patchNote(id: noteID, .pinned(next))
            guard ownsEditingLease, generation == canonicalGeneration else { return }
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            note = previous
            if let previous { store.upsert(previous, epoch: sessionEpoch) }
            self.error = (error as? APIError)?.message ?? "The pin could not be saved."
        }
    }

    func move(toFolder folderID: String?) async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        let previous = note
        note?.folderId = folderID
        store.patch(id: noteID, epoch: sessionEpoch) { $0.folderId = folderID }
        do {
            _ = try await api.patchNote(id: noteID, .folder(folderID))
            guard ownsEditingLease, generation == canonicalGeneration else { return }
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            note = previous
            if let previous { store.upsert(previous, epoch: sessionEpoch) }
            self.error = (error as? APIError)?.message ?? "The move could not be saved."
        }
    }

    func toggleTag(id tagID: String) async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        let previous = note
        var tagIDs = note?.tagIds ?? []
        if let index = tagIDs.firstIndex(of: tagID) {
            tagIDs.remove(at: index)
        } else {
            tagIDs.append(tagID)
        }
        note?.tagIds = tagIDs
        store.patch(id: noteID, epoch: sessionEpoch) { $0.tagIds = tagIDs }
        do {
            try await api.toggleTag(noteId: noteID, tagId: tagID)
            guard ownsEditingLease, generation == canonicalGeneration else { return }
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            note = previous
            if let previous { store.upsert(previous, epoch: sessionEpoch) }
            self.error = (error as? APIError)?.message ?? "The tag could not be saved."
        }
    }

    // MARK: - Aliases, properties, links

    /// Port of `setAliases` in `useNoteEditorData.ts`: optimistic, rolled back
    /// on a rejected PATCH. The caller normalizes (`NotePropertyEditing.normalizeAliases`).
    func setAliases(_ aliases: [String]) async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        let previous = note
        note?.aliases = aliases
        store.patch(id: noteID, epoch: sessionEpoch) { $0.aliases = aliases }
        do {
            _ = try await api.patchNote(id: noteID, .aliases(aliases))
            guard ownsEditingLease, generation == canonicalGeneration else { return }
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            note = previous
            if let previous { store.upsert(previous, epoch: sessionEpoch) }
            self.error = (error as? APIError)?.message ?? "The aliases could not be saved."
        }
    }

    /// Writes the whole object, as Android does, so removing a key is just a
    /// write without it.
    func setProperties(_ properties: NoteProperties) async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        let previous = note
        note?.properties = properties
        store.patch(id: noteID, epoch: sessionEpoch) { $0.properties = properties }
        do {
            _ = try await api.patchNote(id: noteID, .properties(properties))
            guard ownsEditingLease, generation == canonicalGeneration else { return }
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            note = previous
            if let previous { store.upsert(previous, epoch: sessionEpoch) }
            self.error = (error as? APIError)?.message ?? "The properties could not be saved."
        }
    }

    private(set) var links: NoteLinks?
    private(set) var isLoadingLinks = false
    private(set) var linksError: String?

    /// The graph is rebuilt server-side from the *saved* text, so flush first:
    /// an unsaved `[[link]]` would otherwise be missing from the panel that is
    /// meant to show it (Android's `openInfo` does the same).
    func loadLinks() async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        guard await flush() else { return }
        isLoadingLinks = true
        linksError = nil
        defer { isLoadingLinks = false }
        do {
            let loaded = try await api.links(noteId: noteID)
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            links = loaded
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            linksError = (error as? APIError)?.message ?? "Could not load links."
        }
    }

    /// Fill in an unresolved `[[wikilink]]`: the new note lands in this note's
    /// folder so a linked pair stays filed together, and the server resolves
    /// the pending link the moment the title exists (`resolvePendingLinks`).
    /// Returns the new note's id, or nil when the create failed.
    func createLinkedNote(title: String) async -> String? {
        guard allowsUserEditing else { return nil }
        let generation = canonicalGeneration
        do {
            let created = try await api.createNote(title: title, folderId: note?.folderId)
            guard ownsEditingLease, generation == canonicalGeneration else { return nil }
            store.upsert(created, epoch: sessionEpoch)
            return created.id
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return nil }
            self.error = (error as? APIError)?.message ?? "The note could not be created."
            return nil
        }
    }

    func createTag(name: String, color: String) async {
        guard allowsUserEditing else { return }
        let generation = canonicalGeneration
        do {
            let tag = try await api.createTag(name: name, color: color)
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            store.addTag(tag, epoch: sessionEpoch)
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return }
            self.error = (error as? APIError)?.message ?? "The tag could not be created."
        }
    }

    @discardableResult
    func delete() async -> Bool {
        guard allowsUserEditing else { return false }
        let generation = canonicalGeneration
        do {
            try await api.deleteNote(id: noteID)
            guard ownsEditingLease, generation == canonicalGeneration else { return false }
            // Accepted deletion is terminal for this editor. Revoke before
            // the row disappears so late autosave responses cannot reinsert it.
            revokeEditingLease()
            canonicalGeneration &+= 1
            store.removeNote(id: noteID, epoch: sessionEpoch)
            return true
        } catch {
            guard ownsEditingLease, generation == canonicalGeneration else { return false }
            self.error = (error as? APIError)?.message ?? "The note could not be deleted."
            return false
        }
    }

    // MARK: - AI integrity

    static let uncertainNotice = "Your AI request may still be finishing. Editing is paused to protect this note. Check again, or copy/share your retained draft as Markdown from the note menu."
    static let refreshNotice = "The AI may have changed this note, but its saved copy could not be loaded. Editing is paused. Check again, or copy/share your retained draft as Markdown."

    func prepareForAI(_ attempt: NotesStore.AIAttempt) async -> Bool {
        guard allowsUserEditing, pendingAttempt == nil else { return false }
        setIntegrity(.preparing, "Saving your note before asking AI…")
        saveTask?.cancel()
        let saved = await persist(allowPreparing: true)
        guard store.isCurrent(sessionEpoch) else { return false }
        guard saved else { setIntegrity(.editable); return false }
        guard store.recordAttempt(attempt, noteID: noteID, epoch: sessionEpoch) else {
            setIntegrity(.editable)
            error = "The request's safety status could not be saved. Your note is unchanged; try again."
            return false
        }
        pendingAttempt = attempt
        setIntegrity(.running, "AI is working with your saved note. Editing will resume after it is checked.")
        return true
    }

    func noteAIResponseStarted(attemptID: String, responseID: String) {
        guard store.isCurrent(sessionEpoch), pendingAttempt?.id == attemptID, !responseID.isEmpty else { return }
        pendingAttempt?.responseMessageID = responseID
        _ = store.recordAttempt(pendingAttempt, noteID: noteID, epoch: sessionEpoch, expectedAttemptID: attemptID)
    }

    /// Called synchronously by the stream consumer, before spawning/awaiting any GET.
    func noteDidChangeFromAI() {
        guard store.isCurrent(sessionEpoch) else { return }
        canonicalGeneration &+= 1
        if pendingAttempt == nil {
            // Explicit canonical refresh callers outside a live AI attempt.
            setIntegrity(.refreshing, "Checking the saved note…")
        }
        requestCanonicalWorker()
    }

    func noteAIFinished(attemptID: String, terminal: Bool) async -> Bool {
        guard store.isCurrent(sessionEpoch), let attempt = pendingAttempt, attempt.id == attemptID else { return false }
        if attempt.operationProtocol == .operationReceipt {
            // SSE completion and HTTP errors are presentation events, not proof
            // that every server write has stopped. Read or cancel the server
            // operation before adopting a baseline that manual edits can PATCH.
            guard await settleOperation(attempt, cancel: !terminal) else { return false }
        } else {
            guard terminal else {
                setIntegrity(.ambiguous, Self.uncertainNotice)
                return false
            }
            pendingAttempt?.terminal = true
            _ = store.recordAttempt(pendingAttempt, noteID: noteID, epoch: sessionEpoch, expectedAttemptID: attemptID)
        }
        canonicalGeneration &+= 1
        setIntegrity(.refreshing, "Checking the saved note…")
        requestCanonicalWorker()
        return await canonicalTask?.value ?? allowsUserEditing
    }

    /// Check fences an operation before loading the canonical note. It never
    /// resubmits AI or treats assistant history as proof for this protocol.
    /// Legacy ledgers retain their conservative exact-history recovery.
    @discardableResult
    func retryCanonicalCheck() async -> Bool {
        guard store.isCurrent(sessionEpoch), ownsEditingLease, integrity != .preparing else { return false }
        if integrity == .ledgerFailed {
            guard store.recheckRecoveryLedger() else {
                setIntegrity(.ledgerFailed, store.recoveryLedgerError)
                return false
            }
            pendingAttempt = store.pendingAttempt(noteID: noteID)
        }
        // A released owner's late callback may settle the durable attempt
        // after this editor opened. Adopt that same attempt's terminal status,
        // while keeping canonical adoption with this editor's newer lease.
        if let recorded = store.pendingAttempt(noteID: noteID),
           recorded.id == pendingAttempt?.id, recorded.terminal {
            pendingAttempt = recorded
        }
        if let attempt = pendingAttempt, store.wasReconciled(noteID: noteID, attemptID: attempt.id) {
            pendingAttempt?.terminal = true
        }
        if var attempt = pendingAttempt, !attempt.terminal {
            if attempt.operationProtocol == .operationReceipt {
                guard await settleOperation(attempt, cancel: true) else { return false }
            } else {
                guard let responseID = attempt.responseMessageID else {
                    setIntegrity(.ambiguous, Self.uncertainNotice)
                    return false
                }
                do {
                    let history = try await api.aiMessages(noteId: noteID)
                    guard store.isCurrent(sessionEpoch), pendingAttempt?.id == attempt.id else { return false }
                    guard history.contains(where: { $0.id == responseID && $0.role == .assistant }) else {
                        setIntegrity(.ambiguous, Self.uncertainNotice)
                        return false
                    }
                    attempt.terminal = true
                    pendingAttempt = attempt
                    _ = store.recordAttempt(attempt, noteID: noteID, epoch: sessionEpoch, expectedAttemptID: attempt.id)
                } catch {
                    guard store.isCurrent(sessionEpoch) else { return false }
                    setIntegrity(.ambiguous, Self.uncertainNotice)
                    return false
                }
            }
        }
        guard integrity != .conflict else { return false }
        canonicalGeneration &+= 1
        setIntegrity(.refreshing, "Checking the saved note…")
        requestCanonicalWorker()
        return await canonicalTask?.value ?? allowsUserEditing
    }

    private func settleOperation(_ attempt: NotesStore.AIAttempt, cancel: Bool) async -> Bool {
        setIntegrity(.refreshing, "Checking the AI request's safety status…")
        do {
            let receipt: NoteAIOperation
            if cancel {
                receipt = try await api.cancelAIOperation(id: attempt.id, noteId: noteID)
            } else {
                receipt = try await api.aiOperation(id: attempt.id, noteId: noteID)
            }
            guard store.isCurrent(sessionEpoch), pendingAttempt?.id == attempt.id else { return false }
            guard receipt.isTerminal else {
                setIntegrity(.ambiguous, Self.uncertainNotice)
                return false
            }
            var settled = pendingAttempt ?? attempt
            settled.terminal = true
            guard store.recordAttempt(settled, noteID: noteID, epoch: sessionEpoch, expectedAttemptID: attempt.id) else {
                setIntegrity(.failed, Self.refreshNotice)
                return false
            }
            // Invalidate reads that began before the server write fence. Do
            // this before returning across an async boundary: an existing GET
            // must not see terminal=true and unlock with its older snapshot.
            canonicalGeneration &+= 1
            pendingAttempt = settled
            return true
        } catch {
            guard store.isCurrent(sessionEpoch), pendingAttempt?.id == attempt.id else { return false }
            setIntegrity(.ambiguous, Self.uncertainNotice)
            return false
        }
    }

    /// Kept for existing callers/tests; production receipts mark the fence
    /// synchronously via noteDidChangeFromAI rather than spawning competing GETs.
    func reloadAfterAIAppend() async {
        noteDidChangeFromAI()
        _ = await canonicalTask?.value
    }

    private func requestCanonicalWorker() {
        guard canonicalTask == nil, canAdoptCanonical else { return }
        canonicalTask = Task { [weak self] in
            guard let self else { return false }
            let result = await refreshCanonicalLoop()
            canonicalTask = nil
            return result
        }
    }

    private var canonicalAttemptIsCurrent: Bool {
        let current = store.pendingAttempt(noteID: noteID)
        if let pendingAttempt {
            return current?.id == pendingAttempt.id || (current == nil && store.wasReconciled(noteID: noteID, attemptID: pendingAttempt.id))
        }
        return current == nil
    }

    private func refreshCanonicalLoop() async -> Bool {
        while canAdoptCanonical {
            let generation = canonicalGeneration
            let requestWriteRevision = writeRevision
            do {
                let fresh = try await api.note(id: noteID)
                guard canAdoptCanonical else { return false }
                if generation != canonicalGeneration { continue }
                if let active = persistTask { _ = await active.task.value }
                guard canAdoptCanonical else { return false }
                if generation != canonicalGeneration { continue }
                guard canonicalAttemptIsCurrent else {
                    setIntegrity(.ambiguous, Self.uncertainNotice)
                    return false
                }
                guard writeRevision == requestWriteRevision,
                      Self.normalizedTitle(draftTitle) == savedTitle,
                      !controller.hasLoadedDocument || controller.html() == savedEditorHTML
                else {
                    remoteConflict = fresh
                    setIntegrity(.conflict, "Your retained draft differs from the AI's saved note. Editing is paused; copy your draft as Markdown to leave safely. The saved note is unchanged by copying.")
                    return false
                }
                note = fresh
                draftTitle = fresh.title
                savedTitle = Self.normalizedTitle(fresh.title)
                seedEditor(with: fresh)
                store.upsert(fresh, epoch: sessionEpoch)
                guard pendingAttempt == nil || pendingAttempt?.terminal == true else {
                    // A later server write is still possible until the attempt ends.
                    return false
                }
                let alreadyReconciled = pendingAttempt.map { store.wasReconciled(noteID: noteID, attemptID: $0.id) } ?? false
                guard alreadyReconciled || store.recordAttempt(nil, noteID: noteID, epoch: sessionEpoch, expectedAttemptID: pendingAttempt?.id) else {
                    setIntegrity(.failed, Self.refreshNotice)
                    return false
                }
                pendingAttempt = nil
                error = nil
                setIntegrity(.editable)
                return true
            } catch {
                guard canAdoptCanonical else { return false }
                if generation != canonicalGeneration { continue }
                setIntegrity(.failed, Self.refreshNotice)
                return false
            }
        }
        return false
    }
}
