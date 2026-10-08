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
    /// The thumb the user just chose, or `nil` to clear it, plus whatever a
    /// "Not helpful" panel collected - `nil` when the thumb travelled alone.
    /// The shell owns the write and the toast.
    var onFeedback: (ChatViewMessage, AnswerFeedback?, AnswerFeedbackDetails?) -> Void
    /// False until the conversation exists: an unsaved turn has nothing to
    /// share, so Android hides the button rather than explaining.
    var canShare: Bool
    /// True while this answer's link is being minted.
    var isSharing: Bool
    /// Mint (or re-activate) the link; nil after a failure the tab toasted.
    var onShare: (ChatViewMessage) async -> URL?
    var onFollowUp: (String) -> Void
    /// Edit this question: its text goes to the composer and sending replaces
    /// it and every reply after it. Nil while it cannot be edited (an answer is
    /// in flight, or the conversation is not stored yet), which hides Edit.
    var onEdit: (() -> Void)? = nil
    /// Ask this question again. Only the newest settled answer gets one.
    var onRetry: (() -> Void)? = nil
    /// Draws Copy and Edit under the bubble rather than only in its long-press
    /// menu - the newest question, where a long press is least discoverable.
    var showsUserActions: Bool = false

    /// The "What went wrong?" panel, raised by a thumbs down from either the
    /// inline row or the context menu, so both share one presentation. The draft
    /// it edits lives here so every rating opens on an empty panel.
    @State private var isReasonPresented = false
    @State private var reason = ""
    @State private var reasonTags: [FeedbackTag] = []
    /// The link the share sheet is presenting, once minted.
    @State private var sharing: AnswerShareLink?

    /// True for the moment after a Copy, which swaps the glyph for a checkmark.
    @State private var didCopy = false
    /// Which copy owns the current countdown, so a second one does not have its
    /// checkmark cleared early by the first one's timer.
    @State private var copyGeneration = 0

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
        // A sheet rather than the one-line alert this replaced: the chips need
        // room an alert cannot give them. Swiping it away is the Skip - the
        // thumb was recorded before it opened, so there is nothing to undo.
        .sheet(isPresented: $isReasonPresented) {
            FeedbackReasonSheet(
                tags: $reasonTags,
                reason: $reason,
                onSkip: { isReasonPresented = false },
                onSend: { details in
                    isReasonPresented = false
                    onFeedback(message, .down, details)
                }
            )
        }
    }

    /// Every thumb is recorded the moment it is tapped; only "Not helpful" then
    /// stops to ask why.
    ///
    /// The rating goes first and the reasons follow as a second write, matching
    /// web and Android. The chips are a bonus, the thumb is the signal, and a
    /// panel the user dismisses must not swallow both - which is also what makes
    /// the shells' "the thumb has already moved" true
    /// (`SureWord-iOS/Views/Chat/ChatTabView.swift:142`).
    private func rate(_ choice: AnswerFeedback?) {
        onFeedback(message, choice, nil)
        guard choice == .down else { return }
        reason = ""
        reasonTags = []
        isReasonPresented = true
    }

    /// Copy the answer as plain text. Icon-only beside the thumbs, and it
    /// confirms in place because there is no toast this deep in the bubble.
    private var copyControl: some View {
        Button {
            copyAnswer()
        } label: {
            Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                .font(.system(size: 12))
                .foregroundStyle(didCopy ? theme.accent : theme.textFaint)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(SubtleButtonStyle())
        .accessibilityLabel(didCopy ? "Answer copied" : "Copy this answer")
    }

    private func copyAnswer() {
        SharedAnswerPasteboard.copy(message.copyableText)
        UIAccessibility.post(notification: .announcement, argument: "Copied")
        copyGeneration += 1
        let generation = copyGeneration
        withAnimation(.easeOut(duration: 0.15)) { didCopy = true }
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            // A later copy started its own countdown and owns the glyph now.
            guard generation == copyGeneration else { return }
            withAnimation(.easeOut(duration: 0.15)) { didCopy = false }
        }
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

    /// "Share", beside the thumbs on a settled answer: one tap mints the link
    /// (or re-activates a revoked one) and opens the share sheet, as Android's
    /// `Share.share` does. `ShareLink` needs its URL up front, so this presents
    /// a `UIActivityViewController` once the POST returns.
    ///
    /// Inline only, unlike the thumbs: a context-menu entry would have to
    /// dismiss the menu before the sheet could rise.
    private var shareControl: some View {
        Button {
            Task {
                if let url = await onShare(message) {
                    sharing = AnswerShareLink(url: url)
                }
            }
        } label: {
            Group {
                if isSharing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "square.and.arrow.up")
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(theme.textFaint)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(SubtleButtonStyle())
        .disabled(isSharing)
        .accessibilityLabel("Share this answer")
        .accessibilityValue(isSharing ? "Creating the link" : "")
        .sheet(item: $sharing) { link in
            AnswerShareSheet(url: link.url)
                .presentationDetents([.medium, .large])
        }
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
                            SharedAnswerPasteboard.copy(message.copyableText)
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        if let onEdit {
                            Button(action: onEdit) {
                                Label("Edit", systemImage: "pencil")
                            }
                        }
                    }
            }
            if showsUserActions {
                userActions
            }
        }
        // Phone width: cap the bubble so long questions don't read as answers.
        .frame(maxWidth: 320, alignment: .trailing)
    }

    /// Copy and Edit under the newest question. Copy is left out for a
    /// files-only message (there is no text to copy); Edit can still add some.
    private var userActions: some View {
        HStack(spacing: 0) {
            if !message.content.isEmpty {
                Button {
                    copyAnswer()
                } label: {
                    Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12))
                        .foregroundStyle(didCopy ? theme.accent : theme.textFaint)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel(didCopy ? "Message copied" : "Copy your message")
            }
            if let onEdit {
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel("Edit your message")
            }
        }
    }

    /// "Try again" beside the thumbs on the newest answer.
    private func retryControl(_ retry: @escaping () -> Void) -> some View {
        Button(action: retry) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(SubtleButtonStyle())
        .accessibilityLabel("Try again")
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

            if !message.content.isEmpty {
                ChatMarkdownBody(text: message.content, streaming: message.isStreaming)
                    .contextMenu {
                        Button {
                            SharedAnswerPasteboard.copy(message.copyableText)
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
                            if let onRetry {
                                Button(action: onRetry) {
                                    Label("Try again", systemImage: "arrow.clockwise")
                                }
                            }
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
                    copyControl

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

                    if canShare { shareControl }

                    if let onRetry { retryControl(onRetry) }
                }
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

            // Sources only once the answer has settled, below its receipts and
            // cross cards, in Android's order (`MessageBubble.tsx`).
            if !message.isStreaming, !message.retrievedVerses.isEmpty {
                RetrievedVersesCard(
                    verses: message.retrievedVerses,
                    strength: message.matchStrength,
                    onCopy: onVerseCopy,
                    onSaveToNote: onVerseSaveToNote,
                    onReadInBible: onVerseReadInBible
                )
            }

            if !message.isStreaming, !message.tavilyResults.isEmpty {
                WebResultsCard(results: message.tavilyResults)
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

/// The link a share sheet is presenting; identifiable for `.sheet(item:)`.
private struct AnswerShareLink: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// The system share sheet for one answer link, with the subject Android puts
/// on its `Share.share` call ("An answer from SureWord").
private struct AnswerShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [AnswerShareItem(url: url)], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private final class AnswerShareItem: NSObject, UIActivityItemSource {
    static let subject = "An answer from SureWord"
    let url: URL
    init(url: URL) { self.url = url }

    func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { url }
    func activityViewController(_ controller: UIActivityViewController, itemForActivityType type: UIActivity.ActivityType?) -> Any? { url }
    func activityViewController(_ controller: UIActivityViewController, subjectForActivityType type: UIActivity.ActivityType?) -> String { Self.subject }
}
