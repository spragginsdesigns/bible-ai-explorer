import Foundation
import Testing
@testable import SureWord

/// Behaviour of the reader state itself: navigation, the font-step clamp, and
/// the search summary line the sidebar shows. The equivalent logic on Android
/// lives inside `chapter.tsx`/`search.tsx` and has no Vitest suite of its own,
/// so these are written against those files rather than ported from them.
@MainActor
@Suite("Bible reader state")
struct BibleModelTests {
    /// A throwaway defaults domain. `UserDefaults.standard` under `TEST_HOST` is
    /// the shipping app's own domain, so persisting through it would rewrite the
    /// developer's real saved type size every time the suite runs.
    private static let suiteName = "SureWordTests.BibleModel"

    private static func makeDefaults(reset: Bool = true) -> UserDefaults {
        if reset { UserDefaults.standard.removePersistentDomain(forName: suiteName) }
        return UserDefaults(suiteName: suiteName) ?? .standard
    }

    private static func makeModel(defaults: UserDefaults? = nil) -> BibleModel {
        // The font step is persisted, so start every case from the default
        // rather than from whatever the last case left behind.
        BibleModel(
            api: APIClient(token: { _ in nil }, onAuthFailure: {}),
            defaults: defaults ?? makeDefaults()
        )
    }

    @Test("selecting a book shows its chapter grid")
    func selectBook() {
        let model = Self.makeModel()
        #expect(model.selectedBook == nil)

        model.selectBook(43)
        #expect(model.selectedBook == 43)
        #expect(model.pane == .chapters)
        #expect(model.book?.name == "John")
    }

    @Test("an unknown book is ignored rather than selected")
    func selectUnknownBook() {
        let model = Self.makeModel()
        model.selectBook(99)
        #expect(model.selectedBook == nil)
    }

    @Test("opening a chapter switches to the reader and arms the verse flash")
    func openChapter() {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 3, verse: 16)

