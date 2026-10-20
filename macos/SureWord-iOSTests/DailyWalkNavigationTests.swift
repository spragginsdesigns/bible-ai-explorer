import XCTest
@testable import SureWord

@MainActor
final class DailyWalkNavigationTests: XCTestCase {
    func testLegacyDestinationsSelectTheirOwningSection() {
        XCTAssertEqual(AppSection.notes.primary, .study)
        XCTAssertEqual(AppSection.cross.primary, .today)
        XCTAssertFalse(AppSection.allCases.contains(.notes))
        XCTAssertFalse(AppSection.allCases.contains(.cross))
    }

    func testEveryPrimaryRetainsItsOwnIdentity() {
        XCTAssertEqual(AppSection.allCases.count, 5)
        for section in AppSection.allCases { XCTAssertEqual(section.primary, section) }
    }

    func testValidConnectionsContextRetainsChapterAndVerse() {
        let place = ConnectionsPlace.validated(order: 45, chapter: 8, verse: 28)
        XCTAssertEqual(place?.reference, "Romans 8:28")
        XCTAssertEqual(ConnectionsPlace.validated(order: 43, chapter: 3, verse: nil)?.reference, "John 3")
    }

    func testMalformedConnectionsContextIsRejected() {
        XCTAssertNil(ConnectionsPlace.validated(order: 0, chapter: 1, verse: nil))
        XCTAssertNil(ConnectionsPlace.validated(order: 67, chapter: 1, verse: nil))
        XCTAssertNil(ConnectionsPlace.validated(order: 43, chapter: 22, verse: nil))
        XCTAssertNil(ConnectionsPlace.validated(order: 43, chapter: 0, verse: nil))
        XCTAssertNil(ConnectionsPlace.validated(order: 43, chapter: 3, verse: 0))
    }

    func testCanonSectionsCoverEveryBookExactlyOnce() {
        for order in 1...66 {
            XCTAssertEqual(ConnectionCanonSection.all.filter { ($0.first...$0.last).contains(order) }.count, 1)
        }
        XCTAssertEqual(ConnectionCanonSection.containing(44).id, "acts")
        XCTAssertEqual(ConnectionCanonSection.containing(66).id, "revelation")
    }

    func testRingAngleInverseAndCanonGap() {
        for index in [0, 1, 1500, 15550, 31101] {
            let angle = ConnectionsGeometry.angle(index: Double(index), total: 31102)
            XCTAssertEqual(ConnectionsGeometry.index(angle: angle, total: 31102), index)
        }
        XCTAssertNil(ConnectionsGeometry.index(angle: -.pi / 2, total: 31102))
        XCTAssertNil(ConnectionsGeometry.index(angle: 0, total: 0))
    }

    func testRingBookBoundaryDoesNotBleedIntoAdjacentBook() {
        let books = [[1, 0, 100], [2, 100, 80], [3, 180, 50]]
        XCTAssertEqual(ConnectionsGeometry.book(index: 99, books: books), 1)
        XCTAssertEqual(ConnectionsGeometry.book(index: 100, books: books), 2)
        XCTAssertNil(ConnectionsGeometry.book(index: 230, books: books))
    }

    func testRankedLinksPreserveServerOrderAndFocus() {
        let chapter = ConnectionsChapter(order: 43, chapter: 3, book: "John", verseCount: 36, chapterStart: 100, total: 31102,
            books: [[1, 0, 1533]], links: [[16, 45, 5, 8, 200], [16, 1, 1, 1, 0], [17, 45, 8, 1, 250]])
        XCTAssertTrue(chapter.isValid)
        XCTAssertEqual(chapter.ranked(verse: 16, section: nil).count, 2)
        XCTAssertEqual(chapter.ranked(verse: 16, section: "pauline"), [[16, 45, 5, 8, 200]])
        XCTAssertTrue(chapter.ranked(verse: 16, section: "acts").isEmpty)
    }

    func testBadTupleShapeIsRejectedBeforeRingDrawing() {
        let chapter = ConnectionsChapter(order: 43, chapter: 3, book: "John", verseCount: 36, chapterStart: 100, total: 31102,
            books: [[1, 0, 1533]], links: [[16, 45]])
        XCTAssertFalse(chapter.isValid)
        XCTAssertTrue(chapter.ranked(verse: nil, section: nil).isEmpty)
    }

    func testExplanationSeparatesSummaryAndPassageCards() {
        let parsed = ConnectionExplanation.parse("God's love is the thread.\n**Romans 5:8** :: Christ died for us.\nA continuation.\nJohn 3:17 :: Salvation through Him.", complete: true)
        XCTAssertEqual(parsed.summary, "God's love is the thread.")
        XCTAssertEqual(parsed.items.count, 2)
        XCTAssertEqual(parsed.items[0].reference, "Romans 5:8")
        XCTAssertEqual(parsed.items[0].text, "Christ died for us. A continuation.")
    }

    func testPartialStreamDoesNotPublishAnUnfinishedReference() {
        let parsed = ConnectionExplanation.parse("Summary.\nRomans 5:8 :: Christ died for us.\nJohn 3", complete: false)
        XCTAssertEqual(parsed.items.count, 1)
        XCTAssertEqual(parsed.items[0].text, "Christ died for us.")
    }

    func testPreviewAcceptsAnExistingWordWithoutGenerationFields() throws {
        let data = Data(#"{"reference":"John 3:16","text":"For God so loved the world."}"#.utf8)
        let preview = try JSONDecoder().decode(DailyWalkPreview.self, from: data)
        XCTAssertEqual(preview.reference, "John 3:16")
    }
}
