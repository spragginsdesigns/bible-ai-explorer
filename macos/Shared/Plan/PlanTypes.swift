import Foundation

/// The reading-plan shapes exactly as `/api/reading-plans` serves them - a port
/// of `mobile/src/features/plan/types.ts` (and `src/components/plan/types.ts` on
/// web). The server side of the same shapes is `src/lib/reading-plans.ts` and
/// `src/lib/reading-plan-progress.ts`.
///
/// Every enum decodes leniently. The routes only ever send the cases below, but
/// a value this client has not heard of must degrade to one row rendering
/// oddly, never to a screen that refuses to load a plan the user is following.

struct PlanReading: Decodable, Sendable, Equatable, Identifiable {
    let book: String
    let chapter: Int

    var id: String { "\(book)|\(chapter)" }

    init(book: String, chapter: Int) {
        self.book = book
        self.chapter = chapter
    }
}

enum PlanDayState: String, Decodable, Sendable, Equatable, CaseIterable {
    case done, today, upcoming

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PlanDayState(rawValue: raw) ?? .upcoming
    }
}

/// How a done day got that way: `marked` = ticked by hand, `read` = every
/// chapter of it shows up in the user's reading history.
enum PlanDoneSource: String, Decodable, Sendable, Equatable {
    case marked, read

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let source = PlanDoneSource(rawValue: raw) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unknown done source \(raw)"
            )
        }
        self = source
    }
}

struct PlanDay: Decodable, Sendable, Equatable, Identifiable {
    let day: Int
    let readings: [PlanReading]
    let focus: String
    let done: Bool
    /// Null on a day that is not done - and tolerated as null/unknown here so a
    /// future source string cannot take the whole plan down.
    let doneSource: PlanDoneSource?
    let state: PlanDayState

    var id: Int { day }

    private enum CodingKeys: String, CodingKey {
        case day, readings, focus, done, doneSource, state
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        day = try container.decode(Int.self, forKey: .day)
        readings = try container.decodeIfPresent([PlanReading].self, forKey: .readings) ?? []
        focus = try container.decodeIfPresent(String.self, forKey: .focus) ?? ""
        done = try container.decodeIfPresent(Bool.self, forKey: .done) ?? false
        doneSource = try? container.decodeIfPresent(PlanDoneSource.self, forKey: .doneSource)
        state = try container.decodeIfPresent(PlanDayState.self, forKey: .state) ?? .upcoming
    }

    init(
        day: Int,
        readings: [PlanReading],
        focus: String = "",
        done: Bool = false,
        doneSource: PlanDoneSource? = nil,
        state: PlanDayState = .upcoming
    ) {
        self.day = day
        self.readings = readings
        self.focus = focus
        self.done = done
        self.doneSource = doneSource
        self.state = state
    }
}

enum PlanStatus: String, Decodable, Sendable, Equatable {
    case active, completed, archived

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PlanStatus(rawValue: raw) ?? .active
    }
}

enum PlanSource: String, Decodable, Sendable, Equatable {
    case preset, ai

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PlanSource(rawValue: raw) ?? .preset
    }
}

struct ReadingPlan: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let description: String
    let source: PlanSource
    let presetKey: String?
    let startDate: String
    let status: PlanStatus
    let dayCount: Int
    let todayDay: Int
    /// The day to put in front of them: the oldest one still unread, which is
    /// *not* the calendar day once they have fallen behind.
    let currentDay: Int
    let completedCount: Int
    let percent: Int
    let streak: Int
    let days: [PlanDay]

    private enum CodingKeys: String, CodingKey {
        case id, title, description, source, presetKey, startDate, status
        case dayCount, todayDay, currentDay, completedCount, percent, streak, days
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Reading plan"
        description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        source = try container.decodeIfPresent(PlanSource.self, forKey: .source) ?? .preset
        presetKey = try container.decodeIfPresent(String.self, forKey: .presetKey)
        startDate = try container.decodeIfPresent(String.self, forKey: .startDate) ?? ""
        status = try container.decodeIfPresent(PlanStatus.self, forKey: .status) ?? .active
        dayCount = try container.decodeIfPresent(Int.self, forKey: .dayCount) ?? 0
        todayDay = try container.decodeIfPresent(Int.self, forKey: .todayDay) ?? 1
        currentDay = try container.decodeIfPresent(Int.self, forKey: .currentDay) ?? 1
        completedCount = try container.decodeIfPresent(Int.self, forKey: .completedCount) ?? 0
        percent = try container.decodeIfPresent(Int.self, forKey: .percent) ?? 0
        streak = try container.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        days = try container.decodeIfPresent([PlanDay].self, forKey: .days) ?? []
    }

    init(
        id: String,
        title: String,
        description: String,
        source: PlanSource = .preset,
        presetKey: String? = nil,
        startDate: String = "",
        status: PlanStatus = .active,
        dayCount: Int,
        todayDay: Int,
        currentDay: Int,
        completedCount: Int,
        percent: Int,
        streak: Int,
        days: [PlanDay]
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.source = source
        self.presetKey = presetKey
        self.startDate = startDate
        self.status = status
        self.dayCount = dayCount
        self.todayDay = todayDay
        self.currentDay = currentDay
        self.completedCount = completedCount
        self.percent = percent
        self.streak = streak
        self.days = days
    }
}

struct ReadingPlanPreset: Decodable, Sendable, Equatable, Identifiable {
    let key: String
    let title: String
    let description: String
    let dayCount: Int

    var id: String { key }

    init(key: String, title: String, description: String, dayCount: Int) {
        self.key = key
        self.title = title
        self.description = description
        self.dayCount = dayCount
    }
}

/// `GET /api/reading-plans` and `DELETE /api/reading-plans/:id` both answer with
/// this: the plan being followed (if any) and the presets on offer.
struct ReadingPlansView: Decodable, Sendable, Equatable {
    let active: ReadingPlan?
    let presets: [ReadingPlanPreset]

    private enum CodingKeys: String, CodingKey { case active, presets }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        active = try container.decodeIfPresent(ReadingPlan.self, forKey: .active)
        presets = try container.decodeIfPresent([ReadingPlanPreset].self, forKey: .presets) ?? []
    }

    init(active: ReadingPlan?, presets: [ReadingPlanPreset]) {
        self.active = active
        self.presets = presets
    }
}
