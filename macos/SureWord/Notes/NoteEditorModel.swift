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

    let controller = NoteRichTextController()

    private(set) var note: Note?
    private(set) var isLoading = true
    private(set) var isSaving = false
    private(set) var error: String?

    private let api: NotesAPI
    private let store: NotesStore
    private let noteID: String

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    /// The HTML last written to the server, so an unchanged document never
    /// costs a PATCH.
    @ObservationIgnored private var savedHTML = ""

    init(noteID: String, api: NotesAPI, store: NotesStore = .shared) {
        self.noteID = noteID
        self.api = api
        self.store = store

        let cached = store.cachedNote(id: noteID)
        note = cached
        // A cached summary row can fill the title bar, but the editor waits for
        // the real body — seeding an empty document over a note that has
        // content would autosave that emptiness straight back.
        isLoading = !(cached?.hasBody ?? false)

        controller.onChange = { [weak self] in
            self?.scheduleSave()
        }
    }

    // MARK: - Loading

    func start() {
        guard loadTask == nil else { return }
        loadTask = Task { [weak self] in
            guard let self else { return }
            await store.hydrate()

            if let cached = store.cachedNote(id: noteID), cached.hasBody {
                note = cached
                seedEditor(with: cached)
                isLoading = false
            }

            do {
                let loaded = try await api.note(id: noteID)
                note = loaded
                store.upsert(loaded)
                seedEditor(with: loaded)
                error = nil
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

    private func seedEditor(with note: Note) {
        let html = NoteUtils.initialHTML(for: note)
        guard html != savedHTML || savedHTML.isEmpty else { return }
        savedHTML = html
        controller.load(html: html)
    }

    // MARK: - Autosave

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: NoteEditorModel.autosaveDelay)
            guard !Task.isCancelled else { return }
            await self?.persist()
        }
    }

    /// Cancel the pending debounce and write immediately — used when the pane
    /// closes, when another note is selected, and before opening the AI panel
    /// so the assistant reads the current text rather than the last autosave.
    func flush() async {
        saveTask?.cancel()
        saveTask = nil
        await persist()
    }

    private func persist() async {
        let html = controller.html()
        guard html != savedHTML else { return }
        savedHTML = html

        let plainText = NoteUtils.htmlToPlainText(html)
        let payload = NoteSavePayload(
            // `content` and `htmlContent` both get the HTML, exactly as the
            // Android client saves it: the web's Tiptap falls back to parsing
            // `content` as HTML when it is not JSON, and rewrites it to JSON on
            // the next edit there.
            content: html,
            htmlContent: html,
            plainText: plainText,
            wordCount: NoteUtils.countWords(plainText)
        )

        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await api.saveNote(id: noteID, payload)
            note = updated
            store.upsert(updated)
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? "Changes could not be saved."
            // Let the next edit try again rather than pretending it stuck.
            savedHTML = ""
        }
    }

    // MARK: - Metadata

    /// Optimistic, rolling back to the pre-change note when the server rejects
    /// the write — the same shape as every mutation in the Android hook.
    func rename(to title: String) async {
        let previous = note
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = trimmed.isEmpty ? "Untitled Note" : trimmed
        note?.title = next
        store.patch(id: noteID) { $0.title = next }
        do {
            _ = try await api.patchNote(id: noteID, .title(next))
        } catch {
            note = previous
            if let previous { store.upsert(previous) }
            self.error = (error as? APIError)?.message ?? "The title could not be saved."
        }
    }

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

    func createTag(name: String, color: String) async {
        do {
            store.addTag(try await api.createTag(name: name, color: color))
        } catch {
            self.error = (error as? APIError)?.message ?? "The tag could not be created."
        }
    }

    func delete() async {
        do {
            try await api.deleteNote(id: noteID)
            store.removeNote(id: noteID)
        } catch {
            self.error = (error as? APIError)?.message ?? "The note could not be deleted."
        }
    }

    // MARK: - AI appends

    /// Pull the server's copy after the assistant appended to this note and
    /// re-seed the open editor with it. Re-fetching rather than splicing the
    /// returned HTML in locally is deliberate: the server has already merged the
    /// append into the stored document, and that merged copy is the truth.
    func reloadAfterAIAppend() async {
        do {
            let fresh = try await api.note(id: noteID)
            note = fresh
            store.upsert(fresh)
            let html = NoteUtils.initialHTML(for: fresh)
            savedHTML = html
            saveTask?.cancel()
            saveTask = nil
            controller.load(html: html)
        } catch {
            // Leave the editor as it stands; the next save still wins.
        }
    }
}
