import Foundation

/// The message model the TS clients hold as `UIMessage` from the `ai` package.
/// Kept structurally identical so `ChatViewMessage` can reduce it exactly the way
/// `mobile/src/lib/chatView.ts` does, and so history restored from
/// `metadata.parts` round-trips.
struct UIMessage: Sendable, Equatable, Identifiable {
    enum Role: String, Sendable, Codable {
        case user, assistant
    }

    var id: String
    var role: Role
    var parts: [UIMessagePart] = []
    var metadata: JSONValue?
}

enum UIMessagePart: Sendable, Equatable {
    case text(id: String, text: String)
    case reasoning(id: String, text: String)
    case tool(ToolPart)
    case file(FilePart)
    /// App-defined `data-*` payload. The only one SureWord renders is
    /// `data-status`, the live "Getting ready / Thinking / …" narration the
    /// route writes before the first token (`src/lib/ai/status-narration.ts`).
    case data(DataPart)

    var textContent: String? {
        if case .text(_, let text) = self { return text }
        return nil
    }

    var toolPart: ToolPart? {
        if case .tool(let part) = self { return part }
        return nil
    }

    var filePart: FilePart? {
        if case .file(let part) = self { return part }
        return nil
    }

    var dataPart: DataPart? {
        if case .data(let part) = self { return part }
        return nil
    }
}

/// One `data-*` stream part. `name` is the discriminator's suffix, so
/// `data-status` arrives as `name == "status"` — the same key the TS clients
/// match on in `mobile/src/lib/chatView.ts`.
///
/// `id` is what makes the status line a *line* rather than a growing list: the
/// server reuses the id `"status"` for every write, and both the AI SDK and this
/// accumulator reconcile same-id parts in place.
struct DataPart: Sendable, Equatable {
    var name: String
    var id: String?
    var value: JSONValue

    /// The TS discriminator (`data-status`).
    var type: String { "data-\(name)" }
}

struct FilePart: Sendable, Equatable {
    var url: String
    var mediaType: String
    var filename: String?
}

/// Lifecycle of a tool call, matching the AI SDK's `state` field.
enum ToolState: String, Sendable, Equatable {
    case inputStreaming = "input-streaming"
    case inputAvailable = "input-available"
    case outputAvailable = "output-available"
    case outputError = "output-error"
}

struct ToolPart: Sendable, Equatable {
    var toolCallId: String
    var toolName: String
    var state: ToolState
    var input: JSONValue?
    var output: JSONValue?

    /// The TS discriminator (`tool-searchScripture`). Keeping this shape means the
    /// activity-label table and the tool switch in `ChatViewMessage` read the same
    /// keys as the Android client.
    var type: String { "tool-\(toolName)" }
}
