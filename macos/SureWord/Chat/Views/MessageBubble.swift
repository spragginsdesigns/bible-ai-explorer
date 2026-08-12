import SwiftUI

/// One chat turn: the bubble plus every card the answer earned.
/// Port of `mobile/src/features/chat/MessageBubble.tsx`.
struct MessageBubble: View {
    @Environment(\.theme) private var theme

    let message: ChatViewMessage
    var onVerseCopy: (RetrievedVerse) -> Void
    var onVerseSaveToNote: (RetrievedVerse) -> Void
    var onVerseReadInBible: (RetrievedVerse) -> Void
    var onOpenNote: (NoteAction) -> Void
    var onAddToNote: (ChatViewMessage) -> Void
    var onFollowUp: (String) -> Void

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: Spacing.md) {
            if isUser {
                userBubble
            } else {
                assistantBody
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    @ViewBuilder
    private var userBubble: some View {
        VStack(alignment: .trailing, spacing: Spacing.sm) {
            // Receipts for what was sent, above the text that came with them.
            if !message.attachments.isEmpty {
                attachmentCards
            }
            if !message.content.isEmpty {
                Text(message.content)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .background(theme.surfaceStrong, in: .rect(cornerRadius: Radius.lg))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .strokeBorder(theme.border, lineWidth: 1)
                    }
            }
        }
        .frame(maxWidth: 560, alignment: .trailing)
    }

    private var attachmentCards: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            ForEach(message.attachments) { attachment in
                AttachmentCard(attachment: attachment)
            }
        }
    }

    @ViewBuilder
    private var assistantBody: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            // Tool activity, shown only while the answer is still being written.
            if let activity = message.activity {
                HStack(spacing: Spacing.sm) {
                    Text("✦").foregroundStyle(theme.accent)
                    Text(activity).foregroundStyle(theme.textMuted)
                    TypingDots()
                }
                .font(.system(size: 12))
            }

            if !message.retrievedVerses.isEmpty {
                RetrievedVersesCard(
                    verses: message.retrievedVerses,
                    strength: message.matchStrength,
                    onCopy: onVerseCopy,
                    onSaveToNote: onVerseSaveToNote,
                    onReadInBible: onVerseReadInBible
                )
            }

            if !message.content.isEmpty {
                MarkdownBody(text: message.content)
            } else if message.isStreaming, message.activity == nil {
                TypingDots()
            }

            // Only on a settled answer — mid-stream the markdown is a fragment.
            if !message.isStreaming, !message.content.isEmpty {
                Button {
                    onAddToNote(message)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.pencil")
                        Text("Add to notes")
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textFaint)
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel("Add this answer to your notes")
            }

            if !message.tavilyResults.isEmpty {
                WebResultsCard(results: message.tavilyResults)
            }

            ForEach(message.noteActions) { action in
                NoteActionCard(action: action) { onOpenNote(action) }
            }

            // Chips only once the answer has settled, so they don't flicker in
            // and out as the `[FOLLOWUP]` block streams in.
            if !message.followUps.isEmpty, !message.isStreaming {
                FollowUpChips(followUps: message.followUps, onSelect: onFollowUp)
            }
        }
        .frame(maxWidth: 720, alignment: .leading)
    }
}
