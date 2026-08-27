import Foundation

/// The reading-plan endpoints - a port of `mobile/src/features/plan/api.ts`.
/// The same routes serve every client, so a plan started on the phone is the
/// plan the Mac shows.
enum PlanAPI {
    /// Having a plan *written* is a model call (`maxDuration = 120` on the
    /// route); a preset is arithmetic on the server and answers in the usual
    /// budget.
    static let writePlanTimeout: TimeInterval = 120

    private struct PresetBody: Encodable { let presetKey: String }
    private struct GoalBody: Encodable {
        let goal: String
        let days: Int
    }
    private struct DoneBody: Encodable { let done: Bool }

    static func plans(api: APIClient) async throws -> ReadingPlansView {
        try await api.json("/api/reading-plans", as: ReadingPlansView.self)
    }

    /// Start one of SureWord's presets. Archives whatever plan they were on.
    static func startPreset(api: APIClient, presetKey: String) async throws -> ReadingPlan {
        try await api.json(
            "/api/reading-plans",
            method: "POST",
            body: PresetBody(presetKey: presetKey),
            as: ReadingPlan.self
        )
    }

    /// Have a plan written for a goal they typed. Archives their current plan.
    static func startGoal(api: APIClient, goal: String, days: Int) async throws -> ReadingPlan {
        try await api.json(
            "/api/reading-plans",
            method: "POST",
            body: GoalBody(goal: goal, days: days),
            timeout: writePlanTimeout,
            as: ReadingPlan.self
        )
    }

    /// Tick or untick one day by hand - only for reading done outside SureWord.
    /// Chapters read in the app's own reader mark themselves.
    static func setDay(
        api: APIClient,
        planID: String,
        day: Int,
        done: Bool
    ) async throws -> ReadingPlan {
        try await api.json(
            "/api/reading-plans/\(escape(planID))/days/\(day)",
            method: "POST",
            body: DoneBody(done: done),
            as: ReadingPlan.self
        )
    }

    /// Put the plan away. Nothing is deleted; the answer is the empty screen.
    static func archive(api: APIClient, planID: String) async throws -> ReadingPlansView {
        try await api.json(
            "/api/reading-plans/\(escape(planID))",
            method: "DELETE",
            as: ReadingPlansView.self
        )
    }

    /// Plan ids are server-generated cuids, but a path segment is still a path
    /// segment: percent-encode anything outside the RFC 3986 unreserved set so
    /// a stray character cannot rewrite the route.
    private static func escape(_ segment: String) -> String {
        var unreserved = CharacterSet.alphanumerics
        unreserved.insert(charactersIn: "-._~")
        return segment.addingPercentEncoding(withAllowedCharacters: unreserved) ?? segment
    }
}
