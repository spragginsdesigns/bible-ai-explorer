import XCTest

@testable import SureWord

/// Smoke tests for the signed-in iOS shell (Lane 1): the session root model
/// the tab bar is driven from, and the IA it mirrors from Android.
@MainActor
final class TabShellTests: XCTestCase {
    func testAppModelDefaultsToTodayHome() {
        let app = AppModel(settings: SettingsStore(), userID: nil)
        XCTAssertEqual(app.section, .today)
    }

    func testTabSectionsMatchAndroidIA() {
        XCTAssertEqual(AppSection.allCases.map(\.title), ["Today", "Bible", "Chat", "Connections", "Study"])
        XCTAssertEqual(AppSection.bible.symbol, "book")
        XCTAssertEqual(AppSection.notes.symbol, "note.text")
    }
}
