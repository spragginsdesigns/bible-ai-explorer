import Foundation
import Testing
@testable import SureWord

/// Copy / Edit / Try again on chat messages (2026-10-08). The server deletes
/// every stored row after a user message that is sent again under its own id,
/// so what matters here is the thread each action sends: cut at the right
/// message, same id, files and metadata kept.
@Suite("Chat message actions")
@MainActor
struct ChatMessageActionsTests {

    /// A recorded SSE body, delivered byte by byte as `consume` reads it.
    struct ByteStream: AsyncSequence, Sendable {
        typealias Element = UInt8
        let bytes: [UInt8]
        init(_ text: String) { bytes = Array(text.utf8) }

        struct Iterator: AsyncIteratorProtocol {
            let bytes: [UInt8]
            var index = 0
            // Throwing, so the sequence's failure type is `any Error`, which is
            // what `consume` accepts.
            mutating func next() async throws -> UInt8? {
                guard index < bytes.count else { return nil }
                defer { index += 1 }
                return bytes[index]
            }
        }

        func makeAsyncIterator() -> Iterator { Iterator(bytes: bytes) }
    }

    private func makeViewModel() -> ChatViewModel {
        // The client is never called: nothing here opens a stream.
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        return ChatViewModel(api: api, settings: SettingsStore())
    }

    private static let file = UIMessagePart.file(
        FilePart(url: "https://blob.example/clip.jpg", mediaType: "image/jpeg", filename: "clipboard-1.jpg")
    )

    private static let thread: [UIMessage] = [
        UIMessage(
            id: "u1",
            role: .user,
            parts: [file, .text(id: "0", text: "Is it ethical to charge for an app?")],
            metadata: .object(["attachmentIds": .array([.string("att-1")])])
        ),
        UIMessage(id: "a1", role: .assistant, parts: [.text(id: "0", text: "Scripture says...")]),
        UIMessage(id: "u2", role: .user, parts: [.text(id: "0", text: "And selling the data?")]),
        UIMessage(id: "a2", role: .assistant, parts: [.text(id: "0", text: "No.")]),
    ]

    // MARK: Edit

