import Foundation

/// The pure half of "an answer must never be lost", ported from
/// `mobile/src/features/chat/answerRecovery.ts` and the polling rules that live
/// beside it in `useSureWordChat.ts`. `ChatViewModel` owns the polling and the
/// resume wiring; everything decidable without a network lives here so it can be
/// unit-tested.
///
/// Why this exists: a Mac that sleeps, a Wi-Fi hop, or any dropped socket kills
/// the streaming fetch behind an answer. The server does **not** stop -
/// `/api/ask-question` drains its own copy of the SSE stream and persists the
/// finished answer regardless - so the answer is sitting in the conversation
/// waiting to be collected. The client just has to go and get it instead of
/// showing a failure.
enum AnswerRecovery {
    /// How often the recovery poll asks the server whether the answer landed.
    /// Same 3s as the Android client.
    static let pollInterval: Duration = .seconds(3)

    /// How long to keep collecting. The route's own budget is 120s
    /// (`maxDuration`), so this outlasts the slowest possible answer plus its
    /// persistence.
    static let maxDuration: Duration = .seconds(150)

    /// How long to wait after a resume before judging the stream at all. A
    /// stream that merely stalled while the Mac slept often resumes on its own,
    /// and judging it the instant the app is back would catch it mid-recovery.
    static let resumeGrace: Duration = .seconds(4)

    /// How long a **still-open** stream may go silent before a resume is allowed
    /// to tear it down and poll instead.
    ///
    /// Deliberately far larger than `resumeGrace`: cancelling a healthy stream is
    /// the more expensive mistake. It loses the live answer, and the server -
    /// which cannot tell a deliberate stop from a dead socket - then fires a
    /// spurious "your answer is ready" push. A long tool call (Tavily plus a
    /// scripture search plus a slow model) can legitimately go tens of seconds
    /// between chunks, so only a gap no healthy stream produces counts as dead.
    static let staleStreamGrace: Duration = .seconds(45)

    /// Shown only once the server's own budget has run out, at which point
    /// asking again is the honest option. Copy matches `recoveryExhaustedError`
    /// in `mobile/src/features/chat/chatErrors.ts`.
    static let exhaustedError = "We couldn't retrieve that answer. Retry to ask again."

    /// The messages of a conversation whose newest message is a finished
    /// assistant reply, or `nil` while the answer is still being written.
    ///
    /// The user message is persisted when the stream opens and the assistant
    /// message only at the end, so a trailing user message means "not done yet".
    static func completedHistory(_ payload: JSONValue?) -> [JSONValue]? {
        guard let messages = payload?["messages"]?.arrayValue, let last = messages.last else {
            return nil
        }
        guard last.objectValue != nil, last["role"]?.stringValue == "assistant" else { return nil }
        // An assistant row with no content is a persistence artifact, not an
        // answer.
        if let content = last["content"]?.stringValue,
           content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return nil
        }
        return messages
    }

    /// Whether a failed send is a **lost connection** - the server is still
    /// writing the answer, so it can be collected - or something the server
    /// actually said, which is final.
    ///
    /// This distinction is load-bearing. `APIClient.stream` throws
    /// `APIError.server(status:message:)` for every non-2xx, and a non-2xx means
    /// the route never ran: the user message was never persisted, so there is
    /// nothing in the conversation to collect. Feeding one into the poll buys a
    /// 150-second wait that can only ever end in "We couldn't retrieve that
    /// answer" - hiding the real error (rate limited, model unavailable, 500)
    /// for two and a half minutes first.
    static func isTransportFailure(_ error: any Error) -> Bool {
        if let apiError = error as? APIError {
            // A decoded HTTP status means the server answered.
            if apiError.status != nil { return false }
            return apiError.isOffline
        }
        if error is CancellationError { return false }
        // `URLError` bridges to this domain, as does anything `URLSession` throws.
        return (error as NSError).domain == NSURLErrorDomain
    }

    /// Whether a resume should tear the stream down and start collecting.
    /// Evaluated *after* `resumeGrace` has elapsed.
    ///
    /// The rule, in one line: **never cancel a stream that is still receiving.**
    /// A resume acts only when the stream task has already failed or ended while
    /// still owing an answer (nothing to cancel), or when an open stream has
    /// produced nothing for `staleStreamGrace` - a gap no healthy answer, tool
    /// calls included, produces.
    ///
    /// - Parameters:
    ///   - pendingConversationID: the conversation still owed an answer, if any.
    ///   - expecting: the conversation that was pending when the resume fired;
    ///     if it changed underneath, the check is stale.
    ///   - isRecovering: a poll already running owns the job.
    ///   - isStreamOpen: the send is still in flight (`status != .idle`).
    ///   - sinceLastStreamActivity: age of the newest chunk.
    static func shouldCollectOnResume(
        pendingConversationID: String?,
        expecting: String,
        isRecovering: Bool,
        isStreamOpen: Bool,
        sinceLastStreamActivity: Duration
    ) -> Bool {
        guard pendingConversationID == expecting, !isRecovering else { return false }
        // The stream already ended or failed without clearing what it owed - the
        // usual shape of a socket the system killed while the app was away.
        // There is nothing live to lose, so collect.
        guard isStreamOpen else { return true }
        return sinceLastStreamActivity >= staleStreamGrace
    }
}

