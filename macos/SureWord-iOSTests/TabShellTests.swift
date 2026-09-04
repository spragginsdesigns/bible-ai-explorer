import XCTest

@testable import SureWord

/// Smoke tests for the signed-in iOS shell (Lane 1): the session root model
/// the tab bar is driven from, and the IA it mirrors from Android.
@MainActor
final class TabShellTests: XCTestCase {
    func testAppModelDefaultsToChatHome() {
        // Android's bottom tabs land on Chat; TabShell's selection does too.
        let app = AppModel(settings: SettingsStore(), userID: nil)
        XCTAssertEqual(app.section, .chat)
    }

    func testTabSectionsMatchAndroidIA() {
        // Chat / Bible / Notes are the three iOS tabs; Daily Cross has no tab
        // of its own (on Android it lives inside Chat).
        XCTAssertEqual([AppSection.chat, .bible, .notes].map(\.title), ["Chat", "Bible", "Notes"])
        XCTAssertEqual(AppSection.bible.symbol, "book.closed")
        XCTAssertEqual(AppSection.notes.symbol, "note.text")
    }
}
