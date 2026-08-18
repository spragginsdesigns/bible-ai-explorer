import Foundation

/// Port of `mobile/src/features/memories/utils.ts` (and its Vitest suite, ported
/// into `SureWordTests/MemoriesTests.swift`). If a case changes on one side,
/// change both.

struct MemoryGroup: Identifiable, Equatable {
    var id: String { category }
    let category: String
    let label: String
    let items: [MemoryRecord]
}

enum MemoryCategory {
    static let order = ["profile", "prayer", "study", "preference", "general"]

    static let labels: [String: String] = [
        "profile": "Profile",
        "prayer": "Prayer requests",
        "study": "Study",
        "preference": "Preferences",
        "general": "General",
    ]

    /// Groups memories under their category in canonical order, skipping empty
    /// groups. A category the server introduces before the app knows about it is
    /// folded into "General" so it never vanishes from the list.
    static func group(_ memories: [MemoryRecord]) -> [MemoryGroup] {
        var buckets: [String: [MemoryRecord]] = [:]
        for memory in memories {
            let category = labels[memory.category] != nil ? memory.category : "general"
            buckets[category, default: []].append(memory)
        }
        return order.compactMap { category in
            guard let items = buckets[category] else { return nil }
            return MemoryGroup(category: category, label: labels[category] ?? category, items: items)
        }
    }
}

/// Relative timestamps for the summary's "Updated …" line, matching
/// `relativeTime` in `mobile/src/features/notes/utils.ts`.
enum MemoryFormat {
    private static let minute: TimeInterval = 60
    private static let hour: TimeInterval = 60 * 60
    private static let day: TimeInterval = 24 * 60 * 60

    static func date(fromISO iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }

    static func relativeTime(_ iso: String, now: Date = Date()) -> String {
        guard let then = date(fromISO: iso) else { return "" }
        let diff = now.timeIntervalSince(then)
        if diff < minute { return "Just now" }
        if diff < hour { return "\(Int(diff / minute))m ago" }
        if diff < day { return "\(Int(diff / hour))h ago" }
        if diff < 7 * day { return "\(Int(diff / day))d ago" }

        let calendar = Calendar.current
        let sameYear = calendar.component(.year, from: then) == calendar.component(.year, from: now)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = sameYear ? "MMM d" : "MMM d, yyyy"
        return formatter.string(from: then)
    }
}
