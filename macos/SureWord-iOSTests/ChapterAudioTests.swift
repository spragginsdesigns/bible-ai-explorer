import XCTest
@testable import SureWord

final class ChapterAudioTests: XCTestCase {
    func testTimingFollowsTheVerseAndKeepsTheHeadingUnselected() throws {
        let data = Data(#"{"status":"ready","book":43,"chapter":3,"audioUrl":"https://example.com/chapter.mp3","duration":20,"verses":[{"verse":1,"start":3,"end":10},{"verse":2,"start":10,"end":20}]}"#.utf8)
        let audio = try JSONDecoder().decode(ChapterAudio.self, from: data)
        XCTAssertTrue(audio.valid(book: 43, chapter: 3))
        XCTAssertFalse(audio.valid(book: 43, chapter: 4))
        XCTAssertNil(audio.verse(at: 0))
        XCTAssertEqual(audio.verse(at: 9.99), 1)
        XCTAssertEqual(audio.verse(at: 10), 2)
        XCTAssertEqual(audio.start(of: 2), 10)
    }
    func testUnavailableAndMalformedRecordingsNeverOfferPlayback() throws {
        let missing = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"unavailable"}"#.utf8))
        XCTAssertFalse(missing.valid(book: 43, chapter: 3))
        let malformed = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":43,"chapter":3,"audioUrl":"http://example.com/chapter.mp3","duration":20,"verses":[{"verse":2,"start":-1,"end":10}]}"#.utf8))
        XCTAssertFalse(malformed.valid(book: 43, chapter: 3))
        XCTAssertFalse(ChapterAudio.hasNarration(0)); XCTAssertTrue(ChapterAudio.hasNarration(1)); XCTAssertTrue(ChapterAudio.hasNarration(39)); XCTAssertTrue(ChapterAudio.hasNarration(66)); XCTAssertFalse(ChapterAudio.hasNarration(67))
    }
    func testMarkOffersAnAliveRecordingNamedLikeWeb() throws {
        XCTAssertTrue(ChapterAudio.hasAlive(41)); XCTAssertTrue(ChapterAudio.hasAlive(40)); XCTAssertFalse(ChapterAudio.hasAlive(42)); XCTAssertFalse(ChapterAudio.hasAlive(43))
        let alive = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":41,"chapter":1,"edition":"alive","audioUrl":"https://example.com/alive.mp3","duration":20,"verses":[{"verse":1,"start":3,"end":10}]}"#.utf8))
        XCTAssertTrue(alive.valid(book: 41, chapter: 1))
        XCTAssertEqual(alive.kind, .alive)
        let older = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":41,"chapter":1,"audioUrl":"https://example.com/kjv.mp3","duration":20,"verses":[{"verse":1,"start":3,"end":10}]}"#.utf8))
        XCTAssertEqual(older.kind, .regular, "a response without edition is the regular recording")
        XCTAssertEqual(AudioEdition.allCases.map(\.label), ["Regular", "Alive"])
        XCTAssertEqual(AudioEdition.alive.detail, "Full cast, in our LC Greek translation")
    }
    func testListenRecommendsAliveAndListsItFirstLikeWeb() {
        XCTAssertEqual(AudioEdition.recommended, .alive)
        XCTAssertEqual(AudioEdition.recommendedLabel, "Recommended")
        XCTAssertEqual(AudioEdition.listenOrder, [.alive, .regular])
        XCTAssertTrue(AudioEdition.alive.isRecommended); XCTAssertFalse(AudioEdition.regular.isRecommended)
    }
}
