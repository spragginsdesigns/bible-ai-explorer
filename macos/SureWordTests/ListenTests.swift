import Foundation
import Testing
@testable import SureWord

/// A case-for-case port of `mobile/src/features/cross/listen.test.ts`, which is
/// the suite web's identical `src/components/cross/listen.ts` is also pinned
/// to. If a rule changes on one client it must change on all four, and this is
/// the file that notices.

private func audio(
    status: DailyCrossAudioStatus = .none,
    url: String? = nil,
    streamUrl: String? = nil,
    generatedAt: String? = nil,
    plan: UserPlan = .pro
) -> DailyCrossAudio {
    DailyCrossAudio(
        status: status,
        url: url,
        streamUrl: streamUrl,
        generatedAt: generatedAt,
        plan: plan
    )
}

@Suite("Listen phase")
struct ListenPhaseTests {

    @Test("Waits by default - the devotional is made with the day, not on a tap")
    func waitsByDefault() {
        // Nothing here is an invitation any more: a card on screen means a day
        // exists, and a day always schedules its narration.
        #expect(Listen.phase(nil) == .preparing)
        #expect(Listen.phase(audio(status: .none)) == .preparing)
        #expect(Listen.phase(audio(status: .pending)) == .preparing)
    }

    @Test("Follows the server once it reports")
    func followsTheServer() {
        #expect(Listen.phase(audio(status: .failed)) == .failed)
        #expect(Listen.phase(audio(status: .ready, url: "https://blob/x.mp3")) == .ready)
    }

    @Test("Does not call a ready row playable without a URL")
    func readyNeedsAURL() {
        #expect(Listen.phase(audio(status: .ready, url: nil)) == .preparing)
    }

    @Test("Hides the card outright when the server cannot narrate")
    func hidesWhenUnavailable() {
        // No ELEVENLABS_API_KEY: no card at all, never a button that can only
        // fail. Outranks every other status, Pro included.
        #expect(Listen.phase(audio(status: .unavailable)) == .hidden)
        #expect(Listen.phase(audio(status: .unavailable, plan: .pro)) == .hidden)
    }

    @Test("Shows a free account the Pro panel rather than hiding the benefit")
    func showsLockedPanel() {
        #expect(Listen.phase(audio(status: .locked, plan: .free)) == .locked)
    }

    @Test("Polls only while preparing")
    func pollsOnlyWhilePreparing() {
        #expect(Listen.shouldPoll(.preparing))
        #expect(!Listen.shouldPoll(.ready))
        #expect(!Listen.shouldPoll(.failed))
        #expect(!Listen.shouldPoll(.hidden))
        // A locked card must never poll - it would be a request per three
        // seconds, forever, for an answer that cannot change.
        #expect(!Listen.shouldPoll(.locked))
    }

    @Test("An unrecognised status from a newer deployment waits rather than failing")
    func unknownStatusWaits() throws {
        let decoded = try JSONDecoder().decode(
            DailyCrossAudio.self,
            from: Data(#"{"status":"transcoding","plan":"pro"}"#.utf8)
        )
        #expect(decoded.status == .none)
        #expect(Listen.phase(decoded) == .preparing)
    }

    @Test("Decodes the route's ready payload")
    func decodesReadyPayload() throws {
        let decoded = try JSONDecoder().decode(
            DailyCrossAudio.self,
            from: Data(
                """
                {
                  "status": "ready",
                  "url": "https://blob.vercel-storage.com/x.mp3?sig=1",
                  "streamUrl": "/api/verse-of-day/audio/stream",
                  "title": "The LORD is my light",
                  "script": "Good morning…",
                  "durationSec": 225.4,
                  "generatedAt": "2026-08-27T12:00:00.000Z",
                  "plan": "pro"
                }
                """.utf8
            )
        )
        #expect(decoded.status == .ready)
        #expect(decoded.streamUrl == "/api/verse-of-day/audio/stream")
        #expect(decoded.durationSec == 225.4)
        #expect(decoded.plan == .pro)
        #expect(Listen.phase(decoded) == .ready)
    }
}

@Suite("Listen playback speed")
struct ListenRateTests {

