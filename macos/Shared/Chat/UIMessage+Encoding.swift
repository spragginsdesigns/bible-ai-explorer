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
            // `data-*` parts are deliberately dropped. They narrate one turn's
            // wait and nothing else: the route strips them before persisting
            // (`persistableParts` in src/lib/ai/status-narration.ts), and
            // `validateUIMessages` is called without data schemas, so replaying
            // one would risk a 400 on the next question for no gain.
            "parts": .array(parts.compactMap(\.json)),
        ]
        if let metadata { object["metadata"] = metadata }
        return .object(object)
    }
}

/// An assistant turn worth replaying, or `nil`.
///
/// A turn whose only part was `data-status` narration encodes as `parts: []`
/// once the `data-*` parts are dropped, and an assistant message with no parts
/// is not a turn - it is the residue of one. Sending it back means asking
/// `validateUIMessages` to accept an empty assistant message and asking the
/// model to continue from a blank reply; skipping it costs nothing, because
/// every part it ever held was narration the server strips anyway.
///
/// `json` itself stays total, because history restore and the note assistant
/// encode individual messages by hand.
extension UIMessage {
    var outgoingJSON: JSONValue? {
        if role == .assistant, parts.allSatisfy({ $0.json == nil }) { return nil }
        return json
    }
}

extension UIMessagePart {
    /// `nil` for parts that must not be sent back to the server — see the note
    /// in `UIMessage.json`.
    var json: JSONValue? {
        switch self {
        case .data:
            nil

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
    /// The Auto chip's stored sentinel.
    ///
    /// Auto and "never chose" are different requests and must look different
    /// on the wire. An **absent** `effort` means "no opinion, apply the
    /// account's stored default"; an **explicit null** means "no reasoning
    /// override for this turn". Swift has one nil for both, so the store keeps
    /// this sentinel for Auto and `encode(to:)` turns it into the null.
    ///
    /// It is never sent as a string: `"auto"` is not in the server's effort
    /// vocabulary and would be discarded by `isReasoningEffort`.
    static let autoEffort = "auto"

    var messages: [JSONValue]
    var conversationId: String?
    var translation: String
    /// Model picker's choice, nil for the account default.
    var modelId: String?
    /// Reasoning-effort override. The server's vocabulary is
    /// `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`;
    /// `autoEffort` encodes as null, and nil omits the key entirely.
    var effort: String?
    /// Service tier (`standard` / `fast`). Nil means the user never chose, and
    /// the server then applies the account's stored default - it does *not*
    /// mean "standard", which is sent verbatim when it is picked.
    var speed: String?
    /// Answer length (`low` / `medium` / `high`), same nil rule as `speed`.
    var verbosity: String?
    /// Reasoning mode (`standard` / `pro`), same nil rule as `speed`.
    var mode: String?

    private enum CodingKeys: String, CodingKey {
        case messages, conversationId, translation, modelId, effort, speed, verbosity, mode
    }

    /// Written out rather than synthesized for exactly one reason: `effort`
    /// needs three states where Swift's synthesis offers two. Every other field
    /// encodes precisely as the synthesized version did - non-optionals with
    /// `encode`, optionals with `encodeIfPresent`, so nil stays an absent key.
    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(messages, forKey: .messages)
        try container.encodeIfPresent(conversationId, forKey: .conversationId)
        try container.encode(translation, forKey: .translation)
        try container.encodeIfPresent(modelId, forKey: .modelId)
        if effort == Self.autoEffort {
            try container.encodeNil(forKey: .effort)
        } else {
            try container.encodeIfPresent(effort, forKey: .effort)
        }
        try container.encodeIfPresent(speed, forKey: .speed)
        try container.encodeIfPresent(verbosity, forKey: .verbosity)
        try container.encodeIfPresent(mode, forKey: .mode)
    }
}
