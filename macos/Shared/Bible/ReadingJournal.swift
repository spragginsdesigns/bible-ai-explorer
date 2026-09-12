import CryptoKit
import Foundation
import Network

struct ReadingVerseRange: Codable, Equatable, Sendable {
    var start: Int
    var end: Int
}

struct ReadingJournalEntry: Codable, Equatable, Identifiable, Sendable {
    var eventId: String
    var sessionId: String
    var revision: Int
    var source = "reader"
    var book: Int
    var chapter: Int
    var translation: String
    var occurredAt: String?
    var timezone: String
    var precision = "exact"
    var completed: Bool
    var verseRanges: [ReadingVerseRange]
    var evidence: String? = "active_view"
    var bookName: String?
    var localDate: String?
    var deletedAt: String?
    var id: String { eventId }

    var reference: String {
        let book = bookName ?? Bible.book(order: book)?.name ?? "Bible"
        let verses = verseRanges.map { $0.start == $0.end ? "\($0.start)" : "\($0.start)–\($0.end)" }.joined(separator: ", ")
        return "\(book) \(chapter)" + (completed ? "" : ":\(verses)")
    }
    var timeLabel: String {
        if precision == "exact", let occurredAt, let date = Self.date(occurredAt) {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium; formatter.timeStyle = .short
            formatter.timeZone = TimeZone(identifier: timezone) ?? .current
            let zoneLabel = timezone == TimeZone.current.identifier ? "" : " · \(timezone)"
            return formatter.string(from: date) + zoneLabel
        }
        let day = localDate ?? "Date unknown"
        let period = ["morning", "afternoon", "evening"].contains(precision) ? " · \(precision)" : ""
        return day + period + (precision == "legacy" ? " · legacy tracking" : "")
    }
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct ReadingJournalStats: Decodable, Sendable {
    var sessions: Int?
    var chapterReadings: Int
    var partialReadings: Int
    var uniqueChapters: Int
    var activeDays: Int?
    var historicalBackfillPending: Bool?
}
struct ReadingJournalPage: Decodable, Sendable {
    var entries: [ReadingJournalEntry]
    var nextCursor: String?
    var stats: ReadingJournalStats
}
struct ReadingJournalSave: Decodable, Sendable {
    var recorded: Bool
    var entry: ReadingJournalEntry
}

/// One atomic account-specific file contains only unsynced snapshots and the
/// current session. No scripture text, background polling or lifetime cache.
@MainActor @Observable
final class ReadingJournal {
    static let dwellSeconds: TimeInterval = 8
    static let idleSeconds: TimeInterval = 30 * 60
    struct Stored: Codable { var entry: ReadingJournalEntry; var syncedRevision = 0; var blocked = false }
    struct State: Codable {
        var version = 1
        var account: String
        var sessionID: String?
        var lastActivity: Date?
        var rows: [String: Stored] = [:]
    }
    struct Location: Equatable { var book: Int; var chapter: Int; var translation: String; var verseCount: Int }
    typealias Send = @MainActor (ReadingJournalEntry) async throws -> ReadingJournalSave
    typealias RetryWait = @MainActor (TimeInterval) async throws -> Void
    private var state: State
    private let fileURL: URL?
    private let send: Send
    private let waitForRetry: RetryWait
    private let requestTimeout: TimeInterval
    private let api: APIClient?
    private var loadFailed = false
    private var foreground = false
    private var readerVisible = false
    private var obscuredReasons: Set<String> = []
    private var readerFocused = true
    private var stopped = false
    private var location: Location?
    private var visible: Set<Int> = []
    private var since: [Int: TimeInterval] = [:]
    private var dwellTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var syncGeneration = 0
    private var attempts = 0
    private var pathMonitor: NWPathMonitor?
    private var wasConnected: Bool?
    private(set) var error: String?
    private(set) var historyError: String?
    private(set) var history: [ReadingJournalEntry] = []
    private(set) var stats: ReadingJournalStats?
    private(set) var nextCursor: String?
    private(set) var loadingHistory = false
    var pendingCount: Int { state.rows.values.filter { $0.entry.revision > $0.syncedRevision && !$0.blocked }.count }
    var blockedCount: Int { state.rows.values.filter(\.blocked).count }
    var canTrack: Bool { !stopped && !loadFailed && !state.account.isEmpty && foreground && readerVisible && obscuredReasons.isEmpty && readerFocused && location != nil }

