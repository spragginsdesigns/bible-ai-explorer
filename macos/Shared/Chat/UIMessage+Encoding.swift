import Foundation

extension UIMessage {
    /// Serialise back into the AI SDK's wire shape for `POST /api/ask-question`.
    ///
    /// The route runs `validateUIMessages` over this, so the part shapes must
    /// match what the SDK itself would have sent — including prior assistant
    /// tool parts, which the Android client also replays on every turn to keep
    /// the model's tool history intact.
    var json: JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id),
            "role": .string(role.rawValue),
            "parts": .array(parts.map(\.json)),
        ]
        if let metadata { object["metadata"] = metadata }
        return .object(object)
    }
}

extension UIMessagePart {
    var json: JSONValue {
        switch self {
        case .text(_, let text):
            .object(["type": .string("text"), "text": .string(text)])

        case .reasoning(_, let text):
            .object(["type": .string("reasoning"), "text": .string(text)])

        case .file(let file):
            .object([
                "type": .string("file"),
                "filename": .string(file.filename ?? ""),
                "mediaType": .string(file.mediaType),
                "url": .string(file.url),
            ])

        case .tool(let tool):
            .object(
                [
                    "type": .string(tool.type),
                    "toolCallId": .string(tool.toolCallId),
                    "state": .string(tool.state.rawValue),
                ]
                .merging(
                    [
                        "input": tool.input,
                        "output": tool.output,
                    ].compactMapValues { $0 },
                    uniquingKeysWith: { current, _ in current }
                )
            )
        }
    }
}

/// Request body for `POST /api/ask-question`, matching the Android client's
/// `prepareSendMessagesRequest`.
struct AskQuestionRequest: Encodable {
    var messages: [JSONValue]
    var conversationId: String?
    var translation: String
    /// Model picker's choice, nil for the account default.
    var modelId: String?
    /// Reasoning-effort override (`low` / `medium` / `high`), nil for Auto.
    var effort: String?
}
