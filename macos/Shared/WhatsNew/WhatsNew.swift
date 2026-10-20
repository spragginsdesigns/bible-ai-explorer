import Foundation

// Release notes ("What's new"), as served by the shared API. The shapes mirror
// `src/lib/whats-new-rules.ts`; the server builds them from the Play block of
// `mobile/CHANGELOG.md`, and the rules here are Android's
// (`mobile/src/features/whatsNew/whatsNew.ts`) line for line.

enum WhatsNewKind: String, CaseIterable, Sendable {
    case new, improved, fixed

    var label: String {
        switch self {
        case .new: "New"
        case .improved: "Improved"
        case .fixed: "Fixed"
        }
    }
}

/// A feature a release can open. Named rather than pathed on the server
/// because every client places them differently.
enum WhatsNewTarget: String, CaseIterable, Sendable {
    case today, bible, chat, connections, study, sermons, cross, learn, plan, history, timeline
}

struct WhatsNewSection: Decodable, Hashable, Sendable {
    let kind: WhatsNewKind
    let items: [String]

    private enum CodingKeys: String, CodingKey { case kind, items }

    /// A kind added by a newer server reads as "improved" rather than failing
    /// the whole document.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = WhatsNewKind(rawValue: try container.decode(String.self, forKey: .kind)) ?? .improved
        items = try container.decode([String].self, forKey: .items)
    }

    init(kind: WhatsNewKind, items: [String]) {
        self.kind = kind
        self.items = items
    }
}

struct WhatsNewVerse: Decodable, Hashable, Sendable {
    let text: String
    let reference: String
}

struct WhatsNewEntry: Decodable, Hashable, Identifiable, Sendable {
    let version: String
    let versionCode: Int
    /// YYYY-MM-DD.
    let date: String
    let sections: [WhatsNewSection]
    let title: String
    let headline: String?
    let why: String?
    let verse: WhatsNewVerse?
    let target: WhatsNewTarget?

    var id: String { version }

    private enum CodingKeys: String, CodingKey {
        case version, versionCode, date, sections, title, headline, why, verse, target
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(String.self, forKey: .version)
        versionCode = try container.decode(Int.self, forKey: .versionCode)
        date = try container.decode(String.self, forKey: .date)
        sections = try container.decode([WhatsNewSection].self, forKey: .sections)
        title = try container.decode(String.self, forKey: .title)
        headline = try container.decodeIfPresent(String.self, forKey: .headline)
        why = try container.decodeIfPresent(String.self, forKey: .why)
        verse = try container.decodeIfPresent(WhatsNewVerse.self, forKey: .verse)
        // An unknown target from a newer server is simply no target.
        target = (try container.decodeIfPresent(String.self, forKey: .target)).flatMap(WhatsNewTarget.init)
    }

    init(
        version: String, versionCode: Int, date: String, sections: [WhatsNewSection], title: String,
        headline: String? = nil, why: String? = nil, verse: WhatsNewVerse? = nil, target: WhatsNewTarget? = nil
    ) {
        self.version = version
        self.versionCode = versionCode
        self.date = date
        self.sections = sections
        self.title = title
        self.headline = headline
        self.why = why
        self.verse = verse
        self.target = target
    }
}

struct WhatsNewBeginning: Decodable, Hashable, Sendable {
    let title: String
    let dateRange: String
    let summary: String
    let items: [String]
}

/// `GET /api/whats-new`.
struct WhatsNewDocument: Decodable, Sendable {
    let entries: [WhatsNewEntry]
    let beginning: WhatsNewBeginning
}

/// `GET /api/whats-new/catch-up`.
struct WhatsNewCatchUp: Decodable, Identifiable, Sendable {
    struct Card: Decodable, Hashable, Identifiable, Sendable {
        let version: String
        let versionCode: Int
        let title: String
        let summary: String
        let target: WhatsNewTarget?

        var id: Int { versionCode }

        private enum CodingKeys: String, CodingKey { case version, versionCode, title, summary, target }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decode(String.self, forKey: .version)
            versionCode = try container.decode(Int.self, forKey: .versionCode)
            title = try container.decode(String.self, forKey: .title)
            summary = try container.decode(String.self, forKey: .summary)
            target = (try container.decodeIfPresent(String.self, forKey: .target)).flatMap(WhatsNewTarget.init)
        }
    }

    let cards: [Card]
    let newReleaseCount: Int
    let seenUpTo: Int

    var id: Int { seenUpTo }
}

/// `POST /api/whats-new/catch-up`.
struct WhatsNewSeenBody: Encodable, Sendable {
    let versionCode: Int
}

/// Where a target opens on the Apple clients. Sermon studies and the timeline
/// sit behind Study's own navigation with no outside entry, so their cards
/// read "Read more" instead of opening the wrong place.
enum WhatsNewDestination: Equatable {
    case section(AppSection)
    case cross
    case daily(DailyWalkDestination)
}

enum WhatsNewRules {
    static let pageSize = 12

    static func destination(for target: WhatsNewTarget) -> WhatsNewDestination? {
        switch target {
        case .today: .section(.today)
        case .bible: .section(.bible)
        case .chat: .section(.chat)
        case .connections: .section(.connections)
        case .study: .section(.study)
        case .cross: .cross
        case .plan: .daily(.plan)
        case .learn: .daily(.learn)
        case .history: .daily(.history)
        case .sermons, .timeline: nil
        }
    }

    /// A release counts as "new" when any section is; otherwise its first section names it.
    static func primaryKind(_ entry: WhatsNewEntry) -> WhatsNewKind {
        if entry.sections.contains(where: { $0.kind == .new }) { return .new }
        return entry.sections.first?.kind ?? .improved
    }

    /// The search and change-type filter every client offers: every word must appear.
    static func filter(_ entries: [WhatsNewEntry], query: String, kind: WhatsNewKind?) -> [WhatsNewEntry] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        return entries.filter { entry in
            if let kind, !entry.sections.contains(where: { $0.kind == kind }) { return false }
            if words.isEmpty { return true }
            let haystack = ([entry.version, entry.title, entry.headline ?? ""] + entry.sections.flatMap(\.items))
                .joined(separator: " ")
                .lowercased()
            return words.allSatisfy { haystack.contains($0) }
        }
    }

    private static let months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    private static func parts(_ date: String) -> (year: Int, month: Int, day: Int) {
        let numbers = date.split(separator: "-").map { Int($0) ?? 0 }
        return (numbers.first ?? 0, numbers.count > 1 ? numbers[1] : 0, numbers.count > 2 ? numbers[2] : 0)
    }

    private static func monthName(_ month: Int) -> String {
        (1...12).contains(month) ? months[month - 1] : ""
    }

    /// "2026-10-19" -> "October 19, 2026". Parsed by hand so no time zone can move the day.
    static func formatDate(_ date: String) -> String {
        let (year, month, day) = parts(date)
        return "\(monthName(month)) \(day), \(year)"
    }

    /// Consecutive releases grouped under "October 2026" headings, newest first.
    static func groupByMonth(_ entries: [WhatsNewEntry]) -> [(month: String, entries: [WhatsNewEntry])] {
        var groups: [(month: String, entries: [WhatsNewEntry])] = []
        for entry in entries {
            let (year, month, _) = parts(entry.date)
            let label = "\(monthName(month)) \(year)"
            if groups.last?.month == label {
                groups[groups.count - 1].entries.append(entry)
            } else {
                groups.append((label, [entry]))
            }
        }
        return groups
    }
}
