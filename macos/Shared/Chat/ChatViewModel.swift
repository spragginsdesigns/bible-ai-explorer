import Foundation
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

/// One alert about the history list - Android's `Alert.alert` after a failed
/// delete.
struct HistoryAlert: Identifiable, Equatable, Sendable {
    let id = UUID()
    let title: String
    let message: String
}

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
    private(set) var historyError: ClassifiedChatError?
    /// Classified the way Android's `classifyChatError` does, so the card can
    /// show a title and offer "Try again" only when retrying can help.
    private(set) var sendError: ClassifiedChatError?
    /// Raised by `/clear` while a conversation is open; the shell confirms
    /// with Android's "Delete this conversation?" alert before deleting.
    var isClearConfirmationPresented = false
    /// True while a first send waits for its conversation to be created; the
    /// draft is already off the composer, so this keeps a second tap from
    /// creating a second conversation.
    private(set) var isCreatingConversation = false
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
    /// The upload in flight includes a voice message, which the server
    /// transcribes before answering; the composer says so rather than leaving
    /// "Uploading" on screen for half a minute.
    private(set) var transcribingVoiceMessage = false
    /// While a "/verify <YouTube link>" fetches the video's captions before it
    /// sends: the step it is on, in words for the composer. Nil otherwise.
    private(set) var videoStatus: String?
    private(set) var attachmentError: String?
    /// Set while a chat opened from "Share into SureWord" has not been sent
    /// yet: the notices about anything left out, shown with the two share
    /// actions above the composer. Nil hides the row.
    var shareNotices: [String]?
    /// Raised by `/history` and by ⌘K; the shell presents the picker.
    var isHistoryPresented = false
    /// A history action that failed after the row had already moved (a delete
    /// the server refused). The shells present it as an alert and clear it.
    var historyAlert: HistoryAlert?

    private var uiMessages: [UIMessage] = []

    // MARK: Collaborators

    private let api: APIClient
    private let settings: SettingsStore
    private let uploader: AttachmentUploader
    /// Where a deliberate walk-away is recorded, so the "Your answer is ready"
    /// push the server still sends for it can be suppressed.
    private let stopSignals: ChatStopSignals
    private var streamTask: Task<Void, Never>?
    /// Text of a send that failed before the stream opened (the conversation
    /// could not be created), so Retry can send it again - Android's
    /// `lastFailedSendRef`.
    private var lastFailedSend: String?
    /// Guards against a slow history load landing after the user moved on.
    private var historyLoadVersion = 0
    /// Bumped whenever the draft is abandoned, so an upload that lands afterwards
    /// deletes itself instead of attaching to a conversation the user has left.
    private var attachmentDraftVersion = 0
    /// Per-message rating version, so a slow PATCH cannot undo the thumb that
    /// replaced it. Keyed by message id; see `setFeedback`.
    private var feedbackVersions: [String: Int] = [:]
    /// Public share links minted this session, keyed by message id.
    ///
    /// Kept across a conversation switch on purpose. A message id is unique, so
    /// an entry can never come to name a different answer, and returning to a
    /// conversation leaves the link one tap from the share sheet instead of
    /// re-asking the server for something it already gave us.
    private(set) var sharedLinks: [String: URL] = [:]
    /// Message ids with a share POST in flight.
    private(set) var sharingMessageIDs: Set<String> = []

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

    init(api: APIClient, settings: SettingsStore, stopSignals: ChatStopSignals = .shared) {
        self.api = api
        self.settings = settings
        self.uploader = AttachmentUploader(api: api)
        self.stopSignals = stopSignals

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
            && !isCreatingConversation
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
        shareNotices = nil
        stop()
        historyLoading = false
        historyError = nil
        sendError = nil
        lastFailedSend = nil
        activeConversationID = nil
        uiMessages = []
    }

    func switchConversation(to id: String) async {
        guard id != activeConversationID else { return }
        historyLoadVersion += 1
        discardStagedAttachments()
        shareNotices = nil
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
                historyError = ChatErrors.classify(error, message: Self.historyLoadError)
            }
        }
    }

    func retryHistory() async {
        guard let id = activeConversationID else { return }
        activeConversationID = nil
        await switchConversation(to: id)
    }

    /// Optimistic: the row leaves at once. A failed DELETE puts the server's
    /// list back and raises `historyAlert`, so a chat that was never deleted
    /// does not silently vanish until the next launch (Android 1.76.0,
    /// `deleteConversation` in `useSureWordChat.ts`).
    func deleteConversation(_ id: String) async {
        conversations.removeAll { $0.id == id }
        if activeConversationID == id { newConversation() }
        do {
            try await api.data("/api/conversations/\(id)", method: "DELETE")
        } catch {
            await restoreConversations()
            historyAlert = HistoryAlert(
                title: "Couldn't delete chat",
                message: "It may reappear in your history. Please try again."
            )
        }
    }

    /// Stops at the first failure, restores the server's list and says so -
    /// Android's `clearAllConversations`.
    func clearAllConversations() async {
        let ids = conversations.map(\.id)
        conversations = []
        newConversation()
        for id in ids {
            do {
                try await api.data("/api/conversations/\(id)", method: "DELETE")
            } catch {
                await restoreConversations()
                historyAlert = HistoryAlert(title: "Some chats weren't deleted", message: "Please try again.")
                return
            }
        }
    }

    /// The server's list, after a failed delete. Left alone if that fails too.
    private func restoreConversations() async {
        if let restored = try? await api.json("/api/conversations", as: [Conversation].self) {
            conversations = restored
        }
    }

    /// `MAX_CONVERSATION_TITLE_LENGTH` in `src/lib/conversation-title-rules.ts`;
    /// the PATCH route answers 400 past it.
    static let maxConversationTitleLength = 60

    /// The title the route will store: runs of whitespace collapsed, trimmed.
    static func normalizedConversationTitle(_ raw: String) -> String {
        raw.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// Rename a conversation (`PATCH /api/conversations/:id`), as the Android
    /// history list does. Returns an error line for the sheet, or nil when the
    /// rename landed or there was nothing to change.
    @discardableResult
    func renameConversation(_ id: String, to raw: String) async -> String? {
        let title = Self.normalizedConversationTitle(raw)
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return nil }
        guard !title.isEmpty, title != conversations[index].title else { return nil }
        guard title.count <= Self.maxConversationTitleLength else {
            return "Titles can be up to \(Self.maxConversationTitleLength) characters."
        }
        struct Body: Encodable { let title: String }
        do {
            try await api.data("/api/conversations/\(id)", method: "PATCH", body: Body(title: title))
            if let current = conversations.firstIndex(where: { $0.id == id }) {
                conversations[current].title = title
            }
            return nil
        } catch {
            return "Couldn't rename. Try again."
        }
    }

    // MARK: Answer feedback

    /// Rate one settled assistant answer, or clear its rating with `nil`.
    ///
    /// Optimistic: the thumb fills the moment it is tapped and is put back if
    /// the write fails. The failure text is *returned* rather than written to
    /// `sendError`, because that field renders the retry card whose button
    /// re-asks the question - the shells already own a toast for an action that
    /// failed on its own (the receipts line's `onError`), and a rating belongs
    /// there.
    ///
    /// `reason` and `tags` are carried only with `.down`; the request body drops
    /// them otherwise.
    @discardableResult
    func setFeedback(
        messageID: String,
        feedback: AnswerFeedback?,
        reason: String? = nil,
        tags: [FeedbackTag] = []
    ) async -> String? {
        // A turn whose conversation never got created was never persisted, so
        // there is no row to rate.
        guard let conversationID = activeConversationID,
              let index = uiMessages.firstIndex(where: { $0.id == messageID }),
              uiMessages[index].role == .assistant
        else { return nil }

        let previous = uiMessages[index].feedback
        uiMessages[index].feedback = feedback?.rawValue

        // Same guard shape as `historyLoadVersion` and `recoveryVersion` above:
        // a PATCH that has been superseded must not revert - or re-assert - the
        // rating that replaced it.
        let version = (feedbackVersions[messageID] ?? 0) + 1
        feedbackVersions[messageID] = version

        do {
            try await AnswerFeedbackAPI.setAnswerFeedback(
                api: api,
                conversationID: conversationID,
                messageID: messageID,
                feedback: feedback,
                reason: reason,
                tags: tags
            )
            return nil
        } catch {
            guard feedbackVersions[messageID] == version else { return nil }
            if let index = uiMessages.firstIndex(where: { $0.id == messageID }) {
                uiMessages[index].feedback = previous
            }
            return (error as? APIError)?.message ?? Self.feedbackError
        }
    }

    // MARK: Sharing an answer

    /// The public link already minted for this answer, if any.
    func sharedLink(for messageID: String) -> URL? { sharedLinks[messageID] }

    /// True while this answer's link is being minted, so one bubble's button
    /// goes quiet without disabling the rest of the thread.
    func isSharing(_ messageID: String) -> Bool { sharingMessageIDs.contains(messageID) }

    /// Mint the public link for one settled assistant answer, or re-use the one
    /// the server already holds for it. Returns the failure text, or `nil` once
    /// the URL is in `sharedLinks` and the share sheet has something to offer.
    ///
    /// **Deliberately not optimistic**, unlike `setFeedback` above. A thumb is a
    /// local judgment that can be put back; a link is a capability that does not
    /// exist until the server mints it, and handing someone a URL that 404s is
    /// worse than a moment of spinner. The failure is *returned* rather than
    /// written to `sendError` for the same reason a rating's is: that field
    /// renders the retry card, and the shells already own a toast for an action
    /// that failed on its own.
    ///
    /// Sharing is idempotent server-side, and a repeat call is *not* skipped:
    /// the POST is also what re-activates a link revoked in Settings, so a
    /// cached URL could be a dead one (Android POSTs on every tap too).
    @discardableResult
    func shareAnswer(messageID: String) async -> String? {
        // A turn whose conversation never got created was never persisted, so
        // there is no row to snapshot. Unlike a rating this reports itself: the
        // user pressed a button and is owed an explanation for the nothing.
        guard let conversationID = activeConversationID,
              let index = uiMessages.firstIndex(where: { $0.id == messageID }),
              uiMessages[index].role == .assistant
        else { return Self.shareUnavailableError }

        guard !sharingMessageIDs.contains(messageID) else { return nil }

        sharingMessageIDs.insert(messageID)
        defer { sharingMessageIDs.remove(messageID) }

        do {
            let link = try await api.shareAnswer(
                conversationID: conversationID,
                messageID: messageID
            )
            guard let url = link.shareURL else { return Self.shareError }
            sharedLinks[messageID] = url
            return nil
        } catch {
            return (error as? APIError)?.message ?? Self.shareError
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
            // A voice message is transcribed by OpenAI when its upload
            // completes, so consent is asked before the upload starts.
            if files.contains(where: { AttachmentLimits.isAudio($0.mediaType) }),
               !(await AIConsentGate.ensure()) { return }
            uploadingAttachments = true
            transcribingVoiceMessage = files.contains { AttachmentLimits.isAudio($0.mediaType) }
            defer {
                uploadingAttachments = false
                transcribingVoiceMessage = false
            }

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

    // MARK: Share into SureWord

    /// Open a share as a new chat: text in the composer, files uploaded through
    /// the same path as the picker (audio is transcribed on completion), and
    /// the share actions shown. Port of Android's `startSharedChat`. The caller
    /// waits for any upload already running, which would make this one bail.
    func startSharedChat(_ draft: SharedChatDraft) async {
        newConversation()
        input = draft.text
        shareNotices = draft.notices
        guard !draft.files.isEmpty else { return }
        await addAttachments(draft.files)
    }

    /// "Check against Scripture" / "Help me reply": send the command with
    /// whatever is in the composer, plus the attached files.
    func sendShareAction(_ action: ShareAction) async {
        input = action.message(composerText: input)
        shareNotices = nil
        await send()
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
        let typed = input
        // Android's `submit` parses the trimmed text, newlines included.
        var text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if let parsed = SlashCommand.parse(text) {
            if parsed.command.kind == .local {
                input = ""
                switch parsed.command.localAction {
                case .new:
                    newConversation()
                case .clear:
                    // Deleting is destructive, so it is confirmed first, with
                    // Android's alert. With nothing open it is just a new chat.
                    if activeConversationID != nil {
                        isClearConfirmationPresented = true
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
            // A command that needs an argument waits for one ("keep typing").
            if parsed.command.requiresArgs, parsed.args.isEmpty { return }
            // The model is sent the canonical command with collapsed arguments,
            // exactly the text Android's `runCommand` builds.
            text = SlashCommand.outgoingText(parsed.command, args: parsed.args)
        }

        // Asked before anything is cleared, so "Not now" leaves the draft.
        guard canSend, await AIConsentGate.ensure() else { return }
        let composed = VerseAttachment.compose(text, attachment: attachment)
        guard canSend else { return }

        // "/verify <YouTube link>": read the captions over this device's own
        // connection (YouTube refuses datacenter IPs, so the server cannot) and
        // send them as a text attachment the answer weighs against Scripture.
        // A video that cannot be read never reaches the model: the draft comes
        // back with the reason instead. Matched on the outgoing text, since a
        // pinned verse is composed in front of it.
        var videoAttachment: ChatAttachmentDescriptor?
        var videoTitle: String?
        if let link = VideoTranscript.verifyRequest(text) {
            // New chat, History and a conversation switch stay live during a
            // slow fetch and each bumps the draft version; a send that outlived
            // its draft must not land in whatever chat is open now.
            let draftVersion = attachmentDraftVersion
            let draft = typed
            input = ""
            attachmentError = nil
            uploadingAttachments = true
            videoStatus = "Finding the video..."
            defer {
                uploadingAttachments = false
                videoStatus = nil
            }
            do {
                guard fileAttachments.count < 5 else {
                    throw VideoTranscript.Failure(message: "Remove an attachment to make room for the video's transcript.")
                }
                let transcript = try await VideoTranscript.fetch(link) { [weak self] stage in
                    self?.videoStatus = stage
                }
                guard draftVersion == attachmentDraftVersion else { return }
                videoStatus = VideoTranscript.sendingStatus(lengthSeconds: transcript.lengthSeconds)
                let uploaded = try await uploader.upload([LocalAttachment(
                    filename: VideoTranscript.filename(for: transcript.title),
                    mediaType: "text/plain",
                    data: Data(VideoTranscript.fileText(transcript).utf8)
                )])
                guard draftVersion == attachmentDraftVersion else {
                    let uploader = uploader
                    Task { await uploader.deleteAll(uploaded.map(\.id)) }
                    return
                }
                videoAttachment = uploaded.first
                videoTitle = transcript.title
            } catch {
                guard draftVersion == attachmentDraftVersion else { return }
                input = draft
                attachmentError = (error as? VideoTranscript.Failure)?.message
                    ?? (error as? APIError)?.message
                    ?? "Couldn't get this video's transcript."
                return
            }
        }

        sendError = nil
        lastFailedSend = nil
        input = ""
        let sendingAttachment = attachment
        let origin = attachment?.origin
        attachment = nil

        let sending = fileAttachments + (videoAttachment.map { [$0] } ?? [])

        // Create the conversation first so the server can persist the exchange.
        if activeConversationID == nil {
            let title = videoTitle.map { "Verify: \($0)" }
                ?? (composed.isEmpty
                    ? "Attachment: \(sending.first?.filename ?? "New chat")"
                    : composed)
            do {
                isCreatingConversation = true
                defer { isCreatingConversation = false }
                try await createConversation(titledAfter: title)
            } catch {
                // Never send without a conversation (Android does not either):
                // recovery collects a finished answer *from* the conversation,
                // so a conversationless stream could lose the answer outright,
                // and attachments are refused without one. Put the draft back
                // and remember it, so "Try again" sends it.
                input = typed
                attachment = sendingAttachment
                lastFailedSend = typed
                // "Try again" fetches the video afresh, so this copy would only
                // hold a slot against the attachment cap.
                if let videoAttachment {
                    let uploader = uploader
                    Task { await uploader.deleteAll([videoAttachment.id]) }
                }
                sendError = ChatErrors.classify(error, message: Self.conversationCreateError)
                return
            }
        }

        // Once the shared chat has a message, the share actions are done.
        shareNotices = nil

        attachmentDraftVersion += 1
        fileAttachments = []

        var parts: [UIMessagePart] = sending.map {
            .file(FilePart(
                url: $0.previewUrl,
                mediaType: $0.mediaType,
                filename: $0.filename,
                transcript: $0.transcript,
                durationSeconds: $0.durationSeconds
            ))
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
        guard !isBusy, await AIConsentGate.ensure() else { return }
        // The send never happened (the conversation could not be created), so
        // there is no stream to regenerate - send the original question again.
        if let failed = lastFailedSend, activeConversationID == nil {
            lastFailedSend = nil
            sendError = nil
            if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { input = failed }
            await send()
            return
        }
        sendError = nil
        // Drop a failed assistant turn so the model isn't asked to continue it.
        if uiMessages.last?.role == .assistant { uiMessages.removeLast() }
        guard uiMessages.last?.role == .user else { return }
        status = .submitted
        startStream()
    }

    /// Stopping is deliberate: the user no longer wants this answer, so the
    /// recovery poll must not go and fetch it behind their back.
    ///
    /// Also covers starting a new chat and switching conversations, which both
    /// stop first. The server still finishes and saves the answer and sends
    /// "Your answer is ready" for the dropped connection, so the walk-away is
    /// recorded for the notification handler to suppress (Android's
    /// `abandonPendingAnswer` → `markConversationStopped`).
    func stop() {
        if let conversationID = pendingAnswerConversationID {
            stopSignals.markStopped(conversationID)
        }
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

    private func createConversation(titledAfter text: String) async throws {
        let title = String(text.prefix(60))
        struct NewConversation: Encodable { let title: String }
        let created = try await api.json(
            "/api/conversations",
            method: "POST",
            body: NewConversation(title: title),
            as: Conversation.self
        )
        activeConversationID = created.id
        conversations.insert(created, at: 0)
    }

    /// Delete the open conversation once `/clear` has been confirmed.
    func confirmClear() async {
        isClearConfirmationPresented = false
        guard let id = activeConversationID else { return }
        await deleteConversation(id)
    }

    /// An attachment problem found outside the model (a photo the picker could
    /// not hand over, an empty clipboard), shown in the composer's banner.
    func reportAttachmentError(_ message: String) {
        attachmentError = message
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
                        ChatErrors.classify(error),
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
        var failure: (error: ClassifiedChatError, recoverable: Bool)?

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
                    ChatErrors.classify(error),
                    AnswerRecovery.isTransportFailure(error)
                )
            }
        }

        status = .idle

        if let errorText = accumulator.errorText {
            // The server said the answer failed, so there is nothing to collect
            // — unlike a dropped connection, this is the final word.
            pendingAnswerConversationID = nil
            // A mid-stream `[code] message` chunk, classified like Android.
            sendError = ChatErrors.classify(text: errorText)
            return
        }
        if let failure {
            reportStreamFailure(failure.error, recoverable: failure.recoverable)
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
            reportStreamFailure(
                ChatErrors.build(.internal, serverMessage: nil, override: Self.emptyStreamError),
                recoverable: true
            )
            return
        }
        // A stream that finished on its own owes nothing.
        if !Task.isCancelled {
            pendingAnswerConversationID = nil
            // A settled answer is the moment "your answer is ready" makes
            // sense, so iOS may ask for notification permission now (PRD
            // B6a). Nothing listens on the Mac.
            NotificationPermissionMoments.shared.signal(.firstAnswer)
        }
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
    private func reportStreamFailure(_ error: ClassifiedChatError, recoverable: Bool) {
        guard recoverable, let conversationID = pendingAnswerConversationID else {
            pendingAnswerConversationID = nil
            sendError = error
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
                        sendError = ChatErrors.recoveryExhausted
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
            // The answer is collected here, in the app, so the push the server
            // sends for the connection this drops would only repeat it -
            // Android marks the conversation stopped on this path too.
            stopSignals.markStopped(conversationID)
            cancelStream()
            collectPendingAnswer(conversationID)
        }
    }

    /// Android's `CONVERSATION_CREATE_ERROR`.
    static let conversationCreateError =
        "Couldn't start the conversation. Check your connection and try again."

    static let historyLoadError =
        "We couldn't load this conversation. Retry to restore its context, or start a new chat."

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."

    /// Android's alert bodies (`useSureWordChat.ts`, `MessageBubble.tsx`).
    static let feedbackError =
        "Your rating didn't reach the server. Check your connection and try again."

    static let shareError =
        "The link didn't reach the server. Check your connection and try again."

    static let shareUnavailableError =
        "This answer isn't saved yet, so there's nothing to share."
}