    @Test("Cycles through every offered rate and wraps")
    func cyclesAndWraps() {
        var seen = [Listen.defaultRate]
        for _ in 0..<(Listen.rates.count - 1) {
            seen.append(Listen.nextRate(seen[seen.count - 1]))
        }
        #expect(Set(seen).count == Listen.rates.count)
        #expect(Listen.nextRate(seen[seen.count - 1]) == Listen.defaultRate)
    }

    @Test("Restarts the cycle from a rate this build no longer offers")
    func restartsFromAnUnknownRate() {
        #expect(Listen.rates.contains(Listen.nextRate(3.5)))
    }

    @Test("Normalizes anything stored, including the string an older build wrote")
    func normalizesStoredValues() {
        #expect(Listen.normalizeRate("1.5") == 1.5)
        #expect(Listen.normalizeRate(1.5) == 1.5)
        #expect(Listen.normalizeRate("banana") == Listen.defaultRate)
        #expect(Listen.normalizeRate(nil) == Listen.defaultRate)
        // A rate we do not offer must not reach the player.
        #expect(Listen.normalizeRate(4) == Listen.defaultRate)
        // Nor may an unset UserDefaults key, which reads as 0.
        #expect(Listen.normalizeRate(0) == Listen.defaultRate)
    }

    @Test("Normalizing is idempotent, which is what stops the settings write-back looping")
    func normalizingIsIdempotent() {
        // `SettingsStore.listenRate`'s `didSet` writes a normalised value back
        // through its own (`@Observable`-generated) setter, so the second pass
        // MUST be a fixed point or the store recurses until the stack dies -
        // which it did, as a segfault on the first press of the speed chip.
        for raw in [0, 0.75, 1, 1.25, 1.5, 2, 3.5, 4] as [Double] {
            let once = Listen.normalizeRate(raw)
            #expect(Listen.normalizeRate(once) == once)
        }
        #expect(Listen.normalizeRate(Listen.normalizeRate("banana")) == Listen.defaultRate)
    }

    @Test("Labels the speed exactly, never rounded")
    func labelsExactly() {
        #expect(Listen.formatRate(1) == "1x")
        #expect(Listen.formatRate(0.75) == "0.75x")
        #expect(Listen.formatRate(1.25) == "1.25x")
        #expect(Listen.formatRate(1.5) == "1.5x")
        #expect(Listen.formatRate(2) == "2x")
    }
}

@Suite("Listen URL refresh")
struct ListenRefreshTests {
    private let now = Date(timeIntervalSince1970: 1_787_486_400)

    @Test("Re-signs once for a URL old enough to have expired")
    func refreshesAStaleURL() {
        #expect(
            Listen.shouldRefreshURL(
                urlFetchedAt: now.addingTimeInterval(-Listen.urlStaleAfter - 1),
                alreadyRetried: false,
                now: now
            )
        )
    }

    @Test("Does not loop on a blob that is genuinely gone")
    func doesNotLoop() {
        #expect(
            !Listen.shouldRefreshURL(
                urlFetchedAt: now.addingTimeInterval(-Listen.urlStaleAfter - 1),
                alreadyRetried: true,
                now: now
            )
        )
    }

    @Test("Treats a fresh URL failing as a real failure")
    func freshFailureIsAFailure() {
        #expect(
            !Listen.shouldRefreshURL(
                urlFetchedAt: now.addingTimeInterval(-30),
                alreadyRetried: false,
                now: now
            )
        )
        #expect(!Listen.shouldRefreshURL(urlFetchedAt: nil, alreadyRetried: false, now: now))
    }
}

/// The rules that decide when a player is rebuilt and when a fault is finally
/// admitted. macOS-only - `AVPlayer` is the only client that holds a live
/// player across a day boundary, so these have no twin in `listen.test.ts`.
@Suite("Listen source identity")
struct ListenSourceIdentityTests {
    /// Every day's payload carries this same path - which is exactly why it
    /// cannot be what a rebuild keys on.
    private let stream = "/api/verse-of-day/audio/stream"

