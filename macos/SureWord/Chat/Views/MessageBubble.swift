import SwiftUI

/// One chat turn: the bubble plus every card the answer earned.
/// Port of `mobile/src/features/chat/MessageBubble.tsx`.
struct MessageBubble: View {
    @Environment(\.theme) private var theme

    let message: ChatViewMessage
    /// The receipts line's undo fragment talks to `/api/memories` itself.
    let api: APIClient
    var onVerseCopy: (RetrievedVerse) -> Void
    var onVerseSaveToNote: (RetrievedVerse) -> Void
    var onVerseReadInBible: (RetrievedVerse) -> Void
    /// Every receipt fragment dispatches through here; the shell owns where each
    /// `ChatReceiptTarget` lands.
    var onOpenReceipt: (ChatReceipt) -> Void
    /// A failed undo, reported to the shell's toast.
    var onReceiptError: (String) -> Void
    var onAddToNote: (ChatViewMessage) -> Void
    /// The thumb the user just chose, or `nil` to clear it, plus the optional
    /// reason a "Not helpful" collected. The shell owns the write and the toast.
    var onFeedback: (ChatViewMessage, AnswerFeedback?, String?) -> Void
    /// The public link already minted for this answer, if any. Supplied by the
    /// shell from `ChatViewModel.sharedLink(for:)`.
    var shareURL: URL?
    /// True while this answer's link is being minted.
    var isSharing: Bool
    /// Mint the link. The shell owns the write and the toast.
    var onShare: (ChatViewMessage) -> Void
    var onFollowUp: (String) -> Void

    /// The optional "What went wrong?" field, raised by a thumbs down. Held here
    /// rather than in the shell so the control stays self-contained.
    @State private var isReasonPresented = false
    @State private var reason = ""

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: Spacing.md) {
            if isUser {
                userBubble
            } else {
                HStack(alignment: .top, spacing: Spacing.md) {
                    SureWordGuideAvatar(size: 30, active: message.isStreaming)
                    assistantBody
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .alert(AnswerFeedback.reasonPrompt, isPresented: $isReasonPresented) {
            TextField(AnswerFeedback.reasonPlaceholder, text: reasonBinding)
            Button("Send") { onFeedback(message, .down, reason) }
            // The thumb was recorded before this alert opened, so Skip has
            // nothing left to do. Cancel-role so Escape and a click outside do
            // the same thing rather than looking like they undid the rating.
            Button("Skip", role: .cancel) {}
        }
    }

    /// Every thumb is recorded the moment it is tapped; only "Not helpful" then
    /// stops to ask why.
    ///
    /// The rating goes first and the reason follows as a second write, matching
    /// web and Android. The reason is a bonus, the thumb is the signal, and an
    /// alert the user dismisses must not swallow both - which is also what makes
    /// the shells' "the thumb has already moved" true
    /// (`SureWord/Chat/Views/ChatView.swift:167`).
    private func rate(_ choice: AnswerFeedback?) {
        onFeedback(message, choice, nil)
        guard choice == .down else { return }
        reason = ""
        isReasonPresented = true
    }

    /// Clamps the reason at the contract's 500 characters *as it is typed*,
    /// rather than quietly shortening what the user wrote when they press Send.
    ///
    /// Done in the binding rather than with an `.onChange` on the field: an
    /// alert's action builder only takes buttons and text fields, so the fewer
    /// modifiers wrapping the `TextField` the better.
    private var reasonBinding: Binding<String> {
        Binding(
            get: { reason },
            set: { reason = String($0.prefix(AnswerFeedback.maxReasonLength)) }
        )
    }

    /// "Share", beside the thumbs on a settled answer.
    ///
    /// **Two steps by necessity.** `ShareLink` needs its item up front, and the
    /// link does not exist until the server mints it, so the button mints and
    /// the `ShareLink` takes its place once there is a URL to hand over. There
    /// is no public API to open a share sheet programmatically; the alternative
    /// is an `NSSharingServicePicker` bridge, which is AppKit view plumbing this
    /// row does not otherwise need and the repo has no precedent for.
    ///
    /// Re-sharing is idempotent server-side, so the second tap on the ShareLink
    /// costs nothing and the link is always the same one.
    @ViewBuilder
    private var shareControl: some View {
        if let shareURL {
            ShareLink(item: shareURL) {
                shareLabel(tint: theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .accessibilityLabel("Share this answer")
        } else {
            Button {
                onShare(message)
            } label: {
                shareLabel(tint: theme.textFaint, busy: isSharing)
            }
            .buttonStyle(SubtleButtonStyle())
            .disabled(isSharing)
            .accessibilityLabel("Create a link to this answer")
        }
    }

    private func shareLabel(tint: Color, busy: Bool = false) -> some View {
        HStack(spacing: 6) {
            if busy {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "square.and.arrow.up")
            }
            Text("Share")
        }
        .font(.system(size: 12))
        .foregroundStyle(tint)
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
            if let progress = message.progress {
                WorkActivityView(progress: progress, isStreaming: message.isStreaming)
            }
            // Legacy streams still have a single activity label.
            if let activity = message.activity, message.progress == nil {
                HStack(spacing: Spacing.sm) {
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
                MarkdownBody(text: message.content, streaming: message.isStreaming)
            } else if message.isStreaming, message.activity == nil, message.progress == nil {
                TypingDots()
            }

            // Only on a settled answer - mid-stream the markdown is a fragment,
            // and a half-written answer is not one there is anything to judge.
            if !message.isStreaming, !message.content.isEmpty {
                HStack(spacing: 0) {
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

                    AnswerFeedbackButtons(feedback: message.feedback, onSelect: rate)

                    shareControl
                }
            }

            if !message.tavilyResults.isEmpty {
                WebResultsCard(results: message.tavilyResults)
            }

            // Everything this turn saved, on one line. It replaces the note
            // cards and the per-kind receipt rows that came before it.
            ReceiptLineView(
                receipts: message.receipts,
                api: api,
                onOpen: onOpenReceipt,
                onError: onReceiptError
            )

            // The cross card stays as the verse preview: it is content, and the
            // receipt fragment above it is the tap.
            ForEach(message.crossActions) { action in
                CrossActionCard(action: action)
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
