import Foundation

/// Reader state for the Bible section — a port of the state held by
/// `mobile/app/(app)/bible/chapter.tsx` and `search.tsx`, which are two screens
/// on Android and two panes of one window here.
///
/// The translation is deliberately *not* stored: the reader's chips write the
/// shared `SettingsStore` default, exactly as the Android reader does, so the
/// chat attachment and the reader can never disagree about what is on screen.
@MainActor
@Observable
final class BibleModel {
    /// The four type sizes offered by the A−/A+ controls, shared with the other
    /// clients (`FONT_STEPS`).
    static let fontSteps: [CGFloat] = [17, 20, 24, 28]
    static let defaultFontStep = 1
    static let searchLimit = KJVLibrary.defaultSearchLimit
    static let searchDebounce = Duration.milliseconds(300)
    static let highlightDuration = Duration.milliseconds(2400)
    /// A chapter must stay on screen this long before it counts as read,
    /// matching `READ_EVENT_DELAY_MS` in the Android reader.
    static let readEventDelay = Duration.seconds(5)

    private enum Key {
        static let fontStep = "bible.fontStep"
    }

    /// What the detail pane shows for the selected book.
    enum Pane: Equatable {
        case chapters
        case reader
    }

    // MARK: Navigation

    private(set) var selectedBook: Int?
    private(set) var chapter = 1
    private(set) var pane: Pane = .chapters

    // MARK: Reading

    private(set) var verses: [String] = []
    /// Which `translation:book:chapter` `verses` actually holds. The selection
    /// changes a render before the new text arrives, so without this the scroll
    /// and flash below would fire against the previous chapter's verses.
    private(set) var loadedKey: String?
    private(set) var loading = false
    private(set) var error: String?

    /// Verse the pending deep link wants brought into view; cleared once flashed.
    var pendingVerse: Int?
    var highlightedVerse: Int?
    /// Verse whose panel is open under the reader — the Mac stand-in for
    /// Android's tap-a-verse bottom sheet.
    var actionVerse: Int?
    var toast: String?

    var fontStep: Int {
        didSet { defaults.set(fontStep, forKey: Key.fontStep) }
    }

    // MARK: Searching

    var query = ""
    private(set) var searchHits: [KJVSearchHit] = []
    /// The query `searchHits` answers; empty until a search has actually run.
    private(set) var searchedQuery = ""

    // MARK: Collaborators

    /// Tap-a-verse. One per reader, because only one verse's panel is open at
    /// a time — opening another verse supersedes the stream rather than
    /// running a second one.
    let insight: VerseInsightModel

    /// Verse-highlight cache, injected by `AppModel` once both exist (the
    /// store needs the same API client). Optional so the tests can build a
    /// model without one. A chapter load refreshes that chapter's slice.
    var highlights: HighlightsStore?

    private let api: APIClient
    /// Where `fontStep` is persisted. Injected so the tests can hand in a
    /// throwaway suite: under `TEST_HOST` `.standard` *is* the shipping app's
    /// domain, and a test run must not rewrite the reader's real type size.
    private let defaults: UserDefaults
    private var saveTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var flashTask: Task<Void, Never>?
    /// Chapters already reported this session, so a re-render or paging back
    /// doesn't re-post. The server dedupes within the hour as well; this just
    /// keeps the app from making the call at all.
    private var recordedReads: Set<String> = []

    init(api: APIClient, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
        insight = VerseInsightModel(api: api)
        let stored = defaults.object(forKey: Key.fontStep) as? Int
        fontStep = Self.clampFontStep(stored ?? Self.defaultFontStep)
    }

    // MARK: - Derived

    var book: Book? { selectedBook.flatMap { Bible.book(order: $0) } }

    /// "John 3" — the chapter's own reference, used as the Ask-AI title and the
    /// stem of every verse reference.
    var reference: String {
        guard let book else { return "" }
        return "\(book.name) \(chapter)"
    }

