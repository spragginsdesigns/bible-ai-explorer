import Foundation

struct Conversation: Sendable, Equatable, Identifiable, Codable {
    var id: String
    var title: String
    var createdAt: String
}

/// Chat state and the send/stream loop — a port of
/// `mobile/src/features/chat/useSureWordChat.ts`, which stands in for the AI
/// SDK's `useChat` (there is no Swift equivalent).
///
/// File attachments are deliberately absent here; they arrive with the notes
/// phase. Everything else in the Chat section of `docs/PARITY.md` is covered.
@MainActor
@Observable
final class ChatViewModel {
    enum Status: Sendable, Equatable {
        case idle
        /// Request sent, stream not open yet — drives the typing indicator.
        case submitted
        case streaming
    }

    // MARK: Observable state

    private(set) var conversations: [Conversation] = []
    private(set) var activeConversationID: String?
    private(set) var status: Status = .idle
    private(set) var initialLoading = true
    private(set) var historyLoading = false
    private(set) var historyError: String?
    private(set) var sendError: String?

    /// Draft text, so other screens can prefill it (the Bible reader's "Ask AI").
    var input = ""
    /// Verse or chapter context attached to the next outgoing message.
    var attachment: VerseAttachment?
    /// Raised by `/history` and by ⌘K; the shell presents the picker.
    var isHistoryPresented = false

    private var uiMessages: [UIMessage] = []

    // MARK: Collaborators

    private let api: APIClient
    private let settings: SettingsStore
    private var streamTask: Task<Void, Never>?
    /// Guards against a slow history load landing after the user moved on.
    private var historyLoadVersion = 0

    init(api: APIClient, settings: SettingsStore) {
        self.api = api
        self.settings = settings
    }

    // MARK: Derived

    var isStreaming: Bool { status == .streaming }
    var isBusy: Bool { status != .idle }

    var activeConversation: Conversation? {
        conversations.first { $0.id == activeConversationID }
    }

    /// The render list. Only the *last* assistant message is treated as
    /// streaming, so earlier ones keep their settled follow-ups and cards.
    var messages: [ChatViewMessage] {
        let lastAssistantID = uiMessages.last { $0.role == .assistant }?.id
        var views = uiMessages.map { message in
            ChatViewMessage(
                message: message,
                isStreaming: isBusy && message.role == .assistant && message.id == lastAssistantID
            )
        }

        // Before the stream opens there is no assistant message yet — stand in
        // with a typing indicator so the send feels acknowledged.
        if status == .submitted, views.last?.role == .user {
            views.append(
                ChatViewMessage(id: "pending-assistant", role: .assistant, content: "", isStreaming: true)
            )
        }
        return views
    }

    var canSend: Bool {
        let composed = VerseAttachment.compose(input, attachment: attachment)
        return !composed.isEmpty && !isBusy && !historyLoading && historyError == nil
    }

    // MARK: Conversations

    func loadConversations() async {
        defer { initialLoading = false }
        do {
            conversations = try await api.json("/api/conversations", as: [Conversation].self)
        } catch {
            // Non-fatal: chatting still works without the history list.
        }
    }

    func newConversation() {
        historyLoadVersion += 1
        stop()
        historyLoading = false
        historyError = nil
        sendError = nil
        activeConversationID = nil
        uiMessages = []
    }

    func switchConversation(to id: String) async {
        guard id != activeConversationID else { return }
        historyLoadVersion += 1
        let version = historyLoadVersion

        stop()
        activeConversationID = id
        sendError = nil
        historyError = nil
        historyLoading = true
        uiMessages = []

        defer { if version == historyLoadVersion { historyLoading = false } }

        do {
            let payload = try await api.json("/api/conversations/\(id)", as: JSONValue.self)
            guard version == historyLoadVersion else { return }
            guard let rows = payload["messages"]?.arrayValue else {
                throw APIError(message: "Conversation history response was invalid.")
            }
            uiMessages = rows.compactMap(UIMessage.init(storedRow:))
        } catch {
            if version == historyLoadVersion {
                historyError = Self.historyLoadError
            }
        }
    }

    func retryHistory() async {
        guard let id = activeConversationID else { return }
        activeConversationID = nil
        await switchConversation(to: id)
    }

    func deleteConversation(_ id: String) async {
        conversations.removeAll { $0.id == id }
        if activeConversationID == id { newConversation() }
        // The row is already gone locally; a failed delete resurfaces on reload.
        try? await api.data("/api/conversations/\(id)", method: "DELETE")
    }

