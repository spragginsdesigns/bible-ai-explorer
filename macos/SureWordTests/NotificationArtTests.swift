import Foundation
import Testing
import UserNotifications
@testable import SureWord

/// Each notification kind's art (`NotificationArt`), mirrored from
/// `notificationArtFor` in `src/lib/push-routing.ts`. The iOS extensions
/// compile the same file, so these rules hold there too.
@Suite("Notification art")
struct NotificationArtTests {
    @Test("The tap screen picks the art, and only SureWord's two kinds have any")
    func kindFromScreen() {
        #expect(NotificationArt(userInfo: ["screen": "cross"]) == .cross)
        #expect(NotificationArt(userInfo: ["screen": "chat", "conversationId": "c1"]) == .answer)
        #expect(NotificationArt(userInfo: ["body": ["screen": "cross"]]) == .cross)
        #expect(NotificationArt(userInfo: ["type": "sermon-watchdog"]) == nil)
        #expect(NotificationArt(userInfo: [:]) == nil)
    }

    @Test("Categories match the ones the server sends (apnsCategoryFor)")
    func categories() {
        #expect(NotificationArt.cross.categoryIdentifier == "SUREWORD_CROSS")
        #expect(NotificationArt.answer.categoryIdentifier == "SUREWORD_ANSWER")
        #expect(Set(NotificationArt.categories.map(\.identifier)) == ["SUREWORD_CROSS", "SUREWORD_ANSWER"])
    }

    @Test("Every kind's mark and banner ship in the app bundle")
    func artIsBundled() {
        for art in NotificationArt.allCases {
            #expect(Bundle.main.url(forResource: art.markResource, withExtension: "jpg") != nil)
            #expect(Bundle.main.url(forResource: art.bannerResource, withExtension: "jpg") != nil)
        }
    }

    @Test("Dressing a notice sets its category and attaches its mark")
    func dressAttachesMark() {
        let content = UNMutableNotificationContent()
        NotificationArt.answer.dress(content)
        #expect(content.categoryIdentifier == "SUREWORD_ANSWER")
        #expect(content.attachments.map(\.identifier) == ["answer-mark"])
    }
}
