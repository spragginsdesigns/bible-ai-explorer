import Foundation

/// Reader state for the Bible section — a port of the state held by
/// `mobile/app/(app)/bible/chapter.tsx` and `search.tsx`, which are two screens
/// on Android and two panes of one window here.
///
/// The account translation remains in `SettingsStore`; a one-hop chat source
/// may temporarily override it while its reader is open.
@MainActor
@Observable
final class BibleModel {
    /// The four type sizes offered by the A−/A+ controls, shared with the other
    /// clients (`FONT_STEPS`).
    static let fontSteps: [CGFloat] = [17, 20, 24, 28]
    static let defaultFontStep = 1
    static let highlightDuration = Duration.milliseconds(2400)

    private enum Key {
        static let fontStep = "bible.fontStep"
        static let lcGreek = LCGreek.preferenceKey
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
    /// Local translation override for a chat source. Cleared by ordinary reader
    /// navigation or when the user explicitly selects a translation chip.
    var translationOverride: TranslationID?

    // MARK: Reading

    /// The verses on screen.
    private(set) var verses: [String] = []
    /// The KJV chapter behind the LC Greek, which every study path reads
    /// (`verseText`, `chapterText`); nil when the page shows a translation.
    private(set) var studyVerses: [String]?
    /// `verses` formatted for drawing: headings, italics, the words of Jesus
    /// and omitted-verse notes (`ReaderAnnotations`). Always the same length
    /// as `verses` and written in the same step, so the two never disagree.
    private(set) var readerVerses: [ReaderVerse] = []
    /// Which `translation:book:chapter` `verses` actually holds. The selection
    /// changes a render before the new text arrives, so without this the scroll
    /// and flash below would fire against the previous chapter's verses.
    private(set) var loadedKey: String?
    private(set) var loading = false
    private(set) var error: String?

    /// Verse the pending deep link wants brought into view; cleared once flashed.
    var pendingVerse: Int?
    var highlightedVerse: Int?
    var toast: String?

    var fontStep: Int {
        didSet { defaults.set(fontStep, forKey: Key.fontStep) }
    }

    /// The reader's LC Greek choice (LC-15842), kept on this device. It shows
    /// only on a book that has the text and with no chat source override.
    var lcGreek: Bool {
        didSet { defaults.set(lcGreek, forKey: Key.lcGreek) }
    }

    // MARK: Searching

    /// The Mac sidebar's translation-aware search (`search.tsx`). It lives
    /// here, not in the sidebar, so a query survives a trip through chat the
    /// way the book and chapter do. The iOS search screen keeps its own.
    let search: BibleSearchModel

    // MARK: Collaborators

    /// Tap-a-verse. One per reader, because only one verse's panel is open at
    /// a time — opening another verse supersedes the stream rather than
    /// running a second one.
    let insight: VerseInsightModel

    /// The two-tier verse sheet (selection, tier, study tab, action states)
    /// both readers draw: the iPhone's drag sheet and the Mac's docked panel.
    /// It streams through `insight` above.
    let sheet: VerseSheetModel

    /// The reading plan the user is following, and every action the plan pane
    /// takes on it. It hangs off the reader rather than off `AppModel` because
    /// the plan *is* Bible-section state - the sidebar card and the plan pane
    /// are the only two things that read it - and because living here it
    /// survives a trip through chat exactly as the book and chapter do.
    let plan: ReadingPlanModel

    /// Verse-highlight cache, injected by `AppModel` once both exist (the
    /// store needs the same API client). Optional so the tests can build a
    /// model without one. A chapter load refreshes that chapter's slice.
    var highlights: HighlightsStore?

    /// The "Quiz me" run in front of the reader, nil when none is open. Kept
    /// here for the same reason the plan is: an "Ask about this" trip to Chat
    /// must not throw away a half-finished quiz.
    var quiz: QuizModel?

    private let api: APIClient
    private let lcGreekText: LCGreekProvider
    /// Where `fontStep` is persisted. Injected so the tests can hand in a
    /// throwaway suite: under `TEST_HOST` `.standard` *is* the shipping app's
    /// domain, and a test run must not rewrite the reader's real type size.
    private let defaults: UserDefaults
    private var saveTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var flashTask: Task<Void, Never>?
    let reading: ReadingJournal

