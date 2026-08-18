import XCTest

@testable import SureWord

/// The iOS Bible tab's list-flattening and deep-link routing — the Lane 2
/// view-model logic. Reader state itself (`BibleModel`) is covered by the
/// macOS suite, which tests the same shared code.
@MainActor
final class BibleBookListTests: XCTestCase {
    private func bookRows(in rows: [BibleBookList.Row], testament: Book.Testament) -> [Book] {
        rows.compactMap { row in
            guard case .book(let book) = row, book.testament == testament else { return nil }
            return book
        }
    }

    func testExpandedListContainsAll66Books() {
        let rows = BibleBookList.rows(collapsed: [])
        XCTAssertEqual(bookRows(in: rows, testament: .ot).count, 39)
        XCTAssertEqual(bookRows(in: rows, testament: .nt).count, 27)
    }

    func testRowsOpenWithOldTestamentLawAndGenesis() {
        let rows = BibleBookList.rows(collapsed: [])
        guard rows.count >= 3 else { return XCTFail("expected header rows") }

        XCTAssertEqual(rows[0], .testament(.ot, count: 39, expanded: true))
        XCTAssertEqual(rows[1], .group(.law, in: .ot))
        XCTAssertEqual(rows[2], .book(Bible.books[0]))
    }

    func testGenreHeadersInterleaveLikeAndroid() throws {
        let rows = BibleBookList.rows(collapsed: [])
        // Matthew is preceded by the Gospels header; Acts re-opens History in
        // the NT (the group spans both testaments).
        let matthew = try XCTUnwrap(rows.firstIndex(of: .book(Bible.books[39])))
        let gospels = try XCTUnwrap(rows.firstIndex(of: .group(.gospels, in: .nt)))
        let acts = try XCTUnwrap(rows.firstIndex(of: .book(Bible.books[43])))
        let ntHistory = try XCTUnwrap(rows.firstIndex(of: .group(.history, in: .nt)))
        XCTAssertLessThan(gospels, matthew)
        XCTAssertLessThan(ntHistory, acts)
    }

    func testCollapsedTestamentHidesOnlyItsOwnBooks() {
        let rows = BibleBookList.rows(collapsed: [.ot])
        XCTAssertEqual(rows.first, .testament(.ot, count: 39, expanded: false))
        XCTAssertEqual(bookRows(in: rows, testament: .ot).count, 0)
        XCTAssertEqual(bookRows(in: rows, testament: .nt).count, 27)
    }

    func testRowIDsAreUniqueAcrossTheWholeList() {
        // One ForEach renders both testaments; History exists in each, so the
        // group ids must carry the testament to avoid a collision.
        let ids = BibleBookList.rows(collapsed: []).map(\.id)
        XCTAssertEqual(ids.count, Set(ids).count)
    }

    func testReaderRequestsAreUniquePerDeepLink() {
        // Two jumps to the same verse must each push the reader, so identity
        // can never come from the location alone.
        let first = BibleReaderRequest(order: 43, chapter: 3, verse: 16)
        let second = BibleReaderRequest(order: 43, chapter: 3, verse: 16)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first.order, 43)
        XCTAssertEqual(first.verse, 16)
    }
}
