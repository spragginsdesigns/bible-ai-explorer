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

    /// "John 3" for a complete chapter, "John 3:16–21, 24" for a partial one.
    var reference: String {
        let book = bookName ?? Bible.book(order: book)?.name ?? "Bible"
        let verses = verseRanges.map { $0.start == $0.end ? "\($0.start)" : "\($0.start)–\($0.end)" }.joined(separator: ", ")
        return "\(book) \(chapter)" + (completed ? "" : ":\(verses)")
    }
    /// Android `history.tsx`: an exact reading shows the device-local date and
    /// time; a coarse one shows its calendar day and never an invented hour.
    var timeLabel: String {
        if precision == "exact", let occurredAt, let date = Self.date(occurredAt) {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium; formatter.timeStyle = .short
            return formatter.string(from: date)
        }
        let day = localDate ?? occurredAt.map { String($0.prefix(10)) } ?? "Date unspecified"
        return "\(day) · \(precision == "day" ? "time unspecified" : precision)"
    }
    /// Android row subtitle: coverage first, then where the reading came from.
    var sourceLabel: String {
        let source = switch self.source {
        case "reader": "SureWord reader"
        case "physical": "Physical Bible"
        case "legacy": "Earlier tracking"
        default: "Reported reading"
        }
        return (completed ? "Chapter complete" : "Partial reading") + " · " + source
    }
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct ReadingJournalStats: Decodable, Sendable {
    /// Null from the server only for filtered queries; the screen never filters.
    var sessions: Int?
    var chapterReadings: Int
    var partialReadings: Int
    var uniqueChapters: Int
    var activeDays: Int?
    var lastReadAt: String?
    var historicalBackfillPending: Bool?

    /// "1,204 chapters covered".
    var title: String {
        "\(Self.count(uniqueChapters)) \(uniqueChapters == 1 ? "chapter" : "chapters") covered"
    }
    /// "12 chapter readings · 4 sessions · 3 days".
    var line: String {
        var parts = ["\(Self.count(chapterReadings)) \(chapterReadings == 1 ? "chapter reading" : "chapter readings")"]
        if let sessions { parts.append("\(Self.count(sessions)) \(sessions == 1 ? "session" : "sessions")") }
        if let activeDays { parts.append("\(Self.count(activeDays)) \(activeDays == 1 ? "day" : "days")") }
        return parts.joined(separator: " · ")
    }
    private static func count(_ value: Int) -> String {
        NumberFormatter.localizedString(from: NSNumber(value: value), number: .decimal)
    }
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

/// Pure reading journal rules, ported from `mobile/src/features/reading/readingLogCore.ts`.
enum ReadingJournalCore {
    static let batchSize = 25

    static func compact(_ verses: Set<Int>) -> [ReadingVerseRange] {
        var result: [ReadingVerseRange] = []
        for verse in verses.filter({ $0 > 0 }).sorted() {
            if let last = result.last, last.end + 1 == verse { result[result.count - 1].end = verse }
            else { result.append(.init(start: verse, end: verse)) }
        }
        return result
    }
    static func covered(_ ranges: [ReadingVerseRange]) -> Set<Int> {
        Set(ranges.flatMap { $0.start <= $0.end ? Array($0.start...$0.end) : [] })
    }
    /// Android `chapterEventId`: the session UUID with its last six hex digits
    /// mixed with book and chapter, so one session/chapter keeps one identity
    /// and a translation switch does not count a reread.
    static func chapterEventId(sessionId: String, book: Int, chapter: Int) -> String {
        let head = String(sessionId.prefix(30))
        let digits = sessionId.dropFirst(30).prefix { $0.isHexDigit }
        let tail = Int(digits, radix: 16) ?? 0
        let mixed = Int32(truncatingIfNeeded: tail) ^ Int32(truncatingIfNeeded: book * 1000 + chapter)
        let hex = String(mixed, radix: 16)
        return head + String(repeating: "0", count: max(0, 6 - hex.count)) + hex
    }
    /// Android `retryDelay`, in seconds: 5 s doubling to a 300 s cap, ±20% jitter.
    static func retryDelay(attempt: Int, random: Double) -> TimeInterval {
        // Rounded to whole milliseconds, as `Math.round` does on Android.
        (min(300_000, 5_000 * pow(2, Double(min(max(attempt, 0), 6)))) * (0.8 + random * 0.4)).rounded() / 1_000
    }
    /// The oldest unsent, unblocked snapshots first, bounded per pass.
    static func batch(_ rows: [ReadingJournal.Stored]) -> [ReadingJournalEntry] {
        rows.filter { $0.entry.revision > $0.syncedRevision && !$0.blocked }
            .map(\.entry)
            .sorted { a, b in
                let left = a.occurredAt.flatMap(ReadingJournalEntry.date) ?? .distantPast
                let right = b.occurredAt.flatMap(ReadingJournalEntry.date) ?? .distantPast
                return left == right ? a.eventId < b.eventId : left < right
            }
            .prefix(batchSize).map { $0 }
    }
    /// A first page replaces the list; an older page appends below, skipping
    /// anything already shown. Nothing is trimmed, so the newest stay on top.
    static func mergeHistory(_ current: [ReadingJournalEntry], page: [ReadingJournalEntry], appending: Bool) -> [ReadingJournalEntry] {
        guard appending else { return page }
        let known = Set(current.map(\.eventId))
        return current + page.filter { !known.contains($0.eventId) }
    }
}

/// One atomic account-specific file contains only unsynced snapshots and the
/// current session. No scripture text, background polling or lifetime cache.
@MainActor @Observable
final class ReadingJournal {
    static let dwellSeconds: TimeInterval = 8
    static let idleSeconds: TimeInterval = 30 * 60
    /// Session activity is persisted at most this often while scrolling.
    static let touchSeconds: TimeInterval = 10
    /// Android batches radio work: a checkpoint waits this long before sending.
    static let sendDebounceSeconds: TimeInterval = 15
    static let storageError = "Reading could not be saved on this device. Free some storage and try again."
    static let blockedError = "A reading needs attention. Your entry is kept on this device."
    static let openError = "Reading history could not be opened on this device."
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
    typealias FetchHistory = @MainActor (String) async throws -> ReadingJournalPage
    typealias RetryWait = @MainActor (TimeInterval) async throws -> Void
    private var state: State
    private let fileURL: URL?
    private let send: Send
    private let fetchHistory: FetchHistory?
    private let waitForRetry: RetryWait
    private let requestTimeout: TimeInterval
    private var loadFailed = false
    private var foreground = false
    private var readerVisible = false
    private var obscuredReasons: Set<String> = []
    private var readerFocused = true
    private var stopped = false
    private var location: Location?
    private var visible: Set<Int> = []
    private var since: [Int: TimeInterval] = [:]
    /// Verses already recorded during this chapter visit (Android `emitted`).
    private var emitted: Set<Int> = []
    private var lastArm: TimeInterval?
    private var dwellTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var syncGeneration = 0
    private var historyRequest = 0
    private(set) var attempts = 0
    private var pathMonitor: NWPathMonitor?
    private var wasConnected: Bool?
    private(set) var error: String?
    private(set) var historyError: String?
    private(set) var history: [ReadingJournalEntry] = []
    private(set) var stats: ReadingJournalStats?
    private(set) var nextCursor: String?
    private(set) var loadingHistory = false
    /// Snapshots the next pass may send (blocked ones wait for a deliberate retry).
    var pendingCount: Int { state.rows.values.filter { $0.entry.revision > $0.syncedRevision && !$0.blocked }.count }
    var blockedCount: Int { state.rows.values.filter(\.blocked).count }
    /// Android `status.pending`: every snapshot not yet acknowledged, blocked included.
    var unsyncedCount: Int { state.rows.values.filter { $0.entry.revision > $0.syncedRevision }.count }
    var canTrack: Bool { !stopped && !loadFailed && !state.account.isEmpty && foreground && readerVisible && obscuredReasons.isEmpty && readerFocused && location != nil }

    init(account: String?, api: APIClient?, fileURL: URL? = nil, send: Send? = nil, fetchHistory: FetchHistory? = nil,
         retryWait: RetryWait? = nil, requestTimeout: TimeInterval = 15) {
        let account = account ?? ""
        self.state = State(account: account)
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
            return try await api.json("/api/reading-log", method: "POST", body: entry, timeout: requestTimeout)
        }
        if let fetchHistory { self.fetchHistory = fetchHistory }
        else if let api {
            self.fetchHistory = { path in try await api.json(path, timeout: requestTimeout, as: ReadingJournalPage.self) }
        } else { self.fetchHistory = nil }
        if let url = self.fileURL, FileManager.default.fileExists(atPath: url.path) {
            do {
                let stored = try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
                guard stored.version == 1, stored.account == account else { throw APIError(message: "Reading cache belongs to a different account or version.") }
                state = stored
            } catch {
                // The file is preserved untouched and tracking stays paused.
                loadFailed = true
                self.error = Self.openError
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
        guard recovered, foreground, !stopped, attempts > 0 else { return }
        attempts = 0; retryTask?.cancel(); retryTask = nil
        flush()
    }

    static func compact(_ verses: Set<Int>) -> [ReadingVerseRange] { ReadingJournalCore.compact(verses) }

    private func persist() throws {
        guard let fileURL else { throw APIError(message: "Sign in before saving reading history.") }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: fileURL, options: .atomic)
    }
    /// Android `touch`: scrolling keeps a live session alive, persisted at most
    /// every ten seconds. It never starts or rotates a session - only a recorded
    /// reading does, so scrolling alone cannot split a session.
    private func extendSession(now: Date) {
        guard state.sessionID != nil, let last = state.lastActivity else { return }
        let gap = now.timeIntervalSince(last)
        guard gap >= Self.touchSeconds, gap < Self.idleSeconds else { return }
        let previous = state
        state.lastActivity = now
        do { try persist() } catch { state = previous }
    }
    /// A new session after thirty idle minutes (or a clock moved backwards);
    /// acknowledged rows of the old session leave the device.
    private func rotateIfNeeded(now: Date) {
        let last = state.lastActivity ?? .distantPast
        if state.sessionID == nil || now.timeIntervalSince(last) >= Self.idleSeconds || now < last {
            state.sessionID = UUID().uuidString.lowercased()
            state.rows = state.rows.filter { $0.value.entry.revision > $0.value.syncedRevision || $0.value.blocked }
        }
        state.lastActivity = now
    }
    /// Android `scheduleDwell`: after thirty idle minutes on the same screen the
    /// already-recorded verses may count again in the next session.
    private func noteActivity(uptime: TimeInterval) {
        if let lastArm, uptime - lastArm >= Self.idleSeconds { emitted.removeAll() }
        lastArm = uptime
    }
    private func clearDwell() { dwellTask?.cancel(); dwellTask = nil; since.removeAll() }

    func setForeground(_ active: Bool) {
        let resumed = !foreground && active
        foreground = active
        if resumed { attempts = 0 }
        if !active {
            clearDwell()
            retryTask?.cancel(); retryTask = nil
            debounceTask?.cancel(); debounceTask = nil
            // Requests cancelled on background keep their durable snapshots.
            syncGeneration += 1; syncTask?.cancel(); syncTask = nil
        } else if !stopped {
            resumeDwell(); flush()
        }
    }
    func setReaderVisible(_ active: Bool) {
        readerVisible = active
        if active { resumeDwell() }
        else { clearDwell(); visible.removeAll() }
    }
    func setObscured(_ value: Bool, reason: String = "verse") {
        if value { obscuredReasons.insert(reason) } else { obscuredReasons.remove(reason) }
        if value { clearDwell() } else { resumeDwell() }
    }
    func setReaderFocused(_ active: Bool) {
        readerFocused = active
        if active { resumeDwell() } else { clearDwell() }
    }
    func enter(book: Int, chapter: Int, translation: String, verseCount: Int) {
        let next = Location(book: book, chapter: chapter, translation: translation, verseCount: verseCount)
        guard next != location else { return }
        location = next; visible.removeAll(); emitted.removeAll(); clearDwell()
    }
    func visibility(verse: Int, isVisible: Bool, now: Date = Date(), uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard let location, verse >= 1, verse <= location.verseCount else { return }
        if isVisible { visible.insert(verse) } else { visible.remove(verse); since.removeValue(forKey: verse) }
        guard canTrack else { return }
        noteActivity(uptime: uptime)
        extendSession(now: now)
        // Android `VerseDwellTracker.update`: every visible verse not yet
        // recorded keeps its own start, so slow scrolling preserves overlap.
        for verse in visible where since[verse] == nil && !emitted.contains(verse) { since[verse] = uptime }
        scheduleDwell()
    }
    private func resumeDwell() {
        guard canTrack else { return }
        let now = ProcessInfo.processInfo.systemUptime
        noteActivity(uptime: now)
        extendSession(now: Date())
        since = Dictionary(uniqueKeysWithValues: visible.subtracting(emitted).map { ($0, now) })
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
            rotateIfNeeded(now: now)
            guard let session = state.sessionID else { return }
            // An existing row for this session/chapter keeps its identity, even
            // one written before identities followed `chapterEventId`.
            let existingKey = state.rows.first {
                $0.value.entry.sessionId == session && $0.value.entry.book == location.book && $0.value.entry.chapter == location.chapter
            }?.key
            let eventID = existingKey ?? ReadingJournalCore.chapterEventId(sessionId: session, book: location.book, chapter: location.chapter)
            let existing = state.rows[eventID]
            let covered = ReadingJournalCore.covered(existing?.entry.verseRanges ?? [])
                .union(due.filter { $0 <= location.verseCount })
            let ranges = ReadingJournalCore.compact(covered)
            if existing?.entry.verseRanges != ranges {
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                // Timestamp and timezone describe the original observation; the
                // translation follows what is being read now (Android `record`).
                var entry = existing?.entry ?? ReadingJournalEntry(eventId: eventID, sessionId: session, revision: 0,
                    book: location.book, chapter: location.chapter, translation: location.translation,
                    occurredAt: formatter.string(from: now), timezone: TimeZone.current.identifier,
                    completed: false, verseRanges: [])
                entry.revision += 1
                entry.translation = location.translation
                entry.verseRanges = ranges
                entry.completed = ranges.count == 1 && ranges[0].start == 1 && ranges[0].end == location.verseCount
                // New content gets a fresh chance to send, as on Android.
                state.rows[eventID] = Stored(entry: entry, syncedRevision: existing?.syncedRevision ?? 0)
            }
            try persist()
            for verse in due { since.removeValue(forKey: verse); emitted.insert(verse) }
            error = nil
            scheduleFlush()
        } catch {
            state = previous
            self.error = Self.storageError
            // Avoid a hot retry loop; the next viewport change re-arms.
            since.removeAll(); emitted.removeAll()
        }
    }
    /// "Retry sync and refresh": unblock rejected rows and send now.
    func retry() {
        guard !stopped, !loadFailed else { return }
        let previous = state
        do {
            for key in state.rows.keys { state.rows[key]?.blocked = false }
            try persist(); error = nil; attempts = 0
            retryTask?.cancel(); retryTask = nil
            debounceTask?.cancel(); debounceTask = nil
            resumeDwell(); flush()
        } catch { state = previous; self.error = Self.storageError }
    }
    /// Android `schedule()`: one pending timer, never while backing off or
    /// after the retry budget is spent.
    private func scheduleFlush(after delay: TimeInterval = sendDebounceSeconds) {
        guard foreground, !stopped, !loadFailed, attempts < 6, debounceTask == nil, retryTask == nil else { return }
        let waitForRetry = self.waitForRetry
        debounceTask = Task { [weak self] in
            do { try await waitForRetry(delay) } catch { return }
            guard let self, !Task.isCancelled else { return }
            self.debounceTask = nil; self.flush()
        }
    }
    /// Send now (bypassing the debounce), oldest first, at most 25 per pass.
    func flush() {
        guard foreground, !stopped, !loadFailed, syncTask == nil, retryTask == nil, attempts < 6, pendingCount > 0 else { return }
        debounceTask?.cancel(); debounceTask = nil
        syncGeneration += 1
        let generation = syncGeneration
        syncTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.syncGeneration == generation { self.syncTask = nil } }
            let batch = ReadingJournalCore.batch(Array(self.state.rows.values))
            for entry in batch {
                guard self.foreground, !self.stopped, !Task.isCancelled else { return }
                do {
                    let send = self.send
                    _ = try await ReadingRequestDeadline<ReadingJournalSave>.run(seconds: self.requestTimeout) { try await send(entry) }
                    guard !self.stopped, !Task.isCancelled, self.syncGeneration == generation else { return }
                    let previous = self.state
                    var updated = self.state
                    // Only the revision that was sent is acknowledged - also for a
                    // tombstone - so newer offline progress is never dropped.
                    if var row = updated.rows[entry.eventId] {
                        row.syncedRevision = max(row.syncedRevision, entry.revision)
                        updated.rows[entry.eventId] = row
                    }
                    let currentSession = updated.sessionID
                    updated.rows = updated.rows.filter { $0.value.entry.sessionId == currentSession || $0.value.entry.revision > $0.value.syncedRevision || $0.value.blocked }
                    self.state = updated
                    do { try self.persist() } catch { self.state = previous; throw error }
                } catch {
                    guard !Task.isCancelled, self.syncGeneration == generation else { return }
                    let code = (error as? APIError)?.status
                    if let code, [400, 409, 422].contains(code) {
                        if self.state.rows[entry.eventId]?.entry.revision == entry.revision {
                            self.state.rows[entry.eventId]?.blocked = true
                            try? self.persist()
                        }
                        self.error = Self.blockedError
                        continue
                    }
                    // Transient: the row stays pending; the screen shows the
                    // waiting-to-sync count rather than an error (Android).
                    self.attempts += 1; self.scheduleRetry(); return
                }
            }
            self.attempts = 0
            if self.pendingCount > 0 { self.scheduleFlush() }
        }
    }
    private func scheduleRetry() {
        guard foreground, !stopped, attempts < 6 else { return }
        retryTask?.cancel()
        let wait = ReadingJournalCore.retryDelay(attempt: attempts - 1, random: Double.random(in: 0...1))
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
        dwellTask?.cancel(); syncTask?.cancel(); retryTask?.cancel(); debounceTask?.cancel()
        dwellTask = nil; syncTask = nil; retryTask = nil; debounceTask = nil
        since.removeAll(); visible.removeAll(); emitted.removeAll()
    }
    /// Android focus effect: the screen opens empty and loads the first page.
    func resetHistory() {
        historyRequest += 1
        history = []; stats = nil; nextCursor = nil; historyError = nil; loadingHistory = false
    }
    /// `more` loads the page after `nextCursor`; the latest request wins.
    func loadHistory(more: Bool = false) async {
        guard !stopped, let fetchHistory else { return }
        let cursor = more ? nextCursor : nil
        if more && cursor == nil { return }
        historyRequest += 1
        let request = historyRequest
        loadingHistory = true; historyError = nil
        defer { if request == historyRequest { loadingHistory = false } }
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        let suffix = cursor.map { "&cursor=\($0.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" } ?? ""
        do {
            let page = try await ReadingRequestDeadline<ReadingJournalPage>.run(seconds: requestTimeout) {
                try await fetchHistory("/api/reading-log?limit=30\(suffix)")
            }
            guard request == historyRequest, !stopped else { return }
            history = ReadingJournalCore.mergeHistory(history, page: page.entries, appending: more)
            stats = page.stats; nextCursor = page.nextCursor
        } catch {
            guard request == historyRequest, !stopped else { return }
            if let apiError = error as? APIError {
                historyError = apiError.isTimeout
                    ? "Reading history could not be loaded. Check your connection and try again."
                    : apiError.message
            } else {
                historyError = "Reading history could not be loaded."
            }
        }
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
