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

    private func startRegular(_ app: XCUIApplication, editionMenu: Bool) -> Bool {
        let listen = app.buttons["Listen to this chapter"]
        guard listen.waitForExistence(timeout: 30) else {
            XCTFail("The chapter's narration control did not appear")
            return false
        }
        listen.tap()
        if editionMenu {
            let regular = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Regular")).firstMatch
            guard regular.waitForExistence(timeout: 5) else {
                capture(app, "narration-edition-menu")
                XCTFail("The chapter's Regular edition was not offered")
                return false
            }
            regular.tap()
        }
        return true
    }

    private func elapsed(_ app: XCUIApplication) -> Int? {
        let clock = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", #"^\d+:\d{2} / \d+:\d{2}$"#)).firstMatch
        guard clock.exists, let first = clock.label.components(separatedBy: " / ").first else { return nil }
        let parts = first.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    func testPublicNarrationPlaysSkipsAndStopsWithoutReopening() throws {
        let app = reader()
        guard startRegular(app, editionMenu: true) else { return }
        guard app.buttons["Pause narration"].waitForExistence(timeout: 30) else {
            capture(app, "john-3-playback-failed")
            XCTFail("Public narration did not start playing")
            return
        }
        capture(app, "john-3-playing")
        app.buttons["Next verse"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "John 3 ·")).firstMatch.waitForExistence(timeout: 10))

        // Pause to compare actual elapsed seconds without playback drift.
        app.buttons["Pause narration"].tap()
        XCTAssertTrue(app.buttons["Play narration"].waitForExistence(timeout: 5))
        let before = try XCTUnwrap(elapsed(app))
        app.buttons["Forward ten seconds"].tap()
        let forward = NSPredicate { _, _ in (self.elapsed(app) ?? -1) >= before + 8 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: forward, object: nil)], timeout: 5), .completed)
        let afterForward = try XCTUnwrap(elapsed(app))
        app.buttons["Back ten seconds"].tap()
        let back = NSPredicate { _, _ in
            guard let elapsed = self.elapsed(app) else { return false }
            return elapsed <= afterForward - 8
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: back, object: nil)], timeout: 5), .completed)
        capture(app, "john-3-seek-controls")

        app.buttons["Close narration"].tap()
        XCTAssertFalse(app.buttons["Close narration"].exists)
        // Attack the pending readiness/seek path: start and immediately close.
        guard startRegular(app, editionMenu: true) else { return }
        XCTAssertTrue(app.buttons["Close narration"].waitForExistence(timeout: 5))
        app.buttons["Close narration"].tap()
        let reopened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.buttons["Close narration"].exists }, object: nil)
        reopened.isInverted = true
        XCTAssertEqual(XCTWaiter.wait(for: [reopened], timeout: 3), .completed)
        capture(app, "john-3-closed")
    }

    func testOldTestamentNarrationAndNonNarratedTranslation() {
        let app = reader(book: 1, chapter: 1)
        guard app.navigationBars["Genesis 1"].waitForExistence(timeout: 15) else {
            XCTFail("Genesis reader did not appear")
            return
        }
        guard startRegular(app, editionMenu: false) else { return }
        XCTAssertTrue(app.buttons["Pause narration"].waitForExistence(timeout: 30))
        capture(app, "genesis-1-playing")
        app.buttons["Close narration"].tap()
        app.terminate()

        let bsb = reader(translation: "BSB")
        XCTAssertTrue(bsb.navigationBars["John 3"].waitForExistence(timeout: 15))
        XCTAssertFalse(bsb.buttons["Listen to this chapter"].exists)
        capture(bsb, "john-3-bsb-without-narration")
    }

    func testASVReaderLoadsTheBundledGenesisText() {
        let app = reader(book: 1, chapter: 1, translation: "ASV")
        let asv = app.buttons["Read in the American Standard Version"]
        guard asv.waitForExistence(timeout: 15) else {
            XCTFail("The ASV translation selector did not appear")
            return
        }
        XCTAssertTrue(asv.isSelected)
        // The KJV has singular "heaven" here. The public harness initializes
        // ASV without an account; authenticated preference writes are a
        // separate journey. Assert the actual verse button's complete text.
        let text = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "In the beginning God created the heavens and the earth.")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 15))
        capture(app, "genesis-1-asv-selected")
    }
}
