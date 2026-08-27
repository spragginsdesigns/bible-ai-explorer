import Foundation
import Testing
@testable import SureWord

/// Answer recovery driven through `ChatViewModel` itself, rather than through
/// the pure rules in `AnswerRecoveryTests`.
///
/// Both defects these cover were invisible to the pure tests: the rules were
/// right and the wiring around them was wrong. A non-2xx was handed to the
/// 150-second poll that can never restore, and a resume was allowed to cancel a
/// stream that was still receiving.
@Suite("Chat recovery")
@MainActor
struct ChatRecoveryTests {

    /// A body that delivers `prefix` and then fails, which is what a dropped
    /// socket looks like to `consume`.
    struct FailingByteStream: AsyncSequence, Sendable {
        typealias Element = UInt8
        let prefix: [UInt8]
        let failure: any Error & Sendable

        init(_ text: String = "", failing error: any Error & Sendable) {
            prefix = Array(text.utf8)
            failure = error
        }

        struct Iterator: AsyncIteratorProtocol {
            let bytes: [UInt8]
            let failure: any Error & Sendable
            var index = 0

            mutating func next() async throws -> UInt8? {
                guard index < bytes.count else { throw failure }
                defer { index += 1 }
                return bytes[index]
            }
        }

        func makeAsyncIterator() -> Iterator { Iterator(bytes: prefix, failure: failure) }
    }

    /// The client is never reached in the assertions below; a recovery poll that
    /// does start is stopped before the test ends.
    private func makeViewModel() -> ChatViewModel {
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        return ChatViewModel(api: api, settings: SettingsStore())
    }

    // MARK: Failure classification

    /// The blocker: `APIClient.stream` throws `APIError.server(status:)` for
    /// every non-2xx, and recovery used to swallow it. The route never ran, so
    /// the question was never persisted and the poll could not restore anything
    /// - the user waited 150 seconds and was then told we couldn't retrieve an
    /// answer that never existed, instead of being told what the server said.
    @Test("An HTTP status error is shown at once and never enters recovery")
    func httpStatusErrorIsImmediate() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(
            FailingByteStream(failing: APIError.server(status: 500, message: "Model unavailable"))
        )

        #expect(chat.sendError == "Model unavailable")
        #expect(!chat.isRecovering)
        #expect(chat.status == .idle)
        chat.teardown()
    }

    @Test("A 429 the server returned is shown at once too")
    func rateLimitIsImmediate() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(
            FailingByteStream(failing: APIError.server(status: 429, message: "Slow down"))
        )

        #expect(chat.sendError == "Slow down")
        #expect(!chat.isRecovering)
        chat.teardown()
    }

    /// The case the whole mechanism exists for: the connection died, the server
    /// did not, so the answer is collected rather than reported as a failure.
    @Test("A dropped connection starts recovery instead of showing an error")
    func transportFailureStartsRecovery() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(FailingByteStream(failing: URLError(.networkConnectionLost)))

        #expect(chat.isRecovering)
        #expect(chat.sendError == nil)
        // The composer stays disabled and the typing indicator stays up: nothing
        // has actually failed yet.
        #expect(chat.isBusy)
        chat.teardown()
    }

    /// A partial answer that dies mid-sentence is still a dropped connection.
    @Test("A stream that fails after some text still recovers")
    func partialStreamRecovers() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        let opening = "data: {\"type\":\"start\",\"messageId\":\"m1\"}\n\n" +
            "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"He is\"}\n\n"
        await chat.consume(FailingByteStream(opening, failing: URLError(.timedOut)))

        #expect(chat.isRecovering)
        #expect(chat.sendError == nil)
        chat.teardown()
    }

    // MARK: Ending a recovery

    @Test("Stop ends a running recovery")
    func stopEndsRecovery() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        await chat.consume(FailingByteStream(failing: URLError(.networkConnectionLost)))
        #expect(chat.isRecovering)

        chat.stop()

        #expect(!chat.isRecovering)
        #expect(!chat.isBusy)
    }

    /// Walking away from the conversation is the same decision as pressing Stop:
    /// the poll must not fetch an answer into a chat the user has left.
    @Test("Leaving the conversation ends a running recovery")
    func newConversationEndsRecovery() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        await chat.consume(FailingByteStream(failing: URLError(.networkConnectionLost)))
        #expect(chat.isRecovering)

        chat.newConversation()

        #expect(!chat.isRecovering)
        #expect(chat.messages.isEmpty)
    }

    /// Sign-out drops `AppModel`, which drops this. The poll used to hold the
    /// model alive across its own sleep and keep asking with a dead token.
    @Test("Teardown ends a running recovery")
    func teardownEndsRecovery() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        await chat.consume(FailingByteStream(failing: URLError(.networkConnectionLost)))
        #expect(chat.isRecovering)

        chat.teardown()

        #expect(!chat.isRecovering)
    }

    // MARK: Resuming

    /// The other blocker, and the reason macOS listens for `NSWorkspace`'s wake
    /// rather than `NSApplication.didBecomeActiveNotification`: a resume that
    /// fires on every ⌘-Tab used to cancel the stream after a four-second gap,
    /// which is an ordinary pause inside a tool call. That lost a live answer
    /// and made the server push a spurious "your answer is ready".
    ///
    /// This waits out the real grace period on purpose: the bug lived in the
    /// timing, so the test has to live there too.
    @Test("A resume never cancels a stream that is still receiving")
    func resumeLeavesLiveStreamAlone() async throws {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who?", status: .streaming)

        chat.systemDidResume()
        try await Task.sleep(for: AnswerRecovery.resumeGrace + .milliseconds(750))

        #expect(chat.status == .streaming)
        #expect(!chat.isRecovering)
        #expect(chat.sendError == nil)
        chat.teardown()
    }
}
