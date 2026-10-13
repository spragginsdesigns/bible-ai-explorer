import XCTest
@testable import SureWord

/// The LC Greek contract (LC-15842), pinned to `LC_GREEK`, `hasLcGreek` and
/// `parseLcGreek` in src/lib/bible/audioBible.ts.
final class LCGreekTests: XCTestCase {
    private func json(_ text: String) -> Data { Data(text.utf8) }

    func testNamesTheTextLikeWeb() {
        XCTAssertEqual(LCGreek.label, "LC Greek")
        XCTAssertEqual(LCGreek.note, "Our own translation of the Greek · the text Alive reads")
        XCTAssertEqual(LCGreek.copyright, "SureWord's own translation of the Textus Receptus")
        XCTAssertEqual(LCGreek.preferenceKey, "sureword-lc-greek")
        XCTAssertEqual(LCGreek.path(book: 41, chapter: 1), "/api/bible/lc-greek?book=41&chapter=1")
    }

    func testEveryAliveBookHasItsLCGreek() {
        XCTAssertTrue(LCGreek.has(41)); XCTAssertFalse(LCGreek.has(40)); XCTAssertFalse(LCGreek.has(43))
        for book in 1...66 { XCTAssertEqual(LCGreek.has(book), ChapterAudio.hasAlive(book)) }
    }

    func testAcceptsOnlyAReadyChapterForTheAskedReference() {
        XCTAssertEqual(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":1,"verses":["The beginning.","As it is written."]}"#), book: 41, chapter: 1), ["The beginning.", "As it is written."])
        XCTAssertNil(LCGreek.parse(json(#"{"status":"unavailable"}"#), book: 41, chapter: 1))
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":2,"verses":["x"]}"#), book: 41, chapter: 1), "another chapter")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":40,"chapter":1,"verses":["x"]}"#), book: 41, chapter: 1), "another book")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":"41","chapter":1,"verses":["x"]}"#), book: 41, chapter: 1), "a string book")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":1,"verses":[]}"#), book: 41, chapter: 1), "no verses")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":1}"#), book: 41, chapter: 1), "verses missing")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":1,"verses":["x","  \n"]}"#), book: 41, chapter: 1), "a blank verse")
        XCTAssertNil(LCGreek.parse(json(#"{"status":"ready","book":41,"chapter":1,"verses":["x",2]}"#), book: 41, chapter: 1), "a verse that is not text")
        XCTAssertNil(LCGreek.parse(json("[]"), book: 41, chapter: 1))
        XCTAssertNil(LCGreek.parse(json("not json"), book: 41, chapter: 1))
    }

    func testFetchesEachChapterOnceAndFailsAsTheChapterError() async throws {
        let calls = Calls()
        let provider = LCGreekProvider { path in
            await calls.record(path)
            if path.hasSuffix("chapter=2") { throw URLError(.notConnectedToInternet) }
            return Data(#"{"status":"ready","book":41,"chapter":1,"verses":["The beginning."]}"#.utf8)
        }
        let first = try await provider.chapter(book: 41, chapter: 1)
        let again = try await provider.chapter(book: 41, chapter: 1)
        XCTAssertEqual(first, ["The beginning."]); XCTAssertEqual(again, first)
        do {
            _ = try await provider.chapter(book: 41, chapter: 2)
            XCTFail("a failed fetch is a load error")
        } catch {
            XCTAssertEqual(error as? BibleError, BibleError(message: BibleTranslations.chapterLoadError))
        }
        do {
            _ = try await provider.chapter(book: 43, chapter: 1)
            XCTFail("a book without the LC Greek is never fetched")
        } catch {}
        let paths = await calls.paths
        XCTAssertEqual(paths, ["/api/bible/lc-greek?book=41&chapter=1", "/api/bible/lc-greek?book=41&chapter=2"])
    }
}

private actor Calls {
    private(set) var paths: [String] = []
    func record(_ path: String) { paths.append(path) }
}
