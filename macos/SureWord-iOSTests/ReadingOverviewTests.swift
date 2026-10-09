import Foundation
import Testing

@testable import SureWord

/// Ports of `mobile/src/features/reading/readingOverview.test.ts` plus the
/// stat-tile copy in `mobile/app/(app)/bible/history.tsx` and the
/// `WalkCard.tsx` states. Android is the source of truth for every expectation.
@Suite("Reading log overview (Android parity)")
@MainActor
struct ReadingOverviewTests {
    private let utc = ReadingLogRules.gregorian(TimeZone(identifier: "UTC")!)

    private func entry(
        book: Int = 59, bookName: String? = "James", chapter: Int = 4, source: String = "reader",
        completed: Bool = false, ranges: [(Int, Int)] = [(1, 5)],
        occurredAt: String? = "2026-10-09T14:41:58.000Z", localDate: String? = "2026-10-09",
        chapterVerses: Int? = 17
    ) -> ReadingJournalEntry {
        ReadingJournalEntry(
            eventId: UUID().uuidString, sessionId: "s", revision: 1, source: source, book: book, chapter: chapter,
            translation: "KJV", occurredAt: occurredAt, timezone: "UTC", completed: completed,
            verseRanges: ranges.map { ReadingVerseRange(start: $0.0, end: $0.1) },
            bookName: bookName, localDate: localDate, chapterVerses: chapterVerses
        )
    }

    private func overview(current: Int = 0, longest: Int = 0, atRisk: Bool = false, chapters: Int = 0, books: Int = 0) -> ReadingOverview {
        ReadingOverview(
            totals: .init(chaptersComplete: chapters, totalChapters: 1189, booksStarted: books,
                          chapterReadings: chapters, activeDays: 1, lastReadAt: nil),
            streak: .init(current: current, longest: longest, atRisk: atRisk, lastActiveDate: nil),
            books: [], historicalBackfillPending: false
        )
    }

    // MARK: - groupByDay

    @Test("merges a chapter's sessions within a day and pools partial verses")
    func groupMergesSessions() {
        let days = ReadingLogRules.groupByDay([
            entry(ranges: [(9, 11), (13, 17)]),
            entry(ranges: [(1, 9)]),
            entry(chapter: 3, completed: true, ranges: [(1, 18)], chapterVerses: 18),
            entry(chapter: 2, source: "physical", completed: true, ranges: [(1, 26)], localDate: "2026-10-08"),
        ], calendar: utc, bookName: { _ in "?" })
        #expect(days.map(\.date) == ["2026-10-09", "2026-10-08"])
        let james4 = days[0].chapters[0]
        let james3 = days[0].chapters[1]
        #expect(james4.chapter == 4 && james4.readings == 2 && !james4.completed && james4.firstVerse == 1)
        // Verses 1-11 and 13-17: 16 of 17.
        #expect(abs(james4.fraction - 16.0 / 17.0) < 0.0001)
        #expect(james4.meta == "2 times")
        #expect(james3.chapter == 3 && james3.completed && james3.fraction == 1)
        #expect(james3.meta == nil)
        #expect(days[1].chapters[0].physical && days[1].chapters[0].completed)
        #expect(days[1].chapters[0].meta == "Physical Bible")
    }

    @Test("falls back to the occurrence date, then to an unknown day")
    func groupFallbacks() {
        let days = ReadingLogRules.groupByDay([
            entry(bookName: nil, occurredAt: "2026-10-09T12:00:00.000Z", localDate: nil),
            entry(occurredAt: nil, localDate: nil, chapterVerses: nil),
        ], calendar: utc, bookName: { _ in "James" })
        #expect(days.count == 2)
        #expect(days[0].date == "2026-10-09")
        #expect(days[0].chapters[0].bookName == "James")
        #expect(days[1].date == "unknown")
        #expect(days[1].chapters[0].fraction == 0)
    }

