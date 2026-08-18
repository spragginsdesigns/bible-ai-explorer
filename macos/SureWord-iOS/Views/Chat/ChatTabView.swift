import SwiftUI
import UIKit

/// The Chat tab — SureWord's home screen and the whole AI conversation
/// experience: streaming answers with tool cards, the welcome screen, the
/// composer, history and model-picker sheets.
///
/// Ports `macos/SureWord/Chat/Views/ChatView.swift` (and `mobile/app/(app)/index.tsx`
/// before it) to the phone: the sidebar's history lives in a sheet, hover
/// actions are context menus, and cross-screen hops are notifications —
/// `.openBibleVerse` for Lane 2's reader, `.openNote` for Lane 4's notes,
/// `.openDailyCross` (already observed by the shell) for Lane 5.
struct ChatTabView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @State private var toast: String?
    /// The answer whose "Add to notes" picker is open, if any.
    @State private var noteTarget: PendingNoteSave?
    @State private var isModelPickerPresented = false

    private var chat: ChatViewModel { app.chat }

    /// A settled answer waiting to be saved. Identifiable so `.sheet(item:)`
    /// re-presents cleanly when a second answer is picked.
    private struct PendingNoteSave: Identifiable {
        let id: String
        let markdown: String
    }

    var body: some View {
        @Bindable var chat = app.chat

        VStack(spacing: 0) {
            content
            ChatInputBar(chat: chat)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
        }
        .background(MeshBackground())
        .navigationTitle(chat.activeConversation?.title ?? "SureWord")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    chat.isHistoryPresented = true
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                }
                .accessibilityLabel("Conversation history")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isModelPickerPresented = true
                } label: {
                    Image(systemName: "cpu")
                }
                .accessibilityLabel("Choose a model")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    chat.newConversation()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New chat")
            }
        }
        .settingsGearToolbar()
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
        .sheet(isPresented: $chat.isHistoryPresented) {
            ChatHistorySheet(chat: chat)
        }
        .sheet(isPresented: $isModelPickerPresented) {
            ModelPickerSheet(api: app.api, settings: app.settings)
        }
        .sheet(item: $noteTarget) { target in
            ChatAddToNoteSheet(
                api: app.api,
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
            ProgressView().controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let historyError = chat.historyError {
            ChatErrorCard(message: historyError, actionTitle: "Retry") {
                Task { await chat.retryHistory() }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if chat.messages.isEmpty {
            ChatWelcomeState(
                questions: app.suggestedQuestions.questions,
                isLoading: app.suggestedQuestions.isLoading
            ) { question in
                chat.input = question
                Task { await chat.send() }
            }
            .task { app.suggestedQuestions.load() }
        } else {
            ChatMessageList(
                chat: chat,
                onVerseCopy: { verse in
                    VerseActions.copy(reference: verse.reference, text: verse.text)
                    show(toast: "Copied \(verse.reference)")
                },
                onVerseSaveToNote: { verse in save(verse) },
                onVerseReadInBible: readInBible,
                onOpenNote: openNote,
                onOpenCross: {
                    // The day the assistant just replaced is stale in the cached
                    // model, so force a reload on the way in.
                    app.dailyCross.load(force: true)
                    NotificationCenter.default.post(name: .openDailyCross, object: nil)
                },
                onCrossReplaced: { app.dailyCross.invalidate() },
                onAddToNote: { answer in
                    noteTarget = PendingNoteSave(id: answer.id, markdown: answer.content)
                }
            )
        }
    }

    // MARK: - Cross-screen hops (other lanes own the destinations)

    /// Lane 2's Bible reader: announce the reference — TabShell observes
    /// `.openBibleVerse`, stages it on `app.pendingVerseReference`, and
    /// switches tabs; the Bible tab root consumes the pending value and pushes
    /// the reader.
    private func readInBible(_ verse: RetrievedVerse) {
        NotificationCenter.default.post(
            name: .openBibleVerse,
            object: nil,
            userInfo: ["reference": verse.reference]
        )
    }

    /// Lane 4's Notes tab owns opening a note; chat only announces the id.
    private func openNote(_ action: NoteAction) {
        NotificationCenter.default.post(
            name: .openNote,
            object: nil,
            userInfo: ["noteId": action.noteID]
        )
        show(toast: "Opening \(action.noteTitle)…")
    }

    // MARK: - Verse save + toast

    private func save(_ verse: RetrievedVerse) {
        Task {
            do {
                try await VerseActions.saveToNote(
                    api: app.api,
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
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation(.snappy) { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            withAnimation(.snappy) { toast = nil }
        }
    }
}
