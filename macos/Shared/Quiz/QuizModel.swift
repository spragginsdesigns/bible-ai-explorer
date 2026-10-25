import Foundation

/// One run of "Quiz me" for one chapter: loading, the questions one at a time,
/// the results and the reflection note. Owned by `BibleModel.quiz`, so a quiz
/// in progress survives a trip to Chat ("Ask about this") on both platforms.
@MainActor
@Observable
final class QuizModel {
    enum Phase: Equatable {
        case loading
        case failed(String)
        case question
        case results
    }

    let book: Int
    let chapter: Int
    /// "John 3", from the bundled book names so the header is right before the
    /// server answers.
    let title: String

    private(set) var phase: Phase = .loading
    private(set) var quiz: ChapterQuiz?
    /// True once a load has run past four seconds, for the second loading line.
    private(set) var slow = false
    private(set) var index = 0
    /// The option picked on the current question, before or after checking.
    var selection: Int?
    private(set) var checked = false
    /// "Show me the verse first": the verse card without answering.
    var revealedVerse = false
    /// Question id to the chosen option, written when an answer is checked.
    private(set) var answers: [String: Int] = [:]
    /// The bundled KJV chapter, for the Mac's (and wide iPad's) side column.
    private(set) var chapterVerses: [String] = []

    var reflectionText = ""
    private(set) var savingReflection = false
    private(set) var savedNoteID: String?
    private(set) var reflectionError: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var attemptSent = false

    init(api: APIClient, book: Int, chapter: Int) {
        self.api = api
        self.book = book
        self.chapter = chapter
        self.title = Bible.book(order: book).map { "\($0.name) \(chapter)" } ?? ""
    }

    // MARK: Derived

    var questions: [QuizQuestion] { quiz?.questions ?? [] }
    var count: Int { questions.count }
    var current: QuizQuestion? { questions.indices.contains(index) ? questions[index] : nil }
    var isLast: Bool { index >= count - 1 }
    /// The depth switch shows only before anything has been answered.
    var canSwitchDepth: Bool { phase == .question && index == 0 && !checked && answers.isEmpty }
    var depth: QuizDepth { quiz?.depth ?? .seeking }
    var correctCount: Int { questions.filter { answers[$0.id] == $0.answerIndex }.count }
    var missed: [QuizQuestion] { questions.filter { answers[$0.id] != $0.answerIndex } }
    var showsVerse: Bool { checked || revealedVerse }
    /// The verses the side column highlights for the current question.
    var highlightedVerses: Set<Int> {
        guard phase == .question, let current else { return [] }
        return Set(current.verses)
    }
    var next: (location: Bible.Location, title: String)? { QuizRules.nextChapter(book: book, chapter: chapter) }

    // MARK: Loading

    /// The first load, with no depth so the server picks the reader's default.
    func start() {
        guard quiz == nil, loadTask == nil else { return }
        load(depth: nil)
    }

    func retry() { load(depth: quiz?.depth) }

    /// The Foundations / Going deeper switch: a fresh quiz at that depth.
    func switchDepth(_ depth: QuizDepth) {
        guard canSwitchDepth, depth != quiz?.depth else { return }
        load(depth: depth)
    }

    private func load(depth: QuizDepth?) {
        loadTask?.cancel()
        phase = .loading
        slow = false
        let book = book, chapter = chapter, api = api
        loadTask = Task {
            if chapterVerses.isEmpty,
               let verses = try? await KJVLibrary.shared.chapter(order: book, chapter: chapter) {
                chapterVerses = verses.map(VerseMarkup.plainText)
            }
            // A quiz is an AI request started by a tap.
            guard await AIConsentGate.ensure(.tap) else {
                guard !Task.isCancelled else { return }
                phase = .failed(AIConsent.declinedNotice)
                loadTask = nil
                return
            }
            let slowTimer = Task {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled else { return }
                slow = true
            }
            defer { slowTimer.cancel() }
            do {
                let loaded = try await QuizAPI.load(
                    api: api,
                    book: book,
                    chapter: chapter,
                    depth: depth,
                    modelId: SettingsStore.selectedChatModelId()
                )
                guard !Task.isCancelled else { return }
                quiz = loaded
                resetProgress()
                phase = .question
            } catch {
                guard !Task.isCancelled else { return }
                phase = .failed((error as? QuizAPI.LoadError)?.message ?? QuizAPI.unavailableMessage)
            }
            loadTask = nil
        }
    }

    private func resetProgress() {
        index = 0
        selection = nil
        checked = false
        revealedVerse = false
        answers = [:]
        attemptSent = false
    }

    // MARK: Answering

    func select(_ option: Int) {
        guard phase == .question, !checked, let current, current.options.indices.contains(option) else { return }
        selection = option
    }

    func check() {
        guard phase == .question, !checked, let current, let selection else { return }
        answers[current.id] = selection
        checked = true
    }

    /// Next question, or the results after the last one.
    func advance() {
        guard phase == .question, checked else { return }
        if isLast {
            finish()
        } else {
            index += 1
            selection = nil
            checked = false
            revealedVerse = false
        }
    }

    private func finish() {
        phase = .results
        guard !attemptSent, let quiz else { return }
        attemptSent = true
        let attempt = QuizRules.attempt(for: quiz, answers: answers)
        let api = api
        Task { await QuizAPI.recordAttempt(api: api, attempt) }
    }

    func chosen(for question: QuizQuestion) -> Int? { answers[question.id] }

    // MARK: Reflection

    func saveReflection() async {
        guard let reflection = quiz?.reflection, !savingReflection, savedNoteID == nil else { return }
        let words = reflectionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        savingReflection = true
        reflectionError = nil
        do {
            savedNoteID = try await VerseActions.createNote(
                api: api,
                title: QuizRules.reflectionTitle(quiz?.title ?? title),
                html: QuizRules.reflectionHTML(reflection: reflection, words: words),
                plainText: QuizRules.reflectionPlainText(reflection: reflection, words: words)
            )
        } catch {
            reflectionError = (error as? APIError)?.message
                ?? "The note could not be saved. Check your connection and try again."
        }
        savingReflection = false
    }

    func cancel() {
        loadTask?.cancel()
        loadTask = nil
    }
}
