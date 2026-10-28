import Foundation

/// Links the signed-in user's notes to the chapter open in the reader - the
/// ✎ beside a verse number, the Notes tab and its "Notes · N" count. Port of
/// `mobile/src/features/bible/useChapterNotes.ts`.
///
/// The rows come from the persisted notes library (`NotesStore`) first, so the
/// reader paints at once and offline, then from a silent revalidation of
/// `GET /api/notes?summary=1` on every reader open and after every save from
/// the note picker. A failed revalidation keeps what is already shown. It
/// lives on `BibleModel`, which `AppModel` rebuilds per account, so one
/// session's rows never reach the next.
@MainActor
@Observable
final class ChapterNotesModel {
    typealias Fetch = @Sendable () async throws -> [NoteSummary]

    /// Every note's summary row, newest first; empty until the cache or a
    /// fetch has supplied them.
    private(set) var rows: [ChapterNoteSummary] = []
    /// True once a fetch has landed: the cache never overwrites fresher rows.
    private(set) var fetched = false

    @ObservationIgnored private let fetch: Fetch
    @ObservationIgnored private let store: NotesStore
    @ObservationIgnored private var requestID = 0
    /// Bumped whenever `rows` changes, so the memo below knows to recompute.
    @ObservationIgnored private var version = 0
    @ObservationIgnored private var memo: (key: String, version: Int, matches: [MatchedChapterNote])?

    init(fetch: @escaping Fetch, store: NotesStore) {
        self.fetch = fetch
        self.store = store
    }

    convenience init(api: APIClient) {
        self.init(fetch: { try await AddToNote.notes(api: api) }, store: .shared)
    }

    /// The reader opened: paint from the library cache, then revalidate.
    func open() async {
        if !fetched {
            await store.hydrate()
            if !fetched, rows.isEmpty, !store.notes.isEmpty {
                set(store.notes.map {
                    ChapterNoteSummary(id: $0.id, title: $0.title, plainText: $0.plainText, updatedAt: $0.updatedAt)
                })
            }
        }
        await refresh()
    }

    /// Silent revalidation. Only the newest request may write, and a failure
    /// keeps the rows already on screen.
    func refresh() async {
        requestID += 1
        let id = requestID
        do {
            let notes = try await fetch()
            guard id == requestID else { return }
            fetched = true
            set(notes.map {
                ChapterNoteSummary(id: $0.id, title: $0.title, plainText: $0.plainText, updatedAt: $0.updatedAt)
            })
        } catch {
            // Fail-soft, as on Android: the cached rows stay.
        }
    }

    /// The notes that mention this chapter. Memoised per chapter and per set
    /// of rows: the reader asks on every render, and audio playback renders it
    /// several times a second.
    func matches(bookName: String, bookAbbr: String?, chapter: Int, verseCount: Int) -> [MatchedChapterNote] {
        let rows = rows
        let key = "\(bookName)|\(bookAbbr ?? "")|\(chapter)|\(verseCount)"
        if let memo, memo.key == key, memo.version == version { return memo.matches }
        let matches = ChapterNotes.matchChapterNotes(
            notes: rows,
            context: ChapterNotesContext(bookName: bookName, bookAbbr: bookAbbr, chapter: chapter, verseCount: verseCount)
        )
        memo = (key, version, matches)
        return matches
    }

    private func set(_ next: [ChapterNoteSummary]) {
        rows = next
        version += 1
    }
}