    @Test("A new day moves the source even though the stream path never does")
    func noticesANewDay() {
        // The bug this guards: an app left open overnight kept yesterday's
        // player and spliced its buffered bytes into today's devotional.
        let yesterday = audio(
            status: .ready,
            url: "https://blob/1.mp3",
            streamUrl: stream,
            generatedAt: "2026-08-26T12:00:00.000Z"
        )
        let today = audio(
            status: .ready,
            url: "https://blob/2.mp3",
            streamUrl: stream,
            generatedAt: "2026-08-27T12:00:00.000Z"
        )
        #expect(yesterday.streamUrl == today.streamUrl)
        #expect(Listen.sourceIdentity(yesterday) != Listen.sourceIdentity(today))
    }

    @Test("The same day polled twice is the same source, so nothing is rebuilt")
    func sameDayIsStable() {
        let payload = audio(
            status: .ready,
            url: "https://blob/1.mp3",
            streamUrl: stream,
            generatedAt: "2026-08-27T12:00:00.000Z"
        )
        #expect(Listen.sourceIdentity(payload) == Listen.sourceIdentity(payload))
    }

    @Test("Falls back to the signed URL for a row served without a timestamp")
    func fallsBackToTheSignedURL() {
        let first = audio(status: .ready, url: "https://blob/1.mp3", streamUrl: stream)
        let second = audio(status: .ready, url: "https://blob/2.mp3", streamUrl: stream)
        #expect(Listen.sourceIdentity(first) != Listen.sourceIdentity(second))
    }

    @Test("Nothing playable has no identity, so preparing polls churn no players")
    func nothingPlayableHasNoIdentity() {
        #expect(Listen.sourceIdentity(nil) == nil)
        #expect(Listen.sourceIdentity(audio(status: .pending)) == nil)
        #expect(Listen.sourceIdentity(audio(status: .ready, url: "https://blob/1.mp3")) == nil)
    }
}

@Suite("Listen playback failure bounds")
struct ListenFailureTests {

    @Test("Absorbs a couple of faults silently, then admits it")
    func boundedRetries() {
        // The bug this guards: a source that played for an instant re-armed
        // every recovery stage, so it retried forever and never surfaced.
        #expect(!Listen.shouldSurfaceFailure(consecutiveFailures: 1))
        #expect(!Listen.shouldSurfaceFailure(consecutiveFailures: 2))
        #expect(Listen.shouldSurfaceFailure(consecutiveFailures: Listen.maxPlaybackFailures))
        #expect(Listen.shouldSurfaceFailure(consecutiveFailures: 99))
    }

    @Test("Backs off between attempts, and stops growing")
    func backsOff() {
        #expect(Listen.failureBackoff(attempt: 1) == .seconds(1))
        #expect(Listen.failureBackoff(attempt: 2) == .seconds(2))
        #expect(Listen.failureBackoff(attempt: 3) == .seconds(4))
        // Nothing past the surfacing bound, and no negative shift from a
        // nonsense attempt number.
        #expect(Listen.failureBackoff(attempt: 50) == Listen.failureBackoff(attempt: 3))
        #expect(Listen.failureBackoff(attempt: 0) == .seconds(1))
        #expect(Listen.failureBackoff(attempt: -1) == .seconds(1))
    }
}

@Suite("Listen clock and progress")
struct ListenClockTests {

    @Test("Reads as a player clock")
    func readsAsAPlayerClock() {
        #expect(Listen.formatClock(0) == "0:00")
        #expect(Listen.formatClock(9) == "0:09")
        #expect(Listen.formatClock(75) == "1:15")
        #expect(Listen.formatClock(3600) == "1:00:00")
        #expect(Listen.formatClock(3725) == "1:02:05")
    }

