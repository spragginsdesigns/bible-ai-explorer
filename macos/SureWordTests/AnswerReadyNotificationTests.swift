import Foundation
import Testing
@testable import SureWord

/// The Mac's "Your answer is ready" (LC-16620): the rule and payload in
/// `AnswerReadyNotification`, a port of the web's `shouldNotifyAnswerLocally`
/// and `notifyAnswerReady`, and the `ChatViewModel.onAnswerReady` moments the
/// Mac shell posts it from.
@Suite("Answer ready notification")
@MainActor
struct AnswerReadyNotificationTests {

    // MARK: The rule

    @Test("Posts only in the background, with permission, with the switch on")
    func ruleNeedsEveryCondition() {
        #expect(AnswerReadyNotification.shouldNotify(
            conversationID: "conv_1", inBackground: true, authorized: true, chatReplies: true
        ))
        // The web's visible tab: whoever is looking at SureWord needs no notice.
        #expect(!AnswerReadyNotification.shouldNotify(
            conversationID: "conv_1", inBackground: false, authorized: true, chatReplies: true
        ))
        #expect(!AnswerReadyNotification.shouldNotify(
            conversationID: "conv_1", inBackground: true, authorized: false, chatReplies: true
        ))
        // Settings → Chat → "Notify when an answer is ready" off.
        #expect(!AnswerReadyNotification.shouldNotify(
            conversationID: "conv_1", inBackground: true, authorized: true, chatReplies: false
        ))
    }

    @Test("Never posts a notice with no conversation to open")
    func emptyConversationNeverPosts() {
        #expect(!AnswerReadyNotification.shouldNotify(
            conversationID: "", inBackground: true, authorized: true, chatReplies: true
        ))
    }

    // MARK: The payload

    @Test("Copy matches the server push and the web notice")
    func copyMatchesTheOtherClients() {
        #expect(AnswerReadyNotification.title == "Your answer is ready")
        #expect(AnswerReadyNotification.body(conversationTitle: "Who is Melchizedek?") == "Who is Melchizedek?")
        #expect(AnswerReadyNotification.body(conversationTitle: "  Grace  \n") == "Grace")
    }

    @Test("A missing or blank title falls back to the web's body")
    func blankTitleFallsBack() {
        for title in [nil, "", "   ", "\n\t"] as [String?] {
            #expect(AnswerReadyNotification.body(conversationTitle: title) == "Tap to read it in SureWord.")
        }
    }

    @Test("One notice per conversation, under the web's tag")
    func identifierIsPerConversation() {
        #expect(AnswerReadyNotification.identifier(conversationID: "conv_1") == "chat-conv_1")
        #expect(
            AnswerReadyNotification.identifier(conversationID: "conv_1")
                != AnswerReadyNotification.identifier(conversationID: "conv_2")
        )
    }

    /// The click has to land where a tapped push lands, so the payload is the
    /// server's own data and goes back through the same parser.
    @Test("A click routes like the server push: to that conversation")
    func payloadRoutesToTheConversation() {
        let userInfo = AnswerReadyNotification.userInfo(conversationID: "conv_9")
        #expect(userInfo == ["screen": "chat", "conversationId": "conv_9"])
        #expect(NotificationTapTarget(userInfo: userInfo) == .chat(conversationID: "conv_9"))
    }

    // MARK: When the chat model says an answer landed

    /// Stands in for `URLSession.AsyncBytes`, as in `RecordedStreamTests`.
    private struct ByteStream: AsyncSequence, Sendable {
        typealias Element = UInt8
        let bytes: [UInt8]

        init(_ text: String) { bytes = Array(text.utf8) }

        struct Iterator: AsyncIteratorProtocol {
            let bytes: [UInt8]
            var index = 0
            mutating func next() async throws -> UInt8? {
                guard index < bytes.count else { return nil }
                defer { index += 1 }
                return bytes[index]
            }
        }

        func makeAsyncIterator() -> Iterator { Iterator(bytes: bytes) }
    }

    /// The same never-reached client `ChatRecoveryTests` uses.
    private func makeViewModel() -> (ChatViewModel, Landed) {
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        let chat = ChatViewModel(api: api, settings: SettingsStore())
        let landed = Landed()
        chat.onAnswerReady = { conversationID, _, _ in landed.ids.append(conversationID) }
        return (chat, landed)
    }

    @MainActor
    final class Landed {
        var ids: [String] = []
    }

    private static let finishedAnswer =
        "data: {\"type\":\"start\",\"messageId\":\"m1\"}\n\n"
            + "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"He is the king of Salem.\"}\n\n"
            + "data: {\"type\":\"finish\"}\n\n"

    @Test("An answer streamed to the end reports its conversation once")
    func finishedStreamReportsOnce() async {
        let (chat, landed) = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(ByteStream(Self.finishedAnswer))

        #expect(landed.ids == ["c1"])
        chat.teardown()
    }

    /// The server's own word that the answer failed: nothing landed.
    @Test("An error chunk reports nothing")
    func errorChunkReportsNothing() async {
        let (chat, landed) = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(ByteStream(
            "data: {\"type\":\"start\",\"messageId\":\"m1\"}\n\n"
                + "data: {\"type\":\"error\",\"errorText\":\"[internal] Model unavailable\"}\n\n"
        ))

        #expect(chat.sendError != nil)
        #expect(landed.ids.isEmpty)
        chat.teardown()
    }

    /// A 200 with no chunk at all goes to recovery; the answer has not landed
    /// yet, and only the collected one may be reported.
    @Test("An empty stream reports nothing while recovery collects it")
    func emptyStreamReportsNothing() async {
        let (chat, landed) = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(ByteStream(""))

        #expect(chat.isRecovering)
        #expect(landed.ids.isEmpty)
        chat.teardown()
    }

    /// Without a hook (iOS, whose notice is the server's push) a finished
    /// answer behaves exactly as before.
    @Test("No hook, no change to a finished answer")
    func noHookIsInert() async {
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        let chat = ChatViewModel(api: api, settings: SettingsStore())
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")

        await chat.consume(ByteStream(Self.finishedAnswer))

        #expect(chat.status == .idle)
        #expect(chat.sendError == nil)
        #expect(!chat.isRecovering)
        chat.teardown()
    }
}
