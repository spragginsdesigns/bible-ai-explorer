import Foundation

// MARK: - Wire types

/// `streak` in GET /api/reading-log/overview (`ReadingStreak` in
/// `src/lib/reading-overview-rules.ts`).
struct ReadingStreak: Decodable, Equatable, Sendable {
    var current: Int
    var longest: Int
    /// The streak is alive but today has no reading yet.
    var atRisk: Bool
    var lastActiveDate: String?
}

/// One book's chapters read whole (`complete`) and only started (`started`).
struct ReadingBookCoverage: Decodable, Equatable, Sendable {
    var book: Int
    var complete: [Int]
    var started: [Int]
}

/// GET /api/reading-log/overview: the reading log header (lifetime totals,
/// streak and the Bible map). Mirrors `ReadingOverview` in
/// `mobile/src/features/reading/readingOverview.ts`.
struct ReadingOverview: Decodable, Equatable, Sendable {
    struct Totals: Decodable, Equatable, Sendable {
        var chaptersComplete: Int
        var totalChapters: Int
        var booksStarted: Int
        var chapterReadings: Int
        var activeDays: Int
        var lastReadAt: String?
    }
    var totals: Totals
    var streak: ReadingStreak
    var books: [ReadingBookCoverage]
    var historicalBackfillPending: Bool
}

/// "Your walk": the AI reflection on what the person has been reading.
struct ReadingReflection: Decodable, Equatable, Sendable {
    struct Verse: Decodable, Equatable, Sendable {
        var book: Int
        var bookName: String
        var chapter: Int
        var verse: Int
        var text: String
        var note: String?
    }
    struct Next: Decodable, Equatable, Sendable {
        var book: Int
        var bookName: String
        var chapter: Int
        var reason: String
    }
    var title: String
    var reflection: String
    var verse: Verse?
    var next: Next?
}

/// GET /api/reading-log/reflection. An unknown status reads as `unavailable`,
/// so a newer server can never strand the card on a decode error.
enum ReadingReflectionResponse: Decodable, Equatable, Sendable {
    case ready(ReadingReflection, generatedAt: String)
    case empty
    case consentRequired
    case unavailable

    private enum Keys: String, CodingKey { case status, reflection, generatedAt }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        switch try container.decode(String.self, forKey: .status) {
        case "ready":
            self = .ready(
                try container.decode(ReadingReflection.self, forKey: .reflection),
                generatedAt: try container.decode(String.self, forKey: .generatedAt)
            )
        case "empty": self = .empty
        case "consent-required": self = .consentRequired
        default: self = .unavailable
        }
    }
}

// MARK: - Presentation types

/// One row of the timeline: a chapter on a local day, every session of it
/// that day merged. Android `DayChapter`.
struct ReadingDayChapter: Equatable, Identifiable, Sendable {
    var key: String
    var book: Int
    var bookName: String
    var chapter: Int
    var translation: String
    var completed: Bool
    /// 0...1 share of the chapter's verses seen that day; 1 when completed.
    var fraction: Double
    var readings: Int
    var physical: Bool
    /// Carried over from the reading tracker that came before the log.
    var legacy: Bool
    var firstVerse: Int
    var id: String { key }

