import Foundation

/// Pure presentation rules for reading plans - a port of
/// `mobile/src/features/plan/planView.ts` (mirrored on web at
/// `src/components/plan/planView.ts`), whose Vitest suite is ported alongside
/// it into `SureWordTests/ReadingPlanTests.swift`.
///
/// Kept out of the views so the fiddly parts - collapsing chapter runs, and the
/// plan/cross match - are tested directly. **If you change one side, change
/// both**: the strings below are what the other clients render, word for word.
enum PlanView {

    /// A day's chapters as one short line: "Matthew 1-3", "Psalms 1-5, Proverbs 1".
    /// Consecutive chapters of the same book collapse into a range.
    static func describeReadings(_ readings: [PlanReading]) -> String {
        var parts: [String] = []
        var index = 0
        while index < readings.count {
            let start = readings[index]
            var end = start
            var next = index + 1
            while next < readings.count,
                  readings[next].book == end.book,
                  readings[next].chapter == end.chapter + 1 {
                end = readings[next]
                next += 1
            }
            parts.append(
                end.chapter == start.chapter
                    ? "\(start.book) \(start.chapter)"
                    : "\(start.book) \(start.chapter)-\(end.chapter)"
            )
            index = next
        }
        return parts.joined(separator: ", ")
    }

    /// The day the plan wants them on now, or nil for a finished plan.
    static func currentPlanDay(_ plan: ReadingPlan?) -> PlanDay? {
        guard let plan else { return nil }
        return plan.days.first { $0.day == plan.currentDay }
    }

    /// "Day 6 of 30"
    static func dayHeadline(_ plan: ReadingPlan) -> String {
        "Day \(plan.currentDay) of \(plan.dayCount)"
    }

    /// "6 of 30 days read · 20%"
    static func progressCaption(_ plan: ReadingPlan) -> String {
        "\(plan.completedCount) of \(plan.dayCount) days read · \(plan.percent)%"
    }

    /// "5-day streak", or an honest nudge when there is none yet.
    static func streakLabel(_ streak: Int) -> String {
        streak <= 0 ? "No streak yet" : "\(streak)-day streak"
    }

    static func dayStateLabel(_ state: PlanDayState) -> String {
        switch state {
        case .done: "Done"
        case .today: "Today"
        case .upcoming: "Upcoming"
        }
    }

    /// The one-line summary for the Bible screen's plan card: where they are, or
    /// an invitation when they have no plan.
    static func planCardSubtitle(_ plan: ReadingPlan?) -> String {
        guard let plan else { return "Start a plan and read through Scripture" }
        if plan.status == .completed { return "Finished - \(plan.title)" }
        guard let day = currentPlanDay(plan) else { return plan.title }
        return "\(dayHeadline(plan)) · \(describeReadings(day.readings))"
    }

    /// Is this chapter part of today's plan reading? Drives the small "From your
    /// plan" tag on the Pick Up Your Cross study path.
    static func isTodaysPlanReading(_ plan: ReadingPlan?, book: String, chapter: Int) -> Bool {
        guard let plan, plan.status == .active else { return false }
        guard let day = currentPlanDay(plan) else { return false }
        return day.readings.contains { $0.book == book && $0.chapter == chapter }
    }
}
