import Foundation

/// The note AI panel's slash commands — a port of `NOTE_SLASH_COMMANDS` in
/// `mobile/src/features/chat/slashCommands.ts`.
///
/// This is a second table over the *same* `SlashCommand` type the chat composer
/// uses, not a second implementation: `SlashCommand.matching(_:in:)` and
/// `.parse(_:in:)` already take the table to search, and `LocalAction` already
/// carries `.suggest` and `.clearNoteChat`. Adding a note command is therefore a
/// row here and nothing else.
extension SlashCommand {
    static let note: [SlashCommand] = [
        .init(
            command: "/suggest",
            description: "Suggest relevant KJV verses for this note",
            kind: .local,
            localAction: .suggest
        ),
        .init(
            command: "/verse",
            hint: "<reference>",
            description: "Quote a passage word-for-word",
            kind: .ai,
            requiresArgs: true
        ),
        .init(
            command: "/clear",
            description: "Clear this note's AI conversation",
            kind: .local,
            localAction: .clearNoteChat
        ),
    ]

    /// The prompt `/suggest` and the "Suggest Verses" button both send. Kept
    /// character-for-character in step with `SUGGEST_VERSES_PROMPT` in
    /// `mobile/src/features/notes/components/NoteAIPanel.tsx` — the model's
    /// answers are shaped by it, so a reworded copy would give macOS users
    /// different results from the same button.
    static let suggestVersesPrompt =
        "Suggest the most relevant KJV Bible verses for this note and explain how each relates to the content."
}
