import SwiftUI

/// The streaming message list: bubbles, send-error retry, and the
/// follow-the-stream scroll behaviour. iOS port of the list half of
/// `macos/SureWord/Chat/Views/ChatView.swift`.
struct ChatMessageList: View {
    @Bindable var chat: ChatViewModel
    /// Handed to each bubble for the receipts line's undo fragment.
    let api: APIClient
    var onVerseCopy: (RetrievedVerse) -> Void
    var onVerseSaveToNote: (RetrievedVerse) -> Void
    var onVerseReadInBible: (RetrievedVerse) -> Void
    var onOpenReceipt: (ChatReceipt) -> Void
    var onReceiptError: (String) -> Void
    var onCrossReplaced: () -> Void
    var onAddToNote: (ChatViewMessage) -> Void
    /// The answer that was rated, the thumb (`nil` clears it), and whatever a
    /// "Not helpful" panel collected - `nil` when the thumb travelled alone.
    /// The tab owns the write and the toast.
    var onFeedback: (ChatViewMessage, AnswerFeedback?, AnswerFeedbackDetails?) -> Void
    /// Mint (or re-activate) the public link for one answer and hand it back
    /// for the share sheet; `nil` after a failure, which the tab has toasted.
    var onShare: (ChatViewMessage) async -> URL?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                    ForEach(chat.messages) { message in
                        ChatMessageBubble(
                            message: message,
                            api: api,
                            onVerseCopy: onVerseCopy,
                            onVerseSaveToNote: onVerseSaveToNote,
                            onVerseReadInBible: onVerseReadInBible,
                            onOpenReceipt: onOpenReceipt,
                            onReceiptError: onReceiptError,
                            onAddToNote: onAddToNote,
                            onFeedback: onFeedback,
                            // Android hides Share until the conversation exists.
                            canShare: chat.activeConversationID != nil,
                            isSharing: chat.isSharing(message.id),
                            onShare: onShare,
                            onFollowUp: { question in
                                chat.input = question
                                Task { await chat.send() }
                            }
                        )
                        .id(message.id)
                    }

                    if let sendError = chat.sendError {
                        ChatErrorCard(error: sendError, actionTitle: "Try again") {
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
                // Never animate a `scrollTo` into a lazy stack: the animated offset is
                // re-resolved every frame against row estimates that the pass
                // itself changes, and the main thread never converges (the
                // second-message hang fixed in `ChatView.swift`).
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) { proxy.scrollTo(id, anchor: .bottom) }
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
    var title: String?
    let message: String
    /// Shown muted as "ref: <code>" so a screenshot identifies the failure.
    var code: String?
    var actionTitle: String = "Retry"
    /// Nil hides the button - Android offers none when retrying cannot help.
    var action: (() -> Void)?

    init(
        title: String? = nil,
        message: String,
        code: String? = nil,
        actionTitle: String = "Retry",
        action: (() -> Void)?
    ) {
        self.title = title
        self.message = message
        self.code = code
        self.actionTitle = actionTitle
        self.action = action
    }

    /// A classified chat error: its title, message and code, and the action
    /// only when the error says retrying can help (`onRetry={error.retryable ?
    /// retrySend : undefined}` on Android).
    init(error: ClassifiedChatError, actionTitle: String, alwaysRetry: Bool = false, action: @escaping () -> Void) {
        self.init(
            title: error.title,
            message: error.message,
            code: error.code.rawValue,
            actionTitle: actionTitle,
            action: (error.retryable || alwaysRetry) ? action : nil
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let title {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let code {
                Text("ref: \(code)")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
            }
            if let action {
                Button(actionTitle, action: action)
                    .buttonStyle(AccentButtonStyle())
            }
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
