import SwiftUI

/// The streaming message list: bubbles, send-error retry, and the
/// follow-the-stream scroll behaviour. iOS port of the list half of
/// `macos/SureWord/Chat/Views/ChatView.swift`.
struct ChatMessageList: View {
    @Bindable var chat: ChatViewModel
    var onVerseCopy: (RetrievedVerse) -> Void
    var onVerseSaveToNote: (RetrievedVerse) -> Void
    var onVerseReadInBible: (RetrievedVerse) -> Void
    var onOpenNote: (NoteAction) -> Void
    var onOpenCross: () -> Void
    var onCrossReplaced: () -> Void
    var onAddToNote: (ChatViewMessage) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                    ForEach(chat.messages) { message in
                        ChatMessageBubble(
                            message: message,
                            onVerseCopy: onVerseCopy,
                            onVerseSaveToNote: onVerseSaveToNote,
                            onVerseReadInBible: onVerseReadInBible,
                            onOpenNote: onOpenNote,
                            onOpenCross: onOpenCross,
                            onAddToNote: onAddToNote,
                            onFollowUp: { question in
                                chat.input = question
                                Task { await chat.send() }
                            }
                        )
                        .id(message.id)
                    }

                    if let sendError = chat.sendError {
                        ChatErrorCard(message: sendError, actionTitle: "Retry") {
                            Task { await chat.retrySend() }
                        }
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            // Follow the answer as it streams.
            .onChange(of: chat.messages.last?.content) {
                guard let id = chat.messages.last?.id else { return }
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
            // A new turn (or a switched conversation) lands at the bottom too.
            .onChange(of: chat.messages.count) {
                guard let id = chat.messages.last?.id else { return }
                proxy.scrollTo(id, anchor: .bottom)
            }
            // The assistant just replaced today's word, so the cached day is
            // now the old one.
            .onChange(of: chat.messages.last?.crossActions.last?.reference) { _, reference in
                if reference != nil { onCrossReplaced() }
            }
        }
    }
}

/// Port of `mobile/src/features/chat/ErrorCard.tsx` — the chat copy of the
/// Mac's `ErrorCard`, full-width on a phone.
struct ChatErrorCard: View {
    @Environment(\.theme) private var theme
    let message: String
    var actionTitle: String
    var action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(actionTitle, action: action)
                .buttonStyle(AccentButtonStyle())
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.dangerBorder, lineWidth: 1)
        }
    }
}
