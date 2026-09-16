import SwiftUI

/// The chat detail pane: message list, error states, and the composer.
struct ChatView: View {
    @Environment(\.theme) private var theme
    /// The picker writes the chosen model and effort straight into the store
    /// `ChatViewModel` reads on every send.
    @Environment(SettingsStore.self) private var settings
    /// Only for a note receipt's hop to the Notes section. Injected on the
    /// signed-in shell (`SureWord/App/SureWordApp.swift:134`), which is this
    /// pane's only parent (`MainWindow.swift:60`).
    @Environment(AppModel.self) private var app
    @Bindable var chat: ChatViewModel
    let api: APIClient
    /// This user's opening questions, generated once per session.
    let suggested: SuggestedQuestionsModel
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
    /// The model list behind the header picker. Owned here so the toolbar
    /// button can name the current model while the popover is closed.
    @State private var models = ModelPickerModel()
    @State private var isModelPickerPresented = false

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
        .toolbar { modelPickerItem }
        .task {
            models.configure(api)
            await models.load()
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

    /// Model + reasoning picker, the Mac form of the web dropdown and the iOS
    /// sheet: a sparkles button in the window toolbar opening a native popover.
    @ToolbarContentBuilder
    private var modelPickerItem: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                isModelPickerPresented.toggle()
            } label: {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "sparkles")
                    Text(
                        ModelPickerRules.buttonLabel(
                            in: models.data,
                            stored: settings.chatModelId
                        )
                    )
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    // A model id can be long enough to push the rest of the
                    // toolbar off the window; web caps the same caption at
                    // 110px. Middle-truncate so the family stays readable.
                    .frame(maxWidth: 140)
                    .truncationMode(.middle)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.textGhost)
                }
            }
            .help("Choose the AI model and reasoning effort")
            .accessibilityLabel("Choose AI model")
            .popover(isPresented: $isModelPickerPresented, arrowEdge: .bottom) {
                ModelPickerPopover(
                    models: models,
                    settings: settings,
                    isPresented: $isModelPickerPresented
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
            WelcomeState(
                questions: suggested.questions,
                isLoading: suggested.isLoading
            ) { question in
                chat.input = question
                Task { await chat.send() }
            }
            .task { suggested.load() }
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
                            api: api,
                            onVerseCopy: { verse in
                                VerseActions.copy(reference: verse.reference, text: verse.text, translation: verse.translation)
                                show(toast: "Copied \(verse.reference)")
                            },
                            onVerseSaveToNote: { verse in save(verse) },
                            onVerseReadInBible: onReadInBible,
                            onOpenReceipt: { receipt in openReceipt(receipt) },
                            onReceiptError: { message in show(toast: message) },
                            onAddToNote: { answer in
                                noteTarget = PendingNoteSave(
                                    id: answer.id,
                                    markdown: answer.content
                                )
                            },
                            onFeedback: { answer, feedback, reason in
                                Task {
                                    // The thumb has already moved; only a failed
                                    // write has anything to say.
                                    if let failure = await chat.setFeedback(
                                        messageID: answer.id,
                                        feedback: feedback,
                                        reason: reason
                                    ) {
                                        show(toast: failure)
                                    }
                                }
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
            // Follow the answer as it streams - deliberately *unanimated*.
            //
            // This used to be `withAnimation(.easeOut(duration: 0.15)) { … }`,
            // and that one modifier hung the whole app on the second send of
            // every conversation. Animating the offset makes the scroll view
            // re-resolve the target on every frame of the animation, but inside
            // a `LazyVStack` the target's offset is only an *estimate* until the
            // rows between here and there have been realised. On the first send
            // the list is two short rows and the estimate converges immediately.
            // On the second send the animation starts while a full settled answer
            // is being re-laid-out above and two more rows are inserted below, so
            // each pass realises rows, corrects the estimated content length,
            // moves the target, and asks for another pass. It never reaches a
            // fixed point: the main thread spins forever in
            // `LazySubviewPlacements.updateValue → LazyStack.place →
            // LazyHVStack.lengthAndSpacing`, the window stops repainting, and
            // even the accessibility window list comes back empty.
            //
            // Unanimated, `scrollTo` resolves once against the geometry it
            // already has, and the follow-the-stream behaviour is identical to
            // the eye - chunks arrive many times a second, so a 150ms ease was
            // never visible as motion anyway. The transaction explicitly
            // *disables* animation rather than merely not adding one, so an
            // animated transaction elsewhere can never re-inherit the hang.
            .onChange(of: chat.messages.last?.content) {
                guard let id = chat.messages.last?.id else { return }
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
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

    /// Where a receipt fragment goes on the Mac. The window's sections are
    /// `chat`, `bible`, `notes` and `cross` (`AppSection`, `Shared/App/AppModel.swift:9`),
    /// and the shell also handed this pane two hops of its own: the Daily Cross
    /// and the reader. Anything a section owns privately - the Memories sheet
    /// inside Settings, the reading plan and history panes inside Bible - is
    /// named rather than jumped to, because there is no cross-section hook.
    private func openReceipt(_ receipt: ChatReceipt) {
        switch receipt.target {
        case .note:
            // Selecting the section is the whole hop: `NotesSection` builds its
            // own `NotesLibraryModel` on appear (`SureWord/Notes/Views/NotesSection.swift:24`)
            // and owns `selectedNoteID`, so there is nothing here to preselect
            // with. `AppModel.pendingNoteID` is the iOS-only route and says so
            // (`Shared/App/AppModel.swift:78`).
            app.section = .notes
        case .memories:
            show(toast: ReceiptLine.settingsMessage(for: .memory))
        case .chapter(let book, let chapter, let verse, let translation):
            guard let reference = ReceiptLine.chapterReference(book: book, chapter: chapter, verse: verse) else {
                show(toast: "That passage could not be opened.")
                return
            }
            // The only route into the reader from here is the verse-card hop the
            // shell passed down, which reads the reference and translation only.
            onReadInBible(
                RetrievedVerse(reference: reference, similarity: 0, text: nil, translation: translation)
            )
        case .plan:
            show(toast: "Your reading plan is in the Bible section.")
        case .readingHistory:
            show(toast: "Reading history is in the Bible section's toolbar.")
        case .cross:
            onOpenCross()
        case .learn:
            show(toast: "Learn arrives in a later phase.")
        case .settings(let section):
            show(toast: ReceiptLine.settingsMessage(for: section))
        }
    }

    private func save(_ verse: RetrievedVerse) {
        Task {
            do {
                try await VerseActions.saveToNote(
                    api: api,
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
