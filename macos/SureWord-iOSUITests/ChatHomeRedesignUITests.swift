import XCTest

final class ChatHomeRedesignUITests: XCTestCase {
    private func launch(_ appearance: String = "dark") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SureWordEvidence", "YES", "-evidence.screen", "shell", "-evidence.appearance", appearance]
        app.launch()
        return app
    }

    @MainActor
    func testEverySuggestedQuestionRemainsReachable() throws {
        let app = launch()
        XCTAssertTrue(app.staticTexts["CHOSEN FROM YOUR STUDY"].waitForExistence(timeout: 20))
        let companion = app.images["sureword-companion-idle"]
        if !companion.waitForExistence(timeout: 10) { print(app.debugDescription) }
        XCTAssertTrue(companion.exists)
        XCTAssertEqual(companion.label, "SureWord study companion")
        let more = app.buttons["Show 2 more questions from your study"]
        for _ in 0..<4 where !more.isHittable { app.swipeUp() }
        XCTAssertTrue(more.isHittable)
        more.tap()
        let finalQuestion = app.buttons["How should I pray according to Scripture?"]
        for _ in 0..<3 where !finalQuestion.isHittable { app.swipeUp() }
        XCTAssertTrue(finalQuestion.isHittable)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "All study questions remain reachable"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testComposerAndOptionsRemainUsableInLightAppearance() throws {
        let app = launch("light")
        let field = app.textFields["Ask a Bible question..."]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("Explain forgiveness in Ephesians 4:32")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue(app.buttons["Send"].isHittable)
        let keyboard = XCTAttachment(screenshot: app.screenshot())
        keyboard.name = "Light composer clears the keyboard"
        keyboard.lifetime = .keepAlways
        add(keyboard)
        app.swipeDown()
        let options = app.buttons["Chat options"]
        XCTAssertTrue(options.isHittable)
        options.tap()
        XCTAssertTrue(app.buttons["Choose AI model"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Conversation history"].exists)
        XCTAssertTrue(app.buttons["Settings"].exists)
    }
}