    @Test("days sort newest first whatever order the server sent, unknown last")
    func groupSortsDays() {
        let days = ReadingLogRules.groupByDay([
            entry(localDate: "2026-10-07"),
            entry(occurredAt: nil, localDate: nil),
            entry(localDate: "2026-10-09"),
            entry(localDate: "2025-12-31"),
            entry(chapter: 5, localDate: "2026-10-07"),
        ], calendar: utc)
        #expect(days.map(\.date) == ["2026-10-09", "2026-10-07", "2025-12-31", "unknown"])
        #expect(days[1].chapters.map(\.chapter) == [4, 5])
    }

    @Test("legacy rows say Earlier tracking; other unknown sources carry no tag")
    func sourceTags() {
        let rows = ReadingLogRules.groupByDay([
            entry(book: 1, source: "legacy"),
            entry(book: 2, source: "physical"),
            entry(book: 3, source: "manual"),
            entry(book: 4, source: "legacy"),
            entry(book: 4, source: "physical"),
        ], calendar: utc)[0].chapters
        #expect(rows.map(\.meta) == ["Earlier tracking", "Physical Bible", nil, "Physical Bible · Earlier tracking · 2 times"])
    }

    @Test("only the walk card's status lines are announced")
    func walkAnnouncements() {
        #expect(ReadingWalkCard.statusLine(.loading) == "Reflecting on your reading…")
        #expect(ReadingWalkCard.statusLine(.error) == "Your reflection could not be written right now.")
        #expect(ReadingWalkCard.statusLine(.consent) == nil)
        #expect(ReadingWalkCard.statusLine(.hidden) == nil)
        let reflection = ReadingReflection(title: "t", reflection: "r", verse: nil, next: nil)
        #expect(ReadingWalkCard.statusLine(.ready(reflection, generatedAt: "g")) == nil)
    }

    @Test("partial rows label their share and keep a visible sliver of bar")
    func rowPresentation() {
        let row = ReadingLogRules.groupByDay([entry(ranges: [(1, 1)], chapterVerses: 100)], calendar: utc)[0].chapters[0]
        #expect(row.barFraction == 0.06)
        #expect(row.accessibilityLabel == "Open James 4, 1 percent read")
        let read = ReadingLogRules.groupByDay([entry(completed: true)], calendar: utc)[0].chapters[0]
        #expect(read.accessibilityLabel == "Open James 4, read")
    }

    // MARK: - Headings and copy

    @Test("names recent days plainly")
    func dayHeadings() {
        #expect(ReadingLogRules.dayHeading("2026-10-09", today: "2026-10-09") == "Today")
        #expect(ReadingLogRules.dayHeading("2026-10-08", today: "2026-10-09") == "Yesterday")
        #expect(ReadingLogRules.dayHeading("2026-10-07", today: "2026-10-09") == "Wednesday")
        #expect(ReadingLogRules.dayHeading("2026-09-29", today: "2026-10-09") == "Tuesday, Sep 29")
        #expect(ReadingLogRules.dayHeading("2025-12-31", today: "2026-01-02") == "Dec 31, 2025")
        #expect(ReadingLogRules.dayHeading("unknown", today: "2026-10-09") == "Date not recorded")
        #expect(ReadingLogRules.dayHeading("2026-13-01", today: "2026-10-09") == "Date not recorded")
    }

    @Test("never shows a started Bible as zero")
    func percent() {
        #expect(ReadingLogRules.percentOfBible(0, total: 1189) == "0%")
        #expect(ReadingLogRules.percentOfBible(5, total: 1189) == "<1%")
        #expect(ReadingLogRules.percentOfBible(35, total: 1189) == "2%")
        #expect(ReadingLogRules.percentOfBible(1189, total: 1189) == "100%")
    }

