import Foundation
import Testing

@testable import SureWord

/// Replays `tests/verse-selection.test.mjs` case for case against the Swift
/// port, so the phone sheet grows, re-anchors, clears and caps exactly as the
/// Android and web sheets do.
@Suite("Verse selection (mirrors tests/verse-selection.test.mjs)")
struct VerseSelectionTests {
    private func range(_ start: Int, _ end: Int) -> VerseSelection { VerseSelection(start: start, end: end) }

    @Test("tapping grows, re-anchors, clears and caps the range")
    func tapRules() {
        #expect(VerseSelection.toggle(nil, verse: 4) == range(4, 4))
        #expect(VerseSelection.toggle(range(4, 4), verse: 4) == nil)
        #expect(VerseSelection.toggle(range(4, 4), verse: 7) == range(4, 7))
        #expect(VerseSelection.toggle(range(4, 7), verse: 5) == range(5, 5))
        let full = range(1, VerseSelection.maxVerses)
        #expect(VerseSelection.toggle(full, verse: VerseSelection.maxVerses + 1) == full)
    }

    @Test("references, text and share payloads carry the range")
    func payloads() {
        #expect(range(1, 3).reference(bookName: "Genesis", chapter: 1) == "Genesis 1:1-3")
        #expect(range(2, 2).reference(bookName: "Genesis", chapter: 1) == "Genesis 1:2")
        #expect(range(1, 2).text(in: ["a", "b", "c"]) == "1 a 2 b")
        #expect(range(3, 3).text(in: ["a", "b", "c"]) == "c")
        #expect(
            VerseSelection.shareText(reference: "Genesis 1:1-2", text: "1 a 2 b", translation: "KJV")
                == "Genesis 1:1-2 \u{2014} \"1 a 2 b\" (KJV)"
        )
    }

    @Test("a shared highlight color needs every verse to carry it")
    func sharedColor() {
        let highlights = [1: "#F5D76E", 2: "#F5D76E"]
        #expect(range(1, 2).sharedColor(in: highlights) == "#F5D76E")
        #expect(range(1, 3).sharedColor(in: highlights) == nil)
    }

    @Test("the cap is ten verses and growing backwards keeps the range contiguous")
    func capAndBackwards() {
        #expect(VerseSelection.maxVerses == 10)
        #expect(VerseSelection.capMessage == "Up to 10 verses at a time.")
        #expect(VerseSelection.toggle(range(5, 6), verse: 2) == range(2, 6))
        #expect(VerseSelection.toggle(range(1, 10), verse: 10) == range(10, 10))
        #expect(range(3, 5).verses == [3, 4, 5])
        #expect(range(3, 5).count == 3)
        // Colours compare case-insensitively, as the TypeScript does.
        #expect(range(1, 2).sharedColor(in: [1: "#f5d76e", 2: "#F5D76E"]) == "#f5d76e")
    }
}

@MainActor
@Suite("Verse sheet model")
struct VerseSheetModelTests {
    private func makeModel() -> VerseSheetModel {
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, token: { _ in nil }, onAuthFailure: {})
        return VerseSheetModel(insight: VerseInsightModel(api: api))
    }

    private let context = VerseSheetContext(
        order: 43,
        bookName: "John",
        chapter: 3,
        plainTexts: (1...36).map { "v\($0)" },
        translation: .bsb
    )

    @Test("a fresh open starts at the peek on Explain and grows on a second tap")
    func openAndGrow() {
        let model = makeModel()
        model.tier = .expanded
        model.studyTab = .words
        #expect(model.tap(16, context: context))
        #expect(model.isOpen)
        #expect(model.tier == .peek)
        #expect(model.studyTab == .explain)
        #expect(model.reference(context) == "John 3:16")
        #expect(model.subtitle == nil)

        #expect(model.tap(18, context: context))
        #expect(model.selection == VerseSelection(start: 16, end: 18))
        #expect(model.reference(context) == "John 3:16-18")
        #expect(model.text(context) == "16 v16 17 v17 18 v18")
        #expect(model.subtitle == "3 verses")
        #expect(model.shareText(context) == "John 3:16-18 \u{2014} \"16 v16 17 v17 18 v18\" (BSB)")
    }

    @Test("the cap refuses the tap and says why; the next tap clears the message")
    func capMessage() {
        let model = makeModel()
        model.tap(1, context: context)
        model.tap(10, context: context)
        #expect(!model.tap(11, context: context))
        #expect(model.selection == VerseSelection(start: 1, end: 10))
        #expect(model.actionMessage == .init(text: "Up to 10 verses at a time.", tone: .muted))
        model.tap(4, context: context)
        #expect(model.selection == VerseSelection(start: 4, end: 4))
        #expect(model.actionMessage == nil)
    }

    @Test("tapping the only verse closes; the shown selection survives for the slide-out")
    func closeKeepsShownSelection() {
        let model = makeModel()
        model.tap(7, context: context)
        model.tap(7, context: context)
        #expect(!model.isOpen)
        #expect(model.activeSelection == VerseSelection(start: 7, end: 7))
        #expect(!model.obscuresReader)
    }

    @Test("only the expanded study view obscures the reader")
    func obscures() {
        let model = makeModel()
        model.tap(2, context: context)
        #expect(!model.obscuresReader)
        model.openStudy(.seeAlso)
        #expect(model.obscuresReader)
        #expect(model.studyTab == .seeAlso)
        model.toggleTier()
        #expect(model.tier == .peek)
    }

    @Test("Learn adds a range verse by verse, then reports it")
    func learnRange() async {
        let model = makeModel()
        model.tap(16, context: context)
        model.tap(17, context: context)
        var posted: [VerseLearnRequest] = []
        let added = await model.addToLearn(context: context, highlighted: true) { body in
            posted.append(body)
            return VerseLearnCard(id: "c\(body.verse)", book: body.book, chapter: body.chapter, verse: body.verse)
        }
        #expect(added)
        #expect(posted.map(\.verse) == [16, 17])
        #expect(posted.allSatisfy { $0.translation == "BSB" && $0.source == "highlight" && $0.book == 43 })
        #expect(model.learnStatus == .added)
        #expect(model.actionMessage == .init(text: "Added 2 verses to Learn.", tone: .muted))
        // A new selection is a different thing to learn.
        model.tap(20, context: context)
        #expect(model.learnStatus == .idle)
    }

    @Test("Learn rejects a card for another verse and leaves the chip retryable")
    func learnMismatch() async {
        let model = makeModel()
        model.tap(16, context: context)
        let added = await model.addToLearn(context: context, highlighted: false) { body in
            VerseLearnCard(id: "x", book: body.book, chapter: body.chapter, verse: body.verse + 1)
        }
        #expect(!added)
        #expect(model.learnStatus == .idle)
        #expect(model.actionMessage == .init(text: VerseSheetModel.learnError, tone: .danger))
    }

    @Test("a chapter change drops the selection")
    func chapterChange() {
        let model = makeModel()
        model.tap(3, context: context)
        model.chapterChanged()
        #expect(!model.isOpen)
    }
}
