import Foundation
import Testing
@testable import SureWord

/// Port of `mobile/src/features/bible/books.test.ts`, plus the chapter-rolling
/// cases that live inline in `mobile/app/(app)/bible/chapter.tsx`.
@Suite("Bible books")
struct BibleBooksTests {
    @Test("books.json is bundled and complete")
    func bundledData() throws {
        #expect(Bible.books.count == 66)
        #expect(Bible.books.map(\.order) == Array(1...66))
        #expect(Bible.books(in: .ot).count == 39)
        #expect(Bible.books(in: .nt).count == 27)
    }

    @Test("book(order:) returns the book for a valid order")
    func bookByOrder() {
        #expect(Bible.book(order: 43)?.name == "John")
        #expect(Bible.book(order: 1)?.name == "Genesis")
        #expect(Bible.book(order: 66)?.name == "Revelation")
    }

    @Test("book(order:) returns nil out of range")
    func bookByOrderOutOfRange() {
        #expect(Bible.book(order: 0) == nil)
        #expect(Bible.book(order: 67) == nil)
    }

    @Test("group(order:) maps books to their genre group")
    func genreGroups() {
        #expect(Bible.group(order: 1) == .law)
        #expect(Bible.group(order: 5) == .law)
        #expect(Bible.group(order: 6) == .history)
        #expect(Bible.group(order: 18) == .poetry)
        #expect(Bible.group(order: 23) == .majorProphets)
        #expect(Bible.group(order: 39) == .minorProphets)
        #expect(Bible.group(order: 40) == .gospels)
        // Acts sits between the Gospels and the Epistles but reads as history.
        #expect(Bible.group(order: 44) == .history)
        #expect(Bible.group(order: 57) == .paulsEpistles)
        #expect(Bible.group(order: 58) == .generalEpistles)
        #expect(Bible.group(order: 66) == .prophecy)
    }

    @Test("group(order:) returns nil out of range")
    func genreGroupsOutOfRange() {
        #expect(Bible.group(order: 0) == nil)
        #expect(Bible.group(order: 67) == nil)
    }
}

@Suite("Reference parsing")
struct ReferenceParsingTests {
    @Test("parses book, chapter and verse")
    func full() {
        #expect(Bible.resolveReference("John 3:16") == Reference(order: 43, chapter: 3, verse: 16))
    }

    @Test("parses a chapter-only reference")
    func chapterOnly() {
        #expect(Bible.resolveReference("Psalm 23") == Reference(order: 19, chapter: 23, verse: nil))
    }

    @Test("parses abbreviations")
    func abbreviations() {
        #expect(Bible.resolveReference("Gen 1") == Reference(order: 1, chapter: 1, verse: nil))
        #expect(Bible.resolveReference("1 Cor 13:4") == Reference(order: 46, chapter: 13, verse: 4))
    }

    @Test("parses numbered books with full names")
    func numberedBooks() {
        #expect(Bible.resolveReference("1 Samuel 2:1") == Reference(order: 9, chapter: 2, verse: 1))
        #expect(Bible.resolveReference("2 Kings 25") == Reference(order: 12, chapter: 25, verse: nil))
    }

    @Test("returns the start verse of a range")
    func ranges() {
        #expect(Bible.resolveReference("1 Samuel 2:1-10") == Reference(order: 9, chapter: 2, verse: 1))
        #expect(Bible.resolveReference("John 3:16-18") == Reference(order: 43, chapter: 3, verse: 16))
        // En and em dashes too — chat answers use both.
        #expect(Bible.resolveReference("John 3:16–18") == Reference(order: 43, chapter: 3, verse: 16))
        #expect(Bible.resolveReference("John 3:16—18") == Reference(order: 43, chapter: 3, verse: 16))
    }

    @Test("is case-insensitive and tolerant of punctuation and whitespace")
    func tolerance() {
        #expect(Bible.resolveReference("john 3:16") == Reference(order: 43, chapter: 3, verse: 16))
        #expect(Bible.resolveReference("GEN. 1") == Reference(order: 1, chapter: 1, verse: nil))
        #expect(
            Bible.resolveReference("  Song of Solomon  4 ")
                == Reference(order: 22, chapter: 4, verse: nil)
        )
        #expect(Bible.resolveReference("Song of Songs 4") == Reference(order: 22, chapter: 4, verse: nil))
    }

    @Test("rejects unresolvable input")
    func rejects() {
        #expect(Bible.resolveReference("") == nil)
        #expect(Bible.resolveReference("Not a reference") == nil)
        #expect(Bible.resolveReference("Hezekiah 1:1") == nil)
        #expect(Bible.resolveReference("John") == nil)
        #expect(Bible.resolveReference("John 3:16 extra") == nil)
    }

    @Test("rejects chapters outside the book")
    func rejectsChapters() {
        #expect(Bible.resolveReference("Jude 2") == nil)
        #expect(Bible.resolveReference("Genesis 51") == nil)
        #expect(Bible.resolveReference("John 0") == nil)
    }
}

@Suite("Chapter rolling")
struct ChapterRollingTests {
    @Test("steps within a book")
    func withinBook() {
        #expect(
            Bible.next(from: .init(order: 43, chapter: 3)) == Bible.Location(order: 43, chapter: 4)
        )
        #expect(
            Bible.previous(from: .init(order: 43, chapter: 3)) == Bible.Location(order: 43, chapter: 2)
        )
    }

    @Test("rolls forward into chapter 1 of the next book")
    func rollsForward() {
        // John ends at 21; Acts follows.
        #expect(
            Bible.next(from: .init(order: 43, chapter: 21)) == Bible.Location(order: 44, chapter: 1)
        )
    }

    @Test("rolls back into the last chapter of the previous book")
    func rollsBack() {
        // Before Acts 1 is John 21.
        #expect(
            Bible.previous(from: .init(order: 44, chapter: 1)) == Bible.Location(order: 43, chapter: 21)
        )
        // Before Genesis 2 is Genesis 1, not another book.
        #expect(
            Bible.previous(from: .init(order: 1, chapter: 2)) == Bible.Location(order: 1, chapter: 1)
        )
    }

    @Test("stops at both ends of the canon")
    func canonEdges() {
        #expect(Bible.previous(from: .init(order: 1, chapter: 1)) == nil)
        #expect(Bible.next(from: .init(order: 66, chapter: 22)) == nil)
    }

    @Test("every chapter of the canon is reachable by paging forward")
    func fullTraversal() {
        var location = Bible.Location(order: 1, chapter: 1)
        var visited = 1
        while let next = Bible.next(from: location) {
            location = next
            visited += 1
        }
        #expect(location == Bible.Location(order: 66, chapter: 22))
        #expect(visited == Bible.books.reduce(0) { $0 + $1.chapters })
    }
}
