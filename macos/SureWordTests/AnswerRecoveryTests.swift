import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/chat/answerRecovery.test.ts`, plus the
/// polling rules that live in `useSureWordChat.ts` beside it. The point of the
/// whole mechanism: a dropped connection is never a lost answer, because
/// `/api/ask-question` drains its own copy of the stream and persists the
/// finished reply regardless.
@Suite("Answer recovery")
struct AnswerRecoveryTests {

    /// Builds a JSONValue from literal JSON so the fixtures read like the
    /// server's actual response bodies.
    private func payload(_ json: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    }

    // MARK: completedHistory

    @Test("Returns the messages once the answer has landed")
    func returnsLandedAnswer() throws {
        let body = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "Who is Melchizedek?"},
              {"id": "2", "role": "assistant", "content": "He is the king of Salem."}
            ]}
            """
        )
        #expect(AnswerRecovery.completedHistory(body)?.count == 2)
    }

    @Test("Returns nothing while the assistant reply is still being written")
    func trailingUserMessageMeansNotDone() throws {
        let body = try payload(#"{"messages": [{"id": "1", "role": "user", "content": "Who?"}]}"#)
        #expect(AnswerRecovery.completedHistory(body) == nil)
    }

    @Test("Treats an empty assistant row as not yet answered")
    func blankAssistantRowIsNotAnAnswer() throws {
        let body = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "Hi"},
              {"id": "2", "role": "assistant", "content": "   "}
            ]}
            """
        )
        #expect(AnswerRecovery.completedHistory(body) == nil)
    }

    @Test("Rejects malformed payloads")
    func rejectsMalformedPayloads() throws {
        #expect(AnswerRecovery.completedHistory(nil) == nil)
        #expect(AnswerRecovery.completedHistory(.null) == nil)
        #expect(AnswerRecovery.completedHistory(try payload("{}")) == nil)
        #expect(AnswerRecovery.completedHistory(try payload(#"{"messages": "nope"}"#)) == nil)
        #expect(AnswerRecovery.completedHistory(try payload(#"{"messages": []}"#)) == nil)
        #expect(AnswerRecovery.completedHistory(try payload(#"{"messages": ["oops"]}"#)) == nil)
    }

    // MARK: Constants

    /// These are the Android client's numbers and must not drift: the interval
    /// paces the poll, and the budget deliberately outlasts the route's own 120s
    /// `maxDuration` plus the time it takes to persist the answer.
    @Test("Keeps the Android client's backoff and budget")
    func constantsMatchAndroid() {
        #expect(AnswerRecovery.pollInterval == .seconds(3))
        #expect(AnswerRecovery.maxDuration == .seconds(150))
        #expect(AnswerRecovery.resumeGrace == .seconds(4))
        // Not an Android number: the settle delay is all Android needs, because
        // its AppState "active" event only fires after a real background. The
        // Apple clients need a second, much larger threshold before they are
        // allowed to tear a still-open stream down.
        #expect(AnswerRecovery.staleStreamGrace == .seconds(45))
    }

    // MARK: Failure classification

    /// The bug this guards: `APIClient.stream` throws `APIError.server` for
    /// every non-2xx, and treating one as a lost connection buys a 150-second
    /// poll that can never restore - the route never ran, so the question
    /// was never persisted - and then reports "we couldn't retrieve that
    /// answer" instead of what the server actually said.
    @Test("An HTTP status the server returned is never recoverable")
    func httpStatusIsFinal() {
        #expect(!AnswerRecovery.isTransportFailure(APIError.server(status: 500)))
        #expect(!AnswerRecovery.isTransportFailure(APIError.server(status: 429, message: "Slow down")))
        #expect(!AnswerRecovery.isTransportFailure(APIError.server(status: 401)))
        #expect(!AnswerRecovery.isTransportFailure(APIError(message: "Invalid request path: /x")))
        #expect(!AnswerRecovery.isTransportFailure(CancellationError()))
    }

    @Test("A dropped connection is recoverable")
    func transportFailuresRecover() {
        #expect(AnswerRecovery.isTransportFailure(APIError.offline))
        #expect(AnswerRecovery.isTransportFailure(APIError.timedOut))
        #expect(AnswerRecovery.isTransportFailure(URLError(.networkConnectionLost)))
        #expect(AnswerRecovery.isTransportFailure(URLError(.notConnectedToInternet)))
        // `APIClient.translate` maps every other URL error to this shape.
        #expect(
            AnswerRecovery.isTransportFailure(
                APIError(message: "The network connection was lost.", isNetworkError: true)
            )
        )
    }

    // MARK: Polling policy

    @Test("Waits a full interval while the answer is still being written")
    func waitsWhileWriting() throws {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        let body = try payload(#"{"messages": [{"id": "1", "role": "user", "content": "Who?"}]}"#)
        #expect(policy.step(at: started, payload: body) == .wait(.seconds(3)))
    }

    @Test("Keeps polling when the poll itself failed")
    func keepsPollingWhenOffline() {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        // A nil payload is the offline case — precisely what recovery is for.
        #expect(policy.step(at: started.addingTimeInterval(9), payload: nil) == .wait(.seconds(3)))
    }

    @Test("Restores as soon as the finished answer appears")
    func restoresOnAnswer() throws {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        let body = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "Who?"},
              {"id": "2", "role": "assistant", "content": "Melchizedek."}
            ]}
            """
        )
        guard case .restore(let rows) = policy.step(at: started.addingTimeInterval(6), payload: body)
        else {
            Issue.record("expected the answer to be restored")
            return
        }
        #expect(rows.count == 2)
    }

    /// An answer that lands on the very last poll still counts — giving up is a
    /// deadline check, not a race with the payload.
    @Test("Restores even at the deadline")
    func restoresAtDeadline() throws {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        let body = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "Who?"},
              {"id": "2", "role": "assistant", "content": "Melchizedek."}
            ]}
            """
        )
        let step = policy.step(at: started.addingTimeInterval(600), payload: body)
        #expect(step != .giveUp)
    }

    /// The failure mode this guards: a send that died before the route ever
    /// persisted the question would otherwise find the *previous* turn at the
    /// end of the conversation, restore it, and quietly drop what the user just
    /// asked.
    @Test("Refuses a history that is missing the question just asked")
    func refusesHistoryMissingTheQuestion() throws {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started, expectedUserMessages: 2)
        let staleTurn = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "First question"},
              {"id": "2", "role": "assistant", "content": "First answer."}
            ]}
            """
        )
        #expect(policy.step(at: started, payload: staleTurn) == .wait(.seconds(3)))

        let bothTurns = try payload(
            """
            {"messages": [
              {"id": "1", "role": "user", "content": "First question"},
              {"id": "2", "role": "assistant", "content": "First answer."},
              {"id": "3", "role": "user", "content": "Second question"},
              {"id": "4", "role": "assistant", "content": "Second answer."}
            ]}
            """
        )
        guard case .restore(let rows) = policy.step(at: started, payload: bothTurns) else {
            Issue.record("expected the second answer to be restored")
            return
        }
        #expect(rows.count == 4)
    }

    @Test("Gives up once the server's own budget has run out")
    func givesUpAfterBudget() {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        #expect(policy.step(at: started.addingTimeInterval(150), payload: nil) == .giveUp)
        #expect(policy.step(at: started.addingTimeInterval(151), payload: nil) == .giveUp)
    }

    /// Sleeping a full interval past the deadline would delay the give-up by up
    /// to three seconds for nothing.
    @Test("Never sleeps past the deadline")
    func clampsFinalWait() {
        let started = Date(timeIntervalSince1970: 1_000)
        let policy = AnswerRecoveryPolicy(startedAt: started)
        #expect(policy.step(at: started.addingTimeInterval(149), payload: nil) == .wait(.seconds(1)))
    }

    // MARK: Resuming after the app comes back

    /// Only a gap no healthy stream produces. 45s is far past the longest
    /// tool-call pause the route generates, and cancelling a live stream is the
    /// expensive mistake: it loses the answer, and the server - which cannot
    /// tell a dropped socket from a deliberate stop - then pushes a spurious
    /// "your answer is ready".
    @Test("Collects only once an open stream has been silent far past any tool call")
    func collectsAfterLongSilence() {
        #expect(
            AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c1",
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: true,
                sinceLastStreamActivity: .seconds(45)
            )
        )
        #expect(
            AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c1",
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: true,
                sinceLastStreamActivity: .seconds(120)
            )
        )
    }

    /// The stream task failed or ended without clearing what it owed, which is
    /// the shape of a socket the system killed while the app was away. Nothing
    /// live is lost by collecting, so this is the case a resume exists for.
    @Test("Collects when the stream has already ended while still owing an answer")
    func collectsWhenStreamEnded() {
        #expect(
            AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c1",
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: false,
                sinceLastStreamActivity: .seconds(1)
            )
        )
    }

    /// A stream that is still receiving must be left alone: tearing it down to
    /// poll throws away a live answer. On macOS this is the common case rather
    /// than the rare one, because a several-second pause inside a tool call is
    /// ordinary and the machine can wake in the middle of one.
    @Test("Leaves a stream that is still receiving alone")
    func leavesLiveStreamAlone() {
        for gap in [Duration.seconds(1), .seconds(9), .seconds(30), .seconds(44)] {
            #expect(
                !AnswerRecovery.shouldCollectOnResume(
                    pendingConversationID: "c1",
                    expecting: "c1",
                    isRecovering: false,
                    isStreamOpen: true,
                    sinceLastStreamActivity: gap
                ),
                "a \(gap) gap is not a dead stream"
            )
        }
    }

    @Test("Does nothing when nothing is owed, or a poll already owns the job")
    func skipsWhenNothingToDo() {
        #expect(
            !AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: nil,
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: true,
                sinceLastStreamActivity: .seconds(90)
            )
        )
        #expect(
            !AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c1",
                expecting: "c1",
                isRecovering: true,
                isStreamOpen: true,
                sinceLastStreamActivity: .seconds(90)
            )
        )
        // A recovery already running owns the job even once the stream is gone.
        #expect(
            !AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c1",
                expecting: "c1",
                isRecovering: true,
                isStreamOpen: false,
                sinceLastStreamActivity: .seconds(90)
            )
        )
    }

    /// The user switched chats while the check was waiting out its grace period.
    @Test("Ignores a check whose conversation changed underneath it")
    func ignoresStaleCheck() {
        #expect(
            !AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c2",
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: true,
                sinceLastStreamActivity: .seconds(90)
            )
        )
        #expect(
            !AnswerRecovery.shouldCollectOnResume(
                pendingConversationID: "c2",
                expecting: "c1",
                isRecovering: false,
                isStreamOpen: false,
                sinceLastStreamActivity: .seconds(90)
            )
        )
    }
}
