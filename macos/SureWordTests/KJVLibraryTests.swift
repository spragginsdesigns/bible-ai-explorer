import Foundation
import Testing
@testable import SureWord

/// Port of `mobile/src/features/bible/kjv.test.ts`. These also stand as the
/// proof that the 66 book JSONs actually landed in the built app bundle — if
/// XcodeGen stopped copying `Bible/Data/`, every case here fails.
@Suite("Bundled KJV")
struct KJVLibraryTests {
    @Test("loads a chapter from the bundle")
    func chapterLoads() async throws {
        let john3 = try await KJVLibrary.shared.chapter(order: 43, chapter: 3)
        #expect(john3.count == 36)
        #expect(john3[15].hasPrefix("For God so loved the world"))

        let psalm23 = try await KJVLibrary.shared.chapter(order: 19, chapter: 23)
        #expect(psalm23.first == "The LORD is my shepherd; I shall not want.")
    }

    @Test("every book's text is bundled and matches its chapter count")
    func everyBookIsBundled() async throws {
        for book in Bible.books {
            let last = try await KJVLibrary.shared.chapter(order: book.order, chapter: book.chapters)
            #expect(!last.isEmpty, "\(book.name) \(book.chapters) is empty")
        }
    }

    @Test("rejects chapters outside the book")
    func outOfRange() async {
        await #expect(throws: BibleError.self) {
            try await KJVLibrary.shared.chapter(order: 65, chapter: 2)
        }
        await #expect(throws: BibleError.self) {
            try await KJVLibrary.shared.chapter(order: 43, chapter: 0)
        }
        await #expect(throws: BibleError.self) {
            try await KJVLibrary.shared.chapter(order: 67, chapter: 1)
        }
    }

    @Test("matches case-insensitively")
    func caseInsensitive() async {
        let lower = await KJVLibrary.shared.search("in the beginning", limit: 5)
        let upper = await KJVLibrary.shared.search("IN THE BEGINNING", limit: 5)
        #expect(!lower.isEmpty)
        #expect(lower == upper)
    }

    @Test("returns hits in canonical book/chapter/verse order")
    func canonicalOrder() async {
        let hits = await KJVLibrary.shared.search("God", limit: 200)
        #expect(hits.count > 1)
        for (previous, current) in zip(hits, hits.dropFirst()) {
            let ordered =
                previous.order < current.order
                || (previous.order == current.order
                    && (previous.chapter < current.chapter
                        || (previous.chapter == current.chapter && previous.verse < current.verse)))
            #expect(ordered)
        }
    }

    @Test("finds a known verse with the right location and text")
    func knownVerse() async {
        let hits = await KJVLibrary.shared.search("For God so loved the world")
        #expect(hits.count == 1)
        let hit = try? #require(hits.first)
        #expect(hit?.order == 43)
        #expect(hit?.chapter == 3)
        #expect(hit?.verse == 16)
        #expect(hit?.text.lowercased().contains("for god so loved the world") == true)
    }

    @Test("respects the limit")
    func limit() async {
        let seven = await KJVLibrary.shared.search("the", limit: 7)
        #expect(seven.count == 7)
        let capped = await KJVLibrary.shared.search("the")
        #expect(capped.count <= KJVLibrary.defaultSearchLimit)
    }

    @Test("returns nothing for empty or whitespace-only queries")
    func empty() async {
        #expect(await KJVLibrary.shared.search("").isEmpty)
        #expect(await KJVLibrary.shared.search("   ").isEmpty)
    }
}
