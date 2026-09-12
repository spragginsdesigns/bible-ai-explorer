import Foundation
import Testing
@testable import SureWord

@MainActor
struct ReadingJournalTests {
    private func setup(account: String = "owner") throws -> (ReadingJournal, URL) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-tests-\(UUID()).json")
        let model = ReadingJournal(account: account, api: nil, fileURL: url, send: { _ in throw APIError.offline })
        model.setForeground(true); model.setReaderVisible(true)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        return (model, url)
    }
    private func read(_ url: URL) throws -> ReadingJournal.State { try JSONDecoder().decode(ReadingJournal.State.self, from: Data(contentsOf: url)) }

    @Test("eight active visible seconds persist only the observed verses")
    func partialDwell() throws {
        let (model, url) = try setup(); defer { model.teardown(); try? FileManager.default.removeItem(at: url) }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 16, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(7), uptime: clock + 7)
        #expect(!FileManager.default.fileExists(atPath: url.path))
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let row = try #require(read(url).rows.values.first)
        #expect(row.entry.verseRanges == [.init(start: 16, end: 16)])
        #expect(!row.entry.completed)
        #expect(row.entry.revision == 1)
        #expect(model.pendingCount == 1)
    }

    @Test("foreground loss and obscuring a reader discard unfinished dwell")
    func background() throws {
        let (model, url) = try setup(); defer { model.teardown(); try? FileManager.default.removeItem(at: url) }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.setForeground(false)
        model.checkpoint(now: now.addingTimeInterval(100), uptime: clock + 100)
        #expect(model.pendingCount == 0)
        model.setForeground(true); model.setObscured(true, reason: "history")
        model.checkpoint(now: now.addingTimeInterval(110), uptime: clock + 110)
        #expect(model.pendingCount == 0)
        model.setObscured(false, reason: "verse") // closing another sheet must not clear history's pause
        #expect(!model.canTrack)
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test("same session grows one chapter snapshot; a later session keeps the rereading")
    func repeatSessions() throws {
        let (model, url) = try setup(); defer { model.teardown(); try? FileManager.default.removeItem(at: url) }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let original = try #require(read(url).rows.values.first).entry
        model.visibility(verse: 2, isVisible: true, now: now.addingTimeInterval(10), uptime: clock + 10)
        model.checkpoint(now: now.addingTimeInterval(18), uptime: clock + 18)
        let second = try #require(read(url).rows.values.first).entry
        #expect(try read(url).rows.count == 1)
        #expect(second.eventId == original.eventId)
        #expect(second.revision == 2)
        #expect(second.verseRanges == [.init(start: 1, end: 2)])
        model.visibility(verse: 1, isVisible: true, now: now.addingTimeInterval(3600), uptime: clock + 3600)
        model.checkpoint(now: now.addingTimeInterval(3608), uptime: clock + 3608)
        #expect(try read(url).rows.count == 2)
        #expect(Set(try read(url).rows.values.map(\.entry.sessionId)).count == 2)
    }

    @Test("whole chapter completion requires every verse, and snapshots survive restart")
    func completeAndRestart() throws {
        let (model, url) = try setup(); defer { model.teardown(); try? FileManager.default.removeItem(at: url) }
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        for verse in 1...36 { model.visibility(verse: verse, isVisible: true, now: now, uptime: clock) }
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        let entry = try #require(read(url).rows.values.first).entry
        #expect(entry.completed)
        #expect(entry.verseRanges == [.init(start: 1, end: 36)])
        model.teardown()
        let restarted = ReadingJournal(account: "owner", api: nil, fileURL: url)
        defer { restarted.teardown() }
        #expect(restarted.pendingCount == 1)
        let other = ReadingJournal(account: "different-user", api: nil, fileURL: url)
        defer { other.teardown() }
        #expect(other.pendingCount == 0)
        #expect(other.error != nil)
        #expect(try read(url).account == "owner")
    }

    @Test("corrupted files are preserved and prevent silent replacement")
    func corruptedFile() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-corrupt-\(UUID()).json")
        let bytes = Data("broken-state".utf8); try bytes.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url)
        defer { model.teardown() }
        model.setForeground(true); model.setReaderVisible(true)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        #expect(!model.canTrack)
        #expect(model.error != nil)
        #expect(try Data(contentsOf: url) == bytes)
    }

    @Test("acknowledging an older in-flight snapshot preserves newer offline progress")
    func inflightRevision() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-flight-\(UUID()).json")
        var first: ReadingJournalEntry?
        var continuation: CheckedContinuation<ReadingJournalSave, any Error>?
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url, send: { entry in
            if first == nil {
                first = entry
                return try await withCheckedThrowingContinuation { continuation = $0 }
            }
            return ReadingJournalSave(recorded: true, entry: entry)
        })
        defer {
            model.teardown()
            continuation?.resume(throwing: CancellationError())
            try? FileManager.default.removeItem(at: url)
        }
        model.setForeground(true); model.setReaderVisible(true)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        for _ in 0..<100 where first == nil { await Task.yield() }
        let sent = try #require(first)
        model.visibility(verse: 2, isVisible: true, now: now.addingTimeInterval(10), uptime: clock + 10)
        model.checkpoint(now: now.addingTimeInterval(18), uptime: clock + 18)
        continuation?.resume(returning: ReadingJournalSave(recorded: true, entry: sent)); continuation = nil
        for _ in 0..<100 {
            if try read(url).rows.values.first?.syncedRevision == 1 { break }
            await Task.yield()
        }
        let stored = try #require(read(url).rows.values.first)
        #expect(stored.entry.revision == 2)
        #expect(stored.syncedRevision == 1)
        #expect(model.pendingCount == 1)
    }

    @Test("a server tombstone acknowledges stale offline work without restoring it")
    func deletedOfflineEntry() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-deleted-\(UUID()).json")
        var sends = 0
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url, send: { entry in
            sends += 1
            var deleted = entry; deleted.deletedAt = "2026-09-12T12:00:00Z"
            return ReadingJournalSave(recorded: false, entry: deleted)
        })
        defer { model.teardown(); try? FileManager.default.removeItem(at: url) }
        model.setForeground(true); model.setReaderVisible(true)
        model.enter(book: 43, chapter: 3, translation: "KJV", verseCount: 36)
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        for _ in 0..<100 where model.pendingCount > 0 { await Task.yield() }
        #expect(model.pendingCount == 0)
        model.flush()
        await Task.yield()
        #expect(sends == 1)
        #expect(try read(url).rows.values.first?.syncedRevision == 1)
    }

    @Test("a sealed canonical lower revision acknowledges the attempted offline snapshot")
    func sealedCanonicalRevision() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-sealed-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let entry = ReadingJournalEntry(eventId: "event", sessionId: "session", revision: 100, book: 43, chapter: 3, translation: "KJV", occurredAt: "2026-09-12T12:00:00Z", timezone: "UTC", completed: false, verseRanges: [.init(start: 1, end: 2)])
        var state = ReadingJournal.State(account: "owner", sessionID: "session", lastActivity: Date())
        state.rows[entry.eventId] = .init(entry: entry, syncedRevision: 1)
        try JSONEncoder().encode(state).write(to: url, options: .atomic)
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url, send: { entry in
            var corrected = entry; corrected.revision = 2
            return ReadingJournalSave(recorded: false, entry: corrected)
        })
        defer { model.teardown() }
        model.setForeground(true)
        for _ in 0..<100 where model.pendingCount > 0 { await Task.yield() }
        #expect(model.pendingCount == 0)
        #expect(try read(url).rows[entry.eventId]?.syncedRevision == 100)
    }

    @Test("offline retries stop after six and new viewport checkpoints cannot bypass the budget")
    func boundedOfflineRetries() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-retry-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let entry = ReadingJournalEntry(eventId: "event", sessionId: "session", revision: 1, book: 43, chapter: 3, translation: "KJV", occurredAt: "2026-09-12T12:00:00Z", timezone: "UTC", completed: false, verseRanges: [.init(start: 1, end: 2)])
        var state = ReadingJournal.State(account: "owner", sessionID: "session", lastActivity: Date())
        state.rows[entry.eventId] = .init(entry: entry)
        try JSONEncoder().encode(state).write(to: url, options: .atomic)
        var sends = 0
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url,
            send: { _ in sends += 1; throw APIError.offline }, retryWait: { _ in await Task.yield() })
        defer { model.teardown() }
        model.setForeground(true)
        for _ in 0..<200 where sends < 6 { await Task.yield() }
        #expect(sends == 6)
        for _ in 0..<20 { model.flush(); await Task.yield() }
        #expect(sends == 6)
        model.setReaderVisible(true); model.enter(book: 44, chapter: 1, translation: "KJV", verseCount: 26)
        let now = Date(), clock = ProcessInfo.processInfo.systemUptime
        model.visibility(verse: 1, isVisible: true, now: now, uptime: clock)
        model.checkpoint(now: now.addingTimeInterval(8), uptime: clock + 8)
        await Task.yield()
        #expect(sends == 6)
        #expect(model.pendingCount == 2)
        model.setForeground(false); model.setForeground(true)
        for _ in 0..<200 where sends < 12 { await Task.yield() }
        #expect(sends == 12)
    }

    @Test("the whole request deadline releases a hung token operation and ignores its late result")
    func hungRequestDeadline() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("reading-timeout-\(UUID()).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let entry = ReadingJournalEntry(eventId: "event", sessionId: "session", revision: 1, book: 43, chapter: 3, translation: "KJV", occurredAt: "2026-09-12T12:00:00Z", timezone: "UTC", completed: false, verseRanges: [.init(start: 1, end: 2)])
        var state = ReadingJournal.State(account: "owner", sessionID: "session", lastActivity: Date())
        state.rows[entry.eventId] = .init(entry: entry)
        try JSONEncoder().encode(state).write(to: url, options: .atomic)
        var hanging: CheckedContinuation<ReadingJournalSave, any Error>?
        let model = ReadingJournal(account: "owner", api: nil, fileURL: url, send: { _ in
            try await withCheckedThrowingContinuation { hanging = $0 }
        }, requestTimeout: 0.01)
        defer { model.teardown(); hanging?.resume(throwing: CancellationError()) }
        model.setForeground(true)
        for _ in 0..<100 where model.error == nil { try await Task.sleep(for: .milliseconds(2)) }
        #expect(model.error != nil)
        #expect(model.pendingCount == 1)
        #expect(try read(url).rows[entry.eventId]?.syncedRevision == 0)
        hanging?.resume(returning: ReadingJournalSave(recorded: true, entry: entry)); hanging = nil
        await Task.yield()
        #expect(model.pendingCount == 1)
        #expect(try read(url).rows[entry.eventId]?.syncedRevision == 0)
    }

    @Test("coarse physical times never display an invented clock hour")
    func coarseTime() {
        let entry = ReadingJournalEntry(eventId: "a", sessionId: "b", revision: 1, source: "physical", book: 43, chapter: 3, translation: "KJV", occurredAt: nil, timezone: "America/Los_Angeles", precision: "morning", completed: false, verseRanges: [.init(start: 16, end: 21)], localDate: "2026-09-12")
        #expect(entry.timeLabel == "2026-09-12 · morning")
        #expect(entry.reference == "John 3:16–21")
    }
}
