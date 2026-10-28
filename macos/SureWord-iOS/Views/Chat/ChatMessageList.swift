import SwiftUI

/// The streaming message list: bubbles, send-error retry, and the
/// follow-the-stream scroll behaviour. iOS port of the list half of
/// `macos/SureWord/Chat/Views/ChatView.swift`.
struct ChatMessageList: View {
    @Environment(AppModel.self) private var app
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
    /// Open the Share sheet for one answer; the tab owns it.
    var onShare: (ChatViewMessage) -> Void
    /// A Free reader out of today's messages opens the in-app purchase screen
    /// from the error card (StoreKit only, never a web link), as the locked
    /// Listen panel does.
    @State private var showingPro = false
    /// True once `/api/billing/status` says the App Store can sell Pro to this
    /// account; read only while a used-up allowance is on screen.
    @State private var canSellPro = false

    var body: some View {
        // The newest question shows Copy / Edit under it; only the newest
        // settled answer offers Try again.
        let newestUserID = chat.messages.last { $0.role == .user }?.id
        let retryableID = chat.retryableAnswerID
        let cardStates = app.onboarding.cardStates(for: chat)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                    if app.onboarding.isWelcome(chat) {
                        GuideVoiceToggle()
                    }
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
                            onShare: onShare,
                            onFollowUp: { question in
                                chat.input = question
                                Task { await chat.send() }
                            },
                            onEdit: message.role == .user && chat.canEdit(message.id)
                                ? { chat.beginEdit(message.id) }
                                : nil,
                            onRetry: message.id == retryableID
                                ? { Task { await chat.retryAnswer() } }
                                : nil,
                            showsUserActions: message.id == newestUserID,
                            cardState: cardStates[message.id]
                        )
                        .id(message.id)
                    }

                    if let sendError = chat.sendError {
                        ChatErrorCard(
                            error: sendError,
                            actionTitle: "Try again",
                            onSeePro: sendError.upgrade && canSellPro ? { showingPro = true } : nil
                        ) {
                            Task { await chat.retrySend() }
                        }
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            // Android's `usePlayUpgrade`: the status is read only while the
            // card asks for it, so a Pro reader never pays for the request.
            .task(id: chat.sendError?.upgrade == true) {
                await loadProOffer(upgrade: chat.sendError?.upgrade == true)
            }
            .guideVoice(chat: chat, app: app)
            // On the list, not the card: the sheet must outlive the error it came from.
            .sheet(isPresented: $showingPro) {
                NavigationStack {
                    ProMembershipView()
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { showingPro = false }
                            }
                        }
                }
                .environment(app)
            }
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

    /// Any failure answers no: no button beats a button that leads nowhere.
    private func loadProOffer(upgrade: Bool) async {
        guard upgrade else {
            canSellPro = false
            return
        }
        let canOffer = await ProUpgradeOffer.load(api: app.api)
        guard !Task.isCancelled else { return }
        canSellPro = canOffer
    }
}
