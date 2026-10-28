import Foundation
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

    @MainActor
    func testUploadedASVAliveOutsideGospelsIsDiscoveredSelectedAndFallsBackNextChapter() async {
        ASVAudioProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ASVAudioProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://asv-audio.invalid")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: configuration))
        let model = ChapterAudioModel(api: api, settings: SettingsStore())
        defer { model.close() }
        await model.load(book: 1, chapter: 1, reference: "Genesis 1", enabled: true, next: nil)
        XCTAssertTrue(model.available)
        XCTAssertEqual(model.editions, [.alive, .regular])
        XCTAssertEqual(model.aliveText, "ASV")
        XCTAssertEqual(model.edition, .regular)
        model.start(edition: .alive)
        XCTAssertEqual(model.edition, .alive)
        XCTAssertEqual(model.audio?.text, "ASV")
        // The inert media URL is loopback, and close prevents playback; this
        // test proves discovery/selection, not production ASV audibility.
        model.close()
        await model.load(book: 1, chapter: 2, reference: "Genesis 2", enabled: true, next: nil)
        XCTAssertTrue(model.available)
        XCTAssertEqual(model.editions, [.regular])
        XCTAssertEqual(model.edition, .regular, "A chapter without an Alive upload falls back to its regular recording")
        XCTAssertNil(model.aliveText)
        XCTAssertEqual(ASVAudioProtocol.requests, ["regular:1", "alive:1", "regular:2", "alive:2"], "Every chapter asks for Alive without a hard-coded book list")
    }
}

private final class ASVAudioProtocol: URLProtocol, @unchecked Sendable {
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var requests: [String] = []
    }
    private static let state = State()
    static var requests: [String] { state.lock.withLock { state.requests } }
    static func reset() { state.lock.withLock { state.requests = [] } }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "asv-audio.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        let chapter = Int(items.first { $0.name == "chapter" }?.value ?? "")!
        let alive = items.first { $0.name == "edition" }?.value == "alive"
        Self.state.lock.withLock { Self.state.requests.append("\(alive ? "alive" : "regular"):\(chapter)") }
        var row: [String: Any] = ["status": "unavailable"]
        if !alive || chapter == 1 {
            row = ["status": "ready", "book": 1, "chapter": chapter,
                   "audioUrl": "https://127.0.0.1:9/inert.mp3", "duration": 20,
                   "verses": [["verse": 1, "start": 2, "end": 10], ["verse": 2, "start": 11, "end": 20]]]
            if alive { row["edition"] = "alive"; row["text"] = "ASV" }
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: row))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
