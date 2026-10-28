import Foundation
import Testing

@testable import SureWord

/// The reader's verse-to-note picker (`formatVerseNoteMarkdown`,
/// `AddToNoteSheet compose={false}`), its chapter notes, Spanish and German
/// search and the narration follow rule - each pinned against the Android
/// behavior it ports.
@Suite("Verse to note (verseActions.ts)")
struct VerseNoteMarkdownTests {
    @Test("formats a verse as a clean markdown blockquote, exactly as Android")
    func blockquote() {
        #expect(
            VerseNoteMarkdown.format(
                reference: "Romans 8:28",
                text: "And we know that all things work together for good",
                translation: "KJV"
            ) == [
                "> **Romans 8:28**",
                ">",
                "> And we know that all things work together for good",
                ">",
                "> (KJV)",
            ].joined(separator: "\n")
        )
    }

    @Test("drops an empty body or label, and trims the words")
    func emptyParts() {
        #expect(VerseNoteMarkdown.format(reference: "Psalm 23:1", text: nil, translation: nil) == "> **Psalm 23:1**")
        #expect(VerseNoteMarkdown.format(reference: "Psalm 23:1", text: "   ", translation: "") == "> **Psalm 23:1**")
        #expect(
            VerseNoteMarkdown.format(reference: "John 1:1", text: "  In the beginning  ", translation: "LC Greek")
                == "> **John 1:1**\n>\n> In the beginning\n>\n> (LC Greek)"
        )
    }

    @Test("a verse save posts compose false, a null noteId and the reference title")
    func verseRequestBody() throws {
        let body = try encode(
            AppendToNoteRequest(markdown: "> **John 3:16**", noteId: nil, defaultTitle: "John 3:16", compose: false)
        )
        #expect(body.keys.sorted() == ["compose", "markdown", "noteId", "title"])
        #expect(body["compose"] as? Bool == false)
        #expect(body["noteId"] is NSNull)
        #expect(body["title"] as? String == "John 3:16")
    }

    @Test("appending a verse to a note keeps compose false and sends no title")
    func verseAppendBody() throws {
        let body = try encode(
            AppendToNoteRequest(markdown: "> **John 3:16**", noteId: "n1", defaultTitle: "John 3:16", compose: false)
        )
        #expect(body.keys.sorted() == ["compose", "markdown", "noteId"])
        #expect(body["noteId"] as? String == "n1")
    }

    @Test("a chat answer posts no compose key: composing is the route's default")
    func answerBodyOmitsCompose() throws {
        let body = try encode(AppendToNoteRequest(markdown: "**Answer**", noteId: "n1"))
        #expect(body.keys.sorted() == ["markdown", "noteId"])
    }

    @MainActor
    @Test("the sheet's note pick is the selection's blockquote, titled by the reference")
    func sheetNotePick() throws {
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, token: { _ in nil }, onAuthFailure: {})
        let sheet = VerseSheetModel(insight: VerseInsightModel(api: api))
        let context = VerseSheetContext(
            order: 43, bookName: "John", chapter: 3,
            plainTexts: (1...36).map { "v\($0)" }, translation: .kjv
        )
        #expect(sheet.notePick(context) == nil)
        sheet.tap(16, context: context)
        sheet.tap(17, context: context)
        sheet.actionMessage = .init(text: "old", tone: .danger)
        let pick = try #require(sheet.notePick(context))
        #expect(pick.title == "John 3:16-17")
        #expect(pick.markdown == "> **John 3:16-17**\n>\n> 16 v16 17 v17\n>\n> (KJV)")
        #expect(sheet.actionMessage == nil)
    }

    @Test("the Notes tab counts the notes that mention the selection")
    func notesTabLabel() {
        #expect(VerseSheetModel.StudyTab.notes.label(noteCount: 0) == "Notes")
        #expect(VerseSheetModel.StudyTab.notes.label(noteCount: 2) == "Notes · 2")
        #expect(VerseSheetModel.StudyTab.notes.label == "Notes")
        #expect(VerseSheetModel.StudyTab.seeAlso.label(noteCount: 3) == "See also")
    }

    private func encode(_ request: AppendToNoteRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(request)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

@MainActor
@Suite("Chapter notes in the reader (useChapterNotes.ts)")
struct ChapterNotesModelTests {
    private func note(_ id: String, title: String, plainText: String = "", updatedAt: String = "2026-01-01T00:00:00.000Z") -> Note {
        Note(
            id: id, content: "", htmlContent: "", title: title, plainText: plainText,
            folderId: nil, tagIds: [], createdAt: updatedAt, updatedAt: updatedAt,
            isPinned: false, wordCount: 0, hasBody: false
        )
    }

    private actor Calls {
        var count = 0
        func next() -> Int { count += 1; return count }
    }

    @Test("paints from the notes cache, then the revalidated rows replace it")
    func cacheThenRefresh() async {
        let store = NotesStore(cacheURL: nil)
        store.upsert(note("cached", title: "John 3:16 study"))
        let model = ChapterNotesModel(
            fetch: { [NoteSummary(id: "fresh", title: "Love", plainText: "See John 3:17-18", updatedAt: "2026-02-01T00:00:00.000Z")] },
            store: store
        )
        #expect(model.matches(bookName: "John", bookAbbr: "Jn", chapter: 3, verseCount: 36).isEmpty)

        await model.open()
        let matches = model.matches(bookName: "John", bookAbbr: "Jn", chapter: 3, verseCount: 36)
        #expect(model.fetched)
        #expect(matches.map(\.id) == ["fresh"])
        #expect(ChapterNotes.versesWithNotes(matches) == [17, 18])
    }

    @Test("a failed revalidation keeps the cached rows")
    func failSoft() async {
        let store = NotesStore(cacheURL: nil)
        store.upsert(note("cached", title: "Notes", plainText: "John 3:16 again"))
        let model = ChapterNotesModel(fetch: { throw URLError(.notConnectedToInternet) }, store: store)
        await model.open()
        #expect(!model.fetched)
        let matches = model.matches(bookName: "John", bookAbbr: nil, chapter: 3, verseCount: 36)
        #expect(matches.map(\.id) == ["cached"])
        #expect(ChapterNotes.notesForSelection(matches, selection: VerseSelection(start: 16, end: 16)).count == 1)
    }

    @Test("a refresh after a save is what the markers and the tab see next")
    func refreshAfterSave() async {
        let calls = Calls()
        let model = ChapterNotesModel(
            fetch: {
                await calls.next() == 1
                    ? []
                    : [NoteSummary(id: "new", title: "John 3:16", plainText: "> **John 3:16**", updatedAt: "2026-03-01T00:00:00.000Z")]
            },
            store: NotesStore(cacheURL: nil)
        )
        await model.open()
        #expect(model.matches(bookName: "John", bookAbbr: nil, chapter: 3, verseCount: 36).isEmpty)
        await model.refresh()
        let matches = model.matches(bookName: "John", bookAbbr: nil, chapter: 3, verseCount: 36)
        #expect(matches.map(\.id) == ["new"])
        // Another chapter is not served the memo of this one.
        #expect(model.matches(bookName: "John", bookAbbr: nil, chapter: 4, verseCount: 54).isEmpty)
    }
}

@Suite("Spanish and German search (search.ts)")
struct ForeignBibleSearchTests {
    private static let offline = BibleSearch(fetch: { _ in throw URLError(.notConnectedToInternet) })

    @Test("a Spanish or German miss stays in its own Bible: no KJV fallback")
    func noFallback() async throws {
        for translation in [TranslationID.rv1909, .lut1912] {
            let result = try await Self.offline.search("zzzz qqqq", translation: translation)
            #expect(result.translation == translation)
            #expect(result.hits.isEmpty)
        }
        #expect(!BibleSearch.checksAlternate(.rv1909))
        #expect(!BibleSearch.checksAlternate(.lut1912))
        #expect(BibleSearch.checksAlternate(.bsb))
    }

    @Test("accents are optional")
    func accentsOptional() async throws {
        let result = try await Self.offline.search("senor", translation: .rv1909)
        #expect(result.translation == .rv1909)
        #expect(!result.hits.isEmpty)
        #expect(result.hits.allSatisfy { $0.translation == .rv1909 })
    }

    @MainActor
    @Test("the hint and the no-match line name only the Bible searched")
    func localizedLines() async {
        let model = BibleSearchModel(search: Self.offline)
        #expect(model.hint(account: .rv1909) == "Search RV1909 by word or phrase. Accents are optional.")
        #expect(model.hint(account: .lut1912) == "Search LUT1912 by word or phrase. Accents are optional.")
        #expect(model.hint(account: .kjv) == "Search KJV by word or phrase. If there are no matches, we check NKJV too. NKJV requires a connection.")

        model.query = "zzzz qqqq"
        await model.run(account: .rv1909, debounce: .zero)
        #expect(model.status(account: .rv1909) == "No phrase matches in RV1909. Try fewer words or a reference like Job 1:8.")
    }
}

@Suite("Narration follows the verse (chapter.tsx)")
struct ChapterAudioFollowTests {
    @Test("a manual scroll pauses the follow for five seconds")
    func pauseAfterManualScroll() {
        let now = Date()
        #expect(ChapterAudioFollow.follows(lastManualScroll: .distantPast, now: now))
        #expect(!ChapterAudioFollow.follows(lastManualScroll: now.addingTimeInterval(-4.9), now: now))
        #expect(ChapterAudioFollow.follows(lastManualScroll: now.addingTimeInterval(-5), now: now))
    }
}
