import Foundation

/// Per-note AI conversation — a port of
/// `mobile/src/features/notes/useNoteAI.ts`.
///
/// Same relationship to the AI SDK as `ChatViewModel`: the TS clients get this
/// loop from `useChat`, and there is no Swift transport, so the send/stream
/// cycle is written against `POST /api/note-ai` and reuses the shared
/// `UIMessageAccumulator` and `ChatViewMessage` reduction.
@MainActor
@Observable
final class NoteAIModel {
    enum Status: Sendable, Equatable {
        case idle
        case preparing, stopping, checking
        /// Request sent, stream not open yet — drives the typing indicator.
        case submitted
        case streaming
    }

    /// What the editor needs to know when the assistant writes into the note.
    struct ChangeEvent: Sendable, Equatable {
        var noteID: String
    }

    private(set) var status: Status = .idle
    private(set) var historyLoading = false
    private(set) var error: String?

    var input = ""

    private var uiMessages: [UIMessage] = []

    private let api: APIClient
    private let notes: NotesAPI
    private let noteID: String
    private let store: NotesStore
    private let sessionEpoch: UUID
    var beforeSend: (@MainActor (NotesStore.AIAttempt) async -> Bool)?
    var canPrepare: (@MainActor () -> Bool)?
    var onResponseStarted: (@MainActor (String, String) -> Void)?
    var onAttemptFinished: (@MainActor (String, Bool) async -> Bool)?
    var onRecoveryRequested: (@MainActor () async -> Bool)?
    private(set) var needsReconciliation = false
    private var activeAttempt: NotesStore.AIAttempt?
    private var streamGeneration = UUID()
    private var stoppedPresentation: [ChatViewMessage]?
    var retryActionTitle: String { needsReconciliation ? "Check note" : "Try again" }
    /// A successful append or rewrite of the open note, once per tool call.
    /// The editor reloads the server's canonical document for either mutation.
    var onNoteChanged: (@MainActor (ChangeEvent) -> Void)?

    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var appliedToolCallIDs: Set<String> = []

    init(noteID: String, api: APIClient, store: NotesStore = .shared) {
        self.noteID = noteID
        self.api = api
        self.notes = NotesAPI(api: api)
        self.store = store
        self.sessionEpoch = store.epoch
    }

    /// Keep the editor alive while an AI stream drains, without retaining a
    /// SwiftUI view (whose State also owns this assistant).
    func bindEditor(_ editor: NoteEditorModel) {
        let identity = noteID
        beforeSend = { [editor] in await editor.prepareForAI($0) }
        canPrepare = { [editor] in editor.allowsUserEditing }
        onResponseStarted = { [editor] in editor.noteAIResponseStarted(attemptID: $0, responseID: $1) }
        onAttemptFinished = { [editor] in await editor.noteAIFinished(attemptID: $0, terminal: $1) }
        onRecoveryRequested = { [editor] in await editor.retryCanonicalCheck() }
        onNoteChanged = { [editor, identity] event in
            guard event.noteID == identity else { return }
            editor.noteDidChangeFromAI()
        }
    }

    // MARK: - Derived

    var isStreaming: Bool { status == .streaming }
    var isBusy: Bool { status != .idle || historyLoading }

    var messages: [ChatViewMessage] {
        guard store.isCurrent(sessionEpoch) else { return [] }
        if let stoppedPresentation { return stoppedPresentation }
        // Same rule as the chat: only a *trailing* assistant message streams,
        // so a settled answer keeps its rendering while the next send is
        // in flight (`ChatViewModel.streamingAssistantID`).
        let streamingID = ChatViewModel.streamingAssistantID(in: uiMessages, isBusy: status != .idle)
        var views = uiMessages
            .map { message in
                ChatViewMessage(message: message, isStreaming: message.id == streamingID)
            }
            .filter(\.hasRenderableContent)
        if status == .submitted, views.last?.role == .user {
            views.append(
                ChatViewMessage(id: "pending-assistant", role: .assistant, content: "", isStreaming: true)
            )
        }
        return views
    }

    var suggestions: [SlashCommand] {
        SlashCommand.matching(input, in: SlashCommand.note)
    }