    @Test("Never shows NaN or a negative position")
    func neverShowsGarbage() {
        #expect(Listen.formatClock(.nan) == "0:00")
        #expect(Listen.formatClock(-4) == "0:00")
        #expect(Listen.formatClock(.infinity) == "0:00")
    }

    @Test("Clamps a huge finite duration rather than trapping on the conversion")
    func clampsRatherThanTrapping() {
        // `Int(_:)` on a finite Double past `Int.max` is a runtime trap, not a
        // wrap - a crash, from a half-opened item reporting nonsense. Anything
        // past 99:59:59 is garbage either way, so it renders as the ceiling.
        #expect(Listen.formatClock(1e18) == "99:59:59")
        #expect(Listen.formatClock(.greatestFiniteMagnitude) == "99:59:59")
        #expect(Listen.formatClock(Listen.maxClock) == "99:59:59")
        // The clamp must not touch a real devotional's clock.
        #expect(Listen.formatClock(225.4) == "3:45")
    }

    @Test("Progress is a clamped fraction")
    func progressIsClamped() {
        #expect(Listen.progress(currentTime: 30, duration: 120) == 0.25)
        #expect(Listen.progress(currentTime: 200, duration: 120) == 1)
        #expect(Listen.progress(currentTime: -5, duration: 120) == 0)
    }

    @Test("Progress is zero before a duration is known")
    func progressNeedsADuration() {
        #expect(Listen.progress(currentTime: 10, duration: 0) == 0)
        #expect(Listen.progress(currentTime: 10, duration: .nan) == 0)
    }
}

/// The "FROM YOUR PLAN" tag on the Pick Up Your Cross study path is now the
/// plan feature's own rule, `PlanView.isTodaysPlanReading`, read off the shared
/// `ReadingPlanModel` - there is no Daily-Cross copy of it any more. The happy
/// path, another day, another book, no plan and a completed plan all live in
/// `ReadingPlanTests.TodaysPlanReadingTests`; what is kept here is the handful
/// of edges the Cross screen brought with it and that suite does not cover.
@Suite("FROM YOUR PLAN tag")
struct DailyCrossPlanTagTests {

    private func plan(
        status: PlanStatus = .active,
        currentDay: Int = 2,
        readings: [(String, Int)] = [("Matthew", 3)]
    ) -> ReadingPlan {
        ReadingPlan(
            id: "plan_1",
            title: "The Gospels in 30 days",
            description: "Four accounts of one Lord.",
            status: status,
            dayCount: 30,
            todayDay: currentDay,
            currentDay: currentDay,
            completedCount: 1,
            percent: 3,
            streak: 1,
            days: [
                PlanDay(day: 1, readings: [PlanReading(book: "Matthew", chapter: 1)]),
                PlanDay(
                    day: 2,
                    readings: readings.map { PlanReading(book: $0.0, chapter: $0.1) }
                ),
            ]
        )
    }

    @Test("Yesterday's reading is not today's, however recently it was read")
    func leavesYesterdayAlone() {
        #expect(!PlanView.isTodaysPlanReading(plan(), book: "Matthew", chapter: 1))
    }

    @Test("An archived plan, or a current day the plan does not contain, tags nothing")
    func quietWithoutAnActiveDay() {
        #expect(!PlanView.isTodaysPlanReading(plan(status: .archived), book: "Matthew", chapter: 3))
        #expect(!PlanView.isTodaysPlanReading(plan(currentDay: 99), book: "Matthew", chapter: 3))
    }

    @Test("Survives a plan day that arrives with no readings at all")
    func survivesADayWithNoReadings() throws {
        let decoded = try JSONDecoder().decode(
            ReadingPlan.self,
            from: Data(
                """
                {
                  "id": "rp_1",
                  "status": "active",
                  "currentDay": 1,
                  "days": [ { "day": 1 } ]
                }
                """.utf8
            )
        )
        #expect(decoded.days.first?.readings.isEmpty == true)
        #expect(!PlanView.isTodaysPlanReading(decoded, book: "Matthew", chapter: 1))
    }
}