    @Test("An edit cuts the thread at the message and keeps its id, files and metadata")
    func editCutsAndKeeps() throws {
        let edited = try #require(
            ChatViewModel.editedThread(Self.thread, editing: "u1", text: "  Is it right to charge?  ")
        )
        #expect(edited.map(\.id) == ["u1"])
        let message = edited[0]
        #expect(message.role == .user)
        #expect(message.parts == [Self.file, .text(id: "0", text: "Is it right to charge?")])
        #expect(message.metadata == Self.thread[0].metadata)
        // What actually goes over the wire: same id, attachment ids intact.
        let wire = try #require(message.outgoingJSON)
        #expect(wire["id"]?.stringValue == "u1")
        #expect(wire["metadata"]?["attachmentIds"]?.arrayValue?.first?.stringValue == "att-1")
    }

    @Test("Editing a later message keeps everything before it")
    func editLaterMessage() throws {
        let edited = try #require(ChatViewModel.editedThread(Self.thread, editing: "u2", text: "What about ads?"))
        #expect(edited.map(\.id) == ["u1", "a1", "u2"])
        #expect(edited[2].parts == [.text(id: "0", text: "What about ads?")])
    }

    @Test("An edit may clear the text of a files-only message, never of a text-only one")
    func emptyEdits() {
        // The files still carry the message.
        let filesOnly = ChatViewModel.editedThread(Self.thread, editing: "u1", text: "   ")
        #expect(filesOnly?.first?.parts == [Self.file])
        // Nothing would be left to send.
        #expect(ChatViewModel.editedThread(Self.thread, editing: "u2", text: "") == nil)
        // Answers are not editable, and an unknown id is nothing.
        #expect(ChatViewModel.editedThread(Self.thread, editing: "a1", text: "x") == nil)
        #expect(ChatViewModel.editedThread(Self.thread, editing: "nope", text: "x") == nil)
    }

    // MARK: Try again

    @Test("Try again drops the newest answer and ends at its question")
    func retryThread() {
        #expect(ChatViewModel.retryThread(Self.thread)?.map(\.id) == ["u1", "a1", "u2"])
        #expect(ChatViewModel.retryThread(Array(Self.thread.prefix(3))) == nil)
        #expect(ChatViewModel.retryThread([Self.thread[1]]) == nil)
        #expect(ChatViewModel.retryThread([]) == nil)
    }

    // MARK: Composer state

    private func settledChat() async -> ChatViewModel {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")
        let raw = "data: {\"type\":\"start\",\"messageId\":\"msg_1\"}\n\n" +
            "data: {\"type\":\"text-start\",\"id\":\"0\"}\n\n" +
            "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"King of Salem.\"}\n\n" +
            "data: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n"
        await chat.consume(ByteStream(raw))
        return chat
    }

    @Test("Edit loads the message into the composer and Cancel restores the draft")
    func beginAndCancelEdit() async {
        let chat = await settledChat()
        #expect(chat.status == .idle)
        chat.input = "half a thought"

        #expect(chat.canEdit("user-seed"))
        chat.beginEdit("user-seed")
        #expect(chat.isEditing)
        #expect(chat.editingMessageID == "user-seed")
        #expect(chat.input == "Who is Melchizedek?")
        #expect(chat.canSend)

        chat.cancelEdit()
        #expect(!chat.isEditing)
        #expect(chat.input == "half a thought")

        // An answer is not a message the user wrote.
        let answerID = chat.messages.last?.id ?? ""
        #expect(!chat.canEdit(answerID))
        chat.beginEdit(answerID)
        #expect(!chat.isEditing)
        chat.teardown()
    }

    // MARK: replaces

    /// The server deletes only the rows a request names in `replaces`, and
    /// refuses a turn when a stored row after the target is not named.
    @Test("Edit names every message after the edited one; Try again everything after the newest question")
    func replacesIDs() {
        #expect(ChatViewModel.idsAfter(Self.thread, "u1") == ["a1", "u2", "a2"])
        #expect(ChatViewModel.idsAfter(Self.thread, "u2") == ["a2"])
        #expect(ChatViewModel.idsAfter(Self.thread, "a2") == [])
        #expect(ChatViewModel.idsAfter(Self.thread, "missing") == [])
        #expect(ChatViewModel.idsAfterLastUser(Self.thread) == ["a2"])
        // A thread ending on the question (a failed answer) drops nothing.
        #expect(ChatViewModel.idsAfterLastUser(Array(Self.thread.prefix(3))) == [])
        #expect(ChatViewModel.idsAfterLastUser([]) == [])
    }

    private func encoded(_ request: AskQuestionRequest) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(request))
    }

    @Test("An ordinary send omits replaces; a re-send carries exactly the dropped ids")
    func requestBodyCarriesReplaces() async throws {
        let chat = await settledChat()
        let ordinary = try encoded(chat.askRequest())
        #expect(ordinary["replaces"] == nil)

        let answerID = try #require(chat.retryableAnswerID)
        let retry = try encoded(chat.askRequest(replaces: ChatViewModel.idsAfterLastUser([
            UIMessage(id: "user-seed", role: .user),
            UIMessage(id: answerID, role: .assistant),
        ])))
        #expect(retry["replaces"]?.arrayValue?.compactMap(\.stringValue) == [answerID])
        // An empty list is still sent: it means "delete nothing, refuse if
        // the server holds something after the question".
        let empty = try encoded(chat.askRequest(replaces: []))
        #expect(empty["replaces"]?.arrayValue?.isEmpty == true)
        chat.teardown()
    }

    @Test("Recovery never collects an answer the turn is replacing")
    func recoveryRefusesStaleAnswer() throws {
        let body = try JSONDecoder().decode(JSONValue.self, from: Data("""
        {"messages": [
          {"id": "u1", "role": "user", "content": "Who?"},
          {"id": "a-old", "role": "assistant", "content": "The old answer."}
        ]}
        """.utf8))
        #expect(AnswerRecovery.completedHistory(body)?.count == 2)
        #expect(AnswerRecovery.completedHistory(body, staleAnswerIDs: ["a-old"]) == nil)
        #expect(AnswerRecovery.completedHistory(body, staleAnswerIDs: ["other"])?.count == 2)

        let policy = AnswerRecoveryPolicy(startedAt: Date(), expectedUserMessages: 1, staleAnswerIDs: ["a-old"])
        if case .restore = policy.step(at: Date(), payload: body) {
            Issue.record("restored the answer being replaced")
        }
    }

    // MARK: stale_thread

    private static let staleText =
        "[stale_thread] This conversation changed on another device. Reload it and try again."

    @Test("A refused edit classifies as stale_thread, prefix stripped, retryable")
    func staleThreadClassifies() {
        let error = ChatErrors.classify(text: Self.staleText)
        #expect(error.code == .staleThread)
        #expect(error.title == "This chat changed")
        #expect(error.message == "This conversation changed on another device. Reload it and try again.")
        #expect(error.retryable)
        #expect(ChatErrorCode(serverCode: "stale_thread") == .staleThread)
    }

    /// Resending would be refused for ever, so the retry reloads the thread
    /// from the server instead (the same path as the history Retry).
    @Test("Retry after stale_thread reloads the conversation instead of resending")
    func staleThreadRetryReloads() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")
        let raw = "data: {\"type\":\"error\",\"errorText\":\"\(Self.staleText)\"}\n\ndata: [DONE]\n\n"
        await chat.consume(ByteStream(raw))
        #expect(chat.sendError?.code == .staleThread)

        await chat.retrySend()

        // The reload ran: the thread was cleared for the fresh copy (the
        // GET fails against example.invalid, which surfaces as a history
        // error), and no stream was started for a resend.
        #expect(chat.sendError == nil)
        #expect(chat.activeConversationID == "c1")
        #expect(chat.historyError != nil)
        #expect(chat.status == .idle)
        #expect(chat.messages.isEmpty)
        chat.teardown()
    }

    @Test("Only the newest settled answer can be asked again")
    func retryableAnswer() async {
        let chat = await settledChat()
        #expect(chat.retryableAnswerID == chat.messages.last?.id)
        #expect(chat.retryableAnswerID != nil)
        chat.teardown()
    }

    @Test("Nothing is editable or retryable while an answer is in flight")
    func busyBlocksActions() {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        #expect(chat.isBusy)
        #expect(!chat.canEdit("user-seed"))
        #expect(chat.retryableAnswerID == nil)
        chat.beginEdit("user-seed")
        #expect(!chat.isEditing)
        chat.teardown()
    }

    @Test("A new chat drops an open edit and gives the draft back")
    func newConversationCancelsEdit() async {
        let chat = await settledChat()
        chat.input = "draft"
        chat.beginEdit("user-seed")
        chat.newConversation()
        #expect(!chat.isEditing)
        #expect(chat.input == "draft")
        chat.teardown()
    }
}
