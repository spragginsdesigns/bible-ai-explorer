import Foundation

/// "Quiz me" (docs/quiz/PLAN.md): the Codable mirror of
/// `src/lib/quiz-contract.ts`, the contract between `POST /api/quiz`,
/// `POST /api/quiz/attempt` and every client. Change the TypeScript file, the
/// Android copy (`mobile/src/features/quiz/quizContract.ts`) and this one
/// together; `QuizTests` reads the TypeScript file and fails on a missing field.

/// How a chapter is asked. Never shown as a label on the reader themselves,
/// only as the two segments "Foundations" and "Going deeper".
enum QuizDepth: String, Codable, CaseIterable, Sendable, Identifiable {
    case seeking
    case growing

    var id: String { rawValue }

    var label: String {
        switch self {
        case .seeking: "Foundations"
        case .growing: "Going deeper"
        }
    }
}

enum QuizContract {
    /// `QUIZ_LENGTH`: questions in one quiz.
    static let length = 5
    /// `QUIZ_OPTION_COUNT`: answer choices per question.
    static let optionCount = 4
}

struct QuizQuestion: Codable, Equatable, Identifiable, Sendable {
    /// Stable within the quiz ("q1".."q5").
    let id: String
    let prompt: String
    /// Already in display order.
    let options: [String]
    /// Index into `options` of the right answer.
    let answerIndex: Int
    /// Verse numbers in this chapter, ascending; the first is primary.
    let verses: [Int]
    /// "John 3:3" or "John 3:3-5".
    let reference: String
    /// The KJV text of `verses`, from the bundled Bible, never the model.
    let verseText: String
    /// One short sentence on why, or nil.
    let note: String?
}

/// The closing card: one verse to carry and one question to answer in a note.
struct QuizReflection: Codable, Equatable, Sendable {
    let verse: Int
    let reference: String
    let verseText: String
    let prompt: String
}

struct ChapterQuiz: Codable, Equatable, Sendable {
    let book: Int
    let chapter: Int
    let bookName: String
    /// "John 3".
    let title: String
    let depth: QuizDepth
    let suggestedDepth: QuizDepth
    let questions: [QuizQuestion]
    let reflection: QuizReflection?
    let model: String?
    let cached: Bool
}

/// `POST /api/quiz/attempt` body. Coordinates and counts, never text.
struct QuizAttemptInput: Codable, Equatable, Sendable {
    let book: Int
    let chapter: Int
    let depth: QuizDepth
    let total: Int
    let correct: Int
    let missedVerses: [Int]
}

/// The pure rules every quiz screen reads, kept apart from the views so the
/// tests can pin the copy and the arithmetic the other clients share.
enum QuizRules {
    /// The letter on an option row: A-D.
    static func letter(_ index: Int) -> String {
        guard index >= 0, index < 26 else { return "" }
        return String(Character(UnicodeScalar(UInt8(65 + index))))
    }

    /// "FROM VERSE 3", "FROM VERSES 3-5" or "FROM VERSES 3, 5", read from the
    /// part of `reference` after the colon, falling back to `verses` when the
    /// reference has no colon.
    static func verseLabel(reference: String, verses: [Int] = []) -> String {
        var spec = ""
        if let colon = reference.lastIndex(of: ":") {
            spec = String(reference[reference.index(after: colon)...])
                .trimmingCharacters(in: .whitespaces)
        }
        if spec.isEmpty {
            spec = verses.map(String.init).joined(separator: ", ")
        }
        guard !spec.isEmpty else { return "" }
        // Normalise "3,5" and "3 ,5" to "3, 5" so the label reads as prose.
        let parts = spec.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let joined = parts.joined(separator: ", ")
        let plural = parts.count > 1 || joined.contains("-")
        return "FROM \(plural ? "VERSES" : "VERSE") \(joined)"
    }

    /// The title above the results: "You remembered 4 of 5".
    static func headline(correct: Int, total: Int) -> String {
        "You remembered \(correct) of \(total)"
    }

    static func subline(missed: Int) -> String {
        switch missed {
        case ..<1: "Every answer, straight from the Word."
        case 1: "Here is the one worth another look."
        default: "Here are the ones worth another look."
        }
    }

    static func loadingLine(title: String) -> String {
        "Writing your questions from \(title)..."
    }

    static let slowLoadingLine = "Every answer is checked against the King James text."

    /// "Help me understand John 3:3: What did Jesus tell Nicodemus...?"
    static func askPrompt(reference: String, prompt: String) -> String {
        "Help me understand \(reference): \(prompt)"
    }

    /// The chapter after this one in canon order, crossing into the next book;
    /// nil at Revelation 22.
    static func nextChapter(book: Int, chapter: Int) -> (location: Bible.Location, title: String)? {
        guard let next = Bible.next(from: Bible.Location(order: book, chapter: chapter)),
              let name = Bible.book(order: next.order)?.name
        else { return nil }
        return (next, "\(name) \(next.chapter)")
    }

    /// The attempt record for a finished quiz. `answers` maps question id to
    /// the chosen option; an unanswered question counts as missed.
    static func attempt(for quiz: ChapterQuiz, answers: [String: Int]) -> QuizAttemptInput {
        let missed = quiz.questions.filter { answers[$0.id] != $0.answerIndex }
        return QuizAttemptInput(
            book: quiz.book,
            chapter: quiz.chapter,
            depth: quiz.depth,
            total: quiz.questions.count,
            correct: quiz.questions.count - missed.count,
            missedVerses: missed.compactMap(\.verses.first)
        )
    }

    /// "{title} reflection".
    static func reflectionTitle(_ quizTitle: String) -> String {
        "\(quizTitle) reflection"
    }

    /// The reflection note body: the verse as a blockquote with its reference
    /// in bold, the prompt in italics, then the reader's own words, one
    /// paragraph per line. The same shape the web and Android clients write.
    static func reflectionHTML(reflection: QuizReflection, words: String) -> String {
        let escape = VerseActions.escapeHTML
        let paragraphs = words
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { "<p>\(escape($0))</p>" }
            .joined()
        return "<blockquote><p><strong>\(escape(reflection.reference))</strong></p>"
            + "<p>\(escape(reflection.verseText))</p></blockquote>"
            + "<p><em>\(escape(reflection.prompt))</em></p>"
            + paragraphs
    }

    static func reflectionPlainText(reflection: QuizReflection, words: String) -> String {
        "\(reflection.reference)\n\(reflection.verseText)\n\n\(reflection.prompt)\n\n"
            + words.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Chapters dismissed with "Not now", kept on this device only and capped so
/// the list cannot grow without bound.
enum QuizDismissals {
    static let storageKey = "settings.bible.quizDismissed"
    static let limit = 200

    static func key(book: Int, chapter: Int) -> String { "\(book):\(chapter)" }

    static func contains(book: Int, chapter: Int, defaults: UserDefaults = .standard) -> Bool {
        (defaults.stringArray(forKey: storageKey) ?? []).contains(key(book: book, chapter: chapter))
    }

    static func dismiss(book: Int, chapter: Int, defaults: UserDefaults = .standard) {
        let entry = key(book: book, chapter: chapter)
        var list = (defaults.stringArray(forKey: storageKey) ?? []).filter { $0 != entry }
        list.append(entry)
        defaults.set(capped(list), forKey: storageKey)
    }

    /// Newest last; the oldest entries fall off first.
    static func capped(_ list: [String]) -> [String] {
        Array(list.suffix(limit))
    }
}
