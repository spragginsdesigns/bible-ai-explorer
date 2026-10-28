import Foundation
import XCTest

@testable import SureWord

/// The Study hub, Today's links and the Connections screen held to Android
/// (`mobile/app/(app)/study/index.tsx`, `today/index.tsx`, `connections.tsx`
/// and `features/bible/connectionsMap.ts`).
@MainActor
final class StudyParityTests: XCTestCase {
    // MARK: Study hub

    func testChurchSectionShowsOnlyWithStudiesOrEvents() throws {
        XCTAssertFalse(StudyChurchPresence().showsSection)
        XCTAssertFalse(StudyChurchPresence(SermonHome(studies: [], events: [], churchApp: nil)).showsSection)

        let study = SermonStudySummary(id: "s1", videoId: "v1", title: "Grace", serviceTitle: "Sunday", serviceDate: nil,
                                       preacher: nil, preachingText: nil, bigIdea: "", imageUrl: nil)
        let onlyStudies = StudyChurchPresence(SermonHome(studies: [study], events: [], churchApp: nil))
        XCTAssertTrue(onlyStudies.showsSection)
        XCTAssertFalse(onlyStudies.showsAnnouncements)

        let event = try JSONDecoder().decode(ChurchEvent.self, from: Data(#"{"id":"e1","title":"Potluck","startsAt":"2026-11-01T18:00:00Z"}"#.utf8))
        let onlyEvents = StudyChurchPresence(SermonHome(studies: [], events: [event], churchApp: nil))
        XCTAssertTrue(onlyEvents.showsSection)
        XCTAssertTrue(onlyEvents.showsAnnouncements)
    }

    func testAtlasRowsOpenTheirOwnMode() {
        XCTAssertEqual(AtlasExplorerMode(study: .timeline), .timeline)
        XCTAssertEqual(AtlasExplorerMode(study: .people), .people)
        XCTAssertEqual(AtlasExplorerMode(study: .places), .places)
        XCTAssertNil(AtlasExplorerMode(study: .notes))
        XCTAssertNil(AtlasExplorerMode(study: .sermons))
        XCTAssertNil(AtlasExplorerMode(study: .words))
    }

    func testAtlasTitlesFollowAndroid() {
        XCTAssertEqual(AtlasExplorerMode.title(mode: .timeline, chapterScope: nil), "Timeline, People & Places")
        XCTAssertEqual(AtlasExplorerMode.title(mode: .people, chapterScope: nil), "People")
        XCTAssertEqual(AtlasExplorerMode.title(mode: .places, chapterScope: nil), "Places")
        XCTAssertEqual(AtlasExplorerMode.title(mode: .people, chapterScope: ("Genesis", 12)), "Genesis 12")
    }

    func testTodayNotesLinkOpensNotesInsideStudy() {
        let app = AppModel(settings: SettingsStore(), userID: nil)
        StudyHubNavigation.open(.notes, in: app)
        XCTAssertEqual(app.section, .study)
        XCTAssertEqual(app.pendingStudyDestination, .notes)
    }

    // MARK: Today

    func testPlanRowSubtitleCoversLoadingAndFailure() {
        XCTAssertEqual(DailyWalkHome.planSubtitle(nil, hasLoaded: false, error: nil), "Loading your plan...")
        XCTAssertEqual(DailyWalkHome.planSubtitle(nil, hasLoaded: false, error: "offline"), "Loading your plan...")
        XCTAssertEqual(DailyWalkHome.planSubtitle(nil, hasLoaded: true, error: "offline"), "Open your plan to reconnect")
        XCTAssertEqual(DailyWalkHome.planSubtitle(nil, hasLoaded: true, error: nil), PlanView.planCardSubtitle(nil))
    }

    // MARK: Atlas detail history (Mac)

    func testDetailHistoryWalksBackThroughEntriesOpenedFromDetail() {
        var history = AtlasDetailHistory()
        XCTAssertFalse(history.canGoBack)
        history.open(.entity("abraham"), fromDetail: false)
        history.open(.entity("sarah"), fromDetail: true)
        history.open(.event("covenant"), fromDetail: true)
        XCTAssertEqual(history.current, .event("covenant"))
        XCTAssertEqual(history.back(), .entity("sarah"))
        XCTAssertEqual(history.back(), .entity("abraham"))
        XCTAssertNil(history.back())
        XCTAssertEqual(history.current, .entity("abraham"))
    }

    func testDetailHistoryRestartsFromTheListAndIgnoresTheSamePage() {
        var history = AtlasDetailHistory()
        history.open(.entity("abraham"), fromDetail: false)
        history.open(.entity("abraham"), fromDetail: true)
        XCTAssertFalse(history.canGoBack)
        history.open(.entity("sarah"), fromDetail: true)
        XCTAssertTrue(history.canGoBack)
        history.open(.event("exodus"), fromDetail: false)
        XCTAssertFalse(history.canGoBack)
        history.reset()
        XCTAssertNil(history.current)
    }

    // MARK: Connections

    /// Byte for byte Android's and web's `connectionsAskPrompt`.
    func testAskPromptNamesAtMostTenPassages() {
        XCTAssertEqual(
            ConnectionsRules.askPrompt(reference: "John 3:16", linked: ["Romans 5:8", "1 John 4:9"]),
            "How does John 3:16 connect to Romans 5:8, 1 John 4:9? Walk me through what ties these passages together in the King James Bible."
        )
        let many = (1...12).map { "Psalm \($0):1" }
        let prompt = ConnectionsRules.askPrompt(reference: "John 3:16", linked: many)
        XCTAssertTrue(prompt.contains("Psalm 10:1?"))
        XCTAssertFalse(prompt.contains("Psalm 11:1"))
    }

    func testSectionAndVerseCounts() {
        let links = [[16, 45, 5, 8, 200], [16, 1, 1, 1, 0], [17, 45, 8, 1, 250], [17, 44, 2, 1, 240]]
        XCTAssertEqual(ConnectionsRules.sectionCounts(links.map { $0[1] }), ["pauline": 2, "law": 1, "acts": 1])
        XCTAssertNil(ConnectionsRules.sectionCounts([1])["gospels"])
        XCTAssertEqual(ConnectionsRules.countsByVerse(links), [16: 2, 17: 2])
    }

    func testChapterSteppingCrossesBookBoundaries() {
        let genesis50 = ConnectionsPlace(order: 1, chapter: 50, verse: 3)
        XCTAssertEqual(ConnectionsRules.step(genesis50, by: 1), ConnectionsPlace(order: 2, chapter: 1, verse: nil))
        XCTAssertEqual(ConnectionsRules.step(ConnectionsPlace(order: 2, chapter: 1, verse: nil), by: -1),
                       ConnectionsPlace(order: 1, chapter: 50, verse: nil))
        XCTAssertEqual(ConnectionsRules.step(ConnectionsPlace(order: 43, chapter: 3, verse: 16), by: 1),
                       ConnectionsPlace(order: 43, chapter: 4, verse: nil))
        XCTAssertNil(ConnectionsRules.step(ConnectionsPlace(order: 1, chapter: 1, verse: nil), by: -1))
        XCTAssertNil(ConnectionsRules.step(ConnectionsPlace(order: 66, chapter: 22, verse: nil), by: 1))
    }

    func testFocusEmptyMessagesAndCounts() {
        XCTAssertEqual(ConnectionsRules.emptyFocusMessage(loaded: false, sectionLabel: "Law", focusCount: 3), "Loading connected passages…")
        XCTAssertEqual(ConnectionsRules.emptyFocusMessage(loaded: true, sectionLabel: "Law", focusCount: 3),
                       "No links into Law from this verse. Tap All to see the other 3.")
        XCTAssertEqual(ConnectionsRules.emptyFocusMessage(loaded: true, sectionLabel: "Law", focusCount: 0),
                       "No connected passages are listed for this verse.")
        XCTAssertEqual(ConnectionsRules.connectionCount(1), "1 connection")
        XCTAssertEqual(ConnectionsRules.connectionCount(0), "0 connections")
    }

    func testExplainedReferencesOpenAtTheirFirstVerse() {
        XCTAssertEqual(ConnectionsRules.explainedTarget("Romans 5:8-10"), ConnectionsPlace(order: 45, chapter: 5, verse: 8))
        XCTAssertEqual(ConnectionsRules.explainedTarget("Romans 5:8\u{2013}10"), ConnectionsPlace(order: 45, chapter: 5, verse: 8))
        XCTAssertEqual(ConnectionsRules.explainedTarget("Romans 5:8\u{2014}10"), ConnectionsPlace(order: 45, chapter: 5, verse: 8))
        XCTAssertEqual(ConnectionsCanonTag.section(for: "Romans 5:8"), "pauline")
        XCTAssertNil(ConnectionsRules.explainedTarget("Not a passage"))
    }

    func testKeepStudyingWaitsForAFinishedExplanation() {
        let model = ConnectionsModel()
        XCTAssertFalse(model.explanationFinished)
    }
}

/// The section tag an explanation card shows for a reference.
private enum ConnectionsCanonTag {
    static func section(for reference: String) -> String? {
        ConnectionsRules.explainedTarget(reference).map { ConnectionCanonSection.containing($0.order).id }
    }
}
