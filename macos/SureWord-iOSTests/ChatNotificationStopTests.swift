import Foundation
import Testing
@testable import SureWord

private final class StopEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []

    func append(_ value: String) { lock.withLock { entries.append(value) } }
    var values: [String] { lock.withLock { entries } }
}

private actor StopAcknowledgementGate {
    private var released = false
    private var waiter: CheckedContinuation<Void, Never>?

    func wait() async {
        if released { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func release() {
        released = true
        waiter?.resume()
        waiter = nil
    }
}

@Suite("Deliberate chat Stop")
struct ChatNotificationStopTests {
    @Test("Transport stays connected until the Stop acknowledgement")
    func acknowledgementPrecedesDeparture() async {
        let attempt = ChatNotificationAttempt(conversationID: "conversation")
        let events = StopEvents()
        let gate = StopAcknowledgementGate()
        let (entered, signal) = AsyncStream<Void>.makeStream()
        let work = Task {
            await attempt.stop(acknowledge: { received in
                #expect(received == attempt)
                events.append("request")
                signal.yield(())
                await gate.wait()
                events.append("acknowledged")
            }, depart: { events.append("departed") })
        }
        var iterator = entered.makeAsyncIterator()
        _ = await iterator.next()
        #expect(events.values == ["request"])
        await gate.release()
        await work.value
        #expect(events.values == ["request", "acknowledged", "departed"])
        signal.finish()
    }

    @Test("Failed Stop leaves the hidden response draining rather than requesting a push")
    func failedAcknowledgementDoesNotDisconnect() async {
        let events = StopEvents()
        await ChatNotificationAttempt(conversationID: "conversation").stop(
            acknowledge: { _ in throw URLError(.notConnectedToInternet) },
            depart: { events.append("departed") }
        )
        #expect(events.values.isEmpty)
    }

    @Test("Cancellation while acknowledging does not manufacture a departure")
    func cancelledAcknowledgementDoesNotDisconnect() async {
        let events = StopEvents()
        await ChatNotificationAttempt(conversationID: "conversation").stop(
            acknowledge: { _ in throw CancellationError() },
            depart: { events.append("departed") }
        )
        #expect(events.values.isEmpty)
    }

    @Test("Retrying the same conversation has a distinct attempt and wire identity")
    func attemptIdentityIsIndependentOfUserMessage() throws {
        let first = ChatNotificationAttempt(conversationID: "conversation")
        let retry = ChatNotificationAttempt(conversationID: "conversation")
        #expect(first.attemptId != retry.attemptId)
        #expect(UUID(uuidString: first.attemptId) != nil)
        #expect(first.attemptId == first.attemptId.lowercased())
        let stop = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(first)) as? [String: String])
        #expect(stop == ["conversationId": "conversation", "attemptId": first.attemptId])
        let request = AskQuestionRequest(
            messages: [], conversationId: "conversation", translation: "KJV",
            modelId: nil, effort: nil, speed: nil, verbosity: nil, mode: nil,
            notificationAttemptId: first.attemptId
        )
        let body = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        #expect(body["notificationAttemptId"] as? String == first.attemptId)
    }

    @Test("An abandoned stream cannot overwrite a newer visible thread")
    @MainActor
    func abandonedStreamIsFencedFromVisibleState() async {
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, token: { _ in nil }, onAuthFailure: {})
        let chat = ChatViewModel(api: api, settings: SettingsStore())
        chat.seedPendingSend(conversationID: "new-conversation", question: "The new question")
        let original = chat.askRequest().messages
        let bytes = AsyncThrowingStream<UInt8, any Error> { continuation in
            let sse = "data: {\"type\":\"start\",\"messageId\":\"old-answer\"}\n\n" +
                "data: {\"type\":\"text-start\",\"id\":\"0\"}\n\n" +
                "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"An abandoned answer\"}\n\n" +
                "data: {\"type\":\"finish\"}\n\n"
            for byte in sse.utf8 { continuation.yield(byte) }
            continuation.finish()
        }
        await chat.consume(bytes, generation: UUID())
        #expect(chat.askRequest().messages == original)
        #expect(chat.status == .submitted)
        #expect(!chat.isRecovering)
        chat.teardown()
    }
}
