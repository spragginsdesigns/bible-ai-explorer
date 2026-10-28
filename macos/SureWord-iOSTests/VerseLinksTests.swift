import Foundation
import XCTest

@testable import SureWord

/// Ports of `mobile/src/features/chat/verseLinks.test.ts`: which strings become
/// tappable references, how each resolves, and where a tap goes. Each
/// `// describe(...)` names the Android block it mirrors.
final class VerseLinksTests: XCTestCase {
    /// Built from code points, not pasted, like the Android test.
    private let enDash = "\u{2013}"
    private let emDash = "\u{2014}"

    /// Just the linked references, in order.
    private func refs(_ text: String) -> [String] {
        VerseLinks.segments(in: text).compactMap {
            if case .reference(let value) = $0 { return value }
            return nil
        }
    }

    private func resolve(_ raw: String) -> Reference? {
        VersePassages.resolveCitation(raw)
    }

    // describe("resolveVerseReference")

    func testResolvesPlainRangesAliasesAndTags() {
        XCTAssertEqual(resolve("John 3:16"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(resolve("1 John 5:1\(enDash)4"), Reference(order: 62, chapter: 5, verse: 1))
        XCTAssertEqual(resolve("John 3:16-18"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(resolve("Psalm 23:1"), Reference(order: 19, chapter: 23, verse: 1))
        XCTAssertEqual(resolve("Titus 3:5"), Reference(order: 56, chapter: 3, verse: 5))
        XCTAssertEqual(resolve("2 Tim. 4:7"), Reference(order: 55, chapter: 4, verse: 7))
        XCTAssertEqual(resolve("John 3:16 KJV"), Reference(order: 43, chapter: 3, verse: 16))
    }

    func testUnparseableInputResolvesToNothing() {
        XCTAssertNil(resolve("John 99:16"))
        XCTAssertNil(resolve("Notabook 3:16"))
        XCTAssertNil(resolve("hello world"))
    }

    // describe("segmentVerseReferences")

    func testSegmentsASingleReferenceAndRanges() {
        XCTAssertEqual(VerseLinks.segments(in: "John 3:16"), [.reference("John 3:16")])
        XCTAssertEqual(VerseLinks.segments(in: "1 John 5:1\(enDash)4"), [.reference("1 John 5:1\(enDash)4")])
        XCTAssertEqual(VerseLinks.segments(in: "John 3:16-18"), [.reference("John 3:16-18")])
        XCTAssertEqual(VerseLinks.segments(in: "John 3:16 KJV"), [.reference("John 3:16 KJV")])
    }

    func testSegmentsSeveralReferencesWithProseAround() {
        XCTAssertEqual(VerseLinks.segments(in: "See John 3:16 and Romans 5:8 for more."), [
            .text("See "),
            .reference("John 3:16"),
            .text(" and "),
            .reference("Romans 5:8"),
            .text(" for more."),
        ])
        XCTAssertTrue(VerseLinks.segments(in: "\u{201C}For God so loved the world\u{201D} \(emDash) John 3:16")
            .contains(.reference("John 3:16")))
    }

    func testLeavesNonReferencesAsText() {
        XCTAssertEqual(VerseLinks.segments(in: "version 3:16 of the app"), [.text("version 3:16 of the app")])
        XCTAssertEqual(VerseLinks.segments(in: "the quick brown fox jumps over"), [.text("the quick brown fox jumps over")])
        XCTAssertEqual(VerseLinks.segments(in: "see John 99:16 sometime"), [.text("see John 99:16 sometime")])
        XCTAssertEqual(VerseLinks.segments(in: ""), [])
    }

    // describe("C4 cross-chapter ranges and abbreviation forms")

    func testCrossChapterRangeIsCapturedWhole() {
        XCTAssertEqual(refs("Read John 3:16-4:2 for the full discourse."), ["John 3:16-4:2"])
        XCTAssertEqual(resolve("John 3:16-4:2"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(refs("John 3:1234"), [])
    }

    func testEmDashedRange() {
        XCTAssertEqual(refs("Deuteronomy 6:4\(emDash)5 is the Shema."), ["Deuteronomy 6:4\(emDash)5"])
        XCTAssertEqual(resolve("Deuteronomy 6:4\(emDash)5"), Reference(order: 5, chapter: 6, verse: 4))
    }

    func testAbbreviationsWithAndWithoutPeriods() {
        XCTAssertEqual(refs("Gen.1:1 and Rev.22:21 and 2 Pet.1:19 and Rom.8:28"),
                       ["Gen.1:1", "Rev.22:21", "2 Pet.1:19", "Rom.8:28"])
        XCTAssertEqual(resolve("Gen.1:1"), Reference(order: 1, chapter: 1, verse: 1))
        XCTAssertEqual(resolve("2 Pet.1:19"), Reference(order: 61, chapter: 1, verse: 19))
        XCTAssertEqual(refs("Jn 3:16 says it plainly."), ["Jn 3:16"])
        XCTAssertEqual(resolve("Jn 3:16"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(resolve("Mk 1:1"), Reference(order: 41, chapter: 1, verse: 1))
        XCTAssertEqual(resolve("Ps 23:1"), Reference(order: 19, chapter: 23, verse: 1))
    }

    func testSpacelessNumeralForms() {
        XCTAssertEqual(refs("as 1Cor 2:14 puts it"), ["1Cor 2:14"])
        XCTAssertEqual(resolve("1Cor 2:14"), Reference(order: 46, chapter: 2, verse: 14))
        XCTAssertEqual(refs("as 1Thess 1:1 opens"), ["1Thess 1:1"])
        XCTAssertEqual(refs("2Pet.1:19 shines in a dark place"), ["2Pet.1:19"])
        XCTAssertEqual(resolve("1Jn 5:1"), Reference(order: 62, chapter: 5, verse: 1))
        XCTAssertEqual(refs("see 1Isaiah 5:3 there"), [])
    }

    func testSongOfSongs() {
        XCTAssertEqual(refs("Song of Songs 2:1"), ["Song of Songs 2:1"])
        XCTAssertEqual(resolve("Song of Songs 2:1"), Reference(order: 22, chapter: 2, verse: 1))
    }

    func testRegressionSweepResolvesToTheSameBooks() {
        let sweep: [(String, Int)] = [
            ("John 3:16", 43), ("1 John 3:16", 62), ("3 John 1:4", 64), ("Psalm 23:1-6", 19),
            ("Gen. 1:1-3", 1), ("1 Cor. 2:14", 46), ("Judges 6:12", 7), ("Jude 1:3", 65),
            ("Philemon 1:6", 57), ("Philippians 4:13", 50), ("2 Tim. 4:7", 55), ("Titus 3:5", 56),
            ("1 John 5:1\(enDash)4", 62),
        ]
        for (input, order) in sweep {
            XCTAssertEqual(refs(input), [input], input)
            XCTAssertEqual(resolve(input)?.order, order, input)
        }
    }

    func testColonIntroducingAQuoteAndTimesOfDay() {
        XCTAssertEqual(refs("can be found in John 3:14: \n\n> And as Moses lifted up"), ["John 3:14"])
        XCTAssertEqual(refs("the meeting is at 3:16 John said"), [])
        XCTAssertEqual(refs("xJohn 3:16"), [])
    }

    // Spanish and German answers (the Apple book table carries both).

    func testLocalizedBookNamesLinkAndOpenTheEnglishReader() {
        XCTAssertEqual(refs("Como dice Juan 3:16 y G\u{00E9}nesis 1:1."), ["Juan 3:16", "G\u{00E9}nesis 1:1"])
        XCTAssertEqual(refs("Wie 1. Mose 1:1 sagt"), ["1. Mose 1:1"])
        XCTAssertEqual(VerseLinks.readerReference(for: "Juan 3:16"), "John 3:16")
        XCTAssertEqual(VerseLinks.readerReference(for: "1. Mose 1:1"), "Genesis 1:1")
    }

    // describe("openReferenceInReader")

    func testReaderReferenceOpensAtTheFirstVerse() {
        XCTAssertEqual(VerseLinks.readerReference(for: "John 3:16"), "John 3:16")
        XCTAssertEqual(VerseLinks.readerReference(for: "1 John 5:1\(enDash)4"), "1 John 5:1")
        XCTAssertEqual(VerseLinks.readerReference(for: "Ps 23:1-6 KJV"), "Psalms 23:1")
        XCTAssertNil(VerseLinks.readerReference(for: "John 99:16"))
        XCTAssertNil(VerseLinks.readerReference(for: "total nonsense"))
    }

    // Link building (Android's markdown-it integration block).

    private func linkedReferences(_ attributed: AttributedString) -> [String] {
        attributed.runs.compactMap { run in
            guard let url = run.link else { return nil }
            return VerseLinks.reference(from: url)
        }
    }

    private func markdown(_ source: String) throws -> AttributedString {
        try AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    }

    func testURLRoundTripsTheRawReference() throws {
        for raw in ["John 3:16", "1 John 5:1\(enDash)4", "Juan 3:16", "G\u{00E9}nesis 1:1", "Song of Songs 2:1 KJV"] {
            let url = try XCTUnwrap(VerseLinks.url(for: raw))
            XCTAssertEqual(url.scheme, VerseLinks.scheme)
            XCTAssertEqual(VerseLinks.reference(from: url), raw)
        }
        XCTAssertNil(VerseLinks.reference(from: URL(string: "https://example.com/John 3:16".replacingOccurrences(of: " ", with: "%20"))!))
    }

    func testLinksReferencesInsideProseAndStrongText() throws {
        let text = VerseLinks.linkingReferences(in: try markdown("Paul quotes Psalm 23:1, then **Titus 3:5** and 1 John 5:1\(enDash)4."))
        XCTAssertEqual(linkedReferences(text), ["Psalm 23:1", "Titus 3:5", "1 John 5:1\(enDash)4"])
        XCTAssertEqual(String(text.characters), "Paul quotes Psalm 23:1, then Titus 3:5 and 1 John 5:1\(enDash)4.")
    }

    func testOrdinaryLinksAndCodeSpansAreLeftAlone() throws {
        let text = VerseLinks.linkingReferences(in: try markdown("See John 3:16 on [this site](https://example.com), not `John 3:16` or [John 3:16](https://example.com)."))
        XCTAssertEqual(linkedReferences(text), ["John 3:16"])
        let others = text.runs.compactMap(\.link).filter { $0.scheme == "https" }
        XCTAssertEqual(others.count, 2)
    }

    func testUnparseableLookalikesProduceNoLinks() throws {
        let text = VerseLinks.linkingReferences(in: try markdown("version 3:16 and John 99:16 are not links"))
        XCTAssertEqual(text.runs.compactMap(\.link), [])
    }

    func testQuestionTextIsLinkedWithoutMarkdown() {
        let text = VerseLinks.linkedPlainText("What does **John 3:16** mean?")
        XCTAssertEqual(String(text.characters), "What does **John 3:16** mean?")
        XCTAssertEqual(linkedReferences(text), ["John 3:16"])
    }

    func testMatchesAreMemoizedAndStable() {
        let text = "See John 3:16 now, and Romans 5:8."
        let first = VerseLinks.matches(in: text).map(\.value)
        let second = VerseLinks.matches(in: text).map(\.value)
        XCTAssertEqual(first, ["John 3:16", "Romans 5:8"])
        XCTAssertEqual(second, first)
    }

    // MessageBubble's onVerseReference: retrieved passage first, then reader.

    private func retrieved(_ reference: String, source: RetrievedVerse.Source? = .passage) -> RetrievedVerse {
        RetrievedVerse(reference: reference, similarity: 0, text: "text", translation: .kjv, source: source)
    }

    func testAReferenceThisTurnRetrievedOpensItsPassage() throws {
        let grouped = GroupedVerses(verses: [
            retrieved("John 3:16"), retrieved("John 3:17"), retrieved("Romans 5:8"),
        ])
        let johnKey = try XCTUnwrap(grouped.passage(for: "John 3:16")?.key)
        XCTAssertEqual(VerseLinks.destination(for: "John 3:16-17", grouped: grouped), .passage(key: johnKey))
        XCTAssertEqual(VerseLinks.destination(for: "Jn 3:17 KJV", grouped: grouped), .passage(key: johnKey))
        XCTAssertEqual(
            VerseLinks.destination(for: "Romans 5:8", grouped: grouped),
            .passage(key: try XCTUnwrap(grouped.passage(for: "Romans 5:8")?.key))
        )
    }

    func testAnythingElseOpensTheReader() {
        let grouped = GroupedVerses(verses: [retrieved("John 3:16")])
        XCTAssertEqual(VerseLinks.destination(for: "Juan 1:1", grouped: grouped), .reader(reference: "John 1:1"))
        // A question (or a streaming answer) has no passages to open.
        XCTAssertEqual(VerseLinks.destination(for: "John 3:16", grouped: nil), .reader(reference: "John 3:16"))
        XCTAssertNil(VerseLinks.destination(for: "John 99:16", grouped: nil))
    }
}
