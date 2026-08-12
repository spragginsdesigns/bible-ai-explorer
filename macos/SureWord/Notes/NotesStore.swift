import Foundation

/// Shared, persisted cache for the notes library — a port of
/// `mobile/src/features/notes/notesStore.ts`.
///
/// Both the list and the editor read and write through this one object, so:
///
/// - the list renders the last snapshot instantly and revalidates silently;
/// - opening a note whose body has been seen before shows no spinner;
/// - an edit in the editor is visible in the list immediately.
///
/// List fetches return summary rows with no body. Bodies are merged in from
/// single-note fetches and saves, and `hasBody` marks the entries whose body
/// fields are real rather than summary placeholders.
@MainActor
@Observable
final class NotesStore {
    /// The app-wide instance. A single cache is the point: two would let the
    /// list and the editor disagree about the same note.
    static let shared = NotesStore(cacheURL: NotesStore.defaultCacheURL)

    private(set) var notes: [Note] = []
    private(set) var folders: [Folder] = []
    private(set) var tags: [Tag] = []
    /// True once the persisted cache has been read, or found absent.
    private(set) var isHydrated = false

    @ObservationIgnored private let cacheURL: URL?
    @ObservationIgnored private var hydrateTask: Task<Void, Never>?

    /// `cacheURL: nil` keeps the store entirely in memory, which is what the
    /// unit tests use.
    init(cacheURL: URL?) {
        self.cacheURL = cacheURL
    }

    // MARK: - Persistence

    private struct Payload: Codable {
        var notes: [Note]
        var folders: [Folder]
        var tags: [Tag]
    }

    static var defaultCacheURL: URL? {
        guard
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        let directory = base.appendingPathComponent("SureWord", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("notes-cache.v1.json")
    }

    /// Read the persisted cache exactly once per app run.
    func hydrate() async {
        if let hydrateTask {
            await hydrateTask.value
            return
        }
        let task = Task { @MainActor in
            defer { isHydrated = true }
            guard let cacheURL, let data = try? Data(contentsOf: cacheURL) else { return }
            guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
                // A corrupt cache must not block a network load.
                return
            }
            notes = payload.notes
            folders = payload.folders
            tags = payload.tags
        }
        hydrateTask = task
        await task.value
    }

    private func persist() {
        guard let cacheURL else { return }
        let payload = Payload(notes: notes, folders: folders, tags: tags)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // A full or unwritable disk must never break the UI, so the failure is
        // swallowed rather than surfaced — the cache is an optimisation.
        try? data.write(to: cacheURL, options: .atomic)
    }

    // MARK: - Mutations

    /// Replace the cache with a server snapshot. List rows are summaries, so a
    /// cached body is carried over while the server row is unchanged
    /// (`updatedAt` bumps on every edit); a changed row drops the stale body so
    /// the editor refetches it.
    func applyServerSnapshot(notes serverNotes: [Note], folders: [Folder], tags: [Tag]) {
        let previous = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        self.notes = serverNotes.map { note in
            guard
                let prior = previous[note.id],
                prior.hasBody,
                !note.hasBody,
                prior.updatedAt == note.updatedAt
            else { return note }
            var merged = note
            merged.content = prior.content
            merged.htmlContent = prior.htmlContent
            merged.hasBody = true
            return merged
        }
        self.folders = folders
        self.tags = tags
        isHydrated = true
        persist()
    }

    /// Refresh folders and tags without touching the cached notes.
    func applyFoldersAndTags(folders: [Folder], tags: [Tag]) {
        self.folders = folders
        self.tags = tags
        persist()
    }

    func cachedNote(id: String) -> Note? {
        notes.first { $0.id == id }
    }

    func upsert(_ note: Note) {
        if let index = notes.firstIndex(where: { $0.id == note.id }) {
            notes[index] = note
        } else {
            notes.insert(note, at: 0)
        }
        persist()
    }

    func patch(id: String, _ change: (inout Note) -> Void) {
        guard let index = notes.firstIndex(where: { $0.id == id }) else { return }
        change(&notes[index])
        persist()
    }

    func removeNote(id: String) {
        notes.removeAll { $0.id == id }
        persist()
    }

    func addFolder(_ folder: Folder) {
        folders.append(folder)
        persist()
    }

    func renameFolder(_ folder: Folder) {
        if let index = folders.firstIndex(where: { $0.id == folder.id }) {
            folders[index] = folder
        }
        persist()
    }

    /// Deleting a folder unfiles its notes, matching what
    /// `DELETE /api/folders/{id}` does on the server.
    func removeFolder(id: String) {
        folders.removeAll { $0.id == id }
        for index in notes.indices where notes[index].folderId == id {
            notes[index].folderId = nil
        }
        persist()
    }

    func addTag(_ tag: Tag) {
        tags.append(tag)
        persist()
    }

    /// The join rows cascade on the server, so the local copies go too.
    func removeTag(id: String) {
        tags.removeAll { $0.id == id }
        for index in notes.indices where notes[index].tagIds.contains(id) {
            notes[index].tagIds.removeAll { $0 == id }
        }
        persist()
    }

    /// Test seam: drop everything without touching disk semantics.
    func reset() {
        notes = []
        folders = []
        tags = []
    }
}
