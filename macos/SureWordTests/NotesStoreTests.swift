import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/notes/notesStore.test.ts`.
///
/// `cacheURL: nil` keeps each store in memory, so these run without touching
/// Application Support — the TS suite mocks AsyncStorage for the same reason.
@Suite("Notes store")
@MainActor
struct NotesStoreTests {

    private func makeNote(
        _ id: String,
        title: String? = nil,
        htmlContent: String = "",
        hasBody: Bool = false,
        updatedAt: String = "2026-01-01T00:00:00.000Z",
        isPinned: Bool = false,
        folderId: String? = nil,
        tagIds: [String] = []
    ) -> Note {
        Note(
            id: id,
            content: "",
            htmlContent: htmlContent,
            title: title ?? "Note \(id)",
            plainText: "",
            folderId: folderId,
            tagIds: tagIds,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: updatedAt,
            isPinned: isPinned,
            wordCount: 0,
            hasBody: hasBody
        )
    }

    private func makeStore() -> NotesStore {
        NotesStore(cacheURL: nil)
    }

    // MARK: applyServerSnapshot

    @Test("Keeps the cached body when the server row is unchanged")
    func keepsCachedBody() {
        let store = makeStore()
        store.upsert(makeNote("a", htmlContent: "<p>body</p>", hasBody: true))

        // Summary rows omit the body fields.
        store.applyServerSnapshot(notes: [makeNote("a", title: "Renamed?")], folders: [], tags: [])

        #expect(store.cachedNote(id: "a")?.htmlContent == "<p>body</p>")
        #expect(store.cachedNote(id: "a")?.hasBody == true)
    }

    @Test("Drops a stale cached body when updatedAt moved on")
    func dropsStaleBody() {
        let store = makeStore()
        store.upsert(makeNote("a", htmlContent: "<p>old</p>", hasBody: true))

        store.applyServerSnapshot(
            notes: [makeNote("a", updatedAt: "2026-01-02T00:00:00.000Z")],
            folders: [],
            tags: []
        )

        #expect(store.cachedNote(id: "a")?.htmlContent == "")
        #expect(store.cachedNote(id: "a")?.hasBody == false)
    }

    @Test("Replaces folders and tags")
    func replacesFoldersAndTags() {
        let store = makeStore()
        let folder = Folder(id: "f1", name: "Study", parentId: nil)
        let tag = Tag(id: "t1", name: "Grace", color: "#fff")

        store.applyServerSnapshot(notes: [makeNote("b")], folders: [folder], tags: [tag])

        #expect(store.folders.map(\.id) == ["f1"])
        #expect(store.tags.map(\.id) == ["t1"])
        #expect(store.cachedNote(id: "b") != nil)
    }

    @Test("Refreshes folders and tags without touching the notes")
    func refreshesSecondaryData() {
        let store = makeStore()
        store.upsert(makeNote("a", htmlContent: "<p>body</p>", hasBody: true))
        store.applyFoldersAndTags(
            folders: [Folder(id: "f1", name: "Study", parentId: nil)],
            tags: [Tag(id: "t1", name: "Grace", color: "#fff")]
        )
        #expect(store.cachedNote(id: "a")?.htmlContent == "<p>body</p>")
        #expect(store.folders.count == 1)
    }

    // MARK: note mutations

    @Test("Upserts, patches and removes notes")
    func mutatesNotes() {
        let store = makeStore()
        store.upsert(makeNote("a"))
        store.upsert(makeNote("a", title: "Updated"))
        #expect(store.cachedNote(id: "a")?.title == "Updated")
        #expect(store.notes.count == 1)

        store.patch(id: "a") { $0.isPinned = true }
        #expect(store.cachedNote(id: "a")?.isPinned == true)

        store.removeNote(id: "a")
        #expect(store.cachedNote(id: "a") == nil)
    }

    @Test("Inserts new notes at the front")
    func insertsAtFront() {
        let store = makeStore()
        store.upsert(makeNote("a"))
        store.upsert(makeNote("b"))
        #expect(store.notes.map(\.id) == ["b", "a"])
    }

    // MARK: folders and tags

    @Test("Deleting a folder unfiles its notes, matching the server")
    func deletingFolderUnfilesNotes() {
        let store = makeStore()
        store.addFolder(Folder(id: "f1", name: "Study", parentId: nil))
        store.upsert(makeNote("a", folderId: "f1"))

        store.removeFolder(id: "f1")

        #expect(store.folders.isEmpty)
        #expect(store.cachedNote(id: "a")?.folderId == nil)
    }

    @Test("Deleting a tag strips it from every note")
    func deletingTagStripsIt() {
        let store = makeStore()
        store.addTag(Tag(id: "t1", name: "Grace", color: "#fff"))
        store.upsert(makeNote("a", tagIds: ["t1", "t2"]))

        store.removeTag(id: "t1")

        #expect(store.tags.isEmpty)
        #expect(store.cachedNote(id: "a")?.tagIds == ["t2"])
    }

    @Test("Renaming a folder updates it in place")
    func renamesFolder() {
        let store = makeStore()
        store.addFolder(Folder(id: "f1", name: "Study", parentId: nil))
        store.renameFolder(Folder(id: "f1", name: "Romans", parentId: nil))
        #expect(store.folders.first?.name == "Romans")
    }
}

/// The list's filtering and sorting, which the Android hook derives in
/// `useNotesLibrary` and the web derives in `useNotes` — pinned first, then the
/// chosen order.
@Suite("Notes library sorting and filtering")
@MainActor
struct NotesLibraryModelTests {

    private func makeLibrary() -> (NotesLibraryModel, NotesStore) {
        let store = NotesStore(cacheURL: nil)
        // The model only reaches the network through explicit calls, so an
        // unused client is enough to build one.
        let api = APIClient(token: { _ in nil }, onAuthFailure: {})
        return (NotesLibraryModel(api: NotesAPI(api: api), store: store), store)
    }

    private func note(
        _ id: String,
        title: String,
        updated: String,
        created: String = "2026-01-01T00:00:00.000Z",
        pinned: Bool = false,
        folder: String? = nil,
        tags: [String] = [],
        text: String = ""
    ) -> Note {
        Note(
            id: id,
            title: title,
            plainText: text,
            folderId: folder,
            tagIds: tags,
            createdAt: created,
            updatedAt: updated,
            isPinned: pinned
        )
    }

    @Test("Pinned notes come first regardless of sort order")
    func pinnedFirst() {
        let (library, store) = makeLibrary()
        store.applyServerSnapshot(
            notes: [
                note("a", title: "Alpha", updated: "2026-08-10T12:00:00.000Z"),
                note("b", title: "Bravo", updated: "2026-01-01T00:00:00.000Z", pinned: true),
            ],
            folders: [],
            tags: []
        )
        #expect(library.notes.map(\.id) == ["b", "a"])

        library.sortBy = .title
        #expect(library.notes.map(\.id) == ["b", "a"])
    }

    @Test("Sorts by modified, created and title")
    func sortsByEachOrder() {
        let (library, store) = makeLibrary()
        store.applyServerSnapshot(
            notes: [
                note("a", title: "Zeta", updated: "2026-08-01T00:00:00.000Z",
                     created: "2026-01-03T00:00:00.000Z"),
                note("b", title: "Alpha", updated: "2026-08-09T00:00:00.000Z",
                     created: "2026-01-01T00:00:00.000Z"),
            ],
            folders: [],
            tags: []
        )

        library.sortBy = .updatedAt
        #expect(library.notes.map(\.id) == ["b", "a"])
        library.sortBy = .createdAt
        #expect(library.notes.map(\.id) == ["a", "b"])
        library.sortBy = .title
        #expect(library.notes.map(\.id) == ["b", "a"])
    }

    @Test("Search matches the title and the plain text")
    func searchesTitleAndBody() {
        let (library, store) = makeLibrary()
        store.applyServerSnapshot(
            notes: [
                note("a", title: "Romans", updated: "2026-08-01T00:00:00.000Z"),
                note("b", title: "Notes", updated: "2026-08-02T00:00:00.000Z",
                     text: "justified by faith"),
            ],
            folders: [],
            tags: []
        )

        library.searchQuery = "romans"
        #expect(library.notes.map(\.id) == ["a"])
        library.searchQuery = "FAITH"
        #expect(library.notes.map(\.id) == ["b"])
        library.searchQuery = "nothing here"
        #expect(library.notes.isEmpty)
    }

    @Test("Folder and tag filters narrow the list")
    func filtersByFolderAndTag() {
        let (library, store) = makeLibrary()
        store.applyServerSnapshot(
            notes: [
                note("a", title: "A", updated: "2026-08-01T00:00:00.000Z", folder: "f1"),
                note("b", title: "B", updated: "2026-08-02T00:00:00.000Z", tags: ["t1"]),
            ],
            folders: [],
            tags: []
        )

        library.activeFolderID = "f1"
        #expect(library.notes.map(\.id) == ["a"])

        library.activeFolderID = nil
        library.activeTagID = "t1"
        #expect(library.notes.map(\.id) == ["b"])
    }

    @Test("Sort order cycles the way the Android control does")
    func sortCycles() {
        #expect(NoteSort.updatedAt.next == .createdAt)
        #expect(NoteSort.createdAt.next == .title)
        #expect(NoteSort.title.next == .updatedAt)
    }
}
