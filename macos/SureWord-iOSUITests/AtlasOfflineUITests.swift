import XCTest

/// Public, unauthenticated evidence harness over the shipping Study/Atlas
/// views and canonical bundled data. No Atlas fixtures or network-disable
/// flags are installed here; AtlasOfflineTests separately proves zero API
/// access with a rejecting token provider and the canonical JSCore cases.
@MainActor
final class AtlasOfflineUITests: XCTestCase {
    private enum JourneyFailure: Error { case missingControl }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func study() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-SureWordEvidence", "YES", "-evidence.screen", "shell",
            "-evidence.shellTab", "study", "-evidence.translation", "KJV",
            "-evidence.appearance", "dark"
        ]
        app.launch()
        return app
    }

    private func button(_ app: XCUIApplication, startingWith label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication, scrolling: Bool = false) throws {
        if scrolling {
            for _ in 0..<20 {
                // SwiftUI can report a row as hittable while its center is
                // under the navigation/tab glass. Tap inside the content,
                // rather than accepting that partially exposed edge.
                let visible = element.exists && element.isHittable
                let centerY = element.frame.midY
                let top = app.frame.minY + app.frame.height * 0.24
                let bottom = app.frame.minY + app.frame.height * 0.72
                if visible && centerY >= top && centerY <= bottom { break }
                let down = visible && centerY < top
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.4 : 0.65))
                    .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.65 : 0.4)))
            }
        }
        guard element.waitForExistence(timeout: 15), element.isHittable else {
            capture(app, "missing-atlas-control")
            XCTFail("Atlas control was unavailable: \(element)")
            throw JourneyFailure.missingControl
        }
        element.tap()
    }

    private func back(_ app: XCUIApplication, to title: String) throws {
        try tap(app.navigationBars.buttons.element(boundBy: 0), in: app)
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 15))
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func search(_ query: String, in app: XCUIApplication) throws {
        let field = app.textFields["Search the Bible atlas"]
        try tap(field, in: app)
        field.typeText(query)
    }

    func testTimelineEraEventAndReaderReturnAfterColdLaunch() throws {
        let app = study()
        try tap(button(app, startingWith: "Bible timeline"), in: app)
        XCTAssertTrue(app.navigationBars["Timeline, People & Places"].waitForExistence(timeout: 15))

        let patriarchs = app.buttons["Creation & the Patriarchs"]
        try tap(patriarchs, in: app)
        XCTAssertTrue(patriarchs.isSelected)
        try tap(button(app, startingWith: "The creation of the heaven and the earth,"), in: app)
        XCTAssertTrue(app.navigationBars["The creation of the heaven and the earth"].waitForExistence(timeout: 15))
        capture(app, "atlas-creation-event-bundled")

        try tap(app.buttons["Read Genesis 1:1"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Genesis 1"].waitForExistence(timeout: 15))
        XCTAssertTrue(button(app, startingWith: "Genesis 1:1. In the beginning God created the heaven and the earth.").waitForExistence(timeout: 15))
        capture(app, "atlas-creation-reader-handoff")
        try back(app, to: "The creation of the heaven and the earth")
        try back(app, to: "Timeline, People & Places")
        XCTAssertTrue(patriarchs.isSelected, "Returning from the reader must retain this explorer's era")
        try back(app, to: "Study")
    }

    func testPeopleRelationshipsFamilyJourneyAndTraceAfterColdLaunch() throws {
        let app = study()
        try tap(button(app, startingWith: "People of the Bible"), in: app)
        XCTAssertTrue(app.navigationBars["People"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.segmentedControls.buttons["People"].isSelected)
        try search("Abraham", in: app)
        try tap(app.buttons["Abraham, Person"], in: app)
        XCTAssertTrue(app.navigationBars["Abraham"].waitForExistence(timeout: 15))
        try tap(app.buttons["Child Isaac"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Isaac"].waitForExistence(timeout: 15))
        try back(app, to: "Abraham")

        try tap(app.buttons["Immediate family"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Immediate family"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Spouse Sarah"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Child Isaac"].exists)
        capture(app, "atlas-abraham-immediate-family")
        try back(app, to: "Abraham")

        try tap(app.buttons["View journey"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Timeline, People & Places"].waitForExistence(timeout: 15))
        try tap(button(app, startingWith: "The call of Abram,"), in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["The call of Abram"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Read Genesis 12:1-4"].waitForExistence(timeout: 15))
        capture(app, "atlas-abraham-journey-event")
        try back(app, to: "Timeline, People & Places")
        try back(app, to: "Abraham")

        try tap(app.buttons["Trace connection"], in: app, scrolling: true)
        let traceSearch = app.textFields["Search a person to trace"]
        try tap(traceSearch, in: app)
        traceSearch.typeText("Jacob")
        try tap(app.buttons["Trace to Jacob"], in: app)
        XCTAssertTrue(app.staticTexts["SHORTEST CITED PATH"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Open Abraham"].exists)
        XCTAssertTrue(app.buttons["Open Isaac"].exists)
        try tap(app.buttons["Open Jacob"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Jacob"].waitForExistence(timeout: 15))
        try back(app, to: "Trace connection")
        XCTAssertTrue(app.buttons["Open Abraham"].waitForExistence(timeout: 15))
        capture(app, "atlas-abraham-to-jacob-trace-restored")
        try back(app, to: "Abraham")
        try back(app, to: "People")
        try back(app, to: "Study")
    }

    func testPlacesSearchAndReaderReturnAfterColdLaunch() throws {
        let app = study()
        try tap(button(app, startingWith: "Places & atlas"), in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Places"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.segmentedControls.buttons["Places"].isSelected)
        try search("Jericho", in: app)
        try tap(app.buttons["Jericho, Place"], in: app)
        XCTAssertTrue(app.navigationBars["Jericho"].waitForExistence(timeout: 15))
        capture(app, "atlas-jericho-search-detail")
        try tap(app.buttons["Read Joshua 2:1"], in: app, scrolling: true)
        XCTAssertTrue(app.navigationBars["Joshua 2"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "two men to spy secretly")).firstMatch.waitForExistence(timeout: 15))
        capture(app, "atlas-jericho-reader-handoff")
        try back(app, to: "Jericho")
        try back(app, to: "Places")
        XCTAssertEqual(app.textFields["Search the Bible atlas"].value as? String, "Jericho")
        XCTAssertTrue(app.buttons["Jericho, Place"].exists)
        try back(app, to: "Study")
    }
}