    var fontSize: CGFloat { Self.fontSteps[fontStep] }
    var lineHeight: CGFloat { (fontSize * 1.55).rounded() }

    var canShrinkFont: Bool { fontStep > 0 }
    var canGrowFont: Bool { fontStep < Self.fontSteps.count - 1 }

    var location: Bible.Location? {
        selectedBook.map { Bible.Location(order: $0, chapter: chapter) }
    }

    var previousLocation: Bible.Location? { location.flatMap(Bible.previous(from:)) }
    var nextLocation: Bible.Location? { location.flatMap(Bible.next(from:)) }

    /// The reference quick-jump offered above the search results.
    var referenceJump: Reference? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return Bible.resolveReference(trimmed)
    }

    var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func chapterKey(_ translation: TranslationID) -> String {
        "\(translation.rawValue):\(selectedBook ?? 0):\(chapter)"
    }

    func verseReference(_ verse: Int) -> String { "\(reference):\(verse)" }

    /// Plain text of one verse — provider markup stripped.
    func verseText(_ verse: Int) -> String {
        guard verse >= 1, verse <= verses.count else { return "" }
        return VerseMarkup.plainText(verses[verse - 1])
    }

    /// The whole chapter, numbered, for the "✦ Ask AI" attach.
    var chapterText: String {
        verses.enumerated()
            .map { "\($0.offset + 1) \(VerseMarkup.plainText($0.element))" }
            .joined(separator: "\n")
    }

    // MARK: - Navigation

    func selectBook(_ order: Int) {
        guard Bible.book(order: order) != nil else { return }
        selectedBook = order
        pane = .chapters
        dismissVerseActions()
    }

    func showChapterGrid() {
        guard selectedBook != nil else { return }
        pane = .chapters
        dismissVerseActions()
    }

    /// Open a chapter in the reader, optionally scrolling to and flashing a verse.
    func open(order: Int, chapter: Int, verse: Int? = nil) {
        guard let book = Bible.book(order: order), chapter >= 1, chapter <= book.chapters else {
            return
        }
        selectedBook = order
        self.chapter = chapter
        pane = .reader
        pendingVerse = verse
        highlightedVerse = nil
        dismissVerseActions()
    }

    func open(_ reference: Reference) {
        open(order: reference.order, chapter: reference.chapter, verse: reference.verse)
    }

    /// Page to an adjacent chapter. Clearing the pending verse stops the flash
    /// from firing again in the chapter just paged into.
    func go(to location: Bible.Location?) {
        guard let location else { return }
        open(order: location.order, chapter: location.chapter)
    }

    func stepFont(_ delta: Int) {
        fontStep = Self.clampFontStep(fontStep + delta)
    }

    private static func clampFontStep(_ value: Int) -> Int {
        min(fontSteps.count - 1, max(0, value))
    }

    // MARK: - Loading

    /// Load the current chapter. Driven by `.task(id:)`, so a superseded load is
    /// cancelled rather than raced — but a cancelled task can still be mid-flight
    /// when the next one starts, hence the checks before every write.
    func load(translation: TranslationID) async {
        guard let order = selectedBook else { return }
        let key = chapterKey(translation)
        loading = true
        error = nil
        do {
            let next = try await BibleTranslations.chapter(
                translation,
                order: order,
                chapter: chapter
            )
            guard !Task.isCancelled else { return }
            verses = next
            loadedKey = key
        } catch {
            guard !Task.isCancelled else { return }
            verses = []
            loadedKey = nil
            self.error = (error as? BibleError)?.message ?? BibleTranslations.chapterLoadError
        }
        loading = false
        // Highlights ride the chapter load, so a page turn or translation
        // switch revalidates them through the same cancelled-not-raced path.
        // After `loading` clears, so a slow GET never extends the spinner.
        if loadedKey == key {
            await highlights?.refresh(translation: translation, book: order, chapter: chapter)
        }
    }

    // MARK: - Searching

    /// Run the offline search. Callers debounce by driving this from
    /// `.task(id: query)`; a superseded run is dropped on cancellation.
    func runSearch() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            searchHits = []
            searchedQuery = ""
            return
        }
        let results = await KJVLibrary.shared.search(trimmed, limit: Self.searchLimit)
        guard !Task.isCancelled else { return }
        searchHits = results
        searchedQuery = trimmed
    }

    func clearSearch() {
        query = ""
        searchHits = []
        searchedQuery = ""
    }

    /// The line shown above the results, matching the other clients word for word.
    var searchSummary: String? {
        guard !searchedQuery.isEmpty else { return nil }
        if searchHits.isEmpty {
            return referenceJump == nil ? "No verses found." : nil
        }
        if searchHits.count >= Self.searchLimit {
            return "First \(Self.searchLimit) of many — refine your search"
        }
        return "\(searchHits.count) result\(searchHits.count == 1 ? "" : "s")"
    }

    // MARK: - Reading history

    /// Report that the current chapter was read — the history that shapes which
    /// verse "Pick Up Your Cross" picks. The caller waits `readEventDelay`
    /// first, so a chapter merely paged through never counts.
    ///
    /// Fire-and-forget by design: this is a background nicety, and a failure
    /// must never surface in the reader.
    func recordRead(translation: TranslationID) {
        guard let book, loadedKey == chapterKey(translation) else { return }
        let key = chapterKey(translation)
        guard !recordedReads.contains(key) else { return }
        recordedReads.insert(key)

        let name = book.name
        let chapter = chapter
        Task { [api] in
            try? await DailyCrossAPI.recordReading(
                api: api,
                book: name,
                chapter: chapter,
                translation: translation
            )
        }
    }

    // MARK: - Verse actions

    /// Open a verse's panel and start streaming its explanation — Tap-a-verse.
    /// Clicking the open verse again closes it, which is what makes this the
    /// toggle the reader calls on every click.
    func toggleVerse(_ number: Int, translation: TranslationID) {
        guard actionVerse != number else {
            dismissVerseActions()
            return
        }
        actionVerse = number
        insight.start(
            VerseInsightModel.Target(
                reference: verseReference(number),
                text: verseText(number),
                translation: translation
            )
        )
    }

    func dismissVerseActions() {
        actionVerse = nil
        insight.reset()
    }

    func attachment(reference: String, text: String, translation: TranslationID) -> VerseAttachment {
        VerseAttachment(reference: reference, text: text, translation: translation)
    }

    func copy(reference: String, text: String, translation: TranslationID) {
        VerseActions.copy(reference: reference, text: text, translation: translation)
        show(toast: "Copied \(reference)")
        dismissVerseActions()
    }

    func saveToNote(reference: String, text: String, translation: TranslationID) {
        saveTask?.cancel()
        saveTask = Task { [api] in
            do {
                try await VerseActions.saveToNote(
                    api: api,
                    reference: reference,
                    text: text,
                    translation: translation
                )
                show(toast: "Saved \(reference) to your notes")
                dismissVerseActions()
            } catch {
                show(
                    toast: (error as? APIError)?.message
                        ?? "The note could not be saved. Check your connection and try again."
                )
            }
        }
    }

    func show(toast message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    /// Bring a deep-linked verse into view exactly once, then flash it.
    ///
    /// Clearing `pendingVerse` is what lets a second jump to the *same* verse
    /// re-arm the reader: the view watches that value, so it has to fall back to
    /// nil before it can change again.
    func flash(verse: Int) {
        highlightedVerse = verse
        pendingVerse = nil
        // Re-flashing while an earlier flash is still counting down would
        // otherwise let the old timer clear the new highlight early.
        flashTask?.cancel()
        flashTask = Task {
            try? await Task.sleep(for: Self.highlightDuration)
            guard !Task.isCancelled, highlightedVerse == verse else { return }
            highlightedVerse = nil
        }
    }
}
