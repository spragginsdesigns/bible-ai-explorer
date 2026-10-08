import XCTest

/// Real SwiftUI reader and AVPlayer, public production narration. No account
/// fixtures replace the chapter-audio route in these runs.
@MainActor
final class ChapterAudioUITests: XCTestCase {
    private func reader(book: Int = 43, chapter: Int = 3, translation: String = "KJV") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SureWordEvidence", "YES", "-evidence.screen", "reader", "-evidence.book", String(book), "-evidence.chapter", String(chapter), "-evidence.translation", translation, "-evidence.appearance", "dark"]
        app.launch()
        return app
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    func testPublicNarrationPlaysSkipsAndStopsWithoutReopening() {
        let app = reader()
        let listen = app.buttons["Listen to this chapter"]
        XCTAssertTrue(listen.waitForExistence(timeout: 30))
        listen.tap()
        XCTAssertTrue(app.buttons["Pause narration"].waitForExistence(timeout: 30))
        capture(app, "john-3-playing")
        app.buttons["Next verse"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "John 3 ·")).firstMatch.waitForExistence(timeout: 10))
        app.buttons["Close narration"].tap()
        XCTAssertFalse(app.buttons["Close narration"].exists)
        // Attack the pending readiness/seek path: start and immediately close.
        listen.tap()
        XCTAssertTrue(app.buttons["Close narration"].waitForExistence(timeout: 5))
        app.buttons["Close narration"].tap()
        let closed = NSPredicate { _, _ in !app.buttons["Close narration"].exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 5), .completed)
        capture(app, "john-3-closed")
    }
    func testOtherTranslationAndOldTestamentKeepReadingWithoutNarration() {
        let app = reader(book: 1, chapter: 1)
        XCTAssertTrue(app.navigationBars["Genesis 1"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Listen to this chapter"].exists)
        capture(app, "genesis-without-narration")
        app.terminate()
        let bsb = reader(translation: "BSB")
        XCTAssertTrue(bsb.navigationBars["John 3"].waitForExistence(timeout: 15))
        XCTAssertFalse(bsb.buttons["Listen to this chapter"].exists)
    }
}
