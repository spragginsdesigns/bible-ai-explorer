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
        /// Request sent, stream not open yet — drives the typing indicator.
        case submitted
        case streaming
    }

    /// What the editor needs to know when the assistant writes into the note.
    struct AppendEvent: Sendable, Equatable {
        var noteID: String
        var appendedHTML: String
    }

    private(set) var status: Status = .idle
    private(set) var historyLoading = false
    private(set) var error: String?

    var input = ""

    private var uiMessages: [UIMessage] = []

    private let api: APIClient
    private let notes: NotesAPI
    private let noteID: String
    /// Fired once per `addToNote` tool call, live or restored-but-new.
    var onNoteAppended: (@MainActor (AppendEvent) -> Void)?

    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var appliedToolCallIDs: Set<String> = []

    init(noteID: String, api: APIClient) {
        self.noteID = noteID
        self.api = api
        self.notes = NotesAPI(api: api)
    }

    // MARK: - Derived

    var isStreaming: Bool { status == .streaming }
    var isBusy: Bool { status != .idle || historyLoading }

    var messages: [ChatViewMessage] {
        let lastAssistantID = uiMessages.last { $0.role == .assistant }?.id
        var views = uiMessages.map { message in
            ChatViewMessage(
                message: message,
                isStreaming: status != .idle
                    && message.role == .assistant
                    && message.id == lastAssistantID
            )
        }
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
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    // MARK: - History

    /// Restore the persisted conversation. Past appends are already part of the
    /// stored note, so their tool calls are marked applied — without that,
    /// reopening the panel would re-insert every verse the assistant ever wrote.
    func loadHistory() async {
        guard uiMessages.isEmpty, !historyLoading else { return }
        historyLoading = true
        defer { historyLoading = false }
        do {
            let restored = try await notes.aiMessages(noteId: noteID)
            for call in Self.addToNoteCalls(in: restored) {
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
        do {
            try await notes.clearAIMessages(noteId: noteID)
        } catch {
            self.error = (error as? APIError)?.message ?? "The conversation could not be cleared."
            return
        }
        error = nil
        stop()
        uiMessages = []
        appliedToolCallIDs.removeAll()
    }

    // MARK: - Sending

    /// Handles the note slash commands before anything reaches the model —
    /// `/suggest` and `/clear` are local, `/verse` is sent verbatim because the
    /// backend system prompt already teaches the model to carry it out.
    func submit() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        if let parsed = SlashCommand.parse(text, in: SlashCommand.note) {
            if parsed.command.requiresArgs, parsed.args.isEmpty { return }
            input = ""
            switch parsed.command.localAction {
            case .suggest:
                await send(SlashCommand.suggestVersesPrompt)
            case .clearNoteChat:
                await clearHistory()
            default:
                await send(parsed.args.isEmpty
                    ? parsed.command.command
                    : "\(parsed.command.command) \(parsed.args)")
            }
            return
        }

        input = ""
        await send(text)
    }

    func suggestVerses() async {
        await send(SlashCommand.suggestVersesPrompt)
    }

    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isBusy else { return }

        error = nil
        uiMessages.append(
            UIMessage(
                id: "user-\(UUID().uuidString)",
                role: .user,
                parts: [.text(id: "0", text: trimmed)]
            )
        )
        status = .submitted
        startStream()
    }

    func retry() async {
        guard status == .idle else { return }
        error = nil
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

    private func startStream() {
        streamTask?.cancel()
        let request = NoteAIRequest(messages: uiMessages.map(\.json), noteId: noteID)

        streamTask = Task { [weak self] in
            guard let self else { return }
            do {
                let bytes = try await api.stream("/api/note-ai", body: request)
                // Deliberately NOT `bytes.lines` — Foundation drops the blank
                // lines that terminate each SSE event, which silently reduces the
                // whole answer to nothing. See `ServerSentEvents.lines(from:)`.
                await consume(bytes)
            } catch {
                // A cancelled URLSession surfaces as an NSURLError rather than a
                // CancellationError, so catching only the latter would show an
                // error every time the user pressed Stop.
                if !Task.isCancelled {
                    self.error = (error as? APIError)?.message ?? error.localizedDescription
                }
                status = .idle
            }
        }
    }

    /// Fold the response body into the conversation, one chunk at a time.
    ///
    /// Takes **bytes**, not lines: `URLSession.AsyncBytes.lines` discards empty
    /// lines, and the empty line is what terminates an SSE event, so feeding it
    /// here dispatched no event at all — the panel showed the user's question and
    /// then nothing until it was reopened and the persisted reply loaded. Same
    /// entry point `ChatViewModel` uses. Not `private` so the recorded-stream
    /// regression test can replay a real response through this exact path.
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
                emitAppends()
            }
        } catch {
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
        status = .idle
        emitAppends()
    }

    static let emptyStreamError =
        "The answer stream ended before anything arrived. Retry to ask again."

    // MARK: - addToNote

    struct AddToNoteCall: Equatable {
        var toolCallID: String
        var noteID: String
        var appendedHTML: String
    }

    /// Fire each append exactly once, keyed by tool call id.
    private func emitAppends() {
        for call in Self.addToNoteCalls(in: uiMessages) where !appliedToolCallIDs.contains(call.toolCallID) {
            appliedToolCallIDs.insert(call.toolCallID)
            onNoteAppended?(AppendEvent(noteID: call.noteID, appendedHTML: call.appendedHTML))
        }
    }

    /// Pure reduction over messages, so it stays off the main actor and can be
    /// tested without one.
    nonisolated static func addToNoteCalls(in messages: [UIMessage]) -> [AddToNoteCall] {
        var calls: [AddToNoteCall] = []
        for message in messages where message.role == .assistant {
            for part in message.parts {
                guard
                    let tool = part.toolPart,
                    tool.type == "tool-addToNote",
                    tool.state == .outputAvailable,
                    let output = tool.output,
                    let noteID = output["noteId"]?.stringValue,
                    let appendedHTML = output["appendedHtml"]?.stringValue
                else { continue }
                calls.append(
                    AddToNoteCall(
                        toolCallID: tool.toolCallId,
                        noteID: noteID,
                        appendedHTML: appendedHTML
                    )
                )
            }
        }
        return calls
    }
}
