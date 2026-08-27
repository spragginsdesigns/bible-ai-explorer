import Foundation

struct Conversation: Sendable, Equatable, Identifiable, Codable {
    var id: String
    var title: String
    var createdAt: String
}

/// Chat state and the send/stream loop — a port of
/// `mobile/src/features/chat/useSureWordChat.ts`, which stands in for the AI
/// SDK's `useChat` (there is no Swift equivalent). Covers the whole Chat
/// section of `docs/PARITY.md`, file attachments included.
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

    /// Files uploaded and waiting to ride on the next message.
    private(set) var fileAttachments: [ChatAttachmentDescriptor] = []
    private(set) var uploadingAttachments = false
    private(set) var attachmentError: String?
    /// Raised by `/history` and by ⌘K; the shell presents the picker.
    var isHistoryPresented = false

    private var uiMessages: [UIMessage] = []

    // MARK: Collaborators

    private let api: APIClient
    private let settings: SettingsStore
    private let uploader: AttachmentUploader
    private var streamTask: Task<Void, Never>?
    /// Guards against a slow history load landing after the user moved on.
    private var historyLoadVersion = 0
    /// Bumped whenever the draft is abandoned, so an upload that lands afterwards
    /// deletes itself instead of attaching to a conversation the user has left.
    private var attachmentDraftVersion = 0

    init(api: APIClient, settings: SettingsStore) {
        self.api = api
        self.settings = settings
        self.uploader = AttachmentUploader(api: api)
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

    /// Files alone are a valid message — the model is asked to look at them.
    var canSend: Bool {
        let composed = VerseAttachment.compose(input, attachment: attachment)
        return (!composed.isEmpty || !fileAttachments.isEmpty)
            && !isBusy
            && !uploadingAttachments
            && !historyLoading
            && historyError == nil
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
        discardStagedAttachments()
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
        discardStagedAttachments()
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

    // MARK: File attachments

    /// Stage local files: validate, upload, and hold the descriptors for the next
    /// message. Port of `addLocalAttachments`.
    func addAttachments(_ files: [LocalAttachment]) async {
        guard !files.isEmpty, !uploadingAttachments else { return }
        let draftVersion = attachmentDraftVersion
        attachmentError = nil

        do {
            try AttachmentValidator.validateBatch(files, existing: fileAttachments)
            uploadingAttachments = true
            defer { uploadingAttachments = false }

            let completed = try await uploader.upload(files)
            if draftVersion != attachmentDraftVersion {
                // The user started a new chat while this was in flight; the files
                // would otherwise sit in Blob storage forever, uncounted.
                await uploader.deleteAll(completed.map(\.id))
            } else {
                fileAttachments.append(contentsOf: completed)
            }
        } catch let error as AttachmentError {
            attachmentError = error.message
        } catch {
            attachmentError = (error as? APIError)?.message ?? "Could not upload the selected files."
        }
    }

    /// Read files off disk and stage them. Used by the picker and by drag-and-drop.
    func addAttachments(fileURLs urls: [URL]) async {
        var files: [LocalAttachment] = []
        do {
            for url in urls {
                // Harmless with the sandbox off, and correct if it is ever turned on.
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }

                guard let data = try? Data(contentsOf: url) else {
                    throw AttachmentError(
                        message: "\(url.lastPathComponent) is empty or unreadable."
                    )
                }
                files.append(
                    try AttachmentValidator.normalize(
                        filename: url.lastPathComponent,
                        declaredMediaType: "",
                        data: data
                    )
                )
            }
        } catch let error as AttachmentError {
            attachmentError = error.message
            return
        } catch {
            attachmentError = "Could not open the file picker."
            return
        }
        await addAttachments(files)
    }

    func removeAttachment(_ id: String) async {
        do {
            try await uploader.delete(id)
            fileAttachments.removeAll { $0.id == id }
        } catch {
            attachmentError = "Could not remove the attachment."
        }
    }

    func clearAttachmentError() {
        attachmentError = nil
    }

    /// Abandon the staged draft, deleting anything already uploaded.
    private func discardStagedAttachments() {
        attachmentDraftVersion += 1
        let staged = fileAttachments
        fileAttachments = []
        // A verse attachment is part of the abandoned draft too. Clearing it
        // here prevents Daily Cross provenance from crossing a chat switch.
        attachment = nil
        attachmentError = nil
        guard !staged.isEmpty else { return }
        let uploader = uploader
        Task { await uploader.deleteAll(staged.map(\.id)) }
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
        let origin = attachment?.origin
        attachment = nil

        let sending = fileAttachments

        // Create the conversation first so the server can persist the exchange.
        if activeConversationID == nil {
            let title = composed.isEmpty
                ? "Attachment: \(sending.first?.filename ?? "New chat")"
                : composed
            await createConversation(titledAfter: title)

            // `/api/ask-question` rejects attachments without a conversation, so
            // unlike a text-only message this failure is fatal — sending anyway
            // would 400 and lose the files.
            if activeConversationID == nil, !sending.isEmpty {
                sendError = "Could not create the conversation. Retry to send your files."
                return
            }
        }

        attachmentDraftVersion += 1
        fileAttachments = []

        var parts: [UIMessagePart] = sending.map {
            .file(FilePart(url: $0.previewUrl, mediaType: $0.mediaType, filename: $0.filename))
        }
        if !composed.isEmpty { parts.append(.text(id: "0", text: composed)) }

        var metadata: [String: JSONValue] = [:]
        if let origin { metadata["origin"] = origin.json }
        if !sending.isEmpty {
            metadata["attachmentIds"] = .array(sending.map { .string($0.id) })
        }

        let userMessage = UIMessage(
            id: "user-\(UUID().uuidString)",
            role: .user,
            parts: parts,
            metadata: metadata.isEmpty ? nil : .object(metadata)
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
            translation: settings.translation.rawValue,
            modelId: settings.chatModelId,
            effort: settings.chatEffort
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

    /// Internal rather than private so the tests can drive it with a recorded or
    /// malformed body directly — `startStream` is the only production caller.
    func consume(_ bytes: some AsyncSequence<UInt8, any Error> & Sendable) async {
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
        } else if !appended, !Task.isCancelled, sendError == nil {
            // A 200 whose body yielded no chunk at all is a broken answer, not an
            // empty one. Saying so beats the silent dead end that the SSE framing
            // bug produced for every single message.
            //
            // An abort needs no test here: `appended` flips on the *first* decoded
            // chunk, `abort` included, so reaching this branch means nothing was
            // decoded at all and the stream cannot have been aborted.
            sendError = Self.emptyStreamError
        }
        status = .idle
    }

    static let historyLoadError =
        "We couldn't load this conversation. Retry to restore its context, or start a new chat."

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."
}
