import Foundation

/// The plan the user is following, and everything the plan screen does to it -
/// the Apple port of `mobile/src/features/plan/useReadingPlan.ts` and the web's
/// `src/components/plan/useReadingPlan.ts`.
///
/// Every mutation answers with the whole plan and fresh progress, so the model
/// never has to guess what a tick did to the streak - it swaps the plan in.
///
/// Shared with iOS on purpose: only the views differ. One instance lives on
/// `BibleModel`, which `AppModel` owns, so the plan survives a trip through
/// chat the same way the reader's book and chapter do.
@MainActor
@Observable
final class ReadingPlanModel {
    /// The lengths a written plan is offered at, and the step the ± buttons
    /// take - the same numbers the Android builder uses.
    static let goalDayChoices = [14, 30, 60, 90]
    static let goalDayStep = 7
    /// `MIN_PLAN_DAYS` / `MAX_PLAN_DAYS` in `src/lib/reading-plan-presets.ts`;
    /// the route 400s outside this range.
    static let minGoalDays = 7
    static let maxGoalDays = 365
    static let maxGoalLength = 300
    static let defaultGoalDays = 30

    /// What the builder's − / + buttons do: step, then clamp into
    /// `minGoalDays...maxGoalDays`. This is `adjustDays` in Android's
    /// `mobile/app/(app)/bible/plan.tsx`, character for character.
    ///
    /// It exists because SwiftUI's `Stepper(value:in:step:)` refuses any step
    /// that would leave the range instead of clamping to its edge, and 365 is
    /// not 7 plus a whole number of 7s - so from every start the builder offers
    /// (7, 14, 30, 60, 90, 365) the + button dies at 364 and `maxGoalDays` is
    /// unreachable. Clamping reaches it.
    static func adjustedGoalDays(_ current: Int, by delta: Int) -> Int {
        min(max(current + delta, minGoalDays), maxGoalDays)
    }

    private static let genericFailure =
        "Your reading plan could not be loaded. Check your connection and try again."

    /// What is in flight. Split rather than one `busy` flag because the *write*
    /// takes up to two minutes and has to say so, while a tick is instant.
    enum Activity: Equatable {
        case idle
        /// Starting one of the presets.
        case starting(String)
        /// Having a plan written for a typed goal.
        case writing
        /// Ticking or unticking one day by hand.
        case marking(Int)
        case archiving
    }

    private(set) var plan: ReadingPlan?
    private(set) var presets: [ReadingPlanPreset] = []
    /// True until the first response - success or failure - has landed. Starts
    /// true, like `useState(true)` in `useReadingPlan.ts`, so the pane opens on
    /// its loading state rather than flashing the "no plan" chooser.
    private(set) var loading = true
    private(set) var activity: Activity = .idle
    private(set) var error: String?
    /// Whether a load has ever completed, so `loadIfNeeded` runs exactly once
    /// per session however many times the sidebar is rebuilt.
    private(set) var hasLoaded = false

    var isBusy: Bool { activity != .idle }
    var isWriting: Bool { activity == .writing }

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var mutationTask: Task<Void, Never>?
    /// Bumped on every mutation. A cancelled task still resumes once to unwind,
    /// and without this its cleanup would clear the *replacement* call's
    /// activity - leaving a spinner-less screen with a request still in flight.
    @ObservationIgnored private var mutationGeneration = 0
    /// The same trick for loads, and the same bug it avoids: a cancelled load
    /// resumes to unwind and would otherwise clear the *replacement* load's
    /// handle and turn its spinner off.
    @ObservationIgnored private var loadGeneration = 0

    init(api: APIClient) {
        self.api = api
    }

    // MARK: - Loading

    /// First load for a session. Cheap to call from every `.task` that shows
    /// plan state - the card in the Bible sidebar and the pane both do.
    func loadIfNeeded() {
        guard !hasLoaded, loadTask == nil else { return }
        reload()
    }

