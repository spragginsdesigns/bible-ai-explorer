import Foundation
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

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
    /// True while the answer is being collected from the server after a lost
    /// connection. The UI keeps showing the typing indicator rather than an
    /// error — nothing has actually failed yet.
    private(set) var isRecovering = false

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

    // MARK: Answer recovery

    /// The conversation still owed an answer. Set when a send goes out, cleared
    /// the moment the stream finishes on its own — or the moment the answer is
    /// collected after it didn't.
    private var pendingAnswerConversationID: String?
    private var recoveryTask: Task<Void, Never>?
    /// Bumped for every recovery, so a superseded poll cannot clear the state
    /// of the one that replaced it.
    private var recoveryVersion = 0
    private var resumeCheckTask: Task<Void, Never>?
    /// When the stream last produced anything - a stalled stream shows as old.
    private var lastStreamActivity = Date.distantPast
#if os(macOS) || os(iOS)
    /// `nonisolated(unsafe)` because `deinit` and `teardown` are nonisolated and
    /// have to drop the token. Written once in `init` and read only where the
    /// observer is removed, so there is no concurrent access for the compiler to
    /// be protecting.
    @ObservationIgnored private nonisolated(unsafe) var resumeObserver: (any NSObjectProtocol)?
    /// The centre the observer was registered on - `NSWorkspace`'s on macOS,
    /// `.default` on iOS - kept so it can be unregistered from the same place.
    @ObservationIgnored private nonisolated(unsafe) var resumeCenter: NotificationCenter?
#endif

    init(api: APIClient, settings: SettingsStore) {
        self.api = api
        self.settings = settings
        self.uploader = AttachmentUploader(api: api)

#if os(macOS)
        // **Waking, not activating.** `NSApplication.didBecomeActiveNotification`
        // fires on every ⌘-Tab back to the app, and a resume that acts cancels
        // the stream - so a user who glances at another window during a long
        // tool call would lose a perfectly healthy answer, and the server (which
        // cannot tell a dropped socket from a deliberate stop) would then push a
        // spurious "your answer is ready". Sleep is what actually kills the
        // socket on a Mac, and `NSWorkspace` is the only place that event is
        // published.
        let center = NSWorkspace.shared.notificationCenter
        let resumeNotification = NSWorkspace.didWakeNotification
#elseif os(iOS)
        // iOS suspends the app's sockets outright, so returning to the
        // foreground is the genuine resume event there - the same trigger the
        // Android client uses (`AppState` "active").
        let center = NotificationCenter.default
        let resumeNotification = UIApplication.didBecomeActiveNotification
#endif
#if os(macOS) || os(iOS)
        resumeCenter = center
        resumeObserver = center.addObserver(
            forName: resumeNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.systemDidResume() }
        }
#endif
    }

#if os(macOS) || os(iOS)
    deinit { removeResumeObserver() }

    private nonisolated func removeResumeObserver() {
        if let resumeObserver { resumeCenter?.removeObserver(resumeObserver) }
        resumeObserver = nil
        resumeCenter = nil
    }
