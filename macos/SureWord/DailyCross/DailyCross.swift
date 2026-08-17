import Foundation

/// One stop on the day's study path: a chapter to read and what to look for.
struct DailyCrossStudyStep: Decodable, Equatable, Sendable {
    let book: String
    let chapter: Int
    let focus: String
}

/// "Pick Up Your Cross" (Luke 9:23) — the guided daily walk, as served by
/// `GET /api/verse-of-day/today`.
///
/// Mirrors the `DailyCrossEntry` interfaces in `src/app/cross/page.tsx` and
/// `mobile/src/features/notifications/api.ts`. Every field the generator may
/// leave null is decoded leniently: pre-guide `VerseOfDay` rows predate the
/// study path and question columns, and one of those coming back must render a
/// shorter day rather than fail the screen.
struct DailyCrossEntry: Decodable, Equatable, Sendable {
    let reference: String
    let book: String
    let chapter: Int
    let verse: Int
    let text: String
    let reason: String
    let whyToday: String?
    let application: String?
    let studyPath: [DailyCrossStudyStep]
    let question: String?

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reference = try container.decode(String.self, forKey: .reference)
        book = try container.decode(String.self, forKey: .book)
        chapter = try container.decode(Int.self, forKey: .chapter)
        verse = try container.decode(Int.self, forKey: .verse)
        text = try container.decode(String.self, forKey: .text)
        reason = try container.decode(String.self, forKey: .reason)
        whyToday = try container.decodeIfPresent(String.self, forKey: .whyToday)
        application = try container.decodeIfPresent(String.self, forKey: .application)
        studyPath = try container.decodeIfPresent([DailyCrossStudyStep].self, forKey: .studyPath) ?? []
        question = try container.decodeIfPresent(String.self, forKey: .question)
    }

    private enum CodingKeys: String, CodingKey {
        case reference, book, chapter, verse, text, reason
        case whyToday, application, studyPath, question
    }
}

extension DailyCrossEntry {
    /// Memberwise init for tests and previews; `Decodable` conformance above
    /// replaces the synthesised one.
    init(
        reference: String,
        book: String,
        chapter: Int,
        verse: Int,
        text: String,
        reason: String,
        whyToday: String? = nil,
        application: String? = nil,
        studyPath: [DailyCrossStudyStep] = [],
        question: String? = nil
    ) {
        self.reference = reference
        self.book = book
        self.chapter = chapter
        self.verse = verse
        self.text = text
        self.reason = reason
        self.whyToday = whyToday
        self.application = application
        self.studyPath = studyPath
        self.question = question
    }
}

enum DailyCrossAPI {
    /// A cold day is one utility-model call plus context reads — the route
    /// allows itself 120s, so the client must too. The API client's 30s default
    /// would time out on exactly the first fetch of the morning, the one that
    /// generates the day.
    static let generationTimeout: TimeInterval = 120

    /// Today's entry: the cron's if one exists inside the 20h reuse window,
    /// otherwise generated on demand and stored. Since the Mac client registers
    /// no push token, this is normally the call that creates the user's day.
    static func today(api: APIClient) async throws -> DailyCrossEntry {
        try await api.json(
            "/api/verse-of-day/today",
            timeout: generationTimeout,
            as: DailyCrossEntry.self
        )
    }

    /// Record that a chapter was read — the reading history that shapes which
    /// verse gets picked. Deliberately dumb, like the other clients: the caller
    /// debounces, and the server drops a repeat of the same chapter inside an
    /// hour.
    static func recordReading(
        api: APIClient,
        book: String,
        chapter: Int,
        translation: TranslationID
    ) async throws {
        try await api.data(
            "/api/reading-events",
            method: "POST",
            body: ReadingEvent(book: book, chapter: chapter, translation: translation.rawValue)
        )
    }

    private struct ReadingEvent: Encodable {
        let book: String
        let chapter: Int
        let translation: String
    }
}
