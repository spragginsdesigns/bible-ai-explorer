import Foundation

/// Sort orders the notes list offers — a port of `NoteSort` in
/// `mobile/src/features/notes/useNotesLibrary.ts`.
enum NoteSort: String, CaseIterable, Sendable, Identifiable {
    case updatedAt, createdAt, title

    var id: String { rawValue }

    var label: String {
        switch self {
        case .updatedAt: "Modified"
        case .createdAt: "Created"
        case .title: "Title"
        }
    }

    /// The Android list cycles through the orders with one tap; the Mac list
    /// offers them as a menu, but the order has to match so the two agree on
    /// what "next" means.
    var next: NoteSort {
        let all = Self.allCases
        let index = all.firstIndex(of: self) ?? 0
        return all[(index + 1) % all.count]
    }
}

/// List-screen data layer: notes, folders and tags with local filtering and the
/// pinned-first sort the web `useNotes` hook applies. Port of
/// `mobile/src/features/notes/useNotesLibrary.ts`.
///
/// Everything lives in the shared `NotesStore`, so the list renders the cached
/// snapshot immediately and every fetch is a silent background revalidation —
/// only an explicit refresh shows a spinner.
@MainActor
@Observable
final class NotesLibraryModel {
    private let api: NotesAPI
    private let store: NotesStore
    private let sessionEpoch: UUID
    private var loadGeneration = 0

    private(set) var hasLoaded = false
    private(set) var isRefreshing = false
    private(set) var error: String?

    var searchQuery = ""
    var activeFolderID: String?
    var activeTagID: String?
    var sortBy: NoteSort = .updatedAt

    /// The note open in the editor pane. macOS shows list and editor side by
    /// side, where Android pushes a screen — same states, one window.
    var selectedNoteID: String?

    init(api: NotesAPI, store: NotesStore = .shared) {
        self.api = api
        self.store = store
        self.sessionEpoch = store.epoch
    }

    // MARK: Derived

    var folders: [Folder] { store.isCurrent(sessionEpoch) ? store.folders : [] }
    var tags: [Tag] { store.isCurrent(sessionEpoch) ? store.tags : [] }
    var totalNotes: Int { store.isCurrent(sessionEpoch) ? store.notes.count : 0 }

    /// With a hydrated cache there is something to show at once; the spinner is
    /// reserved for a first-ever load with nothing cached.
    var isLoading: Bool {
        !store.isHydrated || (!hasLoaded && store.notes.isEmpty)
    }

    var notes: [Note] {
        guard store.isCurrent(sessionEpoch) else { return [] }
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = store.notes.filter { note in
            if let activeFolderID, note.folderId != activeFolderID { return false }
            if let activeTagID, !note.tagIds.contains(activeTagID) { return false }
            if query.isEmpty { return true }
            return note.title.lowercased().contains(query)
                || note.plainText.lowercased().contains(query)
        }

        return filtered.sorted { lhs, rhs in
            if lhs.isPinned != rhs.isPinned { return lhs.isPinned }
            switch sortBy {
            case .createdAt:
                return date(lhs.createdAt) > date(rhs.createdAt)
            case .title:
                return lhs.title.localizedCompare(rhs.title) == .orderedAscending
            case .updatedAt:
                return date(lhs.updatedAt) > date(rhs.updatedAt)
            }
        }
    }

    private func date(_ iso: String) -> Date {
        NoteUtils.parseISO(iso) ?? .distantPast
    }

    // MARK: Loading

    enum LoadMode { case initial, refresh, silent }

    func load(_ mode: LoadMode = .silent) async {
        guard store.isCurrent(sessionEpoch) else { return }
        loadGeneration += 1
        let generation = loadGeneration
        if mode == .refresh { isRefreshing = true }
        defer {
            if store.isCurrent(sessionEpoch), generation == loadGeneration {
                hasLoaded = true
                isRefreshing = false
            }
        }
        do {
            async let notes = api.notes()
            async let folders = api.folders()
            async let tags = api.tags()
            let snapshot = try await (notes, folders, tags)
            guard store.isCurrent(sessionEpoch), generation == loadGeneration else { return }
            store.applyServerSnapshot(notes: snapshot.0, folders: snapshot.1, tags: snapshot.2, epoch: sessionEpoch)
            error = nil
        } catch {
            guard store.isCurrent(sessionEpoch), generation == loadGeneration else { return }
            self.error = (error as? APIError)?.message ?? "Could not load your notes."
        }
    }

    func start() async {
        await store.hydrate()
        guard store.isCurrent(sessionEpoch) else { return }
        await load(.initial)
    }

    func refresh() async { await load(.refresh) }

    // MARK: Notes

