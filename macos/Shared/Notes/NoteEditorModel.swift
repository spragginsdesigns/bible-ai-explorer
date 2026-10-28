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

    func start() {
        guard loadTask == nil else { return }
        loadTask = Task { [weak self] in
            guard let self else { return }
            let hydrationTitleRevision = titleRevision
            let hydrationWriteRevision = writeRevision
            await store.hydrate()

            if let cached = store.cachedNote(id: noteID), cached.hasBody {
                await applyFetchedNote(cached, titleRevision: hydrationTitleRevision, writeRevision: hydrationWriteRevision)
                isLoading = false
            }

            do {
                let requestTitleRevision = titleRevision
                let requestWriteRevision = writeRevision
                let loaded = try await api.note(id: noteID)
                await applyFetchedNote(loaded, titleRevision: requestTitleRevision, writeRevision: requestWriteRevision)
                if !hasPendingChanges { error = nil }
            } catch {
                self.error = (error as? APIError)?.message ?? "Could not open this note."
            }
            isLoading = false

            // Secondary data — failing here must not block editing.
            if let tags = try? await api.tags(), let folders = try? await api.folders() {
                store.applyFoldersAndTags(folders: folders, tags: tags)
            }
        }
    }

    private static func normalizedTitle(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled Note" : trimmed
    }

    func setDraftTitle(_ title: String) {
        guard draftTitle != title else { return }
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
        if let active = persistTask { _ = await active.task.value }
        // A GET started before an accepted write must not reinstall its older
        // title/body in either the editor or the shared library cache.
        guard writeRevision == requestedWriteRevision else { return }
        let titleWasClean = Self.normalizedTitle(draftTitle) == savedTitle
        savedTitle = Self.normalizedTitle(loaded.title)
        if titleRevision == requestedTitleRevision, titleWasClean {
            draftTitle = loaded.title
        }
        note = loaded
        store.upsert(loaded)
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
        return await persist()
    }

    private func persist() async -> Bool {
        // A departure must await an in-flight autosave, not mistake its
        // snapshot for a successful write. One writer drains newer edits too.
        while true {
            if let active = persistTask {
                let success = await active.task.value
                if persistTask?.id == active.id { persistTask = nil }
                guard success else { return false }
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
                store.upsert(updated)
                // A title may be accepted before the initial GET or before
                // the body view attaches. Its full response can seed that
                // body, while seedEditor's dirty guard preserves newer edits.
                if !bodyChanged { seedEditor(with: updated) }
                error = nil
            } catch {
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
        let previous = note
        let next = !(note?.isPinned ?? false)
        note?.isPinned = next
        store.patch(id: noteID) { $0.isPinned = next }
        do {
            _ = try await api.patchNote(id: noteID, .pinned(next))
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
            self.error = (error as? APIError)?.message ?? "The pin could not be saved."
        }
    }

    func move(toFolder folderID: String?) async {
        let previous = note
        note?.folderId = folderID
        store.patch(id: noteID) { $0.folderId = folderID }
        do {
            _ = try await api.patchNote(id: noteID, .folder(folderID))
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
            self.error = (error as? APIError)?.message ?? "The move could not be saved."
        }
    }

    func toggleTag(id tagID: String) async {
        let previous = note
        var tagIDs = note?.tagIds ?? []
        if let index = tagIDs.firstIndex(of: tagID) {
            tagIDs.remove(at: index)
        } else {
            tagIDs.append(tagID)
        }
        note?.tagIds = tagIDs
        store.patch(id: noteID) { $0.tagIds = tagIDs }
        do {
            try await api.toggleTag(noteId: noteID, tagId: tagID)
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
            self.error = (error as? APIError)?.message ?? "The tag could not be saved."
        }
    }

    // MARK: - Aliases, properties, links

    /// Port of `setAliases` in `useNoteEditorData.ts`: optimistic, rolled back
    /// on a rejected PATCH. The caller normalizes (`NotePropertyEditing.normalizeAliases`).
    func setAliases(_ aliases: [String]) async {
        let previous = note
        note?.aliases = aliases
        store.patch(id: noteID) { $0.aliases = aliases }
        do {
            _ = try await api.patchNote(id: noteID, .aliases(aliases))
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
            self.error = (error as? APIError)?.message ?? "The aliases could not be saved."
        }
    }

    /// Writes the whole object, as Android does, so removing a key is just a
    /// write without it.
    func setProperties(_ properties: NoteProperties) async {
        let previous = note
        note?.properties = properties
        store.patch(id: noteID) { $0.properties = properties }
        do {
            _ = try await api.patchNote(id: noteID, .properties(properties))
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
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
        guard await flush() else { return }
        isLoadingLinks = true
        linksError = nil
        defer { isLoadingLinks = false }
        do {
            links = try await api.links(noteId: noteID)
        } catch {
            linksError = (error as? APIError)?.message ?? "Could not load links."
        }
    }

    /// Fill in an unresolved `[[wikilink]]`: the new note lands in this note's
    /// folder so a linked pair stays filed together, and the server resolves
    /// the pending link the moment the title exists (`resolvePendingLinks`).
    /// Returns the new note's id, or nil when the create failed.
    func createLinkedNote(title: String) async -> String? {
        do {
            let created = try await api.createNote(title: title, folderId: note?.folderId)
            store.upsert(created)
            return created.id
        } catch {
            self.error = (error as? APIError)?.message ?? "The note could not be created."
            return nil
        }
    }

    func createTag(name: String, color: String) async {
        do {
            store.addTag(try await api.createTag(name: name, color: color))
        } catch {
            self.error = (error as? APIError)?.message ?? "The tag could not be created."
        }
    }

    @discardableResult
    func delete() async -> Bool {
        do {
            try await api.deleteNote(id: noteID)
            store.removeNote(id: noteID)
            return true
        } catch {
            self.error = (error as? APIError)?.message ?? "The note could not be deleted."
            return false
        }
    }

    // MARK: - AI appends

    /// Pull the server's copy after the assistant appended to this note and
    /// re-seed the open editor with it. Re-fetching rather than splicing the
    /// returned HTML in locally is deliberate: the server has already merged the
    /// append into the stored document, and that merged copy is the truth.
    func reloadAfterAIAppend() async {
        do {
            let requestTitleRevision = titleRevision
            let requestWriteRevision = writeRevision
            let fresh = try await api.note(id: noteID)
            await applyFetchedNote(fresh, titleRevision: requestTitleRevision, writeRevision: requestWriteRevision)
        } catch {
            // Leave the editor as it stands; the next save still wins.
        }
    }
}
