import Foundation

/// Folds a sequence of `UIMessageChunk`s into a `UIMessage`.
///
/// The AI SDK's `useChat` does this in TypeScript; there is no Swift transport,
/// so this is the one genuinely new piece of the port. It is kept a pure value
/// type on purpose: the whole protocol is exercised by unit tests over recorded
/// chunk sequences rather than only by watching answers appear on screen.
struct UIMessageAccumulator: Sendable {
    private(set) var message: UIMessage
    /// Set when the server sends an `error` chunk mid-stream.
    private(set) var errorText: String?
    private(set) var isAborted = false

    /// Index of each part within `message.parts`, keyed by its stream id, so
    /// deltas append to the right part when several interleave across steps.
    private var textIndex: [String: Int] = [:]
    private var reasoningIndex: [String: Int] = [:]
    private var toolIndex: [String: Int] = [:]
    /// Raw JSON text accumulated from `tool-input-delta`, parsed on completion.
    private var toolInputBuffer: [String: String] = [:]

    init(id: String = "", role: UIMessage.Role = .assistant) {
        message = UIMessage(id: id, role: role)
    }

    mutating func apply(_ chunk: UIMessageChunk) {
        switch chunk {
        case .start(let messageId):
            // The server generates the assistant id (see the comment on
            // `generateMessageId` in `src/app/api/ask-question/route.ts` — an empty
            // id once collapsed every exchange onto one persisted row).
            if let messageId, !messageId.isEmpty { message.id = messageId }

        case .startStep, .finishStep, .finish:
            break

        case .abort:
            isAborted = true

        case .error(let text):
            errorText = text

        // MARK: Text

        case .textStart(let id):
            appendText(id: id, delta: "")

        case .textDelta(let id, let delta):
            appendText(id: id, delta: delta)

        case .textEnd:
            break

        // MARK: Reasoning

        case .reasoningStart(let id):
            appendReasoning(id: id, delta: "")

        case .reasoningDelta(let id, let delta):
            appendReasoning(id: id, delta: delta)

        case .reasoningEnd:
            break

        // MARK: Tools

        case .toolInputStart(let toolCallId, let toolName):
            upsertTool(toolCallId) { part in
                part.toolName = toolName
                part.state = .inputStreaming
            }

        case .toolInputDelta(let toolCallId, let delta):
            toolInputBuffer[toolCallId, default: ""] += delta

        case .toolInputAvailable(let toolCallId, let toolName, let input):
            toolInputBuffer[toolCallId] = nil
            upsertTool(toolCallId) { part in
                if !toolName.isEmpty { part.toolName = toolName }
                part.state = .inputAvailable
                part.input = input
            }

        case .toolOutputAvailable(let toolCallId, let output):
            upsertTool(toolCallId) { part in
                part.state = .outputAvailable
                part.output = output
            }

        // MARK: Attachments & sources

        case .file(let url, let mediaType, let filename):
            message.parts.append(.file(FilePart(url: url, mediaType: mediaType, filename: filename)))

        case .sourceURL, .sourceDocument, .data, .unknown:
            // Not rendered by any SureWord client; the shared backend emits web
            // results through the `webSearch` tool output instead.
            break
        }
    }

    // MARK: - Part upserts

    private mutating func appendText(id: String, delta: String) {
        if let index = textIndex[id], case .text(let partID, let existing) = message.parts[index] {
            message.parts[index] = .text(id: partID, text: existing + delta)
        } else {
            textIndex[id] = message.parts.count
            message.parts.append(.text(id: id, text: delta))
        }
    }

    private mutating func appendReasoning(id: String, delta: String) {
        if let index = reasoningIndex[id], case .reasoning(let partID, let existing) = message.parts[index] {
            message.parts[index] = .reasoning(id: partID, text: existing + delta)
        } else {
            reasoningIndex[id] = message.parts.count
            message.parts.append(.reasoning(id: id, text: delta))
        }
    }

    private mutating func upsertTool(_ toolCallId: String, _ mutate: (inout ToolPart) -> Void) {
        if let index = toolIndex[toolCallId], var part = message.parts[index].toolPart {
            mutate(&part)
            message.parts[index] = .tool(part)
        } else {
            var part = ToolPart(toolCallId: toolCallId, toolName: "", state: .inputStreaming)
            mutate(&part)
            toolIndex[toolCallId] = message.parts.count
            message.parts.append(.tool(part))
        }
    }
}

// MARK: - SSE

/// Splits an SSE byte stream into the payload of each `data:` field.
///
/// Per the SSE spec an event may carry several `data:` lines, joined with
/// newlines and dispatched on the blank line that terminates the event. The AI
/// SDK emits one line per event today, but honouring the general rule costs
/// nothing and avoids a silent truncation if that ever changes.
enum ServerSentEvents {
    static func payloads(
        from lines: some AsyncSequence<String, any Error> & Sendable
    ) -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var buffer: [String] = []

                func flush() {
                    guard !buffer.isEmpty else { return }
                    continuation.yield(buffer.joined(separator: "\n"))
                    buffer.removeAll()
                }

                do {
                    for try await line in lines {
                        if line.isEmpty {
                            flush()
                        } else if line.hasPrefix("data:") {
                            var value = line.dropFirst("data:".count)
                            // A single leading space after the colon is part of
                            // the framing, not the payload.
                            if value.hasPrefix(" ") { value = value.dropFirst() }
                            buffer.append(String(value))
                        }
                        // `event:`, `id:`, `retry:` and comments are unused here.
                    }
                    flush()
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

extension UIMessageChunk {
    /// Decode a live response body into chunks.
    static func stream(
        from lines: some AsyncSequence<String, any Error> & Sendable
    ) -> AsyncThrowingStream<UIMessageChunk, any Error> {
        let payloads = ServerSentEvents.payloads(from: lines)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await payload in payloads {
                        if let chunk = UIMessageChunk.decode(payload: payload) {
                            continuation.yield(chunk)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
