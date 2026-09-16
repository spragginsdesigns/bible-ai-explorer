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
    /// Present on newer responses so chat can attribute a follow-up to the
    /// stored Daily Cross row. Older responses did not include it.
    let id: String?
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
    /// Today's primary theme, added with the "stay with this / somewhere fresh"
    /// controls. Servers older than those controls send neither key, so both
    /// decode leniently; an absent or empty `themeKey` means there is nothing to
    /// stay with and the "Stay with this" button does not apply.
    let themeKey: String?
    let theme: String?

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
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
        themeKey = try container.decodeIfPresent(String.self, forKey: .themeKey)
        theme = try container.decodeIfPresent(String.self, forKey: .theme)
    }

    private enum CodingKeys: String, CodingKey {
        case id, reference, book, chapter, verse, text, reason
        case whyToday, application, studyPath, question, themeKey, theme
    }
}

extension DailyCrossEntry {
    /// Memberwise init for tests and previews; `Decodable` conformance above
    /// replaces the synthesised one.
    init(
        id: String? = nil,
        reference: String,
        book: String,
        chapter: Int,
        verse: Int,
        text: String,
        reason: String,
        whyToday: String? = nil,
        application: String? = nil,
        studyPath: [DailyCrossStudyStep] = [],
        question: String? = nil,
        themeKey: String? = nil,
        theme: String? = nil
    ) {
        self.id = id
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
        self.themeKey = themeKey
        self.theme = theme
    }
}

/// How the user steered the next word: keep working the theme today's verse
/// already raised, or get away from it. Raw values are the wire contract for
/// `POST /api/verse-of-day/today`.
enum DailyCrossDirection: String, Encodable, Sendable {
    case stay
    case fresh
}

enum DailyCrossAPI {
    /// A cold day is one utility-model call plus context reads — the route
    /// allows itself 300s, so the client must too. The API client's 30s default
    /// would time out on exactly the first fetch of the morning, the one that
    /// generates the day.
    static let generationTimeout: TimeInterval = 300

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

    /// Replace today's entry with a newly prepared one, optionally centred on
    /// something the user typed. The same route the assistant's `setDailyCross`
    /// tool posts to, so a replacement from chat and one from this screen are
    /// the same act.
    ///
    /// `direction` is the "stay with this / somewhere fresh" steer. It combines
    /// with `focus`, and both are omitted from the body when nil, so a plain
    /// refresh still posts `{}` exactly as it always did.
    static func replaceToday(
        api: APIClient,
        focus: String? = nil,
        direction: DailyCrossDirection? = nil
    ) async throws -> DailyCrossEntry {
        try await api.json(
            "/api/verse-of-day/today",
            method: "POST",
            body: RefreshBody(focus: focus, direction: direction),
            timeout: generationTimeout,
            as: DailyCrossEntry.self
        )
    }

    /// Internal rather than private so the tests can pin which keys reach the
    /// route: `JSONEncoder` drops a nil optional, and the route branches on a
    /// key being present, so absence is the contract.
    struct RefreshBody: Encodable {
        let focus: String?
        let direction: DailyCrossDirection?

        init(focus: String? = nil, direction: DailyCrossDirection? = nil) {
            self.focus = focus
            self.direction = direction
        }
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
