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
    /// The thumb the user just chose, or `nil` to clear it, plus whatever a
    /// "Not helpful" panel collected - `nil` when the thumb travelled alone.
    /// The shell owns the write and the toast.
    var onFeedback: (ChatViewMessage, AnswerFeedback?, AnswerFeedbackDetails?) -> Void
    /// False until the conversation exists: an unsaved turn has nothing to
    /// share, so Android hides the button rather than explaining.
    var canShare: Bool = true
    /// Open the Share sheet for this answer. The shell owns the sheet, which
    /// mints the public link the card is drawn from.
    var onShare: (ChatViewMessage) -> Void
    var onFollowUp: (String) -> Void
    /// Edit this question: its text goes to the composer and sending replaces
    /// it and every reply after it. Nil while it cannot be edited (an answer is
    /// in flight, or the conversation is not stored yet), which hides Edit.
    var onEdit: (() -> Void)? = nil
    /// Ask this question again. Only the newest settled answer gets one.
    var onRetry: (() -> Void)? = nil
    /// Keeps Copy / Edit drawn under the newest question; every other one
    /// shows them on hover.
    var showsUserActions: Bool = false
    /// Walk with me: whether this message's choice card still takes a tap.
    var cardState: OnboardingRules.CardState? = nil

    /// True while the pointer is over a question, which reveals its actions.
    @State private var isHovering = false

    /// The "What went wrong?" panel, raised by a thumbs down. Held here rather
    /// than in the shell so the control stays self-contained, and the draft it
    /// edits lives here too so every rating opens on an empty panel.
    @State private var isReasonPresented = false
    @State private var reason = ""
    @State private var reasonTags: [FeedbackTag] = []

    /// True for the moment after a Copy, which swaps the glyph for a checkmark.
    @State private var didCopy = false
    /// Which copy owns the current countdown, so a second one does not have its
    /// checkmark cleared early by the first one's timer.
    @State private var copyGeneration = 0
    /// The "Scripture in this answer" sheet, raised by its card or by a Bible
    /// reference clicked in the answer.
    @State private var versesFocus: VersesSheetFocus?

    private var isUser: Bool { message.role == .user }

    /// A clicked `sureword-verse:` link, as Android's `MessageBubble` routes
    /// it: in a settled answer, a reference this turn retrieved opens the
    /// sheet on its passage; anything else, and every reference in a
    /// question, opens the reader at that verse. Other links open normally.
    private func openLink(_ url: URL) -> OpenURLAction.Result {
        guard let raw = VerseLinks.reference(from: url) else { return .systemAction }
        // Mid-stream the passages are still arriving, so a reference reads instead.
        let grouped = isUser || message.isStreaming || message.retrievedVerses.isEmpty ? nil : message.groupedVerses
        switch VerseLinks.destination(for: raw, grouped: grouped) {
        case .passage(let key):
            versesFocus = VersesSheetFocus(key: key)
        case .reader(let reference):
            onVerseReadInBible(RetrievedVerse(reference: reference, similarity: 0, text: nil))
        case nil:
            break
        }
        return .handled
    }

    /// The question with its Bible references linked, in Android's
    /// `userRefLink` look: accent and underlined.
    private var linkedQuestion: AttributedString {
        var text = VerseLinks.linkedPlainText(message.content)
        for run in text.runs where run.link != nil {
            text[run.range].foregroundColor = theme.accent
            text[run.range].underlineStyle = .single
        }
        return text
    }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: Spacing.md) {
            if isUser {
                userBubble
            } else {
                HStack(alignment: .top, spacing: Spacing.md) {
                    SureWordGuideAvatar(size: 40, phase: .resolve(streaming: message.isStreaming, content: message.content))
                    assistantBody
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    /// Every thumb is recorded the moment it is tapped; only "Not helpful" then
    /// stops to ask why.
    ///
    /// The rating goes first and the reasons follow as a second write, matching
    /// web and Android. The chips are a bonus, the thumb is the signal, and a
    /// panel the user dismisses must not swallow both - which is also what makes
    /// the shells' "the thumb has already moved" true
    /// (`SureWord/Chat/Views/ChatView.swift:167`).
    private func rate(_ choice: AnswerFeedback?) {
        onFeedback(message, choice, nil)
        guard choice == .down else { return }
        reason = ""
        reasonTags = []
        isReasonPresented = true
    }

    /// The reason panel, anchored to the action row rather than to the thumb
    /// itself: the glyphs live inside the shared `AnswerFeedbackButtons`, and
    /// reaching into it for an anchor would make a presentational control carry
    /// one shell's presentation.
    private var reasonPanel: some View {
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

    /// Copy the answer as plain text. Icon-only, like the thumbs beside it, and
    /// it confirms in place because there is no toast this deep in the bubble.
    private var copyControl: some View {
        Button {
            copyAnswer()
        } label: {
            Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                .appFont(.system(size: 12))
                .foregroundStyle(didCopy ? theme.accent : theme.textFaint)
        }
        .buttonStyle(SubtleButtonStyle())
        .help(didCopy ? "Copied" : "Copy this answer")
        .accessibilityLabel(didCopy ? "Copied" : "Copy this answer")
    }

    private func copyAnswer() {
        SharedAnswerPasteboard.copy(message.copyableText)
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

    /// "Share", beside the thumbs on a settled answer: opens the Share sheet,
    /// whose card and link both come from the answer's public snapshot. The
    /// sheet mints the link as it opens (idempotent server-side, and the POST
    /// is also what re-activates a link revoked in Settings).
    private var shareControl: some View {
        Button {
            onShare(message)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "square.and.arrow.up")
                Text("Share")
            }
            .appFont(.system(size: 12))
            .foregroundStyle(theme.textFaint)
        }
        .buttonStyle(SubtleButtonStyle())
        .accessibilityLabel("Share this answer")
    }

    @ViewBuilder
    private var userBubble: some View {
        VStack(alignment: .trailing, spacing: Spacing.sm) {
            // Receipts for what was sent, above the text that came with them.
            if !message.attachments.isEmpty {
                attachmentCards
            }
            if !message.content.isEmpty {
                Text(linkedQuestion)
                    .appFont(.system(size: 14))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
                    .environment(\.openURL, OpenURLAction(handler: openLink))
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .background(theme.surfaceStrong, in: .rect(cornerRadius: Radius.lg))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .strokeBorder(theme.border, lineWidth: 1)
                    }
            }
            // Always laid out, faded in on hover, so revealing the row never
            // reflows the conversation under the pointer.
            userActions
                .opacity(showsUserActions || isHovering ? 1 : 0)
        }
        .frame(maxWidth: 560, alignment: .trailing)
        .contentShape(.rect)
        .onHover { isHovering = $0 }
        .contextMenu {
            if !message.content.isEmpty {
                Button("Copy") { copyAnswer() }
            }
            if let onEdit {
                Button("Edit", action: onEdit)
            }
        }
    }

    /// Copy and Edit for a question. Copy is left out for a files-only
    /// message (there is no text to copy); Edit can still add some.
    private var userActions: some View {
        HStack(spacing: 0) {
            if !message.content.isEmpty {
                Button {
                    copyAnswer()
                } label: {
                    Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                        .appFont(.system(size: 12))
                        .foregroundStyle(didCopy ? theme.accent : theme.textFaint)
                }
                .buttonStyle(SubtleButtonStyle())
                .help(didCopy ? "Copied" : "Copy your message")
                .accessibilityLabel(didCopy ? "Copied" : "Copy your message")
            }
            if let onEdit {
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Edit your message")
                .accessibilityLabel("Edit your message")
            }
        }
    }

    /// "Try again" at the end of the newest answer's action row.
    private func retryControl(_ retry: @escaping () -> Void) -> some View {
        Button(action: retry) {
            Image(systemName: "arrow.clockwise")
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textFaint)
        }
        .buttonStyle(SubtleButtonStyle())
        .help("Try again")
        .accessibilityLabel("Try again")
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
                .appFont(.system(size: 12))
            }

            if !message.retrievedVerses.isEmpty {
                RetrievedVersesCard(
                    grouped: message.groupedVerses,
                    strength: message.matchStrength,
                    api: api,
                    onCopy: onVerseCopy,
                    onSaveToNote: onVerseSaveToNote,
                    onReadInBible: onVerseReadInBible,
                    focus: $versesFocus
                )
            }

            if !message.content.isEmpty {
                MarkdownBody(text: message.content, streaming: message.isStreaming, linksVerses: true)
                    .environment(\.openURL, OpenURLAction(handler: openLink))
            } else if message.isStreaming, message.activity == nil, message.progress == nil {
                TypingDots()
            }

            // Walk with me's card belongs to the question it asks, so it sits
            // right under the message, above the answer actions.
            GuideMessageCards(message: message, state: cardState)

            // Only on a settled answer - mid-stream the markdown is a fragment,
            // and a half-written answer is not one there is anything to judge.
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
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .accessibilityLabel("Add this answer to your notes")

                    AnswerFeedbackButtons(feedback: message.feedback, onSelect: rate)

                    if canShare { shareControl }

                    if let onRetry { retryControl(onRetry) }
                }
                .popover(isPresented: $isReasonPresented, arrowEdge: .bottom) {
                    reasonPanel
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
