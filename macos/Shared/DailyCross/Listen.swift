import Foundation

/// Pure state rules for "Listen" - today's spoken devotional.
///
/// A direct port of `src/components/cross/listen.ts` and its Android twin
/// `mobile/src/features/cross/listen.ts`, kept out of the view for the same
/// reason they are: which of five states the card is in, and how the speed chip
/// cycles, are the things that are easy to get wrong. `SureWordTests/ListenTests`
/// is a port of `mobile/src/features/cross/listen.test.ts`, case for case - if
/// you change one side, change both.

/// How the server describes today's spoken devotional.
///
/// `unavailable` means the deployment has no ElevenLabs credentials and can
/// never make audio - the card renders nothing at all for it. `locked` means
/// this account is not on SureWord Pro, and the card renders the Pro panel.
enum DailyCrossAudioStatus: String, Decodable, Sendable {
    case none, pending, ready, failed, unavailable, locked
}

/// The caller's subscription tier, as reported alongside the audio.
enum UserPlan: String, Decodable, Sendable {
    case free, pro
}

/// Today's spoken devotional, as served by `GET /api/verse-of-day/audio`.
///
/// Every field is decoded leniently. The route is newer than some of the rows
/// it reads, and an unrecognised `status` from a future deployment must render
/// the waiting card rather than fail the whole Daily Cross screen.
struct DailyCrossAudio: Decodable, Equatable, Sendable {
    let status: DailyCrossAudioStatus
    /// Signed blob URL, good for 24 hours; only present while `status` is
    /// `ready`. Kept because it fetches fine, but never handed to a player -
    /// AVFoundation and Chrome both refuse it. Play from `streamUrl`.
    let url: String?
    /// Same-origin path that proxies the narration; only present while `status`
    /// is `ready`. See `src/app/api/verse-of-day/audio/stream/route.ts`.
    let streamUrl: String?
    let title: String?
    /// The narrated text, for "Read along".
    let script: String?
    let durationSec: Double?
    let generatedAt: String?
    /// The caller's tier, so `locked` needs no second call to explain itself.
    let plan: UserPlan

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawStatus = try container.decodeIfPresent(String.self, forKey: .status)
        status = rawStatus.flatMap(DailyCrossAudioStatus.init(rawValue:)) ?? .none
        url = try container.decodeIfPresent(String.self, forKey: .url)
        streamUrl = try container.decodeIfPresent(String.self, forKey: .streamUrl)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        script = try container.decodeIfPresent(String.self, forKey: .script)
        durationSec = try container.decodeIfPresent(Double.self, forKey: .durationSec)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        let rawPlan = try container.decodeIfPresent(String.self, forKey: .plan)
        plan = rawPlan.flatMap(UserPlan.init(rawValue:)) ?? .free
    }

    private enum CodingKeys: String, CodingKey {
        case status, url, streamUrl, title, script, durationSec, generatedAt, plan
    }
}

extension DailyCrossAudio {
    /// Memberwise init for tests and previews; `Decodable` above replaces the
    /// synthesised one.
    init(
        status: DailyCrossAudioStatus = .none,
        url: String? = nil,
        streamUrl: String? = nil,
        title: String? = nil,
        script: String? = nil,
        durationSec: Double? = nil,
        generatedAt: String? = nil,
        plan: UserPlan = .pro
    ) {
        self.status = status
        self.url = url
        self.streamUrl = streamUrl
        self.title = title
        self.script = script
        self.durationSec = durationSec
        self.generatedAt = generatedAt
        self.plan = plan
    }
}

/// What the card should show.
///
/// There is no `idle` phase. Nothing is generated on a tap: the day and its
/// narration are made together, so by the time this card is on screen the
/// devotional is ready, being made, or has failed. Every client mounts it only
/// inside a loaded day, which is why `none` - and a nil payload before the
/// first poll answers - read as "being made" rather than "nothing here".
enum ListenPhase: String, Sendable {
    case hidden, locked, preparing, ready, failed
}