#endif

    /// Drop everything this model owns. Called when the session ends: signing
    /// out releases `AppModel`, but a running recovery poll would otherwise keep
    /// the view model alive and keep asking `/api/conversations` with a token
    /// that is now dead - every 401 pair reporting another auth failure.
    func teardown() {
        stop()
#if os(macOS) || os(iOS)
        removeResumeObserver()
#endif
    }

    // MARK: Derived

    var isStreaming: Bool { status == .streaming }
    /// Recovery counts as busy: the answer is still coming, so the composer
    /// stays disabled and the indicator stays up.
    var isBusy: Bool { status != .idle || isRecovering }

    var activeConversation: Conversation? {
        conversations.first { $0.id == activeConversationID }
    }

    /// The id of the assistant answer that is being written *right now*, if any.
    ///
    /// Only a message at the very end of the list can be the one streaming.
    /// Taking "the newest assistant message" instead is wrong for the whole
    /// window between pressing send and the first chunk arriving: the list is
    /// then `[… , settled answer, new user turn]`, `isBusy` is already true, and
    /// the *previous, finished* answer gets flipped back into a streaming one.
    /// That silently tore its follow-up chips and its "Add to notes" button off
    /// an answer already on screen, and re-ran its markdown through the
    /// streaming normalizer, for the length of every send after the first.
    /// (Cosmetic on its own: it was *not* what hung the second send - see the
    /// scroll comment in `ChatView.messageList` for that - but it is a real
    /// glitch and it made the same transaction do far more layout work.)
    static func streamingAssistantID(in messages: [UIMessage], isBusy: Bool) -> String? {
        guard isBusy, let last = messages.last, last.role == .assistant else { return nil }
        return last.id
    }

    /// The render list. Only the *last* assistant message is treated as
    /// streaming, so earlier ones keep their settled follow-ups and cards.
    var messages: [ChatViewMessage] {
        let streamingID = Self.streamingAssistantID(in: uiMessages, isBusy: isBusy)
        var views = uiMessages
            .map { message in
                ChatViewMessage(message: message, isStreaming: message.id == streamingID)
            }
            .filter(\.hasRenderableContent)

        // Before the stream opens there is no assistant message yet — stand in
        // with a typing indicator so the send feels acknowledged. A recovery
        // that began before any text arrived is the same situation.
        if status == .submitted || isRecovering, views.last?.role == .user {
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

    /// A send is only recoverable once the conversation exists — recovery works
    /// by reading that conversation back. A text-only message whose conversation
    /// failed to create still streams; it just has nothing to be collected from.
    private func markAnswerPending() {
        pendingAnswerConversationID = activeConversationID
        lastStreamActivity = Date()
    }

    /// Put the model in exactly the state a real send leaves behind: the
    /// conversation exists, the user turn is on screen, and an answer is owed.
    ///
    /// Internal purely as a test seam, in the same spirit as `consume` above.
    /// Every piece of state it writes is private and only `send()` produces this
    /// combination in production, so the failure and resume paths would
    /// otherwise be reachable only through a live server.
    func seedPendingSend(conversationID: String, question: String, status: Status = .submitted) {
        activeConversationID = conversationID
        uiMessages = [
            UIMessage(id: "user-seed", role: .user, parts: [.text(id: "0", text: question)])
        ]
        self.status = status
        markAnswerPending()
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

    /// Stopping is deliberate: the user no longer wants this answer, so the
    /// recovery poll must not go and fetch it behind their back.
    func stop() {
        cancelStream()
        cancelRecovery()
    }

    private func cancelStream() {
        streamTask?.cancel()
        streamTask = nil
        if status != .idle { status = .idle }
    }

    /// Internal rather than private so `AppModel` can end the poll on sign-out.
    func cancelRecovery() {
        recoveryTask?.cancel()
        recoveryTask = nil
        resumeCheckTask?.cancel()
        resumeCheckTask = nil
        pendingAnswerConversationID = nil
        isRecovering = false
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
        markAnswerPending()
        let request = AskQuestionRequest(
            messages: uiMessages.compactMap(\.outgoingJSON),
            conversationId: activeConversationID,
            translation: settings.translation.rawValue,
            modelId: settings.chatModelId,
            effort: settings.chatEffort,
            speed: settings.chatSpeed,
            verbosity: settings.chatVerbosity,
            mode: settings.chatMode
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
                status = .idle
                if !Task.isCancelled {
                    reportStreamFailure(
                        (error as? APIError)?.message ?? error.localizedDescription,
                        recoverable: AnswerRecovery.isTransportFailure(error)
                    )
                }
            }
        }
    }

    /// Internal rather than private so the tests can drive it with a recorded or
    /// malformed body directly — `startStream` is the only production caller.
    func consume(_ bytes: some AsyncSequence<UInt8, any Error> & Sendable) async {
        var accumulator = UIMessageAccumulator(id: "assistant-\(UUID().uuidString)")
        var appended = false
        var failure: (message: String, recoverable: Bool)?

        do {
            for try await chunk in UIMessageChunk.stream(fromBytes: bytes) {
                try Task.checkCancellation()
                accumulator.apply(chunk)
                lastStreamActivity = Date()

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
                failure = (
                    (error as? APIError)?.message ?? error.localizedDescription,
                    AnswerRecovery.isTransportFailure(error)
                )
            }
        }

        status = .idle

        if let errorText = accumulator.errorText {
            // The server said the answer failed, so there is nothing to collect
            // — unlike a dropped connection, this is the final word.
            pendingAnswerConversationID = nil
            sendError = errorText
            return
        }
        if let failure {
            reportStreamFailure(failure.message, recoverable: failure.recoverable)
            return
        }
        if !appended, !Task.isCancelled {
            // A 200 whose body yielded no chunk at all is a broken answer, not an
            // empty one. Saying so beats the silent dead end that the SSE framing
            // bug produced for every single message.
            //
            // An abort needs no test here: `appended` flips on the *first* decoded
            // chunk, `abort` included, so reaching this branch means nothing was
            // decoded at all and the stream cannot have been aborted.
            //
            // The server may well still be writing that answer, so this goes
            // through recovery like any other lost connection.
            reportStreamFailure(Self.emptyStreamError, recoverable: true)
            return
        }
        // A stream that finished on its own owes nothing.
        if !Task.isCancelled { pendingAnswerConversationID = nil }
    }

    // MARK: Answer recovery

    /// A **broken connection** is a collection job, not a failure to show the
    /// user: the route drains its own copy of the SSE stream and persists the
    /// finished answer even when this client stops listening.
    ///
    /// Anything the server actually said is the opposite - see
    /// `AnswerRecovery.isTransportFailure`. `APIClient.stream` throws
    /// `APIError.server(status:)` for every non-2xx, and a non-2xx means the
    /// route never ran: the question was never persisted, so no answer is coming
    /// and the poll could only end, 150 seconds later, in a misleading "we
    /// couldn't retrieve that answer". Show those immediately, and drop the
    /// pending marker with them. Recovery also covers the cases with no `Error`
    /// to classify - an empty or non-SSE body - which the caller flags.
    private func reportStreamFailure(_ message: String, recoverable: Bool) {
        guard recoverable, let conversationID = pendingAnswerConversationID else {
            pendingAnswerConversationID = nil
            sendError = message
            return
        }
        collectPendingAnswer(conversationID)
    }

    /// Poll the conversation until the finished answer appears, then swap it in
    /// as if the stream had never broken. Only gives up once the server's own
    /// budget has run out, at which point asking again is the honest option.
    private func collectPendingAnswer(_ conversationID: String) {
        guard !isRecovering else { return }
        recoveryTask?.cancel()
        recoveryVersion += 1
        let version = recoveryVersion
        isRecovering = true
        sendError = nil

        let policy = AnswerRecoveryPolicy(
            startedAt: Date(),
            expectedUserMessages: uiMessages.count { $0.role == .user }
        )
        // Captured instead of reached through `self`: the loop must not hold the
        // view model across its sleep. It did, and that outlived sign-out - the
        // model `AppModel` had already released kept polling with a token that
        // was dead for the rest of the 150-second budget, reporting an auth
        // failure on every 401 pair.
        let api = api
        recoveryTask = Task { [weak self] in
            // The version guard is what keeps a poll that has been superseded
            // from clearing state belonging to the send that replaced it.
            defer { self?.finishRecovery(version) }

            while !Task.isCancelled {
                // Nothing left to restore into: stop rather than poll on behalf
                // of a model nobody is showing any more.
                guard self != nil else { return }

                // Offline or a transient failure is not terminal - it is the
                // very case this exists for - so a nil payload keeps polling.
                let payload = try? await api.json(
                    "/api/conversations/\(conversationID)",
                    as: JSONValue.self
                )
                guard !Task.isCancelled else { return }

                // `self` is bound only inside this block, so the strong
                // reference is gone again before the sleep below.
                var nextWait: Duration?
                if let self {
                    guard version == recoveryVersion, activeConversationID == conversationID
                    else { return }

                    switch policy.step(at: Date(), payload: payload) {
                    case .restore(let rows):
                        uiMessages = rows.compactMap(UIMessage.init(storedRow:))
                        sendError = nil
                        return
                    case .giveUp:
                        sendError = AnswerRecovery.exhaustedError
                        return
                    case .wait(let interval):
                        nextWait = interval
                    }
                } else {
                    return
                }

                guard let nextWait else { return }
                try? await Task.sleep(for: nextWait)
            }
        }
    }

    private func finishRecovery(_ version: Int) {
        guard version == recoveryVersion else { return }
        isRecovering = false
        recoveryTask = nil
        pendingAnswerConversationID = nil
    }

    /// The machine woke (macOS) or the app returned to the foreground (iOS)
    /// while an answer was still owed.
    ///
    /// **The rule: never cancel a stream that is still receiving.** Sleep and
    /// suspension do kill sockets, but they also merely stall them, and a
    /// stalled stream usually resumes on its own. So this waits out
    /// `resumeGrace` and then acts only in the two cases
    /// `shouldCollectOnResume` allows - a stream task that already failed or
    /// ended while still owing an answer, or an open one that has produced
    /// nothing for `staleStreamGrace` (45s), a gap no healthy answer produces
    /// even through a slow tool call. Getting this wrong is not a no-op: tearing
    /// down a live stream loses the answer *and* makes the server send a
    /// spurious "your answer is ready" push.
    ///
    /// Internal so the tests can drive the check without a real notification.
    func systemDidResume() {
        guard let conversationID = pendingAnswerConversationID, !isRecovering else { return }
        resumeCheckTask?.cancel()
        resumeCheckTask = Task { [weak self] in
            try? await Task.sleep(for: AnswerRecovery.resumeGrace)
            guard let self, !Task.isCancelled else { return }
            guard
                AnswerRecovery.shouldCollectOnResume(
                    pendingConversationID: pendingAnswerConversationID,
                    expecting: conversationID,
                    isRecovering: isRecovering,
                    isStreamOpen: status != .idle,
                    sinceLastStreamActivity: .seconds(Date().timeIntervalSince(lastStreamActivity))
                )
            else { return }
            cancelStream()
            collectPendingAnswer(conversationID)
        }
    }

    static let historyLoadError =
        "We couldn't load this conversation. Retry to restore its context, or start a new chat."

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."
}
