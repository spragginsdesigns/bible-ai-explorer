import SwiftUI
import UIKit

/// One chat turn: the bubble plus every card the answer earned.
/// iOS port of `macos/SureWord/Chat/Views/MessageBubble.swift` — the Mac's
/// hover and click actions become taps, context menus, and full-width cards.
struct ChatMessageBubble: View {
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
    /// list from `ChatViewModel.sharedLink(for:)`.
    var shareURL: URL?
    /// True while this answer's link is being minted.
    var isSharing: Bool
    /// Mint the link. The tab owns the write and the toast.
    var onShare: (ChatViewMessage) -> Void
    var onFollowUp: (String) -> Void

    /// The optional "What went wrong?" field, raised by a thumbs down from
    /// either the inline row or the context menu, so both share one presentation.
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
            // nothing left to do. Cancel-role so a swipe away does the same
            // thing rather than looking like it undid the rating.
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
    /// (`SureWord-iOS/Views/Chat/ChatTabView.swift:142`).
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

    /// The context-menu entry for one thumb. Choosing the thumb already on the
    /// answer clears it, exactly as tapping the inline glyph does.
    @ViewBuilder
    private func feedbackMenuItem(_ choice: AnswerFeedback) -> some View {
        let chosen = message.feedback == choice
        Button {
            rate(chosen ? nil : choice)
        } label: {
            Label(choice.title, systemImage: chosen ? choice.filledSymbol : choice.symbol)
        }
    }

    /// "Share", beside the thumbs on a settled answer.
    ///
    /// **Two steps by necessity.** `ShareLink` needs its item up front, and the
    /// link does not exist until the server mints it, so the button mints and
    /// the `ShareLink` takes its place once there is a URL to hand over. There
    /// is no public API to open a share sheet programmatically; the alternative
    /// is a `UIActivityViewController` bridge, which is UIKit plumbing this row
    /// does not otherwise need and the repo has no precedent for.
    ///
    /// Inline only, unlike the thumbs. A context-menu entry could mint but not
    /// present, so it would dismiss the menu and leave the user hunting for the
    /// second tap - worse than not offering it there at all.
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
                    .font(.system(size: 15))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .background(theme.surfaceStrong, in: .rect(cornerRadius: Radius.lg))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .strokeBorder(theme.border, lineWidth: 1)
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = message.content
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                    }
            }
        }
        // Phone width: cap the bubble so long questions don't read as answers.
        .frame(maxWidth: 320, alignment: .trailing)
    }

    private var attachmentCards: some View {
        VStack(alignment: .trailing, spacing: Spacing.sm) {
            ForEach(message.attachments) { attachment in
                AttachmentChip(attachment: attachment)
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
                ChatMarkdownBody(text: message.content, streaming: message.isStreaming)
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = message.content
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        // Mid-stream the markdown is a fragment, so the save
                        // action only appears on a settled answer - and a
                        // half-written answer is not one there is anything to
                        // judge, which is what keeps the thumbs off it too.
                        if !message.isStreaming {
                            Button {
                                onAddToNote(message)
                            } label: {
                                Label("Add to notes", systemImage: "square.and.pencil")
                            }
                            feedbackMenuItem(.up)
                            feedbackMenuItem(.down)
                        }
                    }
            } else if message.isStreaming, message.activity == nil, message.progress == nil {
                TypingDots()
            }

            // Only on a settled answer - mid-stream the markdown is a fragment.
            // The thumbs repeat the context menu on purpose: a long press is
            // not discoverable, and a rating nobody finds is no signal at all.
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
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
