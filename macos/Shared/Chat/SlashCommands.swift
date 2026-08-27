import Foundation

/// Slash commands for the chat input — a port of
/// `mobile/src/features/chat/slashCommands.ts`.
///
/// `.local` commands the app executes itself; `.ai` commands are sent to the
/// model verbatim, because the backend system prompt already teaches it how to
/// carry each one out with its tools. That split is why adding an `.ai` command
/// needs no client work beyond this table.
struct SlashCommand: Sendable, Equatable, Identifiable {
    enum Kind: Sendable, Equatable { case ai, local }

    enum LocalAction: Sendable, Equatable {
        case new, clear, history, suggest, clearNoteChat
    }

    var command: String
    var aliases: [String] = []
    /// Argument hint shown in the palette, e.g. `<reference>`.
    var hint: String?
    var description: String
    var kind: Kind
    var localAction: LocalAction?
    /// When true, choosing the command fills the input instead of sending.
    var requiresArgs = false

    var id: String { command }
}

extension SlashCommand {
    static let chat: [SlashCommand] = [
        .init(
            command: "/note",
            aliases: ["/add"],
            hint: "[what to save]",
            description: "Save the last answer (or what you describe) to your notes",
            kind: .ai
        ),
        .init(
            command: "/verse",
            hint: "<reference>",
            description: "Quote a passage word-for-word, e.g. /verse John 3:16-18",
            kind: .ai,
            requiresArgs: true
        ),
        .init(
            command: "/search",
            hint: "<topic>",
            description: "Search the Scriptures for a topic",
            kind: .ai,
            requiresArgs: true
        ),
        .init(
            command: "/web",
            hint: "<query>",
            description: "Search the web — history, archaeology, apologetics",
            kind: .ai,
            requiresArgs: true
        ),
        .init(
            command: "/who",
            hint: "<name or place>",
            description: "Who or where is this? Look it up in Scripture",
            kind: .ai,
            requiresArgs: true
        ),
        .init(
            command: "/cross",
            description: "Today's Pick Up Your Cross",
            kind: .ai
        ),
        // Reads the day's portion and nothing more - starting or changing a plan
        // is a deliberate act, never a side effect of asking what to read.
        .init(
            command: "/plan",
            description: "Today's reading in your reading plan",
            kind: .ai
        ),
        .init(
            command: "/memory",
            description: "What SureWord remembers about you",
            kind: .ai
        ),
        .init(
            command: "/new",
            description: "Start a new conversation",
            kind: .local,
            localAction: .new
        ),
        .init(
            command: "/clear",
            description: "Delete this conversation and start fresh",
            kind: .local,
            localAction: .clear
        ),
        .init(
            command: "/history",
            description: "Open conversation history",
            kind: .local,
            localAction: .history
        ),
    ]

    /// Commands whose name or alias starts with the typed `/…` token. Only
    /// suggests while the *first* token is still being typed, so `/verse John`
    /// stops showing the palette.
    static func matching(_ input: String, in commands: [SlashCommand] = SlashCommand.chat) -> [SlashCommand] {
        let trailingTrimmed = String(input.reversed().drop { $0.isWhitespace }.reversed())
        let firstToken = input.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        if firstToken != trailingTrimmed { return [] }

        let typed = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard typed.hasPrefix("/") else { return [] }

        return commands.filter { candidate in
            candidate.command.hasPrefix(typed)
                || candidate.aliases.contains { $0.hasPrefix(typed) }
        }
    }

    /// Exact command match on the first token of a submitted message.
    static func parse(
        _ text: String,
        in commands: [SlashCommand] = SlashCommand.chat
    ) -> (command: SlashCommand, args: String)? {
        guard text.hasPrefix("/") else { return nil }
        let parts = text.split(separator: " ", omittingEmptySubsequences: true)
        guard let token = parts.first?.lowercased() else { return nil }
        guard let match = commands.first(where: { $0.command == token || $0.aliases.contains(token) })
        else { return nil }
        let args = parts.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return (match, args)
    }
}