    init(account: String?, api: APIClient?, fileURL: URL? = nil, send: Send? = nil, retryWait: RetryWait? = nil, requestTimeout: TimeInterval = 35) {
        let account = account ?? ""
        self.state = State(account: account)
        self.api = api
        self.requestTimeout = requestTimeout
        self.waitForRetry = retryWait ?? { delay in try await Task.sleep(for: .seconds(delay)) }
        if let fileURL { self.fileURL = fileURL }
        else if !account.isEmpty {
            let digest = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
            self.fileURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
                .appendingPathComponent("SureWord/ReadingJournal/\(digest).json")
        } else { self.fileURL = nil }
        self.send = send ?? { entry in
            guard let api else { throw APIError.offline }
            return try await api.json("/api/reading-log", method: "POST", body: entry)
        }
        if let url = self.fileURL, FileManager.default.fileExists(atPath: url.path) {
            do {
                let stored = try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
                guard stored.version == 1, stored.account == account else { throw APIError(message: "Reading cache belongs to a different account or version.") }
                state = stored
            } catch {
                loadFailed = true
                self.error = "Your saved reading queue could not be opened. It has been preserved; reading tracking is paused."
            }
        }
        if api != nil && !account.isEmpty {
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { [weak self] path in
                let connected = path.status == .satisfied
                Task { @MainActor [weak self] in self?.networkChanged(connected) }
            }
            monitor.start(queue: DispatchQueue(label: "sureword.reading.network"))
            pathMonitor = monitor
        }
    }

    private func networkChanged(_ connected: Bool) {
        let recovered = wasConnected == false && connected
        wasConnected = connected
        guard recovered, foreground, !stopped else { return }
        attempts = 0; retryTask?.cancel(); retryTask = nil
        flush()
    }