    /// Source tags then the reread count: "Physical Bible · 2 times",
    /// "Earlier tracking", or nil when nothing applies. Other sources carry no tag.
    var meta: String? {
        let parts = [
            physical ? "Physical Bible" : nil,
            legacy ? "Earlier tracking" : nil,
            readings > 1 ? "\(readings) times" : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
    /// Width of the partial-reading bar, never thinner than a sliver.
    var barFraction: Double { max(0.06, (fraction * 100).rounded() / 100) }
    var accessibilityLabel: String {
        "Open \(bookName) \(chapter), \(completed ? "read" : "\(Int((fraction * 100).rounded())) percent read")"
    }
}

struct ReadingLogDay: Equatable, Identifiable, Sendable {
    /// "YYYY-MM-DD", or "unknown" for a reading with no date at all.
    var date: String
    var chapters: [ReadingDayChapter]
    var id: String { date }
}

/// One book on the Bible map. Android `BookProgress`.
struct ReadingBookProgress: Equatable, Identifiable, Sendable {
    enum ChapterState: Equatable, Sendable { case read, started, unread }

    var order: Int
    var name: String
    var abbr: String
    var chapters: Int
    var complete: Set<Int>
    var started: Set<Int>
    var id: Int { order }

    var touched: Bool { !complete.isEmpty || !started.isEmpty }
    /// Share of the book's chapters read whole, for the tile's bar.
    var share: Double { chapters > 0 ? Double(complete.count) / Double(chapters) : 0 }
    /// Gold filled when read whole, outlined when only started.
    func state(of chapter: Int) -> ChapterState {
        complete.contains(chapter) ? .read : started.contains(chapter) ? .started : .unread
    }
    /// "Genesis · 3 of 50 chapters read".
    var chapterTitle: String {
        "\(name) · \(complete.count) of \(chapters) \(chapters == 1 ? "chapter" : "chapters") read"
    }
}

/// A stat tile in the header: value, label and the small line under it.
struct ReadingStatTile: Equatable, Identifiable, Sendable {
    var value: String
    var label: String
    var sub: String
    var id: String { label }
}

// MARK: - Rules

/// Pure presentation rules for the reading log, ported from
/// `mobile/src/features/reading/readingOverview.ts` and the `Stats` tiles in
/// `mobile/app/(app)/bible/history.tsx`. Android is the source of truth for
/// every string; tested in `ReadingOverviewTests`.
enum ReadingLogRules {
    static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    /// The prefilled question behind "Talk it over →".
    static let talkPrompt = "Help me go deeper in what I have been reading lately."

    /// A Gregorian calendar on the device's zone (or a fixed one in tests).
    static func gregorian(_ timeZone: TimeZone = .current) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// "YYYY-MM-DD" for an instant on the given calendar.
    static func localDateKey(_ instant: Date, calendar: Calendar = gregorian()) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        return String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The server's local day first, then the occurrence on this device's
    /// calendar, then "unknown".
    static func entryDate(_ entry: ReadingJournalEntry, calendar: Calendar = gregorian()) -> String {
        if let localDate = entry.localDate, !localDate.isEmpty { return localDate }
        if let occurredAt = entry.occurredAt, let date = ReadingJournalEntry.date(occurredAt) {
            return localDateKey(date, calendar: calendar)
        }
        return "unknown"
    }

    /// Group entries (newest first) into local days, one row per chapter per
    /// day. Rereading a chapter in a second session that day adds to
    /// `readings`, and partial sessions pool their verses so the progress bar
    /// shows what was seen.
    static func groupByDay(
        _ entries: [ReadingJournalEntry],
        calendar: Calendar = gregorian(),
        bookName: (Int) -> String = { Bible.book(order: $0)?.name ?? "Bible" }
    ) -> [ReadingLogDay] {
        var days: [ReadingLogDay] = []
        var dayIndex: [String: Int] = [:]
        var rowIndex: [String: Int] = [:]
        var seen: [String: Set<Int>] = [:]
        for entry in entries {
            let date = entryDate(entry, calendar: calendar)
            let day: Int
            if let known = dayIndex[date] { day = known } else {
                day = days.count
                dayIndex[date] = day
                days.append(ReadingLogDay(date: date, chapters: []))
            }
            let key = "\(date):\(entry.book):\(entry.chapter)"
            let first = entry.verseRanges.first?.start
            let index: Int
            if let known = rowIndex[key] { index = known } else {
                index = days[day].chapters.count
                rowIndex[key] = index
                days[day].chapters.append(ReadingDayChapter(
                    key: key, book: entry.book, bookName: entry.bookName ?? bookName(entry.book),
                    chapter: entry.chapter, translation: entry.translation, completed: false,
                    fraction: 0, readings: 0, physical: false, legacy: false, firstVerse: first ?? 1
                ))
            }
            seen[key, default: []].formUnion(ReadingJournalCore.covered(entry.verseRanges))
            var row = days[day].chapters[index]
            row.readings += 1
            row.completed = row.completed || entry.completed
            row.physical = row.physical || entry.source == "physical"
            row.legacy = row.legacy || entry.source == "legacy"
            row.firstVerse = min(row.firstVerse, first ?? row.firstVerse)
            let total = entry.chapterVerses ?? 0
            let covered = seen[key]?.count ?? 0
            row.fraction = row.completed ? 1 : total > 0 ? min(1, Double(covered) / Double(total)) : 0
            days[day].chapters[index] = row
        }
        // The server orders by occurrence, so a late-synced or backdated
        // reading can put its day out of order: newest day first, "unknown" last.
        return days.sorted { a, b in
            if (a.date == "unknown") != (b.date == "unknown") { return b.date == "unknown" }
            return a.date > b.date
        }
    }

    /// "Today", "Yesterday", "Wednesday" within the week, "Wednesday, Oct 7",
    /// or "Oct 7, 2025" for another year.
    static func dayHeading(_ date: String, today: String) -> String {
        guard let day = parseDay(date) else { return "Date not recorded" }
        if date == today { return "Today" }
        let label = "\(months[day.month - 1]) \(day.day)"
        guard let now = parseDay(today) else { return "\(label), \(day.year)" }
        let utc = gregorian(TimeZone(identifier: "UTC") ?? .current)
        let diff = utc.dateComponents([.day], from: day.date, to: now.date).day ?? 0
        if diff == 1 { return "Yesterday" }
        if day.year != now.year { return "\(label), \(day.year)" }
        let weekday = weekdays[utc.component(.weekday, from: day.date) - 1]
        if diff > 1 && diff < 7 { return weekday }
        return "\(weekday), \(label)"
    }

    private static func parseDay(_ value: String) -> (year: Int, month: Int, day: Int, date: Date)? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard value.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              (1...12).contains(month), (1...31).contains(day)
        else { return nil }
        let utc = gregorian(TimeZone(identifier: "UTC") ?? .current)
        guard let date = utc.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        return (year, month, day, date)
    }

    /// "3%", or "<1%" so a first chapter never reads as zero.
    static func percentOfBible(_ chapters: Int, total: Int) -> String {
        guard chapters > 0, total > 0 else { return "0%" }
        let percent = Double(chapters) / Double(total) * 100
        return percent < 1 ? "<1%" : "\(Int(percent.rounded(.down)))%"
    }

    /// The reflection card's freshness line; empty when the stamp is unreadable.
    static func reflectionAge(_ generatedAt: String, now: Date, calendar: Calendar = gregorian()) -> String {
        guard let at = ReadingJournalEntry.date(generatedAt) else { return "" }
        let written = localDateKey(at, calendar: calendar)
        if written == localDateKey(now, calendar: calendar) { return "Written today from your reading" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           written == localDateKey(yesterday, calendar: calendar) {
            return "Written yesterday from your reading"
        }
        let parts = calendar.dateComponents([.month, .day], from: at)
        return "Written \(months[max(1, min(12, parts.month ?? 1)) - 1]) \(parts.day ?? 1) from your reading"
    }

    /// The small line under the streak tile.
    static func streakNote(_ streak: ReadingStreak) -> String {
        if streak.atRisk { return "Read today to keep it" }
        if streak.current == 0 { return streak.longest > 0 ? "Best \(streak.longest)" : "Read today to start" }
        return streak.current >= streak.longest ? "Your best yet" : "Best \(streak.longest)"
    }

    /// Day streak, chapters read and books opened, in Android's order.
    static func statTiles(_ overview: ReadingOverview) -> [ReadingStatTile] {
        let totals = overview.totals
        return [
            ReadingStatTile(value: count(overview.streak.current), label: "day streak", sub: streakNote(overview.streak)),
            ReadingStatTile(
                value: count(totals.chaptersComplete),
                label: totals.chaptersComplete == 1 ? "chapter read" : "chapters read",
                sub: "\(percentOfBible(totals.chaptersComplete, total: totals.totalChapters)) of the Bible"
            ),
            ReadingStatTile(
                value: count(totals.booksStarted),
                label: totals.booksStarted == 1 ? "book opened" : "books opened",
                sub: "of 66"
            ),
        ]
    }

    private static func count(_ value: Int) -> String {
        NumberFormatter.localizedString(from: NSNumber(value: value), number: .decimal)
    }

    /// Every book of a testament in canonical order, with what has been read.
    static func testamentProgress(
        _ books: [Book] = Bible.books,
        coverage: [ReadingBookCoverage],
        testament: Book.Testament
    ) -> [ReadingBookProgress] {
        let byBook = Dictionary(coverage.map { ($0.book, $0) }, uniquingKeysWith: { first, _ in first })
        return books.filter { $0.testament == testament }.map { book in
            ReadingBookProgress(
                order: book.order, name: book.name, abbr: book.abbr, chapters: book.chapters,
                complete: Set(byBook[book.order]?.complete ?? []),
                started: Set(byBook[book.order]?.started ?? [])
            )
        }
    }

    /// The map opens on the testament with more reading, New on a tie.
    static func preferredTestament(_ books: [Book] = Bible.books, coverage: [ReadingBookCoverage]) -> Book.Testament {
        func total(_ testament: Book.Testament) -> Int {
            testamentProgress(books, coverage: coverage, testament: testament)
                .reduce(0) { $0 + $1.complete.count + $1.started.count }
        }
        return total(.nt) >= total(.ot) ? .nt : .ot
    }

    /// How many book tiles fit across the map, never fewer than one.
    static func mapColumns(width: CGFloat, minimum: CGFloat, spacing: CGFloat) -> Int {
        guard width > 0, minimum > 0 else { return 1 }
        return max(1, Int(((width + spacing) / (minimum + spacing)).rounded(.down)))
    }

    /// The map's tiles split into rows, so a book's chapter panel can open
    /// directly under the row it sits in.
    static func rows<Item>(_ items: [Item], columns: Int) -> [[Item]] {
        let size = max(1, columns)
        return stride(from: 0, to: items.count, by: size).map { Array(items[$0..<min($0 + size, items.count)]) }
    }

    /// `?tz=` for the overview and reflection routes; empty when unknown.
    static func timezoneQuery(_ timeZone: TimeZone = .current) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let identifier = timeZone.identifier
        guard !identifier.isEmpty, let encoded = identifier.addingPercentEncoding(withAllowedCharacters: allowed) else { return "" }
        return "?tz=\(encoded)"
    }
}

// MARK: - Your walk

/// "Your walk": the AI reflection card at the top of the reading log, port of
/// `mobile/src/features/reading/WalkCard.tsx`. The server caches it per
/// change in reading, so a load is usually one row read. Without AI consent
/// an open never asks; the card offers "Write my reflection →", and only that
/// tap may raise the consent sheet.
@MainActor
@Observable
final class ReadingWalkModel {
    enum State: Equatable {
        case loading
        case consent
        case error
        case hidden
        case ready(ReadingReflection, generatedAt: String)
    }
    typealias Fetch = @MainActor (String) async throws -> ReadingReflectionResponse
    typealias Gate = @MainActor (AIConsentStore.Trigger) async -> Bool

