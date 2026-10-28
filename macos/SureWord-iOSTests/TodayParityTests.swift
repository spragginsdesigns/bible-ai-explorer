import XCTest

@testable import SureWord

/// Today-area rules: the reading plan's "N days behind" (Android
/// `today/plan.tsx`), the Daily Cross's day-change reload on the Mac, and the
/// Mac update check's version compare.
final class TodayParityTests: XCTestCase {
    // MARK: - Days behind

    private func plan(status: PlanStatus = .active, todayDay: Int, currentDay: Int) -> ReadingPlan {
        ReadingPlan(
            id: "p", title: "Gospels", description: "", status: status,
            dayCount: 30, todayDay: todayDay, currentDay: currentDay,
            completedCount: currentDay - 1, percent: 10, streak: 0, days: []
        )
    }

    func testDaysBehindIsTheCalendarDayLessTheReadingDay() {
        XCTAssertEqual(PlanView.daysBehind(plan(todayDay: 9, currentDay: 6)), 3)
        XCTAssertEqual(PlanView.behindLabel(plan(todayDay: 9, currentDay: 6)), "3 days behind")
        XCTAssertEqual(PlanView.behindLabel(plan(todayDay: 7, currentDay: 6)), "1 day behind")
    }

    func testOnPaceOrAheadSaysNothing() {
        XCTAssertEqual(PlanView.daysBehind(plan(todayDay: 6, currentDay: 6)), 0)
        XCTAssertNil(PlanView.behindLabel(plan(todayDay: 6, currentDay: 6)))
        XCTAssertEqual(PlanView.daysBehind(plan(todayDay: 4, currentDay: 6)), 0, "read ahead")
        XCTAssertNil(PlanView.behindLabel(plan(todayDay: 4, currentDay: 6)))
    }

    func testOnlyAnActivePlanCanBeBehind() {
        XCTAssertEqual(PlanView.daysBehind(plan(status: .completed, todayDay: 40, currentDay: 30)), 0)
        XCTAssertEqual(PlanView.daysBehind(plan(status: .archived, todayDay: 40, currentDay: 3)), 0)
    }

    // MARK: - Daily Cross day change

    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    func testDayKeyIsTheLocalCalendarDay() {
        let date = Date(timeIntervalSince1970: 1_793_145_600) // 2026-10-28T00:00:00Z
        XCTAssertEqual(DailyCrossModel.dayKey(date, calendar: utc), "2026-10-28")
        XCTAssertEqual(DailyCrossModel.dayKey(date.addingTimeInterval(-1), calendar: utc), "2026-10-27")
    }

    func testADayFetchedYesterdayIsStale() {
        let now = Date(timeIntervalSince1970: 1_793_145_600 + 3600)
        XCTAssertTrue(DailyCrossModel.isStale(loadedDay: "2026-10-27", hasEntry: true, now: now, calendar: utc))
        XCTAssertFalse(DailyCrossModel.isStale(loadedDay: "2026-10-28", hasEntry: true, now: now, calendar: utc))
    }

    func testNothingInHandIsNeverStale() {
        let now = Date(timeIntervalSince1970: 1_793_145_600)
        XCTAssertFalse(DailyCrossModel.isStale(loadedDay: nil, hasEntry: true, now: now, calendar: utc))
        XCTAssertFalse(DailyCrossModel.isStale(loadedDay: "2026-10-27", hasEntry: false, now: now, calendar: utc))
    }

    // MARK: - Mac update check

    func testVersionsCompareNumerically() {
        XCTAssertEqual(MacUpdateRules.compare("1.10.0", "1.9.2"), .orderedDescending)
        XCTAssertEqual(MacUpdateRules.compare("1.9.2", "1.10.0"), .orderedAscending)
        XCTAssertEqual(MacUpdateRules.compare("1.2", "1.2.0"), .orderedSame)
        XCTAssertEqual(MacUpdateRules.compare("v1.21.1", "1.21.0"), .orderedDescending)
        XCTAssertEqual(MacUpdateRules.compare("2.0.0", "1.99.99"), .orderedDescending)
    }

    func testNonVersionsCompareAsUnknown() {
        XCTAssertNil(MacUpdateRules.compare("Latest", "1.0.0"))
        XCTAssertNil(MacUpdateRules.compare("1.0.0-beta", "1.0.0"))
        XCTAssertNil(MacUpdateRules.compare("", "1.0.0"))
        XCTAssertNil(MacUpdateRules.compare("1..2", "1.0.0"))
    }

    func testOnlyAStrictlyNewerReleaseIsOffered() {
        let url = URL(string: "https://github.com/x/SureWord.dmg")!
        let newer = MacUpdateRules.Release(version: "1.22.0", url: url)
        XCTAssertEqual(MacUpdateRules.newer(than: "1.21.3", latest: newer), newer)
        XCTAssertNil(MacUpdateRules.newer(than: "1.22.0", latest: newer))
        XCTAssertNil(MacUpdateRules.newer(than: "1.23.0", latest: newer))
        XCTAssertNil(MacUpdateRules.newer(than: "1.21.3", latest: .init(version: "Latest", url: url)), "GitHub fallback")
        XCTAssertNil(MacUpdateRules.newer(than: "1.21.3", latest: nil))
    }

    func testLaunchChecksAtMostOnceADay() {
        let now = Date(timeIntervalSince1970: 1_793_145_600)
        XCTAssertTrue(MacUpdateRules.isDue(lastChecked: nil, now: now))
        XCTAssertFalse(MacUpdateRules.isDue(lastChecked: now.addingTimeInterval(-3600), now: now))
        XCTAssertTrue(MacUpdateRules.isDue(lastChecked: now.addingTimeInterval(-MacUpdateRules.interval), now: now))
        XCTAssertTrue(MacUpdateRules.isDue(lastChecked: now.addingTimeInterval(3600), now: now), "clock moved back")
    }

    func testDecodesTheNativeReleasesRoute() throws {
        let json = """
        {"android":{"version":"1.108.0","url":"https://github.com/a/SureWord.apk"},
         "macos":{"version":"1.22.0","url":"https://github.com/spragginsdesigns/bible-ai-explorer/releases/download/macos-v1.22.0/SureWord.dmg"}}
        """
        let releases = try JSONDecoder().decode(MacUpdateRules.Releases.self, from: Data(json.utf8))
        XCTAssertEqual(releases.macos.version, "1.22.0")
        XCTAssertEqual(releases.macos.url.lastPathComponent, "SureWord.dmg")
    }
}