    /// "Start a note" with a template (PRD E1), Android's
    /// `CreateItemSheet.pickTemplate`: the sermon template asks `/api/church`
    /// for the saved church's name first (an unavailable Places key just
    /// leaves it out), Blank creates the ordinary Untitled Note. Throws so the
    /// sheet can show Android's "could not finish" message and stay open.
    func createNote(template: NoteTemplates.ID, church: (() async throws -> String?)? = nil) async throws -> Note {
        guard store.isCurrent(sessionEpoch) else { throw APIError(message: "The account changed. Reopen Notes.") }
        var churchName: String?
        if template == .sermon, let church {
            churchName = try await church()
            guard store.isCurrent(sessionEpoch) else { throw APIError(message: "The account changed. Reopen Notes.") }
        }
        let note: Note
        if let seed = NoteTemplates.build(template, churchName: churchName) {
            note = try await api.createNote(folderId: activeFolderID, seed: seed)
        } else {
            note = try await api.createNote(title: "Untitled Note", folderId: activeFolderID)
        }
        guard store.isCurrent(sessionEpoch) else { throw APIError(message: "The account changed. Reopen Notes.") }
        store.upsert(note, epoch: sessionEpoch)
        selectedNoteID = note.id
        error = nil
        return note
    }

    func deleteNote(id: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        guard store.canMutateUnopenedNote(noteID: id, epoch: sessionEpoch) else {
            error = "This note is open or waiting for an AI safety check. Use its editor, or close it after the check finishes."
            return
        }
        store.removeNote(id: id, epoch: sessionEpoch)
        if selectedNoteID == id { selectedNoteID = nil }
        do {
            try await api.deleteNote(id: id)
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            // The row is already gone locally; resync rather than resurrect it
            // from a stale copy.
            await load(.silent)
        }
    }

    func togglePin(id: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        guard store.canMutateUnopenedNote(noteID: id, epoch: sessionEpoch) else {
            error = "This note is open or waiting for an AI safety check. Use its editor, or close it after the check finishes."
            return
        }
        guard let note = store.cachedNote(id: id) else { return }
        let isPinned = !note.isPinned
        store.patch(id: id, epoch: sessionEpoch) { $0.isPinned = isPinned }
        do {
            _ = try await api.patchNote(id: id, .pinned(isPinned))
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            store.patch(id: id, epoch: sessionEpoch) { $0.isPinned = note.isPinned }
        }
    }

    func move(id: String, toFolder folderID: String?) async {
        guard store.isCurrent(sessionEpoch) else { return }
        guard store.canMutateUnopenedNote(noteID: id, epoch: sessionEpoch) else {
            error = "This note is open or waiting for an AI safety check. Use its editor, or close it after the check finishes."
            return
        }
        guard let note = store.cachedNote(id: id) else { return }
        store.patch(id: id, epoch: sessionEpoch) { $0.folderId = folderID }
        do {
            _ = try await api.patchNote(id: id, .folder(folderID))
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            store.patch(id: id, epoch: sessionEpoch) { $0.folderId = note.folderId }
        }
    }

    // MARK: Folders

    func createFolder(name: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        do {
            let accepted = try await api.createFolder(name: name)
            guard store.isCurrent(sessionEpoch) else { return }
            store.addFolder(accepted, epoch: sessionEpoch)
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            self.error = (error as? APIError)?.message ?? "The folder could not be created."
        }
    }

    func renameFolder(id: String, name: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        do {
            let accepted = try await api.renameFolder(id: id, name: name)
            guard store.isCurrent(sessionEpoch) else { return }
            store.renameFolder(accepted, epoch: sessionEpoch)
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            self.error = (error as? APIError)?.message ?? "The folder could not be renamed."
        }
    }

    func deleteFolder(id: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        store.removeFolder(id: id, epoch: sessionEpoch)
        if activeFolderID == id { activeFolderID = nil }
        do {
            try await api.deleteFolder(id: id)
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            await load(.silent)
        }
    }

    // MARK: Tags

    func createTag(name: String, color: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        do {
            let accepted = try await api.createTag(name: name, color: color)
            guard store.isCurrent(sessionEpoch) else { return }
            store.addTag(accepted, epoch: sessionEpoch)
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            self.error = (error as? APIError)?.message ?? "The tag could not be created."
        }
    }

    func deleteTag(id: String) async {
        guard store.isCurrent(sessionEpoch) else { return }
        store.removeTag(id: id, epoch: sessionEpoch)
        if activeTagID == id { activeTagID = nil }
        do {
            try await api.deleteTag(id: id)
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            guard store.isCurrent(sessionEpoch) else { return }
            await load(.silent)
        }
    }
}
