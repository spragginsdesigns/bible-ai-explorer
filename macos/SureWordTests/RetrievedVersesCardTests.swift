import Testing
@testable import SureWord

@Suite("RetrievedVersesCard")
struct RetrievedVersesCardTests {
    private func hit(_ reference: String) -> RetrievedVerse {
        RetrievedVerse(reference: reference, similarity: 0.7, text: "t", translation: .kjv)
    }

    @Test("Shows four chips inline and folds the rest into +N more")
    func inlineChips() {
        let grouped = GroupedVerses(
            verses: ["Acts 19:1", "Acts 19:3", "Acts 19:5", "Acts 19:7", "Acts 19:9", "Acts 19:11"].map(hit)
        )
        let chips = grouped.inlineChips
        #expect(chips.shown.map(\.reference) == ["Acts 19:1", "Acts 19:3", "Acts 19:5", "Acts 19:7"])
        #expect(chips.hidden == 2)
    }

    @Test("A short answer shows every chip and no +N more")
    func noOverflow() {
        let chips = GroupedVerses(verses: [hit("Acts 19:1")]).inlineChips
        #expect(chips.shown.count == 1)
        #expect(chips.hidden == 0)
    }
}
