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
    /// A plan or Learn receipt tapped in chat pushes that screen onto this
    /// stack - the same screens the Bible home's cards push.
    @State private var studyRoute: StudyRoute?

    private enum StudyRoute: Hashable, Identifiable {
        case plan, learn
        /// Android's receipt routes (`mobile/src/lib/receiptRoutes.ts`): a
        /// memory or settings receipt opens that screen, not a hint.
        case memories, settings
        var id: Self { self }
    }
    /// A reading-log receipt opens the log as the Bible home does, as a sheet.
    @State private var isReadingHistoryPresented = false

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
            VStack(spacing: Spacing.sm) {
                // "Share into SureWord": the two one-tap actions, until the
                // shared chat has its first message.
                if let notices = chat.shareNotices {
                    ShareActionsRow(chat: chat, notices: notices)
                }
                ChatInputBar(chat: chat)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
        }
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        // A share opens over whatever was up; the picker would hide it.
        .onChange(of: chat.shareNotices != nil) { _, opened in
            if opened { isModelPickerPresented = false }
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
                .accessibilityLabel("Choose AI model")
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
        .navigationDestination(item: $studyRoute) { route in
            switch route {
            case .plan: ReadingPlanView().analyticsScreen(AnalyticsScreen.plan)
            case .learn: LearnView().analyticsScreen(AnalyticsScreen.learn)
            case .memories: ReceiptMemoriesScreen(api: app.api).analyticsScreen(AnalyticsScreen.memories)
            case .settings: SettingsView()
            }
        }
        .sheet(isPresented: $isReadingHistoryPresented) {
            ReadingHistoryView(model: app.bible.reading, onOpen: { target in
                isReadingHistoryPresented = false
                guard let reference = ReceiptLine.chapterReference(book: target.book, chapter: target.chapter, verse: target.verse) else { return }
                openChapter(reference: reference, translation: target.translation)
            }, onTalk: { prompt in
                // Already in chat: close the log and fill the composer.
                isReadingHistoryPresented = false
                if let prompt { app.chat.input = prompt }
            })
        }
        // A delete that failed after the sheet closed (Clear all dismisses at
        // once); while the sheet is up it presents the alert itself.
        .historyAlert(chat, isActive: !chat.isHistoryPresented)
        // `/clear`, confirmed with Android's alert before anything is deleted.
        .alert("Delete this conversation?", isPresented: $chat.isClearConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await chat.confirmClear() }
            }
        } message: {
            Text("The conversation and its messages will be removed.")
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
            // Android always offers Retry on the history card: reloading is
            // the remedy whatever the cause.
            ChatErrorCard(error: historyError, actionTitle: "Retry", alwaysRetry: true) {
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
                api: app.api,
                onVerseCopy: { verse in
                    VerseActions.copy(reference: verse.reference, text: verse.text, translation: verse.translation)
                    show(toast: "Copied \(verse.reference)")
                },
                onVerseSaveToNote: { verse in save(verse) },
                onVerseReadInBible: readInBible,
                onOpenReceipt: { receipt in openReceipt(receipt) },
                onReceiptError: { message in show(toast: message) },
                onCrossReplaced: { app.dailyCross.invalidate() },
                onAddToNote: { answer in
                    noteTarget = PendingNoteSave(id: answer.id, markdown: answer.content)
                },
                onFeedback: { answer, feedback, details in
                    Task {
                        // The thumb has already moved; only a failed write has
                        // anything to say.
                        if let failure = await chat.setFeedback(
                            messageID: answer.id,
                            feedback: feedback,
                            reason: details?.reason,
                            tags: details?.tags ?? []
                        ) {
                            show(toast: failure)
                        }
                    }
                },
                onShare: { answer in
                    // Every tap POSTs, as Android does, so a link revoked in
                    // Settings is re-activated before it is handed out again.
                    if let failure = await chat.shareAnswer(messageID: answer.id) {
                        show(toast: failure)
                        return nil
                    }
                    return chat.sharedLink(for: answer.id)
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
        var userInfo: [AnyHashable: Any] = ["reference": verse.reference]
        if let translation = verse.translation {
            userInfo["translation"] = translation.rawValue
        }
        NotificationCenter.default.post(
            name: .openBibleVerse,
            object: nil,
            userInfo: userInfo
        )
    }

    /// Lane 4's Notes tab owns opening a note; chat only announces the id.
    /// TabShell observes `.openNote`, stages `app.pendingNoteID` and switches
    /// tabs (`SureWord-iOS/Views/TabShell.swift:95`).
    private func openNote(_ noteID: String) {
        NotificationCenter.default.post(
            name: .openNote,
            object: nil,
            userInfo: ["noteId": noteID]
        )
    }

    /// Where a receipt fragment goes on the phone, matching Android's
    /// `receiptRoutes.ts`: memories, settings and the reading log open their
    /// screens on this stack rather than saying where to look.
    private func openReceipt(_ receipt: ChatReceipt) {
        switch receipt.target {
        case .note(let noteID):
            openNote(noteID)
        case .memories:
            studyRoute = .memories
        case .chapter(let book, let chapter, let verse, let translation):
            guard let reference = ReceiptLine.chapterReference(book: book, chapter: chapter, verse: verse) else {
                show(toast: "That passage could not be opened.")
                return
            }
            openChapter(reference: reference, translation: translation)
        case .plan:
            studyRoute = .plan
        case .readingHistory:
            isReadingHistoryPresented = true
        case .cross:
            // The day the assistant just replaced is stale in the cached model,
            // so force a reload on the way into the sheet.
            app.dailyCross.load(force: true)
            NotificationCenter.default.post(name: .openDailyCross, object: nil)
        case .learn:
            studyRoute = .learn
        case .settings(let section):
            // Android opens settings/memory for a memory change and the hub
            // otherwise (church lives inside the hub on iOS).
            studyRoute = section == .memory ? .memories : .settings
        }
    }

    /// Same journey as a verse card, from a reference the receipt's book and
    /// chapter numbers were turned into.
    private func openChapter(reference: String, translation: TranslationID?) {
        var userInfo: [AnyHashable: Any] = ["reference": reference]
        if let translation {
            userInfo["translation"] = translation.rawValue
        }
        NotificationCenter.default.post(name: .openBibleVerse, object: nil, userInfo: userInfo)
    }

    // MARK: - Verse save + toast

    private func save(_ verse: RetrievedVerse) {
        Task {
            do {
                try await VerseActions.saveToNote(
                    api: app.api,
                    reference: verse.reference,
                    text: verse.text,
                    translation: verse.translation
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

/// Settings → Memory, opened from a "Remembered" receipt. It owns its model,
/// as `SettingsView` does, because nothing else on the chat stack holds one.
private struct ReceiptMemoriesScreen: View {
    let api: APIClient
    @State private var model = MemoriesModel()

    var body: some View {
        MemoriesView(model: model)
            .task {
                model.configure(api)
                await model.load()
            }
    }
}
