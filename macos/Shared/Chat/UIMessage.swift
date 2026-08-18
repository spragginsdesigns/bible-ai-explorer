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