        #expect(model.pane == .reader)
        #expect(model.selectedBook == 43)
        #expect(model.chapter == 3)
        #expect(model.pendingVerse == 16)
        #expect(model.reference == "John 3")
        #expect(model.verseReference(16) == "John 3:16")
    }

    @Test("a chapter outside the book is refused")
    func openOutOfRange() {
        let model = Self.makeModel()
        model.open(order: 65, chapter: 2)
        #expect(model.selectedBook == nil)
        #expect(model.pane == .chapters)
    }

    @Test("opening a resolved reference is the chat deep-link path")
    func openReference() throws {
        let model = Self.makeModel()
        let reference = try #require(Bible.resolveReference("1 Samuel 2:1-10"))
        model.open(reference)

        #expect(model.reference == "1 Samuel 2")
        #expect(model.pendingVerse == 1)
    }

    @Test("paging clears the pending verse so the flash does not follow along")
    func pagingClearsFlash() {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 3, verse: 16)
        #expect(model.pendingVerse == 16)

        model.go(to: model.nextLocation)
        #expect(model.chapter == 4)
        #expect(model.pendingVerse == nil)
    }

    @Test("prev/next roll across book boundaries")
    func rollsAcrossBooks() {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 21)
        #expect(model.nextLocation == Bible.Location(order: 44, chapter: 1))

        model.go(to: model.nextLocation)
        #expect(model.reference == "Acts 1")
        #expect(model.previousLocation == Bible.Location(order: 43, chapter: 21))
    }

    @Test("neighbours are nil at the ends of the canon")
    func canonEdges() {
        let model = Self.makeModel()
        model.open(order: 1, chapter: 1)
        #expect(model.previousLocation == nil)

        model.open(order: 66, chapter: 22)
        #expect(model.nextLocation == nil)
    }

    @Test("the font step has four positions and clamps at both ends")
    func fontSteps() {
        let model = Self.makeModel()
        #expect(BibleModel.fontSteps == [17, 20, 24, 28])
        #expect(model.fontStep == BibleModel.defaultFontStep)
        #expect(model.fontSize == 20)
        #expect(model.lineHeight == 31)

        model.stepFont(-1)
        #expect(model.fontStep == 0)
        #expect(!model.canShrinkFont)
        model.stepFont(-1)
        #expect(model.fontStep == 0)

        model.stepFont(1)
        model.stepFont(1)
        model.stepFont(1)
        #expect(model.fontStep == 3)
        #expect(!model.canGrowFont)
        model.stepFont(1)
        #expect(model.fontStep == 3)
        #expect(model.fontSize == 28)
    }

    @Test("the font step survives a new reader")
    func fontStepPersists() {
        let model = Self.makeModel()
        model.stepFont(1)
        #expect(model.fontStep == 2)

        // Same domain, fresh reader — the app's own relaunch path.
        let reopened = Self.makeModel(defaults: Self.makeDefaults(reset: false))
        #expect(reopened.fontStep == 2)
        UserDefaults.standard.removePersistentDomain(forName: Self.suiteName)
    }

    @Test("the reference quick-jump only appears for a resolvable reference")
    func referenceJump() {
        let model = Self.makeModel()
        #expect(model.search.referenceJump == nil)

        model.search.query = "John 3:16"
        #expect(model.search.referenceJump == Reference(order: 43, chapter: 3, verse: 16))

        model.search.query = "love"
        #expect(model.search.referenceJump == nil)
        #expect(model.search.isSearching)
    }

    @Test("the sidebar search follows the account translation over the bundled text")
    func search() async {
        let model = Self.makeModel()
        let search = model.search

        // Under two characters is not a search at all.
        search.query = "a"
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.hits.isEmpty)
        #expect(search.status(account: .kjv) == nil)

        search.query = "For God so loved the world"
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.hits.count == 1)
        #expect(search.hits.first?.order == 43)
        #expect(search.hits.first?.translation == .kjv)
        #expect(search.status(account: .kjv) == "1 result")

        search.query = "the"
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.hits.count == BibleSearch.defaultLimit)
        #expect(search.status(account: .kjv) == "First 100 results. Refine your search.")

        // A BSB reader searches the BSB wording first.
        search.query = "one and only Son"
        await search.run(account: .bsb, debounce: .zero)
        #expect(search.resultTranslation == .bsb)
        #expect(search.hits.contains { $0.order == 43 && $0.chapter == 3 && $0.verse == 16 })
    }

    @Test("a miss falls back to the other wording and the status line says so")
    func searchFallback() async {
        let nkjv = Data(#"{"results":[{"translation":"NKJV","book":18,"chapter":1,"verse":1,"text":"that man was <mark>blameless and upright</mark>"}]}"#.utf8)
        let search = BibleSearchModel(search: BibleSearch(fetch: { request in
            (nkjv, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }))

        // "blameless and upright" is NKJV wording the KJV never uses.
        search.query = "blameless and upright"
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.resultTranslation == .nkjv)
        #expect(search.hits == [BibleSearchHit(order: 18, chapter: 1, verse: 1, text: "that man was blameless and upright", translation: .nkjv)])
        #expect(search.status(account: .kjv) == "1 result in NKJV. No phrase matches in KJV.")

        // The chip overrides the account translation for this search only.
        search.query = "only begotten Son"
        search.selectedTranslation = .bsb
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.resultTranslation == .kjv)
        #expect(search.status(account: .kjv)?.hasSuffix(" in KJV. No phrase matches in BSB.") == true)

        search.clear()
        #expect(search.query.isEmpty)
        #expect(search.selectedTranslation == nil)
        #expect(!search.isSearching)
    }

    @Test("an unreachable NKJV is the search error, and Retry runs it again")
    func searchError() async {
        let search = BibleSearchModel(search: BibleSearch(fetch: { _ in throw URLError(.notConnectedToInternet) }))
        search.query = "zzzz qqqq"
        let key = search.taskKey(account: .kjv)
        await search.run(account: .kjv, debounce: .zero)
        #expect(search.error == BibleSearch.error)
        #expect(search.status(account: .kjv) == nil)
        #expect(!search.loading)

        search.retry()
        #expect(search.taskKey(account: .kjv) != key)
    }

    @Test("loading a chapter fills the reader and builds the Ask-AI attachment")
    func loadChapter() async {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 3, verse: 16)
        await model.load(translation: .kjv)

        #expect(model.error == nil)
        #expect(!model.loading)
        #expect(model.verses.count == 36)
        #expect(model.loadedKey == "KJV:43:3")
        #expect(model.verseText(16).hasPrefix("For God so loved the world"))
        #expect(model.chapterText.hasPrefix("1 There was a man of the Pharisees"))
        #expect(model.chapterText.contains("\n16 For God so loved the world"))
    }

    @Test("flashing a verse consumes the deep link exactly once")
    func flashConsumesDeepLink() {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 3, verse: 16)

        model.flash(verse: 16)
        #expect(model.highlightedVerse == 16)
        #expect(model.pendingVerse == nil)
    }

    @Test("jumping to the same verse again re-arms the flash")
    func repeatedJumpReArms() {
        let model = Self.makeModel()
        model.open(order: 43, chapter: 3, verse: 16)
        model.flash(verse: 16)
        #expect(model.pendingVerse == nil)

        // The reader watches `pendingVerse`, so a second quick-jump to the verse
        // already flashed has to move that value again — the chapter itself is
        // unchanged, and nothing else tells the reader to scroll.
        model.open(order: 43, chapter: 3, verse: 16)
        #expect(model.chapter == 3)
        #expect(model.pendingVerse == 16)
        #expect(model.highlightedVerse == nil)
    }
}
