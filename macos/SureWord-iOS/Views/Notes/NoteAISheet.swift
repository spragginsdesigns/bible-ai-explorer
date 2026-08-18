import SwiftUI

/// Per-note AI conversation as a sheet — a port of
/// `mobile/src/features/notes/components/NoteAIPanel.tsx`, which presents the
/// same way on Android.
///
/// Everything the Android sheet has: persisted history, clear, the Suggest
/// Verses shortcut, the `/suggest` `/verse` `/clear` slash commands with their
/// palette, and the receipt card when the assistant writes into the note.
struct NoteAISheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var ai: NoteAIModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                messages
                if !ai.messages.isEmpty { suggestInline }
                if !ai.suggestions.isEmpty && !ai.isBusy { palette }
                Divider().overlay(theme.border)
                composer
            }
            .background(theme.bg.ignoresSafeArea())
            .navigationTitle("AI Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !ai.messages.isEmpty {
                        Button {
                            Task { await ai.clearHistory() }
                        } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(theme.textMuted)
                        }
                        .accessibilityLabel("Clear conversation")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textGhost)
                    }
                    .accessibilityLabel("Close AI assistant")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await ai.loadHistory() }
    }

    // MARK: Messages

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
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text("Something went wrong: \(error)")
                                    .font(.subheadline)
                                    .foregroundStyle(theme.danger)
                                Button("Try again") {
                                    Task { await ai.retry() }
                                }
                                .buttonStyle(AccentButtonStyle())
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: ai.messages.last?.content) {
                    guard let id = ai.messages.last?.id else { return }
                    withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "sparkles")
                .font(.title)
                .foregroundStyle(theme.accentDim)
            Text("Ask about your note")
                .font(.headline)
                .foregroundStyle(theme.textMuted)
            Text("The AI can see this note and can write Scripture straight into it.")
                .font(.subheadline)
                .foregroundStyle(theme.textGhost)
                .multilineTextAlignment(.center)
            Button {
                Task { await ai.suggestVerses() }
            } label: {
                Label("Suggest Verses", systemImage: "sparkles")
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
            Label("Suggest Verses", systemImage: "sparkles")
                .font(.subheadline)
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
                                .font(.subheadline.weight(.semibold).monospaced())
                                .foregroundStyle(theme.accent)
                            if let hint = command.hint {
                                Text(hint)
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(theme.textFaint)
                            }
                        }
                        Text(command.description)
                            .font(.footnote)
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
                .font(.body)
                .lineLimit(1...6)
                .onSubmit { Task { await ai.submit() } }

            if ai.isStreaming {
                Button {
                    ai.stop()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel("Stop")
            } else {
                Button {
                    Task { await ai.submit() }
                } label: {
                    Image(systemName: "arrow.up").fontWeight(.semibold)
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(!ai.canSend)
                .accessibilityLabel("Send")
            }
        }
        .padding(Spacing.md)
    }
}

// MARK: - Message

/// One turn in the note conversation — a port of `NoteAIMessage.tsx`.
private struct NoteAIMessageView: View {
    @Environment(\.theme) private var theme
    let message: ChatViewMessage

    var body: some View {
        if message.role == .user {
            Text(message.content)
                .font(.body)
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
                Image(systemName: "sparkles")
                    .font(.caption2)
                    .foregroundStyle(theme.accent)
                    .frame(width: 22, height: 22)
                    .background(theme.surface, in: .circle)
                    .overlay { Circle().strokeBorder(theme.borderStrong, lineWidth: 1) }

                VStack(alignment: .leading, spacing: 6) {
                    if !message.content.isEmpty {
                        NoteMarkdownText(content: message.content)
                    } else if message.isStreaming, message.activity == nil {
                        TypingDots()
                    }
                    if message.isStreaming, let activity = message.activity {
                        Text("\(activity)…")
                            .font(.footnote)
                            .foregroundStyle(theme.textFaint)
                    }
                    if !message.retrievedVerses.isEmpty {
                        ForEach(message.retrievedVerses) { verse in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verse.reference)
                                    .font(.footnote.weight(.semibold))
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
                                .font(.caption2)
                                .foregroundStyle(theme.accent)
                            Text(action.created ? "Created note" : "Added to note")
                                .foregroundStyle(theme.textSecondary)
                            Text(action.noteTitle)
                                .foregroundStyle(theme.accent)
                                .fontWeight(.semibold)
                        }
                        .font(.footnote)
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

/// Inline-markdown answer text. The Mac renders through its `MarkdownBody`;
/// the panel's answers are prose with emphasis and lists, which
/// `AttributedString(markdown:)` covers without pulling a renderer into this
/// lane. Namespaced under Notes so the chat lane's own renderer cannot
/// collide with it.
private struct NoteMarkdownText: View {
    @Environment(\.theme) private var theme
    let content: String

    var body: some View {
        if let parsed = try? AttributedString(
            markdown: content,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            Text(parsed)
                .font(.body)
                .foregroundStyle(theme.text)
                .textSelection(.enabled)
        } else {
            Text(content)
                .font(.body)
                .foregroundStyle(theme.text)
                .textSelection(.enabled)
        }
    }
}