enum Listen {
    /// How often to re-ask the server while a devotional is being prepared.
    static let pollInterval: Duration = .seconds(3)

    /// Preparing takes ~30-60s. Past this the card stops polling and offers a
    /// retry rather than shimmering forever at someone whose generation quietly
    /// died.
    static let pollTimeout: TimeInterval = 4 * 60

    /// A signed audio URL lives 24 hours, but the window holding it may have
    /// been open far longer than the listen. When playback errors out on a URL
    /// this old, the card re-fetches once and resumes rather than accusing the
    /// user's connection - a URL fetched moments ago that fails is a real
    /// failure.
    static let urlStaleAfter: TimeInterval = 10 * 60

    /// Playback speeds offered on the Listen card, in cycle order. 1x sits
    /// second so the chip a listener presses most often is one press from the
    /// slowest and one from the faster half; going past 2x makes a devotional
    /// unintelligible rather than efficient.
    static let rates: [Double] = [0.75, 1, 1.25, 1.5, 2]

    static let defaultRate: Double = 1

    /// Nothing playing this long after Play means the source never opened.
    /// AVFoundation reports a failed *item* eventually, but a stalled one that
    /// is simply never fed reports nothing at all - the same hole expo-audio
    /// leaves on Android, and the same 8s answer.
    static let playbackStall: TimeInterval = 8

    /// Playback that survives this long is a listen, not a source that opened
    /// and died on the next byte. Only *this* re-arms the silent recovery
    /// stages; the bare transition to `.playing` must not, or a source that
    /// plays for an instant and dies re-arms them forever - a Clerk mint and a
    /// stream-route hit every `playbackStall` seconds, with the listener never
    /// told anything is wrong.
    static let playbackSteady: TimeInterval = 5

    /// How many playback faults in a row are absorbed silently before the card
    /// admits it. Small on purpose: each one costs a token mint and a rebuilt
    /// player, and three failures inside a few seconds is a dead source, not a
    /// blip.
    static let maxPlaybackFailures = 3

    static let failureText = "Couldn't prepare audio - try again"

    /// Which of the five states the card is in.
    static func phase(_ audio: DailyCrossAudio?) -> ListenPhase {
        // A server that cannot narrate must offer nothing at all - not even for
        // a Pro account. This outranks every other status.
        if audio?.status == .unavailable { return .hidden }
        // A locked benefit stays visible; hiding it would sell nothing and
        // explain nothing. Outranks the rest: a free account has no audio to be
        // in.
        if audio?.status == .locked { return .locked }
        if audio?.status == .ready, audio?.url != nil { return .ready }
        if audio?.status == .failed { return .failed }
        // "pending", "none" before the scheduled generation has claimed the
        // row, a ready row with no URL, or nothing fetched yet.
        return .preparing
    }

    /// Whether the card should keep polling the server in this phase.
    static func shouldPoll(_ phase: ListenPhase) -> Bool {
        phase == .preparing
    }

    /// What identifies the audio a player was built from.
    ///
    /// Deliberately NOT `streamUrl`: that is the constant path
    /// `/api/verse-of-day/audio/stream` for every day of every account, so a
    /// "has the source moved?" test keyed on it can never answer yes. An app
    /// left open overnight would keep yesterday's player - and splice its
    /// buffered bytes into today's devotional. `generatedAt` is the field that
    /// actually moves when the day turns; the signed `url` (re-signed per
    /// response) is the fallback for a row served without one.
    ///
    /// Nil for anything not playable, so preparing polls do not churn players.
    static func sourceIdentity(_ audio: DailyCrossAudio?) -> String? {
        guard let audio, audio.status == .ready, let streamUrl = audio.streamUrl else {
            return nil
        }
        if let generatedAt = audio.generatedAt, !generatedAt.isEmpty { return generatedAt }
        if let url = audio.url, !url.isEmpty { return url }
        return streamUrl
    }

