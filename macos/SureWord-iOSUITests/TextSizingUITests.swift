import XCTest

/// Exercises the shipping settings and bundled reader through the existing
/// DEBUG evidence entry point. No authentication or network fixtures needed.
@MainActor
final class TextSizingUITests: XCTestCase {
    private func launch(screen: String = "settings-appearance", scale: String = "standard", accessibility: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-SureWordEvidence", "YES",
            "-evidence.screen", screen,
            "-evidence.appearance", "dark",
            "-settings.textScale", scale,
        ]
        if accessibility {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        if screen == "reader" {
            app.launchArguments += [
                "-evidence.book", "43", "-evidence.chapter", "3",
                "-evidence.translation", "KJV", "-evidence.fontStep", "3",
                "-sureword-lc-greek", "NO",
            ]
        }
        app.launch()
        if screen == "settings-appearance" {
            XCTAssertTrue(app.navigationBars["Appearance & reading"].waitForExistence(timeout: 20))
        }
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        // A preceding capture may have scrolled below the control.
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            app.swipeDown()
        }
        XCTFail("Control was not reachable by scrolling: \(element.identifier)", file: file, line: line)
    }

    private func expectSize(_ name: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let value = app.staticTexts["text-size-value"]
        let changed = NSPredicate { _, _ in
            value.exists && (value.label.contains(name) || value.value as? String == name)
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: nil)], timeout: 5), .completed, file: file, line: line)
    }

    private func expectWithinScreenWidth(_ element: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let screen = app.windows.firstMatch.frame
        XCTAssertGreaterThan(element.frame.width, 0, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minX, screen.minX - 1, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, screen.maxX + 1, file: file, line: line)
    }

    func testSettingsStepsStopAtEndpointsAndReset() {
        let app = launch()
        defer { app.terminate() }
        let decrease = app.buttons["text-size-decrease"]
        let increase = app.buttons["text-size-increase"]
        let reset = app.buttons["text-size-reset"]

        reveal(increase, in: app)
        expectSize("Standard", in: app)
        XCTAssertFalse(decrease.isEnabled)
        XCTAssertTrue(increase.isEnabled)
        capture(app, "text-size-standard-settings")

        increase.tap()
        expectSize("Large", in: app)
        XCTAssertTrue(decrease.isEnabled)
        reveal(increase, in: app)
        capture(app, "text-size-large-settings")
        increase.tap()
        expectSize("Largest", in: app)
        XCTAssertFalse(increase.isEnabled)
        XCTAssertTrue(decrease.isEnabled)
        capture(app, "text-size-largest-settings")

        let preview = app.staticTexts["text-size-preview"]
        reveal(preview, in: app)
        expectWithinScreenWidth(preview, in: app)
        capture(app, "text-size-largest-live-preview")
        reveal(reset, in: app)
        reset.tap()
        expectSize("Standard", in: app)
        XCTAssertFalse(decrease.isEnabled)
        XCTAssertFalse(reset.isEnabled)
        XCTAssertTrue(increase.isEnabled)
        capture(app, "text-size-reset-standard")
    }

    func testLargestWithMaximumAccessibilityKeepsPreviewAndResetReachable() {
        let app = launch(scale: "largest", accessibility: true)
        defer { app.terminate() }
        let preview = app.staticTexts["text-size-preview"]
        reveal(preview, in: app)
        expectSize("Largest", in: app)
        expectWithinScreenWidth(preview, in: app)
        capture(app, "text-size-largest-maximum-accessibility-preview")

        let reset = app.buttons["text-size-reset"]
        reveal(reset, in: app)
        XCTAssertTrue(reset.isEnabled)
        XCTAssertFalse(app.buttons["text-size-increase"].isEnabled)
        capture(app, "text-size-largest-maximum-accessibility-controls")
        reset.tap()
        expectSize("Standard", in: app)
        XCTAssertFalse(app.buttons["text-size-decrease"].isEnabled)
        capture(app, "text-size-maximum-accessibility-after-reset")
    }

    func testLargestAppAndLargestReaderSizeKeepBundledVerseReadable() {
        let app = launch(screen: "reader", scale: "largest")
        defer { app.terminate() }
        let firstVerse = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "John 3:1. ")).firstMatch
        XCTAssertTrue(firstVerse.waitForExistence(timeout: 30))
        expectWithinScreenWidth(firstVerse, in: app)
        let increase = app.buttons["Increase text size"]
        XCTAssertTrue(increase.exists)
        XCTAssertFalse(increase.isEnabled, "The separate reader setting must remain at its upper stop")
        capture(app, "text-size-largest-app-and-reader-step-three")
    }
}