/// One poll of the recovery loop, expressed as a decision so the loop itself
/// stays a three-line `switch` and the rules stay testable.
struct AnswerRecoveryPolicy: Sendable, Equatable {
    enum Step: Sendable, Equatable {
        /// The finished answer arrived - swap these rows in.
        case restore([JSONValue])
        /// Nothing yet; sleep this long and ask again.
        case wait(Duration)
        /// The server's budget has run out. Show the exhausted error.
        case giveUp
    }

    /// When the recovery started, which fixes the deadline.
    let startedAt: Date

    /// How many user messages the conversation must hold before a stored answer
    /// can be trusted as the answer to *this* question.
    ///
    /// Without this, a send that died before the server ever persisted the
    /// question - a 200 carrying an HTML error page, say - would find the
    /// previous turn sitting at the end of the conversation, restore it, and
    /// quietly drop the question the user just asked. The route persists the
    /// user message when the stream opens, so "my question is in there" is
    /// exactly the precondition for collecting an answer to it.
    let expectedUserMessages: Int

    init(startedAt: Date, expectedUserMessages: Int = 0) {
        self.startedAt = startedAt
        self.expectedUserMessages = expectedUserMessages
    }

    var deadline: Date { startedAt.addingTimeInterval(AnswerRecovery.maxDuration.inSeconds) }

    /// - Parameter payload: the `GET /api/conversations/{id}` body, or `nil`
    ///   when that request failed. A failure is not terminal: offline is exactly
    ///   the case this whole mechanism exists for, so keep asking.
    func step(at now: Date, payload: JSONValue?) -> Step {
        if let restored = AnswerRecovery.completedHistory(payload),
           restored.count(where: { $0["role"]?.stringValue == "user" }) >= expectedUserMessages {
            return .restore(restored)
        }
        guard now < deadline else { return .giveUp }
        // Never sleep past the deadline: the last wait should land on it.
        let remaining = deadline.timeIntervalSince(now)
        return .wait(min(AnswerRecovery.pollInterval, .seconds(remaining)))
    }
}

extension Duration {
    /// `Duration` in seconds as a `TimeInterval`, for `Date` arithmetic.
    ///
    /// Named `inSeconds` rather than `seconds` on purpose: `Duration.seconds(_:)`
    /// is the standard-library constructor, and a module-wide property spelled
    /// the same way reads as though it were part of it.
    var inSeconds: TimeInterval {
        TimeInterval(components.seconds) + TimeInterval(components.attoseconds) / 1e18
    }
}