    var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy && !needsReconciliation && beforeSend != nil && canPrepare?() != false && store.isCurrent(sessionEpoch)
    }

    // MARK: - History

    /// Restored writes are already part of the stored note. Mark their calls
    /// applied so reopening the panel never replays an old change notification.
    func loadHistory() async {
        guard store.isCurrent(sessionEpoch), uiMessages.isEmpty, !historyLoading else { return }
        historyLoading = true
        defer { historyLoading = false }
        do {
            let restored = try await notes.aiMessages(noteId: noteID)
            guard store.isCurrent(sessionEpoch) else { return }
            for call in Self.noteChangeCalls(in: restored) {
                appliedToolCallIDs.insert(call.toolCallID)
            }
            uiMessages = restored
        } catch {
            // An unreadable history must not block a new conversation.
        }
    }

    /// Clear the server copy first: wiping local state before the DELETE would
    /// leave a failed clear looking like a fresh conversation.
    func clearHistory() async {
        guard store.isCurrent(sessionEpoch), !isBusy, !needsReconciliation, canPrepare?() != false else {
            error = "Check the saved note before clearing this conversation."
            return
        }
        status = .checking
        defer { status = .idle }
        do {
            try await notes.clearAIMessages(noteId: noteID)
            guard store.isCurrent(sessionEpoch) else { return }
        } catch {
            self.error = (error as? APIError)?.message ?? "The conversation could not be cleared."
            return
        }
        error = nil
        uiMessages = []
        stoppedPresentation = nil
        appliedToolCallIDs.removeAll()
    }

    // MARK: - Sending

    /// Handles the note slash commands before anything reaches the model —
    /// `/suggest` and `/clear` are local, `/verse` is sent verbatim because the
    /// backend system prompt already teaches the model to carry it out.
    func submit() async {
        let original = input
        let text = original.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if let parsed = SlashCommand.parse(text, in: SlashCommand.note) {
            if parsed.command.requiresArgs, parsed.args.isEmpty { return }
            if parsed.command.localAction == .clearNoteChat {
                await clearHistory()
                if error == nil, input == original { input = "" }
                return
            }
            let outgoing = parsed.command.localAction == .suggest ? SlashCommand.suggestVersesPrompt
                : (parsed.args.isEmpty ? parsed.command.command : "\(parsed.command.command) \(parsed.args)")
            if await send(outgoing), input == original { input = "" }
        } else if await send(text), input == original {
            input = ""
        }
    }

    func suggestVerses() async { _ = await send(SlashCommand.suggestVersesPrompt) }

    @discardableResult
    func send(_ text: String) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isBusy, !needsReconciliation, store.isCurrent(sessionEpoch), canPrepare?() != false else { return false }
        guard let beforeSend, await AIConsentGate.ensure(), store.isCurrent(sessionEpoch), !isBusy else { return false }
        let userID = "user-\(UUID().uuidString)"
        let attempt = NotesStore.AIAttempt(id: UUID().uuidString, userMessageID: userID, operationProtocol: .operationReceipt)
        status = .preparing
        guard await beforeSend(attempt), store.isCurrent(sessionEpoch) else { status = .idle; return false }
        activeAttempt = attempt
        stoppedPresentation = nil
        error = nil
        uiMessages.append(UIMessage(id: userID, role: .user, parts: [.text(id: "0", text: trimmed)]))
        status = .submitted
        startStream()
        return true
    }

    func didReconcileNote() {
        guard store.isCurrent(sessionEpoch), !isBusy, canPrepare?() != false else { return }
        needsReconciliation = false
        activeAttempt = nil
        error = nil
    }

    func retry() async {
        guard store.isCurrent(sessionEpoch), !isBusy else { return }
        if needsReconciliation {
            status = .checking
            if await onRecoveryRequested?() ?? false {
                needsReconciliation = false
                activeAttempt = nil
                error = nil
            }
            status = .idle
            return
        }
        guard let beforeSend, canPrepare?() != false, await AIConsentGate.ensure(), store.isCurrent(sessionEpoch), !isBusy else { return }
        var retryMessages = uiMessages
        if retryMessages.last?.role == .assistant { retryMessages.removeLast() }
        guard let question = retryMessages.last, question.role == .user else { return }
        let attempt = NotesStore.AIAttempt(id: UUID().uuidString, userMessageID: question.id, operationProtocol: .operationReceipt)
        status = .preparing
        guard await beforeSend(attempt), store.isCurrent(sessionEpoch) else { status = .idle; return }
        activeAttempt = attempt
        uiMessages = retryMessages
        stoppedPresentation = nil
        error = nil
        status = .submitted
        startStream()
    }

    /// Stop presentation, not the server receipt drain. A disconnected server
    /// may still commit a tool, so editing stays locked until reconciliation.
    func stop() {
        guard isBusy, status != .preparing else { return }
        if stoppedPresentation == nil {
            stoppedPresentation = messages.map { message in
                var settled = message
                settled.isStreaming = false
                settled.activity = nil
                return settled
            }
        }
        status = .stopping
    }

    private func startStream() {
        guard let attempt = activeAttempt else { return }
        let generation = UUID()
        streamGeneration = generation
        let request = NoteAIRequest(messages: uiMessages.compactMap(\.outgoingJSON), noteId: noteID, operationId: attempt.id)
        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                let reservation = try await notes.reserveAIOperation(request)
                guard store.isCurrent(sessionEpoch), streamGeneration == generation else { return }
                guard reservation.state == .reserved else {
                    self.error = "This AI request could not be started. Check the saved note before trying again."
                    await reconcileAttempt(terminal: false)
                    return
                }
                let bytes = try await api.stream("/api/note-ai", body: request)
                guard store.isCurrent(sessionEpoch), streamGeneration == generation else { return }
                await consume(bytes, generation: generation)
            } catch {
                guard store.isCurrent(sessionEpoch), streamGeneration == generation else { return }
                self.error = (error as? APIError)?.message ?? error.localizedDescription
                // A 5xx or a lost reserve response can hide a server write.
                // Only an operation cancellation receipt can settle that risk.
                await reconcileAttempt(terminal: false)
            }
        }
    }

    private func reconcileAttempt(terminal: Bool) async {
        guard store.isCurrent(sessionEpoch) else { return }
        if let attempt = activeAttempt {
            status = .checking
            let reconciled = await onAttemptFinished?(attempt.id, terminal) ?? false
            guard store.isCurrent(sessionEpoch), activeAttempt?.id == attempt.id else { return }
            needsReconciliation = !reconciled
            if reconciled { activeAttempt = nil }
        }
        status = .idle
        streamTask = nil
    }

    /// Fold the response body into the conversation, one chunk at a time.
    ///
    /// Takes **bytes**, not lines: `URLSession.AsyncBytes.lines` discards empty
    /// lines, and the empty line is what terminates an SSE event, so feeding it
    /// here dispatched no event at all — the panel showed the user's question and
    /// then nothing until it was reopened and the persisted reply loaded. Same
    /// entry point `ChatViewModel` uses. Not `private` so the recorded-stream
    /// regression test can replay a real response through this exact path.
    func consume(_ bytes: some AsyncSequence<UInt8, any Error> & Sendable, generation: UUID? = nil) async {
        var accumulator = UIMessageAccumulator(id: "assistant-\(UUID().uuidString)")
        var appended = false
        var receivedFinish = false
        var transportFailed = false

        do {
            for try await chunk in UIMessageChunk.stream(fromBytes: bytes, includingEnd: true) {
                try Task.checkCancellation()
                guard store.isCurrent(sessionEpoch), generation == nil || generation == streamGeneration else { return }
                if case .streamEnd = chunk {
                    receivedFinish = true
                    continue
                }
                if case .finish = chunk { receivedFinish = true }
                if case .start(let responseID) = chunk, let responseID, let attempt = activeAttempt {
                    activeAttempt?.responseMessageID = responseID
                    onResponseStarted?(attempt.id, responseID)
                }
                accumulator.apply(chunk)

                if appended {
                    uiMessages[uiMessages.count - 1] = accumulator.message
                } else {
                    uiMessages.append(accumulator.message)
                    appended = true
                }
                if stoppedPresentation == nil, status != .streaming { status = .streaming }
                emitNoteChanges()
            }
        } catch {
            transportFailed = true
            if !Task.isCancelled {
                self.error = (error as? APIError)?.message ?? error.localizedDescription
            }
        }

        if let errorText = accumulator.errorText {
            self.error = errorText
        } else if !appended, !accumulator.isAborted, !Task.isCancelled, error == nil {
            // A 200 whose body yielded no chunk at all is a broken answer, not an
            // empty one. Saying so beats the silent dead end the SSE framing bug
            // produced — the panel simply stopped, with no card to retry from.
            error = Self.emptyStreamError
        }
        guard store.isCurrent(sessionEpoch), generation == nil || generation == streamGeneration else { return }
        emitNoteChanges()
        // The SDK also writes DONE after an execute error. That does not
        // establish successful completion of every possible server-side write.
        let terminal = receivedFinish && !transportFailed && !accumulator.isAborted
            && accumulator.errorText == nil && !Task.isCancelled
        await reconcileAttempt(terminal: terminal)
    }

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."

    // MARK: - Note writes

    struct NoteChangeCall: Equatable {
        var toolCallID: String
        var noteID: String
    }

    /// Only a completed server tool result can refresh the open note. Prose
    /// claiming a write, in-flight calls, and writes to another note cannot.
    private func emitNoteChanges() {
        for call in Self.noteChangeCalls(in: uiMessages)
        where call.noteID == noteID && !appliedToolCallIDs.contains(call.toolCallID) {
            appliedToolCallIDs.insert(call.toolCallID)
            onNoteChanged?(ChangeEvent(noteID: call.noteID))
        }
    }

    /// Pure reduction over messages, so it stays off the main actor and can be
    /// tested without one.
    nonisolated static func noteChangeCalls(in messages: [UIMessage]) -> [NoteChangeCall] {
        var calls: [NoteChangeCall] = []
        for message in messages where message.role == .assistant {
            for part in message.parts {
                guard
                    let tool = part.toolPart,
                    tool.state == .outputAvailable,
                    let output = tool.output,
                    output["error"] == nil,
                    let noteID = output["noteId"]?.stringValue,
                    !noteID.isEmpty,
                    !tool.toolCallId.isEmpty
                else { continue }
                switch tool.type {
                case "tool-addToNote":
                    guard output["appendedHtml"]?.stringValue != nil else { continue }
                case "tool-updateNote":
                    // A rewrite returns ids and word counts, not appendedHtml.
                    guard output["noteTitle"]?.stringValue != nil,
                          output["wordCount"]?.doubleValue != nil,
                          output["previousWordCount"]?.doubleValue != nil
                    else { continue }
                default:
                    continue
                }
                calls.append(NoteChangeCall(toolCallID: tool.toolCallId, noteID: noteID))
            }
        }
        return calls
    }
}