    @Test("says when the reflection was written, on the device's calendar")
    func reflectionAge() {
        let pacific = ReadingLogRules.gregorian(TimeZone(identifier: "America/Los_Angeles")!)
        func at(_ day: Int, _ hour: Int) -> String {
            ISO8601DateFormatter().string(from: pacific.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour))!)
        }
        let now = pacific.date(from: DateComponents(year: 2026, month: 10, day: 9, hour: 18))!
        #expect(ReadingLogRules.reflectionAge(at(9, 8), now: now, calendar: pacific) == "Written today from your reading")
        #expect(ReadingLogRules.reflectionAge(at(8, 8), now: now, calendar: pacific) == "Written yesterday from your reading")
        #expect(ReadingLogRules.reflectionAge(at(3, 8), now: now, calendar: pacific) == "Written Oct 3 from your reading")
        // 23:00 Pacific on the 8th is already the 9th in UTC; the device's day decides.
        #expect(ReadingLogRules.reflectionAge(at(8, 23), now: now, calendar: pacific) == "Written yesterday from your reading")
        #expect(ReadingLogRules.reflectionAge("2026-10-09T15:00:00.123Z", now: now, calendar: pacific) == "Written today from your reading")
        #expect(ReadingLogRules.reflectionAge("nope", now: now, calendar: pacific) == "")
    }

    @Test("streak tile sub-copy follows Android's Stats rules")
    func streakNotes() {
        #expect(ReadingLogRules.streakNote(.init(current: 4, longest: 9, atRisk: true)) == "Read today to keep it")
        #expect(ReadingLogRules.streakNote(.init(current: 0, longest: 0, atRisk: false)) == "Read today to start")
        #expect(ReadingLogRules.streakNote(.init(current: 0, longest: 4, atRisk: false)) == "Best 4")
        #expect(ReadingLogRules.streakNote(.init(current: 5, longest: 5, atRisk: false)) == "Your best yet")
        #expect(ReadingLogRules.streakNote(.init(current: 2, longest: 5, atRisk: false)) == "Best 5")
    }

    @Test("stat tiles: streak, chapters with share of the Bible, books of 66")
    func statTiles() {
        let one = ReadingLogRules.statTiles(overview(current: 1, longest: 1, chapters: 1, books: 1))
        #expect(one.map(\.value) == ["1", "1", "1"])
        #expect(one.map(\.label) == ["day streak", "chapter read", "book opened"])
        #expect(one.map(\.sub) == ["Your best yet", "<1% of the Bible", "of 66"])
        let many = ReadingLogRules.statTiles(overview(current: 0, longest: 3, chapters: 35, books: 4))
        #expect(many.map(\.label) == ["day streak", "chapters read", "books opened"])
        #expect(many.map(\.sub) == ["Best 3", "2% of the Bible", "of 66"])
    }

    // MARK: - Bible map

    @Test("lists every book in a testament with its read chapters")
    func testamentProgress() {
        let coverage = [ReadingBookCoverage(book: 59, complete: [1, 2, 3], started: [4])]
        let nt = ReadingLogRules.testamentProgress(coverage: coverage, testament: .nt)
        #expect(nt.count == 27)
        #expect(nt.first?.name == "Matthew")
        let james = nt.first { $0.order == 59 }
        #expect(james?.complete == [1, 2, 3])
        #expect(james?.state(of: 1) == .read)
        #expect(james?.state(of: 4) == .started)
        #expect(james?.state(of: 5) == .unread)
        #expect(james?.chapterTitle == "James · 3 of 5 chapters read")
        #expect(james?.touched == true)
        #expect(nt.first { $0.order == 60 }?.complete.isEmpty == true)
        #expect(nt.first { $0.order == 60 }?.touched == false)
        #expect(ReadingLogRules.testamentProgress(coverage: coverage, testament: .ot).count == 39)
        #expect(ReadingLogRules.testamentProgress(coverage: [], testament: .nt).first { $0.order == 57 }?.chapterTitle == "Philemon · 0 of 1 chapter read")
    }

    @Test("the map splits into rows so a book's chapters open under its own row")
    func mapRows() {
        // A phone-width map (about 361 points) fits Android's three columns.
        #expect(ReadingLogRules.mapColumns(width: 361, minimum: 104, spacing: 8) == 3)
        #expect(ReadingLogRules.mapColumns(width: 650, minimum: 104, spacing: 8) == 5)
        #expect(ReadingLogRules.mapColumns(width: 50, minimum: 104, spacing: 8) == 1)
        #expect(ReadingLogRules.mapColumns(width: 0, minimum: 104, spacing: 8) == 1)
        let ot = ReadingLogRules.testamentProgress(coverage: [], testament: .ot)
        let rows = ReadingLogRules.rows(ot, columns: 3)
        #expect(rows.count == 13)
        #expect(rows.allSatisfy { $0.count == 3 })
        #expect(rows.first?.map(\.name) == ["Genesis", "Exodus", "Leviticus"])
        #expect(ReadingLogRules.rows(Array(1...7), columns: 3) == [[1, 2, 3], [4, 5, 6], [7]])
        #expect(ReadingLogRules.rows([Int](), columns: 3).isEmpty)
        #expect(ReadingLogRules.rows([1, 2], columns: 0) == [[1], [2]])
    }

    @Test("the map opens on the testament with more reading, New on a tie")
    func preferredTestament() {
        #expect(ReadingLogRules.preferredTestament(coverage: []) == .nt)
        #expect(ReadingLogRules.preferredTestament(coverage: [.init(book: 1, complete: [1, 2], started: [3])]) == .ot)
        #expect(ReadingLogRules.preferredTestament(coverage: [
            .init(book: 1, complete: [1], started: []), .init(book: 43, complete: [], started: [3]),
        ]) == .nt)
    }

    // MARK: - Wire

    @Test("decodes the overview and every reflection status")
    func decoding() throws {
        let overview = try JSONDecoder().decode(ReadingOverview.self, from: Data("""
        {"totals":{"chaptersComplete":3,"totalChapters":1189,"booksStarted":1,"chapterReadings":4,"activeDays":2,"lastReadAt":null},
         "streak":{"current":2,"longest":5,"atRisk":true,"lastActiveDate":"2026-10-08"},
         "books":[{"book":59,"complete":[1,2,3],"started":[4]}],"historicalBackfillPending":false}
        """.utf8))
        #expect(overview.totals.chaptersComplete == 3)
        #expect(overview.streak.atRisk)
        #expect(overview.books.first?.started == [4])

        func decode(_ json: String) throws -> ReadingReflectionResponse {
            try JSONDecoder().decode(ReadingReflectionResponse.self, from: Data(json.utf8))
        }
        let ready = try decode("""
        {"status":"ready","generatedAt":"2026-10-09T15:00:00.000Z","reflection":{"title":"A week in James","reflection":"You have been in James.",
         "verse":{"book":59,"bookName":"James","chapter":1,"verse":22,"text":"But be ye doers of the word","note":null},
         "next":{"book":59,"bookName":"James","chapter":5,"reason":"It finishes the letter."}}}
        """)
        guard case .ready(let reflection, let generatedAt) = ready else {
            Issue.record("expected a ready reflection")
            return
        }
        #expect(generatedAt == "2026-10-09T15:00:00.000Z")
        #expect(reflection.verse?.verse == 22 && reflection.verse?.note == nil)
        #expect(reflection.next?.chapter == 5)
        let bare = try decode(#"{"status":"ready","generatedAt":"x","reflection":{"title":"t","reflection":"r","verse":null,"next":null}}"#)
        #expect(bare == .ready(ReadingReflection(title: "t", reflection: "r", verse: nil, next: nil), generatedAt: "x"))
        #expect(try decode(#"{"status":"empty"}"#) == .empty)
        #expect(try decode(#"{"status":"consent-required"}"#) == .consentRequired)
        #expect(try decode(#"{"status":"unavailable"}"#) == .unavailable)
        #expect(try decode(#"{"status":"something-new"}"#) == .unavailable)
    }

    @Test("the timezone query is percent-encoded")
    func timezoneQuery() {
        #expect(ReadingLogRules.timezoneQuery(TimeZone(identifier: "America/Los_Angeles")!) == "?tz=America%2FLos_Angeles")
    }

    // MARK: - Your walk

    @Test("walk card states: consent offer, tap to ask, ready, hidden, errors")
    func walkStates() async {
        final class Box {
            var allow = false
            var triggers: [AIConsentStore.Trigger] = []
            var paths: [String] = []
            var result: Result<ReadingReflectionResponse, APIError> = .success(.empty)
        }
        let box = Box()
        let walk = ReadingWalkModel(fetch: { path in
            box.paths.append(path)
            return try box.result.get()
        }, gate: { trigger in
            box.triggers.append(trigger)
            return box.allow
        })
        #expect(walk.state == .loading)

        // Opening never asks: without consent the card offers instead.
        await walk.load()
        #expect(walk.state == .consent)
        #expect(box.triggers == [.automatic])
        #expect(box.paths.isEmpty)

        // "Write my reflection →" is the tap that may ask.
        box.allow = true
        let reflection = ReadingReflection(title: "A week in James", reflection: "r", verse: nil, next: nil)
        box.result = .success(.ready(reflection, generatedAt: "2026-10-09T15:00:00Z"))
        await walk.load(ask: true)
        #expect(box.triggers.last == .tap)
        #expect(walk.state == .ready(reflection, generatedAt: "2026-10-09T15:00:00Z"))
        #expect(box.paths.last?.hasPrefix("/api/reading-log/reflection") == true)

        // The server's own consent answer, a 403, and the other statuses.
        box.result = .success(.consentRequired)
        await walk.load()
        #expect(walk.state == .consent)
        box.result = .failure(APIError.server(status: 403))
        await walk.load()
        #expect(walk.state == .consent)
        box.result = .failure(APIError.timedOut)
        await walk.load()
        #expect(walk.state == .error)
        box.result = .success(.unavailable)
        await walk.load()
        #expect(walk.state == .error)
        box.result = .success(.empty)
        await walk.load()
        #expect(walk.state == .hidden)
    }

    @Test("a silent refresh keeps the ready card while it checks")
    func walkKeepsReady() async {
        let reflection = ReadingReflection(title: "t", reflection: "r", verse: nil, next: nil)
        final class Box { var observed: [Bool] = [] }
        let box = Box()
        var walk: ReadingWalkModel? = nil
        walk = ReadingWalkModel(fetch: { _ in
            box.observed.append(walk?.isReady ?? false)
            return .ready(reflection, generatedAt: "g")
        }, gate: { _ in true })
        await walk?.load()
        await walk?.load()
        #expect(box.observed == [false, true])
        await walk?.load(ask: true)
        #expect(box.observed == [false, true, false])
    }

    // MARK: - Journal

    @Test("the overview loads with each first page and gates the walk on any reading")
    func journalLoadsOverview() async {
        var paths: [String] = []
        let stats = ReadingJournalStats(sessions: 0, chapterReadings: 0, partialReadings: 0, uniqueChapters: 0, activeDays: 0)
        let summary = overview(current: 2, longest: 5, chapters: 3, books: 1)
        final class Failure { var error: Error? }
        let failure = Failure()
        let model = ReadingJournal(
            account: "owner", api: nil,
            fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("reading-overview-\(UUID()).json"),
            fetchHistory: { path in
                paths.append(path)
                return ReadingJournalPage(entries: [], nextCursor: "c1", stats: stats)
            },
            fetchOverview: { path in
                paths.append(path)
                if let error = failure.error { throw error }
                return summary
            }
        )
        defer { model.teardown() }
        #expect(!model.hasReading)
        await model.loadHistory()
        #expect(model.overview == summary)
        #expect(model.hasReading)
        await model.loadHistory(more: true)
        #expect(paths.filter { $0.hasPrefix("/api/reading-log/overview") }.count == 1)
        #expect(paths.contains { $0.hasPrefix("/api/reading-log/overview?tz=") })

        // The header is fetched on its own: its failure never blanks the log.
        failure.error = APIError.timedOut
        await model.loadHistory()
        #expect(model.historyError == nil)
        #expect(model.historyLoaded)
        #expect(model.overview == summary)

        model.resetHistory()
        #expect(model.overview == nil)
        #expect(!model.hasReading)
        #expect(!model.historyLoaded)
        await model.loadHistory()
        #expect(model.historyError == nil)
        #expect(model.overview == nil) // no stats or map, the log still shows
        #expect(model.nextCursor == "c1")
    }

    @Test("try again repeats exactly the request that failed")
    func retryFailedRequest() async {
        var paths: [String] = []
        final class Failure { var error: Error? }
        let failure = Failure()
        let stats = ReadingJournalStats(sessions: 0, chapterReadings: 0, partialReadings: 0, uniqueChapters: 0, activeDays: 0)
        let model = ReadingJournal(
            account: "owner", api: nil,
            fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("reading-retry-\(UUID()).json"),
            fetchHistory: { path in
                paths.append(path)
                if let error = failure.error { throw error }
                return path.contains("cursor=c2")
                    ? ReadingJournalPage(entries: [], nextCursor: "c3", stats: stats)
                    : path.contains("cursor=c1")
                        ? ReadingJournalPage(entries: [], nextCursor: "c2", stats: stats)
                        : ReadingJournalPage(entries: [], nextCursor: "c1", stats: stats)
            }
        )
        defer { model.teardown() }
        await model.loadHistory()
        await model.loadHistory(more: true) // c1 -> next is c2
        failure.error = APIError.timedOut
        await model.loadHistory(more: true) // the c2 page fails
        #expect(model.failedCursor == "c2")
        failure.error = nil
        paths.removeAll()
        await model.retryFailedLoad()
        #expect(paths == ["/api/reading-log?limit=30&cursor=c2"])
        #expect(model.failedCursor == nil && model.nextCursor == "c3")

        // A failed full refresh retries as a full refresh, never the next page.
        failure.error = APIError.timedOut
        await model.loadHistory()
        #expect(model.failedCursor == nil && model.historyError != nil)
        failure.error = nil
        paths.removeAll()
        await model.retryFailedLoad()
        #expect(paths == ["/api/reading-log?limit=30"])
        #expect(model.historyError == nil)
    }

    @Test("a reset clears the log, header, cursor and the reflection card")
    func resetClearsEverything() async {
        let stats = ReadingJournalStats(sessions: 0, chapterReadings: 0, partialReadings: 0, uniqueChapters: 0, activeDays: 0)
        let model = ReadingJournal(
            account: "owner", api: nil,
            fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("reading-reset-\(UUID()).json"),
            fetchHistory: { _ in ReadingJournalPage(entries: [self.entry()], nextCursor: "c1", stats: stats) },
            fetchOverview: { _ in self.overview(chapters: 1, books: 1) },
            fetchReflection: { _ in .empty }
        )
        defer { model.teardown() }
        await model.loadHistory()
        await model.walk.load()
        #expect(model.walk.state == .hidden)
        #expect(!model.history.isEmpty && model.overview != nil && model.nextCursor == "c1")
        model.resetHistory()
        #expect(model.history.isEmpty && model.overview == nil && model.nextCursor == nil && model.failedCursor == nil)
        #expect(model.walk.state == .loading)
        #expect(!model.historyLoaded)
    }
}
