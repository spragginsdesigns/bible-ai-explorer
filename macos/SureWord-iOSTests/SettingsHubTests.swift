import Foundation
import XCTest

@testable import SureWord

/// The iOS Settings hub (PRD B5): the category pages exist in Android 1.69.0's
/// order, and the row subtitles say what Android's say.
@MainActor
final class SettingsHubTests: XCTestCase {
    func testAppearanceSubtitle() {
        XCTAssertEqual(
            SettingsHubSubtitles.appearance(theme: .system, parchment: true, translation: .kjv),
            "System · Parchment · KJV"
        )
        XCTAssertEqual(
            SettingsHubSubtitles.appearance(theme: .dark, parchment: false, translation: .bsb),
            "Dark · Plain reader · BSB"
        )
    }

    func testChurchSubtitle() {
        XCTAssertEqual(SettingsHubSubtitles.church(nil), "…")
        XCTAssertEqual(SettingsHubSubtitles.church(.ok(church: nil)), "Not set")
        let church = ChurchProfile(
            placeId: "p1", name: "Grace Chapel", address: "1 Main St", phone: nil, website: nil,
            mapsUrl: nil, photoUrl: nil, mission: nil, about: nil, missionSource: nil,
            updatedAt: "2026-09-11T00:00:00.000Z"
        )
        XCTAssertEqual(SettingsHubSubtitles.church(.ok(church: church)), "Grace Chapel")
    }

    func testMemorySubtitle() {
        XCTAssertEqual(SettingsHubSubtitles.memory(enabled: nil, count: 3), "…")
        XCTAssertEqual(SettingsHubSubtitles.memory(enabled: false, count: 3), "Off")
        XCTAssertEqual(SettingsHubSubtitles.memory(enabled: true, count: nil), "On")
        XCTAssertEqual(SettingsHubSubtitles.memory(enabled: true, count: 12), "On · 12 saved")
    }

    func testAISubtitle() {
        XCTAssertEqual(SettingsHubSubtitles.ai(connectedKeys: 0), "Membership, provider keys, web search")
        XCTAssertEqual(SettingsHubSubtitles.ai(connectedKeys: 1), "Membership, provider keys, web search · 1 key")
        XCTAssertEqual(SettingsHubSubtitles.ai(connectedKeys: 2), "Membership, provider keys, web search · 2 keys")
    }

    func testNotificationsSubtitle() {
        XCTAssertEqual(SettingsHubSubtitles.notifications(enabled: true, hour: 8), "Daily verse 8:00 AM")
        XCTAssertEqual(SettingsHubSubtitles.notifications(enabled: false, hour: 8), "Daily verse off")
    }

    /// Every Android category page has an iOS page reporting the same route,
    /// except Check for updates, which is a Play Store row and not a page.
    func testEveryAndroidSettingsPageHasAnIOSPage() throws {
        let settingsDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "mobile/app/(app)/settings")
        let pages = try FileManager.default.contentsOfDirectory(atPath: settingsDir.path)
            .filter { $0.hasSuffix(".tsx") && !$0.hasPrefix("_") && $0 != "index.tsx" }
            .map { "/settings/" + $0.dropLast(4) }
        let ios: Set<String> = [
            AnalyticsScreen.settingsAccount, AnalyticsScreen.settingsAppearance,
            AnalyticsScreen.settingsHighlights, AnalyticsScreen.settingsChurch, AnalyticsScreen.settingsMemory,
            AnalyticsScreen.settingsAI, AnalyticsScreen.settingsShared, AnalyticsScreen.settingsNotifications,
            AnalyticsScreen.settingsAbout, AnalyticsScreen.feedback,
        ]
        XCTAssertFalse(pages.isEmpty)
        for page in pages {
            XCTAssertTrue(ios.contains(page), "\(page) has no iOS Settings page")
        }
    }

    func testChatRepliesDefaultsOnLikeAndroid() {
        let key = "settings.notifications.chatReplies"
        let saved = UserDefaults.standard.object(forKey: key)
        defer { UserDefaults.standard.set(saved, forKey: key) }
        UserDefaults.standard.removeObject(forKey: key)
        XCTAssertTrue(SettingsStore().notifyChatReplies)
    }
}
