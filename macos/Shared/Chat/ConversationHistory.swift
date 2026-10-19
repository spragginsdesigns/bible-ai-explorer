import Foundation

/// History search and titles, view-free so the rules are testable. Matches
/// Android's `HistoryModal`: case-insensitive, on the title as shown. Used by
/// the iOS history sheet and by the Mac's sidebar and history picker.
enum HistorySearch {
    static func displayTitle(_ conversation: Conversation) -> String {
        conversation.title.isEmpty ? "Untitled conversation" : conversation.title
    }

    static func filter(_ conversations: [Conversation], query: String) -> [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return conversations }
        return conversations.filter { displayTitle($0).lowercased().contains(needle) }
    }

    /// Android's empty state when nothing matches the search.
    static func noMatches(_ query: String) -> String {
        "No conversations match “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”."
    }
}

/// Renaming a conversation through `PATCH /api/conversations/{id}` with
/// `{ "title": ... }`, under the same rules as Android's `HistoryModal` and the
/// web sidebar.
enum ConversationRename {
    /// `MAX_CONVERSATION_TITLE_LENGTH` in `src/app/api/conversations/[id]/route.ts`;
    /// the route answers 400 past it. That limit is JavaScript's `length`, so it
    /// counts UTF-16 code units, not characters: an emoji is two.
    static let maxLength = 120

    /// Android's line under the search box for any rename the server refused.
    static let failureMessage = "Couldn't rename. Try again."

    struct Body: Encodable, Equatable {
        let title: String
    }

    /// The title the route will store: `replace(/\s+/g, " ").trim()`. Walked
    /// scalar by scalar, as JavaScript does, so a space before a combining mark
    /// still counts as a space.
    static func normalized(_ raw: String) -> String {
        var scalars = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in raw.unicodeScalars {
            if isJavaScriptWhitespace(scalar) {
                pendingSpace = !scalars.isEmpty
                continue
            }
            if pendingSpace {
                scalars.append(" ")
                pendingSpace = false
            }
            scalars.append(scalar)
        }
        return String(scalars)
    }

    /// JavaScript's `\s`: Unicode White_Space without NEL (U+0085), plus the
    /// byte order mark (U+FEFF).
    private static func isJavaScriptWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.value == 0xFEFF { return true }
        return scalar.properties.isWhitespace && scalar.value != 0x85
    }

    /// The field's text cut to what the route accepts, never through the
    /// middle of a character. Android's and the web's inputs stop at
    /// `maxLength` the same way.
    static func clamped(_ value: String) -> String {
        guard value.utf16.count > maxLength else { return value }
        var result = ""
        for character in value {
            guard result.utf16.count + character.utf16.count <= maxLength else { break }
            result.append(character)
        }
        return result
    }

    /// The title to send, or nil when there is nothing to send: blank, or no
    /// different from the current title. Over-long input is clamped by the
    /// field, so it never reaches the route.
    static func titleToSend(_ raw: String, current: String) -> String? {
        let title = normalized(clamped(raw))
        guard !title.isEmpty, title != current else { return nil }
        return title
    }
}

/// The destructive confirmation every Apple delete of one conversation asks
/// first, as Android's "Sure?" and the web's do.
enum ConversationDeletion {
    static let title = "Delete this conversation?"

    static func message(for conversation: Conversation) -> String {
        "“\(HistorySearch.displayTitle(conversation))” will be deleted. This cannot be undone."
    }
}
