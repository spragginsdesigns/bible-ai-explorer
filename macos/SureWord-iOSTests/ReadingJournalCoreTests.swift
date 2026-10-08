import Foundation
import Testing

@testable import SureWord

/// Ports of `mobile/src/features/reading/readingLogCore.test.ts` (and the
/// scheduler rules in `readingLogStore.ts`) that apply to the Apple journal.
/// Android is the source of truth for every expectation here.
@Suite("Reading log core rules (Android parity)")
@MainActor
struct ReadingJournalCoreTests {
    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("reading-core-\(UUID()).json")
    }
    private func read(_ url: URL) throws -> ReadingJournal.State {
        try JSONDecoder().decode(ReadingJournal.State.self, from: Data(contentsOf: url))
    }
    private func entry(_ id: String, at occurredAt: String?, revision: Int = 1, session: String = "s") -> ReadingJournalEntry {
        ReadingJournalEntry(eventId: id, sessionId: session, revision: revision, book: 43, chapter: 3, translation: "KJV",
                            occurredAt: occurredAt, timezone: "UTC", completed: false, verseRanges: [.init(start: 1, end: 1)])
    }
    private func tracking(_ url: URL, send: ReadingJournal.Send? = nil, retryWait: ReadingJournal.RetryWait? = nil) -> ReadingJournal {
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url, send: send ?? { _ in throw APIError.offline }, retryWait: retryWait)
        model.setForeground(true); model.setReaderVisible(true)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        return model
    }

    // MARK: - Pure helpers

    @Test("normalizes ranges: sorted, deduplicated, contiguous runs, positives only")
    func compactRanges() {
        #expect(ReadingJournalCore.compact([3, 1, 2, 2, 7, 8]) == [.init(start: 1, end: 3), .init(start: 7, end: 8)])
        #expect(ReadingJournalCore.compact([0, -4, 5]) == [.init(start: 5, end: 5)])
        #expect(ReadingJournalCore.covered([.init(start: 1, end: 3), .init(start: 7, end: 8)]) == [1, 2, 3, 7, 8])
    }

    @Test("chapter identities are stable UUIDs, matching Android's chapterEventId")
    func chapterIdentity() {
        let id = ReadingJournalCore.chapterEventId(sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001", book: 43, chapter: 3)
        // 0x000001 ^ (43 * 1000 + 3) = 0x00a7fa, exactly what the TypeScript produces.
        #expect(id == "aaaaaaaa-bbbb-4ccc-8ddd-00000000a7fa")
        #expect(id.range(of: #"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$"#, options: .regularExpression) != nil)
        #expect(ReadingJournalCore.chapterEventId(sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001", book: 43, chapter: 3) == id)
        #expect(ReadingJournalCore.chapterEventId(sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001", book: 43, chapter: 4) != id)
    }

    @Test("retry backoff: 5 s doubling to a 300 s cap with 20% jitter")
    func backoff() {
        #expect(ReadingJournalCore.retryDelay(attempt: 0, random: 0.5) == 5)
        #expect(ReadingJournalCore.retryDelay(attempt: 1, random: 0.5) == 10)
        #expect(ReadingJournalCore.retryDelay(attempt: 6, random: 0) == 240)
        #expect(ReadingJournalCore.retryDelay(attempt: 100, random: 1) <= 360)
    }

    @Test("a replay pass sends the oldest 25 unsent, unblocked snapshots")
    func batchOrder() {
        var rows = (0..<30).map { index in
            ReadingJournal.Stored(entry: entry("e\(index)", at: String(format: "2026-09-%02dT12:00:00Z", 30 - index)))
        }
        rows.append(.init(entry: entry("synced", at: "2026-01-01T00:00:00Z"), syncedRevision: 1))
        rows.append(.init(entry: entry("blocked", at: "2026-01-01T00:00:00Z"), blocked: true))
        let batch = ReadingJournalCore.batch(rows.shuffled())
        #expect(batch.count == 25)
        #expect(batch.first?.eventId == "e29")
        #expect(batch.last?.eventId == "e5")
        #expect(!batch.contains { $0.eventId == "synced" || $0.eventId == "blocked" })
    }

    @Test("older pages append below without trimming the newest readings")
    func historyMerge() {
        let first = (0..<150).map { entry("n\($0)", at: nil) }
        let older = [entry("n149", at: nil)] + (0..<60).map { entry("o\($0)", at: nil) }
        let merged = ReadingJournalCore.mergeHistory(first, page: older, appending: true)
        #expect(merged.count == 210)
        #expect(merged.first?.eventId == "n0")
        #expect(merged.last?.eventId == "o59")
        #expect(ReadingJournalCore.mergeHistory(first, page: older, appending: false).first?.eventId == "n149")
    }

    @Test("history copy follows Android: stats plurals, coarse dates and source labels")
    func historyCopy() throws {
        let json = #"{"sessions":1,"chapterReadings":2,"partialReadings":0,"uniqueChapters":1,"activeDays":3,"lastReadAt":null}"#
        let stats = try JSONDecoder().decode(ReadingJournalStats.self, from: Data(json.utf8))
        #expect(stats.title == "1 chapter covered")
        #expect(stats.line == "2 chapter readings · 1 session · 3 days")
        let filtered = try JSONDecoder().decode(ReadingJournalStats.self, from: Data(#"{"sessions":null,"chapterReadings":1,"partialReadings":0,"uniqueChapters":2,"activeDays":null}"#.utf8))
        #expect(filtered.title == "2 chapters covered")
        #expect(filtered.line == "1 chapter reading")

        var day = entry("a", at: nil); day.precision = "day"; day.localDate = "2026-09-12"
        #expect(day.timeLabel == "2026-09-12 · time unspecified")
        var unknown = entry("b", at: nil); unknown.precision = "morning"
        #expect(unknown.timeLabel == "Date unspecified · morning")
        var legacy = entry("c", at: "2026-09-12T08:00:00Z"); legacy.precision = "legacy"; legacy.localDate = "2026-09-12"
        legacy.source = "legacy"; legacy.completed = true
        #expect(legacy.timeLabel == "2026-09-12 · legacy")
        #expect(legacy.sourceLabel == "Chapter complete · Earlier tracking")
        #expect(day.sourceLabel == "Partial reading · SureWord reader")
        var physical = day; physical.source = "physical"
        #expect(physical.sourceLabel == "Partial reading · Physical Bible")
        var manual = day; manual.source = "manual"
        #expect(manual.sourceLabel == "Partial reading · Reported reading")
    }

    // MARK: - Journal behaviour

    @Test("a translation switch updates the same chapter entry, keeping time and zone")
    func translationFollowsReading() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        let model = tracking(url); defer { model.teardown() }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let first = try #require(read(url).rows.values.first).entry
        model.enter(book: 43, chapter: 3, translation: "BSB", verseCount: 36)
        model.visibility(verse: 2, isVisible: true, now: now.addingTimeInterval(10), uptime: clock + 10)
        model.checkpoint(now: now.addingTimeInterval(18), uptime: clock + 18)
        let rows = try read(url).rows
        #expect(rows.count == 1)
        let second = try #require(rows.values.first).entry
        #expect(second.eventId == first.eventId)
        #expect(second.revision == 2)
        #expect(second.translation == "BSB")
        #expect(second.occurredAt == first.occurredAt)
        #expect(second.timezone == first.timezone)
        #expect(second.verseRanges == [.init(start: 1, end: 2)])
    }

    @Test("new sessions use chapterEventId identities")
    func identityFormat() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        let model = tracking(url); defer { model.teardown() }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let state = try read(url)
        let row = try #require(state.rows.values.first).entry
        #expect(row.eventId == ReadingJournalCore.chapterEventId(sessionId: try #require(state.sessionID), book: 43, chapter: 3))
    }

    @Test("session activity is persisted at most every ten seconds and never rotates the session")
    func touchCoalescing() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        let model = tracking(url); defer { model.teardown() }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let session = try read(url).sessionID
        model.visibility(verse: 2, isVisible: true, now: now.addingTimeInterval(12), uptime: clock + 12)
        #expect(try read(url).lastActivity == now.addingTimeInterval(8))
        model.visibility(verse: 3, isVisible: true, now: now.addingTimeInterval(20), uptime: clock + 20)
        #expect(try read(url).lastActivity == now.addingTimeInterval(20))
        // Scrolling after a long idle neither extends nor replaces the session;
        // only the next recorded reading starts a new one.
        model.visibility(verse: 4, isVisible: true, now: now.addingTimeInterval(4000), uptime: clock + 4000)
        #expect(try read(url).lastActivity == now.addingTimeInterval(20))
        #expect(try read(url).sessionID == session)
    }

    @Test("a recorded verse is not re-armed for the rest of that chapter visit")
    func emittedVerses() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        let model = tracking(url); defer { model.teardown() }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        // Resuming (a sheet closes) and re-reporting the same verse must not
        // arm it again: a later checkpoint has nothing due and writes nothing.
        model.setObscured(true); model.setObscured(false)
        model.visibility(verse: 1, isVisible: true, now: now.addingTimeInterval(9), uptime: clock + 9)
        model.checkpoint(now: now.addingTimeInterval(30), uptime: clock + 30)
        #expect(try read(url).lastActivity == now.addingTimeInterval(8))
        #expect(try read(url).rows.values.first?.entry.revision == 1)
        // A new chapter visit may record it again.
        model.enter(book: 43, chapter: 4, translation: "KJV", verseCount: 54)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        model.visibility(verse: 1, isVisible: true, now: now.addingTimeInterval(40), uptime: clock + 40)
        model.checkpoint(now: now.addingTimeInterval(48), uptime: clock + 48)
        #expect(try read(url).lastActivity == now.addingTimeInterval(48))
    }

    @Test("a checkpoint waits for the send debounce instead of sending at once")
    func sendDebounce() async throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        var sends = 0
        var waits: [TimeInterval] = []
        var release: CheckedContinuation<Void, any Error>?
        let model = tracking(url, send: { entry in sends += 1; return ReadingJournalSave(recorded: true, entry: entry) },
                             retryWait: { delay in waits.append(delay); try await withCheckedThrowingContinuation { release = $0 } })
        defer { model.teardown(); release?.resume(throwing: CancellationError()) }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        for _ in 0..<50 where waits.isEmpty { await Task.yield() }
        #expect(waits == [ReadingJournal.sendDebounceSeconds])
        #expect(sends == 0)
        release?.resume(); release = nil
        for _ in 0..<100 where model.pendingCount > 0 { await Task.yield() }
        #expect(sends == 1)
        #expect(model.pendingCount == 0)
    }

    @Test("first retry waits about 5 s; only 400/409/422 block a reading")
    func retryAndBlocking() async throws {
        let seeded = tempURL(); defer { try? FileManager.default.removeItem(at: seeded) }
        var state = ReadingJournal.State(account: "owner", sessionID: "s", lastActivity: Date())
        state.rows["e"] = .init(entry: entry("e", at: "2026-09-12T12:00:00Z"))
        try JSONEncoder().encode(state).write(to: seeded, options: .atomic)

        var waits: [TimeInterval] = []
        var hold: CheckedContinuation<Void, any Error>?
        let transient = ReadingJournal(account: "owner", api: nil, fileURL: seeded,
            send: { _ in throw APIError.server(status: 404) },
            retryWait: { delay in waits.append(delay); try await withCheckedThrowingContinuation { hold = $0 } })
        transient.setForeground(true)
        for _ in 0..<100 where waits.isEmpty { await Task.yield() }
        #expect(waits.count == 1)
        #expect((4...6).contains(waits[0]))
        #expect(transient.blockedCount == 0)
        #expect(transient.error == nil)
        #expect(transient.unsyncedCount == 1)
        transient.teardown(); hold?.resume(throwing: CancellationError()); hold = nil

        let rejected = ReadingJournal(account: "owner", api: nil, fileURL: seeded,
            send: { _ in throw APIError.server(status: 409) }, retryWait: { _ in })
        defer { rejected.teardown() }
        rejected.setForeground(true)
        for _ in 0..<100 where rejected.blockedCount == 0 { await Task.yield() }
        #expect(rejected.blockedCount == 1)
        #expect(rejected.pendingCount == 0)
        #expect(rejected.unsyncedCount == 1)
        #expect(rejected.error == ReadingJournal.blockedError)
    }

    @Test("history pages by cursor, keeps the newest first and reports Android errors")
    func historyPaging() async throws {
        var paths: [String] = []
        let stats = ReadingJournalStats(sessions: 1, chapterReadings: 1, partialReadings: 0, uniqueChapters: 1, activeDays: 1)
        final class Failure { var error: Error? }
        let failure = Failure()
        let model = ReadingJournal(account: "owner", api: nil, fileURL: tempURL(), fetchHistory: { path in
            paths.append(path)
            if let error = failure.error { throw error }
            return path.contains("cursor=")
                ? ReadingJournalPage(entries: [self.entry("e2", at: nil), self.entry("e1", at: nil)], nextCursor: nil, stats: stats)
                : ReadingJournalPage(entries: [self.entry("e3", at: nil), self.entry("e2", at: nil)], nextCursor: "c1_=", stats: stats)
        })
        defer { model.teardown() }
        await model.loadHistory()
        await model.loadHistory(more: true)
        #expect(model.history.map(\.eventId) == ["e3", "e2", "e1"])
        #expect(paths == ["/api/reading-log?limit=30", "/api/reading-log?limit=30&cursor=c1_%3D"])
        await model.loadHistory(more: true) // no cursor left: nothing to fetch
        #expect(paths.count == 2)

        failure.error = APIError.timedOut
        await model.loadHistory()
        #expect(model.historyError == "Reading history could not be loaded. Check your connection and try again.")
        failure.error = APIError.server(status: 400, message: "limit must be between 1 and 100.")
        await model.loadHistory()
        #expect(model.historyError == "limit must be between 1 and 100.")
        #expect(model.history.count == 3) // a failed refresh keeps what was shown
    }
}
