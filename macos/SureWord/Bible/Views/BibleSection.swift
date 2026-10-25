import SwiftUI

/// The Bible section: book picker on the left, chapter grid or reader on the
/// right. Android splits these across four pushed screens
/// (`mobile/app/(app)/bible/*`); a Mac window is wide enough to keep the picker
/// and the search field permanently visible, which is the only difference.
struct BibleSection: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Owned by `AppModel`, not by this view: switching to chat and back
    /// destroys `BibleSection`, and reader state that died with it would send
    /// the user back to "Choose a book" every time.
    private var model: BibleModel { app.bible }
    @State private var showingAtlas = false
    @State private var showingPlan = false
    @State private var showingSermons = false
    @State private var showingLearn = false
    @State private var showingHistory = false
    @State private var atlasBook: Int?
    @State private var atlasChapter: Int?

    var body: some View {
        HStack(spacing: 0) {
            BibleSidebar(
                model: model,
                onShowBible: { showBible() }
            )
                .frame(width: 300)

            Divider().overlay(theme.border)

            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle("Bible")
        .toolbar { Button { showingHistory = true } label: { Label("Reading history", systemImage: "clock.arrow.circlepath") } }
        .sheet(isPresented: $showingHistory) {
            ReadingHistoryView(model: model.reading, onOpen: { target in
                showBible()
                model.open(order: target.book, chapter: target.chapter, verse: target.verse,
                           translationOverride: target.translation)
            }, onTalk: { prompt in
                // Android pushes the chat home with `?prompt=`: the composer is
                // filled and focused, and sending is left to the person.
                if let prompt { app.chat.input = prompt }
                app.section = .chat
            })
            .analyticsScreen(AnalyticsScreen.history)
            .onDisappear { Analytics.shared.screenReturned(from: AnalyticsScreen.history, to: detailScreen) }
        }
        // The pane in front is the screen Android would have pushed.
        .onChange(of: detailScreen, initial: true) { _, screen in Analytics.shared.screen(screen) }
        .onChange(of: showingHistory) { _, visible in model.reading.setObscured(visible, reason: "history") }
        // The quiz covers the chapter, so it is not being read meanwhile.
        .onChange(of: model.quiz != nil) { _, visible in model.reading.setObscured(visible, reason: "quiz") }
        // The sidebar moved the reader elsewhere: the quiz no longer belongs
        // to what is selected.
        .onChange(of: model.location) { _, location in
            guard let quiz = model.quiz else { return }
            if location != Bible.Location(order: quiz.book, chapter: quiz.chapter) { model.closeQuiz() }
        }
        .onChange(of: model.pane) { _, pane in
            if pane != .reader { model.closeQuiz() }
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.bgElevated, in: .rect(cornerRadius: Radius.full))
                    .overlay {
                        Capsule().strokeBorder(theme.border, lineWidth: 1)
                    }
                    .padding(.bottom, Spacing.xl)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: model.toast)
        // A verse reference tapped in chat lands here. Consume it once: the
        // reader is a long-lived pane, so leaving the value set would re-open
        // the same verse every time the section is shown.
        .onChange(of: app.pendingVerseReference, initial: true) { _, pending in
            guard let pending else { return }
            showBible()
            if let reference = Bible.resolveReference(pending) {
                model.open(reference, translationOverride: app.pendingVerseTranslation)
            }
            app.pendingVerseReference = nil
            app.pendingVerseTranslation = nil
        }
    }

    /// Android's route for the pane `detail` is showing (`screen_viewed`).
    private var detailScreen: String {
        if showingLearn { return AnalyticsScreen.learn }
        if showingSermons { return AnalyticsScreen.sermons }
        if showingPlan { return AnalyticsScreen.plan }
        if showingAtlas { return AnalyticsScreen.timeline }
        guard model.selectedBook != nil else { return AnalyticsScreen.bible }
        switch model.pane {
        case .chapters: return AnalyticsScreen.chapters
        case .reader: return AnalyticsScreen.chapter
        }
    }

    /// Back to the books, whichever pane was covering them.
    private func showBible() {
        model.closeQuiz()
        showingAtlas = false
        showingPlan = false
        showingSermons = false
        showingLearn = false
        atlasBook = nil
        atlasChapter = nil
    }

    /// Learn a verse in front of the books, from the sidebar card, the
    /// reader's Added chip or a chat receipt.
    private func showLearn() {
        showBible()
        showingLearn = true
    }

    @ViewBuilder
    private var detail: some View {
        if let quiz = model.quiz {
            QuizScreen(model: quiz, actions: quizActions(quiz))
        } else if showingLearn {
            LearnPane(onDismiss: { showBible() })
        } else if showingSermons {
            SermonStudiesPane(onDismiss: { showBible() })
        } else if showingPlan {
            ReadingPlanPane(
                model: model.plan,
                onOpenReading: { reading in
                    // The plan names books the way the KJV data does, so the
                    // shared resolver is all the translation needed - the same
                    // path the atlas reference chips take.
                    guard let reference = Bible.resolveReference("\(reading.book) \(reading.chapter)")
                    else { return }
                    showBible()
                    model.open(reference)
                },
                onDismiss: { showBible() }
            )
        } else if showingAtlas {
            AtlasExplorerPane(
                model: app.atlas,
                onOpenReference: { rawReference in
                    guard let reference = Bible.resolveReference(rawReference) else { return }
                    showingAtlas = false
                    atlasBook = nil
                    atlasChapter = nil
                    model.open(reference)
                },
                onDismiss: {
                    showingAtlas = false
                    atlasBook = nil
                    atlasChapter = nil
                },
                scopedBook: atlasBook,
                scopedChapter: atlasChapter
            )
        } else if model.selectedBook == nil {
            emptyState
        } else {
            switch model.pane {
            case .chapters:
                ChapterGridPane(model: model)
            case .reader:
                ChapterReaderPane(
                    model: model,
                    askAI: askAI,
                    showAtlas: { book, chapter in
                        atlasBook = book
                        atlasChapter = chapter
                        showingAtlas = true
                    },
                    showLearn: { showLearn() },
                    startQuiz: { book, chapter in model.startQuiz(book: book, chapter: chapter) }
                )
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "book.closed")
                .font(.system(size: 28))
                .foregroundStyle(theme.textGhost)
            Text("Choose a book")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("All 66 books of the King James Bible are bundled with the app and read offline.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// "Quiz me" hops: back to the reader, into Chat with the question, to a
    /// saved reflection note, or on to the next chapter.
    private func quizActions(_ quiz: QuizModel) -> QuizActions {
        QuizActions(
            close: { model.closeQuiz() },
            readInContext: { verse in
                model.closeQuiz()
                model.open(order: quiz.book, chapter: quiz.chapter, verse: verse, translationOverride: model.translationOverride)
            },
            ask: { prompt, reference, text in
                // The quiz lives on the model, so it is still open when the
                // reader comes back from Chat.
                app.chat.input = prompt
                app.chat.attachment = VerseAttachment(reference: reference, text: text, translation: .kjv)
                app.section = .chat
            },
            openNote: { noteID in
                app.pendingNoteID = noteID
                app.section = .notes
            },
            continueTo: { location in
                model.closeQuiz()
                model.go(to: location)
            }
        )
    }

    /// Attach the passage to the next question and switch to chat — the Mac
    /// equivalent of Android pushing "/" with `?attachRef&attachText`.
    private func askAI(reference: String, text: String) {
        app.chat.attachment = VerseAttachment(
            reference: reference,
            text: text,
            translation: app.settings.translation
        )
        model.dismissVerseActions()
        app.section = .chat
    }
}
