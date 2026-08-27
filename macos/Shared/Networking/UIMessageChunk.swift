import Foundation

/// One decoded frame of the AI SDK's UI Message Stream protocol (v1), as served
/// by `POST /api/ask-question` via `createUIMessageStreamResponse`.
///
/// The stream is SSE: each event is a `data:` line holding one JSON object with a
/// `type` discriminator, and the stream ends with the literal `data: [DONE]`.
/// Unrecognised types decode to `.unknown` rather than failing — the server can
/// add chunk types (the SDK already emits several this client ignores) and a hard
/// decode error there would kill a live answer mid-sentence.
enum UIMessageChunk: Sendable, Equatable {
    case start(messageId: String?)
    case startStep
    case finishStep
    case finish
    case abort(reason: String?)
    case error(text: String)

    case textStart(id: String)
    case textDelta(id: String, delta: String)
    case textEnd(id: String)

    case reasoningStart(id: String)
    case reasoningDelta(id: String, delta: String)
    case reasoningEnd(id: String)

    case toolInputStart(toolCallId: String, toolName: String)
    case toolInputDelta(toolCallId: String, delta: String)
    case toolInputAvailable(toolCallId: String, toolName: String, input: JSONValue)
    case toolOutputAvailable(toolCallId: String, output: JSONValue)

    case file(url: String, mediaType: String, filename: String?)
    case sourceURL(sourceId: String, url: String)
    case sourceDocument(sourceId: String, mediaType: String, title: String?)
    /// `data-<name>`. A part that carries an `id` replaces the previous part
    /// with that id (the status line does exactly this).
    ///
    /// `transient` is the AI SDK's own flag for a part that is delivered to the
    /// UI but never becomes part of the message: it is not stored on the message
    /// and never persisted. Decoding it is what lets the accumulator honour that
    /// - folding a transient part into `parts` would leave it on screen after
    /// the turn finished and replay it on the next question.
    case data(name: String, id: String?, value: JSONValue, transient: Bool)

    case unknown(type: String)
}

extension UIMessageChunk {
    /// Decode one SSE `data:` payload. Returns `nil` for the `[DONE]` sentinel
    /// and for anything that isn't a JSON object.
    static func decode(payload: String) -> UIMessageChunk? {
        let trimmed = payload.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != "[DONE]" else { return nil }
        guard
            let data = trimmed.data(using: .utf8),
            let value = try? JSONDecoder().decode(JSONValue.self, from: data),
            let type = value["type"]?.stringValue
        else { return nil }
        return decode(type: type, from: value)
    }

    private static func decode(type: String, from value: JSONValue) -> UIMessageChunk {
        func string(_ key: String) -> String? { value[key]?.stringValue }

        switch type {
        case "start":
            return .start(messageId: string("messageId"))
        case "start-step":
            return .startStep
        case "finish-step":
            return .finishStep
        case "finish":
            return .finish
        case "abort":
            return .abort(reason: string("reason"))
        case "error":
            return .error(text: string("errorText") ?? "Something went wrong.")

        case "text-start":
            return .textStart(id: string("id") ?? "")
        case "text-delta":
            return .textDelta(id: string("id") ?? "", delta: string("delta") ?? "")
        case "text-end":
            return .textEnd(id: string("id") ?? "")

        case "reasoning-start":
            return .reasoningStart(id: string("id") ?? "")
        case "reasoning-delta":
            return .reasoningDelta(id: string("id") ?? "", delta: string("delta") ?? "")
        case "reasoning-end":
            return .reasoningEnd(id: string("id") ?? "")

        case "tool-input-start":
            return .toolInputStart(
                toolCallId: string("toolCallId") ?? "",
                toolName: string("toolName") ?? ""
            )
        case "tool-input-delta":
            return .toolInputDelta(
                toolCallId: string("toolCallId") ?? "",
                delta: string("inputTextDelta") ?? ""
            )
        case "tool-input-available":
            return .toolInputAvailable(
                toolCallId: string("toolCallId") ?? "",
                toolName: string("toolName") ?? "",
                input: value["input"] ?? .null
            )
        case "tool-output-available":
            return .toolOutputAvailable(
                toolCallId: string("toolCallId") ?? "",
                output: value["output"] ?? .null
            )

        case "file":
            return .file(
                url: string("url") ?? "",
                mediaType: string("mediaType") ?? "",
                filename: string("filename")
            )
        case "source-url":
            return .sourceURL(sourceId: string("sourceId") ?? "", url: string("url") ?? "")
        case "source-document":
            return .sourceDocument(
                sourceId: string("sourceId") ?? "",
                mediaType: string("mediaType") ?? "",
                title: string("title")
            )

        default:
            // `data-*` carries app-defined payloads; everything else is a chunk
            // type this client doesn't render.
            if type.hasPrefix("data-") {
                return .data(
                    name: String(type.dropFirst("data-".count)),
                    id: string("id"),
                    value: value["data"] ?? .null,
                    // Absent means false - the SureWord route writes its status
                    // line without the flag today.
                    transient: value["transient"]?.boolValue ?? false
                )
            }
            return .unknown(type: type)
        }
    }
}
