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
    }

    // MARK: Derived

    var folders: [Folder] { store.folders }
    var tags: [Tag] { store.tags }
    var totalNotes: Int { store.notes.count }

    /// With a hydrated cache there is something to show at once; the spinner is
    /// reserved for a first-ever load with nothing cached.
    var isLoading: Bool {
        !store.isHydrated || (!hasLoaded && store.notes.isEmpty)
    }

    var notes: [Note] {
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
        if mode == .refresh { isRefreshing = true }
        defer {
            hasLoaded = true
            isRefreshing = false
        }
        do {
            async let notes = api.notes()
            async let folders = api.folders()
            async let tags = api.tags()
            store.applyServerSnapshot(
                notes: try await notes,
                folders: try await folders,
                tags: try await tags
            )
            error = nil
        } catch {
            // Cached data stays on screen; the banner is the only signal.
            self.error = (error as? APIError)?.message ?? "Could not load your notes."
        }
    }

    func start() async {
        await store.hydrate()
        await load(.initial)
    }

    func refresh() async { await load(.refresh) }

    // MARK: Notes

    @discardableResult
    func createNote() async -> Note? {
        do {
            let note = try await api.createNote(title: "Untitled Note", folderId: activeFolderID)
            store.upsert(note)
            selectedNoteID = note.id
            error = nil
            return note
        } catch {
            self.error = (error as? APIError)?.message ?? "The note could not be created."
            return nil
        }
    }

    func deleteNote(id: String) async {
        store.removeNote(id: id)
        if selectedNoteID == id { selectedNoteID = nil }
        do {
            try await api.deleteNote(id: id)
        } catch {
            // The row is already gone locally; resync rather than resurrect it
            // from a stale copy.
            await load(.silent)
        }
    }

    func togglePin(id: String) async {
        guard let note = store.cachedNote(id: id) else { return }
        let isPinned = !note.isPinned
        store.patch(id: id) { $0.isPinned = isPinned }
        do {
            _ = try await api.patchNote(id: id, .pinned(isPinned))
        } catch {
            store.patch(id: id) { $0.isPinned = note.isPinned }
        }
    }

    func move(id: String, toFolder folderID: String?) async {
        guard let note = store.cachedNote(id: id) else { return }
        store.patch(id: id) { $0.folderId = folderID }
        do {
            _ = try await api.patchNote(id: id, .folder(folderID))
        } catch {
            store.patch(id: id) { $0.folderId = note.folderId }
        }
    }

    // MARK: Folders

    func createFolder(name: String) async {
        do {
            store.addFolder(try await api.createFolder(name: name))
        } catch {
            self.error = (error as? APIError)?.message ?? "The folder could not be created."
        }
    }

    func renameFolder(id: String, name: String) async {
        do {
            store.renameFolder(try await api.renameFolder(id: id, name: name))
        } catch {
            self.error = (error as? APIError)?.message ?? "The folder could not be renamed."
        }
    }

    func deleteFolder(id: String) async {
        store.removeFolder(id: id)
        if activeFolderID == id { activeFolderID = nil }
        do {
            try await api.deleteFolder(id: id)
        } catch {
            await load(.silent)
        }
    }

    // MARK: Tags

    func createTag(name: String, color: String) async {
        do {
            store.addTag(try await api.createTag(name: name, color: color))
        } catch {
            self.error = (error as? APIError)?.message ?? "The tag could not be created."
        }
    }

    func deleteTag(id: String) async {
        store.removeTag(id: id)
        if activeTagID == id { activeTagID = nil }
        do {
            try await api.deleteTag(id: id)
        } catch {
            await load(.silent)
        }
    }
}
