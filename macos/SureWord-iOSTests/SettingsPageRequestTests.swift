import XCTest

@testable import SureWord

/// `AppModel.openSettings(_:)` lands on the right page, every Mac Settings
/// page reports Android's route for it, and the translation hint is
/// Android's sentence.
@MainActor
final class SettingsPageRequestTests: XCTestCase {
    func testEveryRequestMapsToItsMacPane() {
        XCTAssertEqual(SettingsPane(request: .account), .account)
        XCTAssertEqual(SettingsPane(request: .ai), .ai)
        // Membership is the first section of the AI page, as on Android.
        XCTAssertEqual(SettingsPane(request: .membership), .ai)
        XCTAssertEqual(SettingsPane(request: .memory), .memory)
        XCTAssertEqual(SettingsPane(request: .church), .church)
        XCTAssertEqual(SettingsPane(request: .notifications), .notifications)
    }

    func testMacPanesReportAndroidRoutes() {
        let expected: [SettingsPane: String] = [
            .account: "/settings/account",
            .appearance: "/settings/appearance",
            .language: "/settings/language",
            .highlights: "/settings/highlights",
            .church: "/settings/church",
            .serve: "/settings/serve",
            .memory: "/settings/memory",
            .ai: "/settings/ai",
            .shared: "/settings/shared",
            .notifications: "/settings/notifications",
            .feedback: "/settings/feedback",
            .about: "/settings/about",
        ]
        XCTAssertEqual(Set(expected.keys), Set(SettingsPane.allCases))
        for pane in SettingsPane.allCases {
            XCTAssertEqual(pane.analyticsScreen, expected[pane], "\(pane)")
        }
    }

    func testServeSettingsRouteMatchesAndroid() {
        // mobile/app/(app)/settings/serve.tsx
        XCTAssertEqual(AnalyticsScreen.settingsServe, "/settings/serve")
    }

    func testTranslationHintIsAndroidsSentenceThenTheCopyright() {
        let android = "Used by the Bible reader and verse attachments. Every translation but NKJV works fully "
            + "offline; NKJV is fetched when needed. SureWord's AI answers quote the translation you "
            + "select when it is in the language they are written in (Settings, Language)."
        XCTAssertEqual(TranslationID.kjv.settingsHint, android + " Public domain.")
        XCTAssertEqual(TranslationID.nkjv.settingsHint, android + " © Thomas Nelson - text via bolls.life.")
    }
}
