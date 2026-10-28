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
    func testTimingsMaySkipAVerseTheASVLeavesOutAndSkippingStepsOverIt() throws {
        // Matthew 17 in the ASV: 17:21 is omitted, so its timings go 20, 22 (LC-17800).
        let audio = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":40,"chapter":17,"edition":"alive","text":"ASV","audioUrl":"https://example.com/asv.mp3","duration":130,"verses":[{"verse":20,"start":100,"end":110},{"verse":22,"start":111,"end":118},{"verse":23,"start":119,"end":125}]}"#.utf8))
        XCTAssertTrue(audio.valid(book: 40, chapter: 17))
        XCTAssertEqual(audio.text, "ASV")
        XCTAssertEqual(audio.start(of: 21), 111, "a verse with no timing starts where the next one does")
        XCTAssertEqual(audio.adjacent(to: 20, by: 1), 22)
        XCTAssertEqual(audio.adjacent(to: 22, by: -1), 20)
        XCTAssertEqual(audio.adjacent(to: 23, by: 1), 23, "the last verse is reachable")
        XCTAssertEqual(audio.adjacent(to: nil, by: 1), 20)
        let backwards = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":40,"chapter":17,"audioUrl":"https://example.com/a.mp3","duration":130,"verses":[{"verse":22,"start":1,"end":2},{"verse":20,"start":3,"end":4}]}"#.utf8))
        XCTAssertFalse(backwards.valid(book: 40, chapter: 17), "verse numbers must rise")
        let repeated = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":40,"chapter":17,"audioUrl":"https://example.com/a.mp3","duration":130,"verses":[{"verse":1,"start":1,"end":2},{"verse":1,"start":3,"end":4}]}"#.utf8))
        XCTAssertFalse(repeated.valid(book: 40, chapter: 17))
    }
    func testListenNamesTheTextAliveReads() {
        XCTAssertEqual(AudioEdition.alive.detail(aliveText: "ASV"), "Full cast, in the American Standard Version")
        XCTAssertEqual(AudioEdition.alive.detail(aliveText: "LC Greek"), "Full cast, in our LC Greek translation")
        XCTAssertEqual(AudioEdition.alive.detail(aliveText: nil), "Full cast, in our LC Greek translation")
        XCTAssertEqual(AudioEdition.regular.detail(aliveText: "ASV"), "The King James Version, read aloud")
    }
    func testMarkOffersAnAliveRecordingNamedLikeWeb() throws {
        let alive = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":41,"chapter":1,"edition":"alive","audioUrl":"https://example.com/alive.mp3","duration":20,"verses":[{"verse":1,"start":3,"end":10}]}"#.utf8))
        XCTAssertTrue(alive.valid(book: 41, chapter: 1))
        XCTAssertEqual(alive.kind, .alive)
        let older = try JSONDecoder().decode(ChapterAudio.self, from: Data(#"{"status":"ready","book":41,"chapter":1,"audioUrl":"https://example.com/kjv.mp3","duration":20,"verses":[{"verse":1,"start":3,"end":10}]}"#.utf8))
        XCTAssertEqual(older.kind, .regular, "a response without edition is the regular recording")
        XCTAssertEqual(AudioEdition.allCases.map(\.label), ["Regular", "Alive"])
        XCTAssertNil(alive.text, "a server before LC-17800 sends no text")
    }
    func testListenRecommendsAliveAndListsItFirstLikeWeb() {
        XCTAssertEqual(AudioEdition.recommended, .alive)
        XCTAssertEqual(AudioEdition.recommendedLabel, "Recommended")
        XCTAssertEqual(AudioEdition.listenOrder, [.alive, .regular])
        XCTAssertTrue(AudioEdition.alive.isRecommended); XCTAssertFalse(AudioEdition.regular.isRecommended)
    }
}
