import SwiftUI

/// Per-note AI conversation — a port of
/// `mobile/src/features/notes/components/NoteAIPanel.tsx`.
///
/// Everything the Android sheet has: persisted history, clear, the Suggest
/// Verses shortcut, the `/suggest` `/verse` `/clear` slash commands with their
/// palette, and the receipt card when the assistant writes into the note.
struct NoteAIPanelView: View {
    @Environment(\.theme) private var theme
    @Bindable var ai: NoteAIModel
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(theme.border)
            messages
            if !ai.messages.isEmpty { suggestInline }
            if !ai.suggestions.isEmpty && !ai.isBusy { palette }
            Divider().overlay(theme.border)
            composer
        }
        .background(theme.glassLight)
        .task { await ai.loadHistory() }
    }

    // MARK: Chrome

    private var header: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 11))
                .foregroundStyle(theme.accent)
            Text("AI Assistant")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
            Spacer()
            if !ai.messages.isEmpty {
                Button {
                    Task { await ai.clearHistory() }
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Clear conversation")
            }
            Button {
                onClose()
            } label: {
                Image(systemName: "sidebar.right")
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Close AI panel")
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
    }

    @ViewBuilder
    private var messages: some View {
        if ai.messages.isEmpty {
            emptyState
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.md) {
                        ForEach(ai.messages) { message in
                            NoteAIMessageView(message: message).id(message.id)
                        }
                        if let error = ai.error {
                            ErrorCard(message: "Something went wrong: \(error)", actionTitle: "Try again") {
                                Task { await ai.retry() }
                            }
                        }
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: ai.messages.last?.content) {
                    guard let id = ai.messages.last?.id else { return }
                    // Never animate a `scrollTo` into a lazy stack: the animated offset is
                    // re-resolved every frame against row estimates that the pass
                    // itself changes, and the main thread never converges (the
                    // second-message hang fixed in `ChatView.swift`).
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text("✦")
                .font(.system(size: 24))
                .foregroundStyle(theme.accentDim)
            Text("Ask about your note")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            Text("The AI can see this note and can write Scripture straight into it.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textGhost)
                .multilineTextAlignment(.center)
            Button("✦  Suggest Verses") {
                Task { await ai.suggestVerses() }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(ai.isBusy)
            .padding(.top, Spacing.sm)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var suggestInline: some View {
        Button {
            Task { await ai.suggestVerses() }
        } label: {
            Text("✦  Suggest Verses")
                .font(.system(size: 11.5))
                .foregroundStyle(theme.accentDim)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(ai.isBusy)
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, 6)
    }

    private var palette: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(ai.suggestions) { command in
                Button {
                    ai.input = command.requiresArgs ? "\(command.command) " : command.command
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(command.command)
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(theme.accent)
                            if let hint = command.hint {
                                Text(hint)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(theme.textFaint)
                            }
                        }
                        Text(command.description)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textMuted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, 6)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.borderStrong, lineWidth: 1)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.sm)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Spacing.sm) {
            TextField("Ask about your note…", text: $ai.input, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .lineLimit(1...6)
                .onSubmit { Task { await ai.submit() } }

            if ai.isStreaming {
                Button {
                    ai.stop()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Stop")
            } else {
                Button {
                    Task { await ai.submit() }
                } label: {
                    Image(systemName: "arrow.up").fontWeight(.semibold)
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(!ai.canSend)
            }
        }
        .padding(Spacing.md)
    }
}

/// One turn in the note conversation — a port of `NoteAIMessage.tsx`.
struct NoteAIMessageView: View {
    @Environment(\.theme) private var theme
    let message: ChatViewMessage

    var body: some View {
        if message.role == .user {
            Text(message.content)
                .font(.system(size: 13))
                .foregroundStyle(theme.text)
                .textSelection(.enabled)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .background(theme.surfaceStrong, in: .rect(cornerRadius: Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            HStack(alignment: .top, spacing: Spacing.sm) {
                SureWordGuideAvatar(size: 20, active: message.isStreaming)

                VStack(alignment: .leading, spacing: 6) {
                    if !message.content.isEmpty {
                        MarkdownBody(text: message.content, streaming: message.isStreaming)
                    } else if message.isStreaming, message.activity == nil {
                        TypingDots()
                    }
                    if message.isStreaming, let activity = message.activity {
                        Text("\(activity)…")
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textFaint)
                    }
                    if !message.retrievedVerses.isEmpty {
                        ForEach(message.retrievedVerses) { verse in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verse.reference)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.accent)
                                if let text = verse.text {
                                    Text(text)
                                        .font(.custom(FontFamily.verse, size: 15))
                                        .foregroundStyle(theme.textSecondary)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                    ForEach(message.noteActions) { action in
                        HStack(spacing: 6) {
                            Image(systemName: "pencil")
                                .font(.system(size: 10))
                                .foregroundStyle(theme.accent)
                            Text(action.created ? "Created note" : "Added to note")
                                .foregroundStyle(theme.textSecondary)
                            Text(action.noteTitle)
                                .foregroundStyle(theme.accent)
                                .fontWeight(.semibold)
                        }
                        .font(.system(size: 11.5))
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, 6)
                        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.sm)
                                .strokeBorder(theme.accentBorder, lineWidth: 1)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