    static func compact(_ verses: Set<Int>) -> [ReadingVerseRange] {
        var result: [ReadingVerseRange] = []
        for verse in verses.filter({ $0 > 0 }).sorted() {
            if let last = result.last, last.end + 1 == verse { result[result.count - 1].end = verse }
            else { result.append(.init(start: verse, end: verse)) }
        }
        return result
    }
    private func persist() throws {
        guard let fileURL else { throw APIError(message: "Sign in before saving reading history.") }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: fileURL, options: .atomic)
    }
    private func touch(now: Date) throws {
        if state.sessionID == nil || now.timeIntervalSince(state.lastActivity ?? .distantPast) >= Self.idleSeconds || now < (state.lastActivity ?? .distantPast) {
            state.sessionID = UUID().uuidString.lowercased()
            state.rows = state.rows.filter { $0.value.entry.revision > $0.value.syncedRevision || $0.value.blocked }
        }
        state.lastActivity = now
    }
    func setForeground(_ active: Bool) {
        let resumed = !foreground && active
        foreground = active
        if resumed { attempts = 0 }
        if !active {
            dwellTask?.cancel(); dwellTask = nil; since.removeAll()
            retryTask?.cancel(); retryTask = nil
            // Requests cancelled on background keep their durable snapshots.
            syncGeneration += 1; syncTask?.cancel(); syncTask = nil
        } else if !stopped {
            resumeDwell(); flush()
        }
    }
    func setReaderVisible(_ active: Bool) {
        readerVisible = active
        if active { resumeDwell() }
        else { dwellTask?.cancel(); dwellTask = nil; since.removeAll(); visible.removeAll() }
    }
    func setObscured(_ value: Bool, reason: String = "verse") {
        if value { obscuredReasons.insert(reason) } else { obscuredReasons.remove(reason) }
        if value { dwellTask?.cancel(); dwellTask = nil; since.removeAll() }
        else { resumeDwell() }
    }
    func setReaderFocused(_ active: Bool) {
        readerFocused = active
        if active { resumeDwell() }
        else { dwellTask?.cancel(); dwellTask = nil; since.removeAll() }
    }
    func enter(book: Int, chapter: Int, translation: String, verseCount: Int) {
        let next = Location(book: book, chapter: chapter, translation: translation, verseCount: verseCount)
        guard next != location else { return }
        location = next; visible.removeAll(); since.removeAll(); dwellTask?.cancel(); dwellTask = nil
    }
    func visibility(verse: Int, isVisible: Bool, now: Date = Date(), uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard let location, verse >= 1, verse <= location.verseCount else { return }
        if isVisible { visible.insert(verse) } else { visible.remove(verse); since.removeValue(forKey: verse) }
        guard canTrack else { return }
        do { try touch(now: now) } catch { self.error = error.localizedDescription; return }
        if isVisible { since[verse] = since[verse] ?? uptime }
        scheduleDwell()
    }
    private func resumeDwell() {
        guard canTrack else { return }
        do { try touch(now: Date()) } catch { self.error = error.localizedDescription; return }
        let now = ProcessInfo.processInfo.systemUptime
        since = Dictionary(uniqueKeysWithValues: visible.map { ($0, now) })
        scheduleDwell()
    }
    private func scheduleDwell() {
        dwellTask?.cancel(); dwellTask = nil
        guard canTrack, let earliest = since.values.min() else { return }
        let delay = max(0.01, Self.dwellSeconds - (ProcessInfo.processInfo.systemUptime - earliest))
        dwellTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self, !Task.isCancelled else { return }
            self.checkpoint()
            self.scheduleDwell()
        }
    }
    /// Called only for an eligible foreground viewport. Public for deterministic
    /// tests with an injected monotonic clock; the app uses the one-shot timer.
    func checkpoint(now: Date = Date(), uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard canTrack, let location else { return }
        let due = since.filter { uptime - $0.value >= Self.dwellSeconds }.map(\.key)
        guard !due.isEmpty else { return }
        let previous = state
        do {
            try touch(now: now)
            guard let session = state.sessionID else { return }
            let eventID = "\(session):\(location.book):\(location.chapter)"
            let existing = state.rows[eventID]
            var covered = Set(existing?.entry.verseRanges.flatMap { Array($0.start...$0.end) } ?? [])
            covered.formUnion(due)
            let ranges = Self.compact(covered)
            if existing?.entry.verseRanges != ranges {
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                var entry = existing?.entry ?? ReadingJournalEntry(eventId: eventID, sessionId: session, revision: 0,
                    book: location.book, chapter: location.chapter, translation: location.translation,
                    occurredAt: formatter.string(from: now), timezone: TimeZone.current.identifier,
                    completed: false, verseRanges: [])
                entry.revision += 1; entry.verseRanges = ranges
                entry.completed = covered.count == location.verseCount
                state.rows[eventID] = Stored(entry: entry, syncedRevision: existing?.syncedRevision ?? 0, blocked: existing?.blocked ?? false)
            }
            try persist()
            for verse in due { since.removeValue(forKey: verse) }
            error = nil
            flush()
        } catch {
            state = previous
            self.error = "Reading could not be saved on this device. Free some storage and retry."
            since.removeAll() // avoid a hot retry loop on storage failure
        }
    }
    func retry() {
        guard !stopped, !loadFailed else { return }
        let previous = state
        do {
            for key in state.rows.keys { state.rows[key]?.blocked = false }
            try persist(); error = nil; attempts = 0
            retryTask?.cancel(); retryTask = nil
            resumeDwell(); flush()
        } catch { state = previous; self.error = "Reading could not be saved on this device." }
    }
    func flush() {
        guard foreground, !stopped, !loadFailed, syncTask == nil, retryTask == nil, attempts < 6, pendingCount > 0 else { return }
        retryTask?.cancel(); retryTask = nil
        syncGeneration += 1
        let generation = syncGeneration
        syncTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.syncGeneration == generation { self.syncTask = nil } }
            let batch = self.state.rows.values.filter { $0.entry.revision > $0.syncedRevision && !$0.blocked }.prefix(20).map(\.entry)
            for entry in batch {
                guard self.foreground, !self.stopped, !Task.isCancelled else { return }
                do {
                    let send = self.send
                    let response = try await ReadingRequestDeadline<ReadingJournalSave>.run(seconds: self.requestTimeout) { try await send(entry) }
                    guard !self.stopped, !Task.isCancelled, self.syncGeneration == generation else { return }
                    let previous = self.state
                    var updated = self.state
                    if var row = updated.rows[entry.eventId] {
                        row.syncedRevision = response.entry.deletedAt != nil ? row.entry.revision : max(row.syncedRevision, entry.revision)
                        updated.rows[entry.eventId] = row
                    }
                    let currentSession = updated.sessionID
                    updated.rows = updated.rows.filter { $0.value.entry.sessionId == currentSession || $0.value.entry.revision > $0.value.syncedRevision || $0.value.blocked }
                    self.state = updated
                    do { try self.persist() } catch { self.state = previous; throw error }
                    self.attempts = 0; self.error = nil
                } catch {
                    guard !Task.isCancelled else { return }
                    let code = (error as? APIError)?.status
                    if let code, [400, 403, 404, 409, 422].contains(code) {
                        self.state.rows[entry.eventId]?.blocked = true
                        try? self.persist()
                        self.error = "A reading entry needs attention. Your local copy is preserved. Open history and retry after checking it."
                    } else {
                        self.error = "Reading is saved on this device and waiting to sync."
                        self.attempts += 1; self.scheduleRetry(); return
                    }
                }
            }
            if self.pendingCount > 0 { self.scheduleRetry(delay: 1) }
        }
    }
    private func scheduleRetry(delay: TimeInterval? = nil) {
        guard foreground, !stopped, attempts < 6 else { return }
        retryTask?.cancel()
        let wait = delay ?? min(300, 5 * pow(2, Double(min(attempts, 6)))) * Double.random(in: 0.8...1.2)
        let waitForRetry = self.waitForRetry
        retryTask = Task { [weak self] in
            do { try await waitForRetry(wait) } catch { return }
            guard let self, !Task.isCancelled else { return }
            self.retryTask = nil; self.flush()
        }
    }
    func teardown() {
        stopped = true; foreground = false
        pathMonitor?.cancel(); pathMonitor = nil
        dwellTask?.cancel(); syncTask?.cancel(); retryTask?.cancel()
        dwellTask = nil; syncTask = nil; retryTask = nil
        since.removeAll(); visible.removeAll()
    }
    func loadHistory(more: Bool = false) async {
        guard !loadingHistory, !stopped, let api else { return }
        loadingHistory = true; historyError = nil
        defer { loadingHistory = false }
        do {
            let suffix = more ? nextCursor.map { "&cursor=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")" } ?? "" : ""
            let page = try await ReadingRequestDeadline<ReadingJournalPage>.run(seconds: requestTimeout) {
                try await api.json("/api/reading-log?limit=30\(suffix)", as: ReadingJournalPage.self)
            }
            guard !stopped, !Task.isCancelled else { return }
            let combined = more ? history + page.entries.filter { entry in !history.contains(where: { $0.eventId == entry.eventId }) } : page.entries
            history = Array(combined.suffix(150))
            stats = page.stats; nextCursor = page.nextCursor
        } catch { historyError = "Reading history could not be loaded. Your local reading queue is preserved." }
    }
}

/// An unstructured race is intentional: a token provider that ignores task
/// cancellation must not hold the queue open as a structured task-group child.
@MainActor
private final class ReadingRequestDeadline<Value: Sendable> {
    var continuation: CheckedContinuation<Value, any Error>?
    var work: Task<Void, Never>?
    var timer: Task<Void, Never>?
    func finish(_ result: Result<Value, any Error>) {
        guard let continuation else { return }
        self.continuation = nil
        work?.cancel(); timer?.cancel(); work = nil; timer = nil
        continuation.resume(with: result)
    }
    static func run(seconds: TimeInterval, operation: @escaping @MainActor () async throws -> Value) async throws -> Value {
        try Task.checkCancellation()
        let race = ReadingRequestDeadline<Value>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                race.continuation = continuation
                race.work = Task {
                    do { race.finish(.success(try await operation())) }
                    catch { race.finish(.failure(error)) }
                }
                race.timer = Task {
                    do { try await Task.sleep(for: .seconds(seconds)) } catch { return }
                    race.finish(.failure(APIError.timedOut))
                }
            }
        } onCancel: {
            Task { @MainActor in race.finish(.failure(CancellationError())) }
        }
    }
}