    /// Whether this many consecutive playback faults is enough to stop trying
    /// and show the failure card.
    static func shouldSurfaceFailure(consecutiveFailures: Int) -> Bool {
        consecutiveFailures >= maxPlaybackFailures
    }

    /// How long to wait before the next silent recovery attempt. Doubling from
    /// a second keeps a flapping source from hammering the token endpoint while
    /// still recovering a genuine blip fast enough that nobody notices.
    static func failureBackoff(attempt: Int) -> Duration {
        let step = min(max(attempt, 1), maxPlaybackFailures)
        return .seconds(1 << (step - 1))
    }

    /// Whether a playback error is worth one silent retry with a freshly signed
    /// URL instead of a failure card. `urlFetchedAt` is when the client received
    /// the URL, and `alreadyRetried` stops a genuinely dead blob looping.
    static func shouldRefreshURL(
        urlFetchedAt: Date?,
        alreadyRetried: Bool,
        now: Date = .now
    ) -> Bool {
        guard !alreadyRetried, let urlFetchedAt else { return false }
        return now.timeIntervalSince(urlFetchedAt) >= urlStaleAfter
    }

    /// The largest position a clock will render: 99:59:59.
    static let maxClock: Double = 99 * 3600 + 59 * 60 + 59

    /// Seconds as m:ss (or h:mm:ss past an hour), for elapsed / total readouts.
    static func formatClock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        // `Int(_:)` on a finite Double past `Int.max` is a trap, not a wrap, so
        // the clamp is a crash guard rather than cosmetics: AVFoundation hands
        // out nonsense durations for a half-opened item, and a devotional is
        // minutes long - anything past 99:59:59 is already garbage.
        let whole = Int(min(seconds, maxClock).rounded(.down))
        let hours = whole / 3600
        let minutes = (whole % 3600) / 60
        let secs = whole % 60
        let padded = String(format: "%02d", secs)
        if hours > 0 { return "\(hours):\(String(format: "%02d", minutes)):\(padded)" }
        return "\(minutes):\(padded)"
    }

    /// A clamped fraction of the way through, for a hand-drawn scrubber rail.
    /// Ported from Android's `listenProgress` - web's `<input type="range">`
    /// fills its own track and has no use for it.
    static func progress(currentTime: Double, duration: Double) -> Double {
        guard duration.isFinite, duration > 0 else { return 0 }
        guard currentTime.isFinite, currentTime > 0 else { return 0 }
        return min(1, currentTime / duration)
    }

    /// The next speed in the cycle. An unrecognised current rate (a hand-edited
    /// preference, an older build's value) restarts at the top rather than
    /// falling out of the cycle.
    static func nextRate(_ rate: Double) -> Double {
        // -1 for "not one we offer", exactly as `findIndex` returns it, so the
        // wrap below lands on the first rate rather than anywhere arbitrary.
        let index = rates.firstIndex(of: rate) ?? -1
        return rates[(index + 1) % rates.count]
    }

    /// A stored or incoming rate, or the default when it is not one we offer.
    /// Accepts the string form too: `UserDefaults` and `localStorage` both hand
    /// back whatever was written, and an older build wrote strings.
    static func normalizeRate(_ raw: Any?) -> Double {
        let value: Double?
        switch raw {
        case let number as Double: value = number
        case let number as Int: value = Double(number)
        case let text as String: value = Double(text)
        default: value = nil
        }
        guard let value, rates.contains(value) else { return defaultRate }
        return value
    }

    /// The speed as a chip label: "1x", "0.75x". Never rounded - a label that
    /// disagreed with the speed would be telling the listener the wrong thing.
    static func formatRate(_ rate: Double) -> String {
        rate == rate.rounded()
            ? "\(Int(rate))x"
            : "\(String(format: "%g", rate))x"
    }
}