    private(set) var state: State = .loading
    var isReady: Bool {
        if case .ready = state { return true }
        return false
    }
    @ObservationIgnored private let fetch: Fetch?
    @ObservationIgnored private let gate: Gate
    @ObservationIgnored private var request = 0

    init(fetch: Fetch?, gate: @escaping Gate = { await AIConsentGate.ensure($0) }) {
        self.fetch = fetch
        self.gate = gate
    }

    /// `ask` is the consent offer's tap. A silent refresh keeps a ready card
    /// on screen while it checks for a newer one.
    func load(ask: Bool = false) async {
        guard let fetch else { return }
        request += 1
        let id = request
        if ask || !isReady { state = .loading }
        guard await gate(ask ? .tap : .automatic) else {
            if id == request { state = .consent }
            return
        }
        guard id == request else { return }
        do {
            let result = try await fetch("/api/reading-log/reflection\(ReadingLogRules.timezoneQuery())")
            guard id == request else { return }
            switch result {
            case .ready(let reflection, let generatedAt): state = .ready(reflection, generatedAt: generatedAt)
            case .consentRequired: state = .consent
            case .empty: state = .hidden
            case .unavailable: state = .error
            }
        } catch {
            guard id == request else { return }
            state = (error as? APIError)?.status == 403 ? .consent : .error
        }
    }

    /// The screen went away: a late answer is dropped.
    func cancel() { request += 1 }

    /// A fresh screen or another account: drop any answer in flight and start
    /// over from loading, so nothing of the previous card shows.
    func reset() {
        request += 1
        state = .loading
    }
}
