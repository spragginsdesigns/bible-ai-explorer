import Foundation
import Testing
@testable import SureWord

/// Port of `mobile/src/features/plan/planView.test.ts`, case for case, so the
/// Mac's plan copy cannot drift from Android's and web's. The fixtures below
/// are the same plan that suite builds.
private func day(
    _ number: Int,
    _ readings: [(String, Int)],
    done: Bool = false,
    doneSource: PlanDoneSource? = nil,
    state: PlanDayState = .upcoming
) -> PlanDay {
    PlanDay(
        day: number,
        readings: readings.map { PlanReading(book: $0.0, chapter: $0.1) },
        focus: "Read it slowly.",
        done: done,
        doneSource: doneSource,
        state: state
    )
}

private func plan(
    status: PlanStatus = .active,
    todayDay: Int = 6,
    currentDay: Int = 6
) -> ReadingPlan {
    ReadingPlan(
        id: "plan_1",
        title: "The Gospels in 30 days",
        description: "Four accounts of one Lord.",
        source: .preset,
        presetKey: "gospels-30",
        startDate: "2026-08-01T12:00:00.000Z",
        status: status,
        dayCount: 30,
        todayDay: todayDay,
        currentDay: currentDay,
        completedCount: 5,
        percent: 17,
        streak: 5,
        days: [
            day(5, [("Matthew", 8)], done: true, doneSource: .read, state: .done),
            day(6, [("Matthew", 9), ("Matthew", 10), ("Matthew", 11)], state: .today),
            day(7, [("Matthew", 12)]),
        ]
    )
}

@Suite("describeReadings")
struct DescribeReadingsTests {
    private func describe(_ readings: [(String, Int)]) -> String {
        PlanView.describeReadings(readings.map { PlanReading(book: $0.0, chapter: $0.1) })
    }

    @Test("Collapses a run of consecutive chapters in one book")
    func collapsesRun() {
        #expect(describe([("Matthew", 1), ("Matthew", 2), ("Matthew", 3)]) == "Matthew 1-3")
    }

    @Test("Keeps separate books apart, and does not span a book boundary")
    func keepsBooksApart() {
        #expect(describe([("Malachi", 4), ("Matthew", 1)]) == "Malachi 4, Matthew 1")
    }

    @Test("Does not join chapters that are not consecutive")
    func doesNotJoinGaps() {
        #expect(describe([("Psalms", 1), ("Psalms", 3)]) == "Psalms 1, Psalms 3")
    }

    @Test("Renders a single chapter without a range")
    func singleChapter() {
        #expect(describe([("Jude", 1)]) == "Jude 1")
    }

    @Test("Is empty for an empty day")
    func emptyDay() {
        #expect(PlanView.describeReadings([]) == "")
    }
}

@Suite("Plan summaries")
struct PlanSummaryTests {
    @Test("Names the day the user is actually on, not the calendar day")
    func namesCurrentDay() {
        // Fallen three days behind: the calendar says 9, the plan hands back 6.
        let behind = plan(todayDay: 9, currentDay: 6)
        #expect(PlanView.dayHeadline(behind) == "Day 6 of 30")
        #expect(PlanView.currentPlanDay(behind)?.day == 6)
    }

    @Test("Reads progress and streak the way the screen shows them")
    func progressAndStreak() {
        #expect(PlanView.progressCaption(plan()) == "5 of 30 days read · 17%")
        #expect(PlanView.streakLabel(5) == "5-day streak")
        #expect(PlanView.streakLabel(0) == "No streak yet")
    }

    @Test("Labels each day state")
    func dayStates() {
        #expect(PlanView.dayStateLabel(.done) == "Done")
        #expect(PlanView.dayStateLabel(.today) == "Today")
        #expect(PlanView.dayStateLabel(.upcoming) == "Upcoming")
    }

    @Test("Invites a plan when there is none, and reports a finished one")
    func cardSubtitles() {
        #expect(PlanView.planCardSubtitle(nil) == "Start a plan and read through Scripture")
        #expect(PlanView.planCardSubtitle(plan()) == "Day 6 of 30 · Matthew 9-11")
        #expect(PlanView.planCardSubtitle(plan(status: .completed)) == "Finished - The Gospels in 30 days")
    }
}

/// The builder's − / + rule, held to Android's `adjustDays` in
/// `mobile/app/(app)/bible/plan.tsx`.
@Suite("Goal day stepping")
@MainActor
struct GoalDayStepTests {
    private func adjust(_ current: Int, _ delta: Int) -> Int {
        ReadingPlanModel.adjustedGoalDays(current, by: delta)
    }

    @Test("Steps by the builder's step in both directions")
    func steps() {
        #expect(adjust(30, ReadingPlanModel.goalDayStep) == 37)
        #expect(adjust(30, -ReadingPlanModel.goalDayStep) == 23)
    }