    init(api: APIClient, defaults: UserDefaults = .standard, reading: ReadingJournal? = nil) {
        self.reading = reading ?? ReadingJournal(account: nil, api: nil)
        self.api = api
        self.defaults = defaults
        let insight = VerseInsightModel(api: api)
        self.insight = insight
        sheet = VerseSheetModel(insight: insight)
        plan = ReadingPlanModel(api: api)
        search = BibleSearchModel()
        lcGreekText = LCGreekProvider { [api] path in try await api.data(path) }
        let stored = defaults.object(forKey: Key.fontStep) as? Int
        fontStep = Self.clampFontStep(stored ?? Self.defaultFontStep)
        lcGreek = defaults.bool(forKey: Key.lcGreek)
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

    /// `lcGreek` is the LC Greek on screen over the KJV `translation` every
    /// study path reads, a different text with its own key.
    func chapterKey(_ translation: TranslationID, lcGreek: Bool = false) -> String {
        "\(lcGreek ? "LCG" : translation.rawValue):\(selectedBook ?? 0):\(chapter)"
    }

    func verseReference(_ verse: Int) -> String { "\(reference):\(verse)" }

    /// Plain text of one verse — provider markup stripped — in the study
    /// translation: the KJV under the LC Greek, for Explain and Ask AI.
    func verseText(_ verse: Int) -> String {
        let source = studyVerses ?? verses
        guard verse >= 1, verse <= source.count else { return "" }
        return VerseMarkup.plainText(source[verse - 1])
    }

    /// Plain text of one verse as it reads on screen, for Copy, Share and Save.
    func shownText(_ verse: Int) -> String {
        guard verse >= 1, verse <= verses.count else { return "" }
        return VerseMarkup.plainText(verses[verse - 1])
    }

    /// The whole chapter, numbered, for the "✦ Ask AI" attach.
    var chapterText: String {
        (studyVerses ?? verses).enumerated()
            .map { "\($0.offset + 1) \(VerseMarkup.plainText($0.element))" }
            .joined(separator: "\n")
    }

    // MARK: - Navigation

    func selectBook(_ order: Int) {
        guard Bible.book(order: order) != nil else { return }
        selectedBook = order
        translationOverride = nil
        pane = .chapters
        dismissVerseActions()
    }

    func showChapterGrid() {
        guard selectedBook != nil else { return }
        pane = .chapters
        translationOverride = nil
        dismissVerseActions()
    }

    /// Open a chapter in the reader, optionally scrolling to and flashing a verse.
    func open(
        order: Int,
        chapter: Int,
        verse: Int? = nil,
        translationOverride: TranslationID? = nil
    ) {
        guard let book = Bible.book(order: order), chapter >= 1, chapter <= book.chapters else {
            return
        }
        selectedBook = order
        self.translationOverride = translationOverride
        self.chapter = chapter
        pane = .reader
        pendingVerse = verse
        highlightedVerse = nil
        dismissVerseActions()
    }

    func open(_ reference: Reference, translationOverride: TranslationID? = nil) {
        open(
            order: reference.order,
            chapter: reference.chapter,
            verse: reference.verse,
            translationOverride: translationOverride
        )
    }

    /// Page to an adjacent chapter. Clearing the pending verse stops the flash
    /// from firing again in the chapter just paged into.
    func go(to location: Bible.Location?) {
        guard let location else { return }
        open(
            order: location.order,
            chapter: location.chapter,
            translationOverride: translationOverride
        )
    }

    /// Open "Quiz me" for a chapter, reusing a quiz already open on it.
    func startQuiz(book: Int, chapter: Int) {
        if let quiz, quiz.book == book, quiz.chapter == chapter { return }
        quiz?.cancel()
        let model = QuizModel(api: api, book: book, chapter: chapter)
        quiz = model
        model.start()
    }

    func closeQuiz() {
        quiz?.cancel()
        quiz = nil
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
    ///
    /// With `lcGreek` the page shows the LC Greek, plain text under the KJV's
    /// headings, and `translation` (the KJV) is loaded alongside for study.
    func load(translation: TranslationID, lcGreek: Bool = false) async {
        guard let order = selectedBook else { return }
        let key = chapterKey(translation, lcGreek: lcGreek)
        loading = true
        error = nil
        do {
            let next = try await BibleTranslations.chapter(
                translation,
                order: order,
                chapter: chapter
            )
            var formatted = await ReaderAnnotations.shared.chapter(
                translation,
                order: order,
                chapter: chapter,
                markups: next
            )
            var shown = next
            if lcGreek {
                shown = try await lcGreekText.chapter(book: order, chapter: chapter)
                formatted = shown.enumerated().map { index, text in
                    ReaderVerse(
                        number: index + 1,
                        headings: index < formatted.count ? formatted[index].headings : [],
                        segments: [ReaderSegment(text: text, italic: false)],
                        omitted: false
                    )
                }
            }
            guard !Task.isCancelled else { return }
            verses = shown
            studyVerses = lcGreek ? next : nil
            readerVerses = formatted
            loadedKey = key
        } catch {
            guard !Task.isCancelled else { return }
            verses = []
            studyVerses = nil
            readerVerses = []
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

    // MARK: - Reading history

    func prepareReading(translation: TranslationID, lcGreek: Bool = false) {
        guard let book, loadedKey == chapterKey(translation, lcGreek: lcGreek) else { return }
        reading.enter(book: book.order, chapter: chapter, translation: translation.rawValue, verseCount: verses.count)
    }

    func readingVisibility(verse: Int, visible: Bool, translation: TranslationID, lcGreek: Bool = false) {
        guard loadedKey == chapterKey(translation, lcGreek: lcGreek) else { return }
        prepareReading(translation: translation, lcGreek: lcGreek)
        reading.visibility(verse: verse, isVisible: visible)
    }

    // MARK: - Verse actions

    /// Close the verse sheet and abandon its explanation: navigation, a hop
    /// to chat, or a context-menu action that finished the job.
    func dismissVerseActions() {
        sheet.close()
        insight.reset()
    }

    func attachment(reference: String, text: String, translation: TranslationID) -> VerseAttachment {
        VerseAttachment(reference: reference, text: text, translation: translation)
    }

    func copy(reference: String, text: String, translation: TranslationID, label: String? = nil) {
        VerseActions.copy(reference: reference, text: text, translation: translation, label: label)
        show(toast: "Copied \(reference)")
        dismissVerseActions()
    }

    func saveToNote(reference: String, text: String, translation: TranslationID, label: String? = nil) {
        saveTask?.cancel()
        saveTask = Task { [api] in
            do {
                try await VerseActions.saveToNote(
                    api: api,
                    reference: reference,
                    text: text,
                    translation: translation,
                    label: label
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