    func clearAllConversations() async {
        let ids = conversations.map(\.id)
        conversations = []
        newConversation()
        for id in ids {
            // Keep going so one failure doesn't strand the rest.
            try? await api.data("/api/conversations/\(id)", method: "DELETE")
        }
    }

    // MARK: Sending

    func send() async {
        // Local slash commands never reach the model, and are allowed even when
        // `canSend` is false — `/new` in particular is how you escape a
        // conversation whose history failed to load.
        if let parsed = SlashCommand.parse(input.trimmingCharacters(in: .whitespaces)),
           parsed.command.kind == .local {
            input = ""
            switch parsed.command.localAction {
            case .new:
                newConversation()
            case .clear:
                if let id = activeConversationID {
                    await deleteConversation(id)
                } else {
                    newConversation()
                }
            case .history:
                isHistoryPresented = true
            default:
                break
            }
            return
        }

        let composed = VerseAttachment.compose(input, attachment: attachment)
        guard canSend else { return }

        sendError = nil
        input = ""
        attachment = nil

        // Create the conversation first so the server can persist the exchange.
        if activeConversationID == nil {
            await createConversation(titledAfter: composed)
        }

        let userMessage = UIMessage(
            id: "user-\(UUID().uuidString)",
            role: .user,
            parts: [.text(id: "0", text: composed)]
        )
        uiMessages.append(userMessage)
        status = .submitted

        startStream()
    }

    /// Re-run the last exchange after a failure, matching `retrySend`.
    func retrySend() async {
        guard !isBusy else { return }
        sendError = nil
        // Drop a failed assistant turn so the model isn't asked to continue it.
        if uiMessages.last?.role == .assistant { uiMessages.removeLast() }
        guard uiMessages.last?.role == .user else { return }
        status = .submitted
        startStream()
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
        if status != .idle { status = .idle }
    }

    private func createConversation(titledAfter text: String) async {
        let title = String(text.prefix(60))
        struct NewConversation: Encodable { let title: String }
        do {
            let created = try await api.json(
                "/api/conversations",
                method: "POST",
                body: NewConversation(title: title),
                as: Conversation.self
            )
            activeConversationID = created.id
            conversations.insert(created, at: 0)
        } catch {
            // Non-fatal for text-only messages: the answer still streams, it
            // just isn't persisted. Mirrors the Android client.
        }
    }

    private func startStream() {
        streamTask?.cancel()
        let request = AskQuestionRequest(
            messages: uiMessages.map(\.json),
            conversationId: activeConversationID,
            translation: settings.translation.rawValue
        )

        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                let bytes = try await api.stream("/api/ask-question", body: request)
                // Deliberately NOT `bytes.lines` — Foundation drops the blank
                // lines that terminate each SSE event, which silently reduces the
                // whole answer to nothing. See `ServerSentEvents.lines(from:)`.
                await consume(bytes)
            } catch {
                // A cancelled URLSession surfaces as an NSURLError, not a
                // CancellationError, so catching only the latter would show the
                // user an error banner every time they pressed Stop.
                if !Task.isCancelled {
                    sendError = (error as? APIError)?.message ?? error.localizedDescription
                }
                status = .idle
            }
        }
    }

    private func consume(_ bytes: some AsyncSequence<UInt8, any Error> & Sendable) async {
        var accumulator = UIMessageAccumulator(id: "assistant-\(UUID().uuidString)")
        var appended = false

        do {
            for try await chunk in UIMessageChunk.stream(fromBytes: bytes) {
                try Task.checkCancellation()
                accumulator.apply(chunk)

                if appended {
                    uiMessages[uiMessages.count - 1] = accumulator.message
                } else {
                    uiMessages.append(accumulator.message)
                    appended = true
                }
                if status != .streaming { status = .streaming }
            }
        } catch {
            // Same as above: keep whatever streamed in before a stop, and only
            // report failures the user didn't ask for.
            if !Task.isCancelled {
                sendError = (error as? APIError)?.message ?? error.localizedDescription
            }
        }

        if let errorText = accumulator.errorText {
            sendError = errorText
        } else if !appended, !accumulator.isAborted, !Task.isCancelled, sendError == nil {
            // A 200 whose body yielded no chunk at all is a broken answer, not an
            // empty one. Saying so beats the silent dead end that the SSE framing
            // bug produced for every single message.
            sendError = Self.emptyStreamError
        }
        status = .idle
    }

    static let historyLoadError =
        "We couldn't load this conversation. Retry to restore its context, or start a new chat."

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."
}
