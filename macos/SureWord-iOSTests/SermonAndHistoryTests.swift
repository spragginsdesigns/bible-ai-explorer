import Foundation
import XCTest

@testable import SureWord

/// Sermon studies' formatting and wire shapes (mirroring the cases in
/// `tests/sermon-studies.test.mjs` and `sermonApi.ts`), and the chat history
/// rules behind D1: search, and the title the rename route will store.
final class SermonAndHistoryTests: XCTestCase {
    // MARK: - Sermon studies

    func testTimestampsMatchTheServerFormatter() {
        XCTAssertEqual(SermonFormat.timestamp(1_867_000), "31:07")
        XCTAssertEqual(SermonFormat.timestamp(3_784_000), "1:03:04")
        XCTAssertEqual(SermonFormat.timestamp(-5), "0:00")
        XCTAssertEqual(SermonFormat.timestamp(59_500), "1:00")
    }

    func testWatchLinksDeepLinkTheMomentInWholeSeconds() {
        XCTAssertEqual(
            SermonFormat.watchURL(videoID: "abcdefghijk")?.absoluteString,
            "https://www.youtube.com/watch?v=abcdefghijk"
        )
        XCTAssertEqual(
            SermonFormat.watchURL(videoID: "abcdefghijk", atMs: 1_867_999)?.absoluteString,
            "https://www.youtube.com/watch?v=abcdefghijk&t=1867s"
        )
        XCTAssertEqual(
            SermonFormat.watchURL(videoID: "abcdefghijk", atMs: 0)?.absoluteString,
            "https://www.youtube.com/watch?v=abcdefghijk&t=0s"
        )
    }

    func testServiceDatesReadAsTheDayOfTheService() {
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(SermonFormat.serviceDate("2026-09-13", locale: locale), "Sunday, September 13")
        XCTAssertNil(SermonFormat.serviceDate(nil, locale: locale))
        XCTAssertNil(SermonFormat.serviceDate("last Sunday", locale: locale))
    }

    func testAskAIPrefillsAnOrdinarySentenceNamingTheStudy() {
        XCTAssertEqual(SermonFormat.askPrompt(title: "Follow Me"), "Let's talk about the sermon study \"Follow Me\".")
    }

    func testDecodesAStudyWithNullsAndAPartialSection() throws {
        let json = #"""
        {"study":{"id":"smn_1","videoId":"abcdefghijk","title":"Follow Me","serviceTitle":"Sunday Morning Worship",
        "serviceDate":"2026-09-13","preacher":"Pastor Ron Hess","preachingText":"Luke 9:57-62",
        "bigIdea":"Christ calls before He comforts.","imageUrl":null,"summary":"A walk.","application":"Name it.",
        "prayer":"Lord, make me willing.","sermonStartMs":120000,"durationSec":null,
        "sections":[{"heading":"The call","startMs":1867000,"pastorQuote":null,"passage":"Luke 9:57-58",
        "passageText":[{"verse":57,"text":"And it came to pass"}],"explanation":"SureWord's teaching.",
        "reflection":"What has it cost?","imageUrl":null},{"heading":"Second","startMs":2000000.0}]}}
        """#
        struct Envelope: Decodable { let study: SermonStudyDetail }
        let study = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).study
        XCTAssertEqual(study.sections.count, 2)
        XCTAssertNil(study.sections[0].pastorQuote)
        XCTAssertEqual(study.sections[0].passageText?.first?.verse, 57)
        XCTAssertEqual(study.sections[1].startMs, 2_000_000)
        XCTAssertEqual(study.sections[1].explanation, "")
        XCTAssertEqual(study.sermonStartMs, 120_000)
        XCTAssertNil(study.durationSec)
        XCTAssertEqual(study.credits, "Sunday Morning Worship · Pastor Ron Hess · 2026-09-13")

        let list = #"{"studies":[{"id":"smn_1","videoId":"v","title":"T","serviceTitle":"S","serviceDate":null,"preacher":null,"preachingText":null,"bigIdea":"B","imageUrl":null}]}"#
        struct ListEnvelope: Decodable { let studies: [SermonStudySummary] }
        XCTAssertEqual(try JSONDecoder().decode(ListEnvelope.self, from: Data(list.utf8)).studies.first?.id, "smn_1")
    }

    // MARK: - Chat history (D1)

    func testHistorySearchMatchesTheShownTitleCaseInsensitively() {
        let conversations = [
            Conversation(id: "1", title: "Grace in Romans", createdAt: ""),
            Conversation(id: "2", title: "", createdAt: ""),
            Conversation(id: "3", title: "Psalm 23", createdAt: ""),
        ]
        XCTAssertEqual(HistorySearch.filter(conversations, query: "").map(\.id), ["1", "2", "3"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "  romans ").map(\.id), ["1"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "untitled").map(\.id), ["2"])
        XCTAssertEqual(HistorySearch.displayTitle(conversations[1]), "Untitled conversation")
    }

    @MainActor
    func testRenameStoresTheTitleTheRouteWillStore() {
        XCTAssertEqual(ChatViewModel.normalizedConversationTitle("  Grace \n in\tRomans  "), "Grace in Romans")
        XCTAssertEqual(ChatViewModel.normalizedConversationTitle("   "), "")
        XCTAssertEqual(ChatViewModel.maxConversationTitleLength, 60)
    }
}