    /// Fetch the plan and the presets again. Safe to call on every appear: the
    /// plan already on screen stays there while this runs, because the pane
    /// only shows its loading state before the first response has landed.
    ///
    /// **The coordination rule, in one line: a mutation always beats a load.**
    /// A GET that was already in flight when the user ticked a day carries
    /// pre-tick data, so it is discarded rather than allowed to overwrite the
    /// mutation's answer - `mutationGeneration` moving is the whole test. The
    /// load's own bookkeeping (`loading`, `hasLoaded`, the task handle) still
    /// settles either way, guarded only by `loadGeneration` so that a newer
    /// load - not a stale one unwinding - owns it.
    func reload() {
        loadTask?.cancel()
        loadGeneration += 1
        let generation = loadGeneration
        let mutationsAtStart = mutationGeneration
        loading = true
        error = nil
        let api = api
        loadTask = Task { @MainActor in
            defer { finishLoad(generation) }
            do {
                let view = try await PlanAPI.plans(api: api)
                guard isCurrentLoad(generation, since: mutationsAtStart) else { return }
                apply(view)
            } catch {
                guard isCurrentLoad(generation, since: mutationsAtStart) else { return }
                self.error = Self.message(for: error)
            }
        }
    }

    /// This load is still the newest one, and nothing has been written since it
    /// started - so its answer is still the truth.
    private func isCurrentLoad(_ generation: Int, since mutations: Int) -> Bool {
        generation == loadGeneration && mutations == mutationGeneration
    }

    /// Turn the spinner off only if this load is still the current one.
    private func finishLoad(_ generation: Int) {
        guard generation == loadGeneration else { return }
        loadTask = nil
        loading = false
        hasLoaded = true
    }

    // MARK: - Mutations

    /// Start one of SureWord's presets. The server archives the current plan.
    func startPreset(_ presetKey: String) {
        mutate(.starting(presetKey)) { [api] in
            try await PlanAPI.startPreset(api: api, presetKey: presetKey)
        }
    }

    /// Have a plan written for a goal they typed. Slow by nature - the model is
    /// laying out every day - so the pane watches `isWriting` for its own state.
    func startGoal(_ goal: String, days: Int) {
        let described = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !described.isEmpty else { return }
        let clamped = min(max(days, Self.minGoalDays), Self.maxGoalDays)
        mutate(.writing) { [api] in
            try await PlanAPI.startGoal(api: api, goal: described, days: clamped)
        }
    }

    /// Tick or untick one day by hand.
    func setDayDone(_ day: Int, done: Bool) {
        guard let planID = plan?.id else { return }
        mutate(.marking(day)) { [api] in
            try await PlanAPI.setDay(api: api, planID: planID, day: day, done: done)
        }
    }

    /// Put the plan away. Answers the whole screen back, not just a plan.
    func archive() {
        guard let planID = plan?.id else { return }
        mutationTask?.cancel()
        mutationGeneration += 1
        let generation = mutationGeneration
        activity = .archiving
        error = nil
        let api = api
        mutationTask = Task { @MainActor in
            defer { finish(generation) }
            do {
                let view = try await PlanAPI.archive(api: api, planID: planID)
                guard !Task.isCancelled else { return }
                apply(view)
            } catch {
                guard !Task.isCancelled else { return }
                self.error = Self.message(for: error)
            }
        }
    }

    func dismissError() {
        error = nil
    }

    // MARK: - Plumbing

    /// Run one mutation that answers with a plan, keeping the presets we already
    /// have beside the new one - the routes only re-send presets on the two
    /// calls that can leave the user with no plan.
    private func mutate(
        _ activity: Activity,
        _ run: @escaping @Sendable () async throws -> ReadingPlan
    ) {
        mutationTask?.cancel()
        mutationGeneration += 1
        let generation = mutationGeneration
        self.activity = activity
        error = nil
        mutationTask = Task { @MainActor in
            defer { finish(generation) }
            do {
                let plan = try await run()
                guard !Task.isCancelled else { return }
                self.plan = plan
                hasLoaded = true
            } catch {
                guard !Task.isCancelled else { return }
                self.error = Self.message(for: error)
            }
        }
    }

    /// Clear the busy state only if this call is still the current one.
    private func finish(_ generation: Int) {
        guard generation == mutationGeneration else { return }
        mutationTask = nil
        activity = .idle
    }

    private func apply(_ view: ReadingPlansView) {
        plan = view.active
        presets = view.presets
        error = nil
    }

    private static func message(for error: any Error) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? genericFailure : described
    }
}