    @Test("Clamps to the ends rather than refusing the step")
    func clampsToEnds() {
        #expect(adjust(ReadingPlanModel.minGoalDays, -ReadingPlanModel.goalDayStep) == 7)
        #expect(adjust(10, -ReadingPlanModel.goalDayStep) == 7)
        #expect(adjust(ReadingPlanModel.maxGoalDays, ReadingPlanModel.goalDayStep) == 365)
    }

    /// The bug this replaced: `Stepper(value:in:step:)` stops at 364, because
    /// 365 is not a whole number of 7s from any start the builder offers.
    @Test("Reaches the maximum from the last whole step below it")
    func reachesMaximum() {
        #expect(adjust(364, ReadingPlanModel.goalDayStep) == 365)
        #expect(adjust(359, ReadingPlanModel.goalDayStep) == 365)
    }

    @Test("Pulls a value from outside the range back inside it")
    func pullsStrayValuesIn() {
        #expect(adjust(3, 0) == 7)
        #expect(adjust(9_000, 0) == 365)
    }
}

@Suite("isTodaysPlanReading")
struct TodaysPlanReadingTests {
    @Test("Recognises a chapter that is part of today's reading")
    func recognisesToday() {
        #expect(PlanView.isTodaysPlanReading(plan(), book: "Matthew", chapter: 10))
    }

    @Test("Rejects a chapter from another day, another book, or no plan")
    func rejectsOthers() {
        #expect(!PlanView.isTodaysPlanReading(plan(), book: "Matthew", chapter: 12))
        #expect(!PlanView.isTodaysPlanReading(plan(), book: "Mark", chapter: 10))
        #expect(!PlanView.isTodaysPlanReading(nil, book: "Matthew", chapter: 10))
    }

    @Test("Claims nothing once the plan is no longer running")
    func rejectsFinished() {
        #expect(!PlanView.isTodaysPlanReading(plan(status: .completed), book: "Matthew", chapter: 10))
    }
}

/// Pins the wire shapes to what `/api/reading-plans` actually sends
/// (`src/lib/reading-plans.ts`), including the nulls the other clients tolerate.
@Suite("Reading plan decoding")
struct ReadingPlanDecodingTests {
    private func decode<T: Decodable>(_ json: String, as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test("Decodes the whole screen: an active plan plus the presets")
    func decodesView() throws {
        let view: ReadingPlansView = try decode(
            """
            {
              "active": {
                "id": "rp_1",
                "title": "The Gospels in 30 days",
                "description": "Four accounts of one Lord.",
                "source": "preset",
                "presetKey": "gospels-30",
                "startDate": "2026-08-01T12:00:00.000Z",
                "status": "active",
                "dayCount": 30,
                "todayDay": 9,
                "currentDay": 6,
                "completedCount": 5,
                "percent": 17,
                "streak": 5,
                "days": [
                  {
                    "day": 6,
                    "readings": [
                      { "book": "Matthew", "chapter": 9 },
                      { "book": "Matthew", "chapter": 10 }
                    ],
                    "focus": "Watch who he calls.",
                    "done": false,
                    "doneSource": null,
                    "state": "today"
                  }
                ]
              },
              "presets": [
                {
                  "key": "gospels-30",
                  "title": "The Gospels in 30 days",
                  "description": "Four accounts of one Lord.",
                  "dayCount": 30
                }
              ]
            }
            """
        )

        let plan = try #require(view.active)
        #expect(plan.id == "rp_1")
        #expect(plan.status == .active)
        #expect(plan.source == .preset)
        #expect(plan.todayDay == 9)
        #expect(plan.currentDay == 6)
        #expect(plan.days.first?.state == .today)
        #expect(plan.days.first?.doneSource == nil)
        #expect(PlanView.describeReadings(plan.days[0].readings) == "Matthew 9-10")
        #expect(view.presets.count == 1)
        #expect(view.presets.first?.dayCount == 30)
    }

    @Test("Decodes the empty screen - no plan, presets only")
    func decodesEmptyView() throws {
        let view: ReadingPlansView = try decode(#"{"active":null,"presets":[]}"#)
        #expect(view.active == nil)
        #expect(view.presets.isEmpty)
    }

    @Test("Keeps a day ticked by hand apart from one read in the app")
    func decodesDoneSource() throws {
        let marked: PlanDay = try decode(
            #"{"day":1,"readings":[{"book":"Jude","chapter":1}],"focus":"","done":true,"doneSource":"marked","state":"done"}"#
        )
        let read: PlanDay = try decode(
            #"{"day":2,"readings":[{"book":"Jude","chapter":1}],"focus":"","done":true,"doneSource":"read","state":"done"}"#
        )
        #expect(marked.doneSource == .marked)
        #expect(read.doneSource == .read)
    }

    /// A state or status this build has not heard of must cost one odd-looking
    /// row, never the whole plan the user is following.
    @Test("Falls back rather than failing on an unknown state")
    func tolerantOfUnknownState() throws {
        let day: PlanDay = try decode(
            #"{"day":3,"readings":[],"focus":"","done":false,"doneSource":"future-source","state":"future-state"}"#
        )
        #expect(day.state == .upcoming)
        #expect(day.doneSource == nil)
    }
}
