import SwiftUI

/// The chat detail pane: message list, error states, and the composer.
struct ChatView: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel
    let api: APIClient
    /// Open the Daily Cross section — the receipt card's destination after the
    /// assistant replaces today's word.
    var onOpenCross: () -> Void
    /// Fired when an answer replaced today's word, so the cached day can be
    /// dropped before the user reaches the Daily Cross section.
    var onCrossReplaced: () -> Void
    var onReadInBible: (RetrievedVerse) -> Void

    @State private var toast: String?
    /// The answer whose "Add to notes" picker is open, if any.
    @State private var noteTarget: PendingNoteSave?

    /// A settled answer waiting to be saved. Identifiable so `.sheet(item:)`
    /// re-presents cleanly when a second answer is picked.
    private struct PendingNoteSave: Identifiable {
        let id: String
        let markdown: String
    }

    var body: some View {
        VStack(spacing: 0) {
            content
            Divider().overlay(theme.border)
            ChatInputBar(chat: chat)
                .padding(Spacing.lg)
        }
        .background(MeshBackground())
        .overlay(alignment: .top) {
            if let toast {
                Text(toast)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.glass, in: .capsule)
                    .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
                    .padding(.top, Spacing.md)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .sheet(item: $noteTarget) { target in
            AddToNoteSheet(
                api: api,
                markdown: target.markdown,
                defaultTitle: chat.activeConversation?.title
            ) { result in
                show(
                    toast: result.created
                        ? "Created \(result.noteTitle)"
                        : "Added to \(result.noteTitle)"
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if chat.historyLoading {
            centered { ProgressView().controlSize(.small) }
        } else if let historyError = chat.historyError {
            centered {
                ErrorCard(message: historyError, actionTitle: "Retry") {
                    Task { await chat.retryHistory() }
                }
            }
        } else if chat.messages.isEmpty {
            WelcomeState { question in
                chat.input = question
                Task { await chat.send() }
            }
        } else {
            messageList
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                    ForEach(chat.messages) { message in
                        MessageBubble(
                            message: message,
                            onVerseCopy: { verse in
                                VerseActions.copy(reference: verse.reference, text: verse.text)
                                show(toast: "Copied \(verse.reference)")
                            },
                            onVerseSaveToNote: { verse in save(verse) },
                            onVerseReadInBible: onReadInBible,
                            onOpenNote: { _ in show(toast: "Notes arrive in a later phase.") },
                            onOpenCross: onOpenCross,
                            onAddToNote: { answer in
                                noteTarget = PendingNoteSave(
                                    id: answer.id,
                                    markdown: answer.content
                                )
                            },
                            onFollowUp: { question in
                                chat.input = question
                                Task { await chat.send() }
                            }
                        )
                        .id(message.id)
                    }

                    if let sendError = chat.sendError {
                        ErrorCard(message: sendError, actionTitle: "Retry") {
                            Task { await chat.retrySend() }
                        }
                    }
                }
                .padding(Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Follow the answer as it streams.
            .onChange(of: chat.messages.last?.content) {
                guard let id = chat.messages.last?.id else { return }
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
            // The assistant just replaced today's word, so the cached day the
            // sidebar would show is now the old one.
            .onChange(of: chat.messages.last?.crossActions.last?.reference) { _, reference in
                if reference != nil { onCrossReplaced() }
            }
        }
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func save(_ verse: RetrievedVerse) {
        Task {
            do {
                try await VerseActions.saveToNote(
                    api: api,
                    reference: verse.reference,
                    text: verse.text
                )
                show(toast: "Saved \(verse.reference) to your notes")
            } catch {
                show(toast: (error as? APIError)?.message ?? "Could not save that verse.")
            }
        }
    }

    private func show(toast message: String) {
        withAnimation(.snappy) { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            withAnimation(.snappy) { toast = nil }
        }
    }
}

/// Port of `mobile/src/features/chat/ErrorCard.tsx`.
struct ErrorCard: View {
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
        .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.dangerBorder, lineWidth: 1)
        }
        .frame(maxWidth: 520)
    }
}
