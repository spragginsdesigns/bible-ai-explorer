import Foundation

/// The Learn a verse contract - a port of `mobile/src/features/learn/learn.ts`
/// (mirrored on web at `src/components/learn/learn.ts`). The server side is
/// `src/lib/learn.ts` behind `/api/learn`, `/api/learn/today` and
/// `/api/learn/:id/review`.
///
/// Parsing is strict on purpose, exactly as on Android: a card that fails any
/// check is refused rather than half-rendered, because a practice session that
/// sends a review for a card it misread would corrupt the schedule. Pinned by
/// `SureWord-iOSTests/LearnContractTests.swift`, which mirrors
/// `mobile/src/features/learn/learn.test.ts` and `tests/learn-mask.test.mjs`.
/// **If you change one side, change both.**

struct LearnParseError: Error, Equatable, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum LearnResult: String, Codable, Sendable, Equatable {
    case again, good
}

/// The three translations a card may be kept in. A raw string on the card
/// (validated against this set) so a client that has no BSB reader yet can
/// still practise a BSB card the server already resolved.
enum LearnTranslations {
    static let all = ["KJV", "NKJV", "BSB"]
}

struct LearnCard: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var revision: Int
    var book: Int
    var chapter: Int
    var verse: Int
    var translation: String
    var reference: String
    var text: String
    /// Only ever `true` or absent: the server could not resolve the requested
    /// translation, so `text` is empty and practice waits for a reload.
    var textUnavailable: Bool?
    /// 0 read, 1 every fourth word hidden, 2 half hidden, 3 recall from the
    /// reference.
    var stage: Int
    var intervalDays: Int
    var dueAt: String
    var knownAt: String?

    init(
        id: String,
        revision: Int,
        book: Int,
        chapter: Int,
        verse: Int,
        translation: String,
        reference: String,
        text: String,
        textUnavailable: Bool? = nil,
        stage: Int,
        intervalDays: Int,
        dueAt: String,
        knownAt: String?
    ) {
        self.id = id
        self.revision = revision
        self.book = book
        self.chapter = chapter
        self.verse = verse
        self.translation = translation
        self.reference = reference
        self.text = text
        self.textUnavailable = textUnavailable
        self.stage = stage
        self.intervalDays = intervalDays
        self.dueAt = dueAt
        self.knownAt = knownAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, revision, book, chapter, verse, translation, reference, text
        case textUnavailable, stage, intervalDays, dueAt, knownAt
    }

    static let invalid = LearnParseError(message: "Learn returned an invalid verse. Please reload.")

    /// `parseCard`: every check in the same order and with the same message.
    init(from decoder: any Decoder) throws {
        let invalid = Self.invalid
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { throw invalid }
        func int(_ key: CodingKeys) throws -> Int {
            guard let value = try? c.decode(Int.self, forKey: key) else { throw invalid }
            return value
        }
        func string(_ key: CodingKeys) throws -> String {
            guard let value = try? c.decode(String.self, forKey: key) else { throw invalid }
            return value
        }
        id = try string(.id)
        revision = try int(.revision)
        book = try int(.book)
        chapter = try int(.chapter)
        verse = try int(.verse)
        translation = try string(.translation)
        reference = try string(.reference)
        text = try string(.text)
        if c.contains(.textUnavailable) {
            guard let flag = try? c.decode(Bool.self, forKey: .textUnavailable), flag else { throw invalid }
            textUnavailable = true
        } else {
            textUnavailable = nil
        }
        stage = try int(.stage)
        intervalDays = try int(.intervalDays)
        dueAt = try string(.dueAt)
        // `knownAt` must be present: null, or an instant.
        guard c.contains(.knownAt) else { throw invalid }
        if (try? c.decodeNil(forKey: .knownAt)) == true {
            knownAt = nil
        } else {
            knownAt = try string(.knownAt)
        }
        try validate()
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(revision, forKey: .revision)
        try c.encode(book, forKey: .book)
        try c.encode(chapter, forKey: .chapter)
        try c.encode(verse, forKey: .verse)
        try c.encode(translation, forKey: .translation)
        try c.encode(reference, forKey: .reference)
        try c.encode(text, forKey: .text)
        if textUnavailable == true { try c.encode(true, forKey: .textUnavailable) }
        try c.encode(stage, forKey: .stage)
        try c.encode(intervalDays, forKey: .intervalDays)
        try c.encode(dueAt, forKey: .dueAt)
        // Explicit null: the strict decoder above requires the key.
        try c.encode(knownAt, forKey: .knownAt)
    }

    func validate() throws {
        let invalid = Self.invalid
        guard !id.isEmpty,
              revision >= 0,
              (1...66).contains(book),
              chapter >= 1,
              verse >= 1,
              LearnTranslations.all.contains(translation),
              !reference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              textUnavailable == nil || textUnavailable == true,
              !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && textUnavailable != true),
              (0...3).contains(stage),
              intervalDays >= 0,
              LearnTime.parse(dueAt) != nil,
              knownAt == nil || LearnTime.parse(knownAt!) != nil
        else { throw invalid }
    }
}

struct LearnToday: Codable, Sendable, Equatable {
    var cards: [LearnCard]
    var knownCount: Int
    var queueCount: Int

    init(cards: [LearnCard], knownCount: Int, queueCount: Int) {
        self.cards = cards
        self.knownCount = knownCount
        self.queueCount = queueCount
    }

    private enum CodingKeys: String, CodingKey { case cards, knownCount, queueCount }

    init(from decoder: any Decoder) throws {
        let invalid = LearnParseError(message: "Learn returned an invalid queue. Please reload.")
        guard let c = try? decoder.container(keyedBy: CodingKeys.self),
              let knownCount = try? c.decode(Int.self, forKey: .knownCount),
              let queueCount = try? c.decode(Int.self, forKey: .queueCount),
              let rawCards = try? c.decode([JSONValue].self, forKey: .cards)
        else { throw invalid }
        guard rawCards.count <= 3 else { throw invalid }
        // Per-card failures carry the card's own message, as `parseCard` does.
        let cards = try c.decode([LearnCard].self, forKey: .cards)
        self.init(cards: cards, knownCount: knownCount, queueCount: queueCount)
        try validate()
    }

    /// `parseToday`. Also run on values that never went through JSON (tests,
    /// the sync store's install path), so it re-checks the cards too.
    func validate() throws {
        guard cards.count <= 3, knownCount >= 0, queueCount >= 0 else {
            throw LearnParseError(message: "Learn returned an invalid queue. Please reload.")
        }
        for card in cards { try card.validate() }
        guard Set(cards.map(\.id)).count == cards.count else {
            throw LearnParseError(message: "Learn returned duplicate verses.")
        }
    }
}

struct LearnReviewOperation: Codable, Sendable, Equatable {
    var result: LearnResult
    var operationId: String
    var expectedRevision: Int
    var reviewedAt: String
    var timezone: String
}

struct LearnReviewAcknowledgement: Codable, Sendable, Equatable {
    var operationId: String
    var appliedRevision: Int
    var replayed: Bool
    var currentCard: LearnCard?

    init(operationId: String, appliedRevision: Int, replayed: Bool, currentCard: LearnCard?) {
        self.operationId = operationId
        self.appliedRevision = appliedRevision
        self.replayed = replayed
        self.currentCard = currentCard
    }

    private enum CodingKeys: String, CodingKey { case operationId, appliedRevision, replayed, currentCard }

    static let invalid = LearnParseError(message: "Learn returned an invalid review receipt. Please reload.")

    init(from decoder: any Decoder) throws {
        let invalid = Self.invalid
        guard let c = try? decoder.container(keyedBy: CodingKeys.self),
              let operationId = try? c.decode(String.self, forKey: .operationId),
              let appliedRevision = try? c.decode(Int.self, forKey: .appliedRevision),
              let replayed = try? c.decode(Bool.self, forKey: .replayed),
              c.contains(.currentCard)
        else { throw invalid }
        let card: LearnCard?
        if (try? c.decodeNil(forKey: .currentCard)) == true {
            card = nil
        } else {
            card = try c.decode(LearnCard.self, forKey: .currentCard)
        }
        self.init(operationId: operationId, appliedRevision: appliedRevision, replayed: replayed, currentCard: card)
        try validate(expectedOperationID: nil)
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(operationId, forKey: .operationId)
        try c.encode(appliedRevision, forKey: .appliedRevision)
        try c.encode(replayed, forKey: .replayed)
        try c.encode(currentCard, forKey: .currentCard)
    }

    /// `parseReviewAcknowledgement(value, expectedOperationId)`.
    func validate(expectedOperationID: String?) throws {
        if let expectedOperationID, operationId != expectedOperationID { throw Self.invalid }
        guard appliedRevision >= 1 else { throw Self.invalid }
        if let currentCard {
            try currentCard.validate()
            guard currentCard.revision >= appliedRevision else { throw Self.invalid }
        }
    }
}

struct VerseWord: Equatable, Sendable {
    let text: String
    let hidden: Bool
    let blank: String
}

enum Learn {
    /// Whitespace defines a word; punctuation surrounding a blank remains visible.
    static func verseWords(_ text: String, stage: Int) -> [VerseWord] {
        words(of: text).enumerated().map { index, word in
            let token = LearnPractice.split(word)
            return VerseWord(
                text: word,
                hidden: stage == 3 || (stage == 1 && index % 4 == 3) || (stage == 2 && index % 2 == 1),
                blank: "\(token.prefix)____\(token.suffix)"
            )
        }
    }

    static func maskVerse(_ text: String, stage: Int) -> String {
        verseWords(text, stage: stage).map { $0.hidden ? $0.blank : $0.text }.joined(separator: " ")
    }

    /// `text.trim().split(/\s+/).filter(Boolean)`.
    static func words(of text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    /// Keep valid cached text when a receipt cannot resolve that same translation.
    static func preserveCardText(_ previous: LearnCard?, _ current: LearnCard) -> LearnCard {
        guard current.textUnavailable == true,
              current.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let previous,
              !previous.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              previous.translation == current.translation
        else { return current }
        var restored = current
        restored.text = previous.text
        restored.textUnavailable = nil
        return restored
    }

    static func isCardDueAfterDay(_ card: LearnCard, instant: Date, timezone: String) -> Bool {
        guard let due = LearnTime.parse(card.dueAt) else { return false }
        let zone = LearnTime.validTimezone(timezone)
        return LearnTime.dayKey(due, timezone: zone) > LearnTime.dayKey(instant, timezone: zone)
    }

    /// Keep same-day ladder stages on screen; a completed stage-3 review leaves today.
    static func applyReviewAcknowledgement(
        _ today: LearnToday,
        before: LearnCard,
        operation: LearnReviewOperation,
        acknowledgement: LearnReviewAcknowledgement,
        receivedAt: Date = Date(),
        timezone: String = TimeZone.current.identifier
    ) throws -> LearnToday {
        guard acknowledgement.operationId == operation.operationId else {
            throw LearnParseError(message: "The review returned a different receipt. Please reload.")
        }
        guard acknowledgement.appliedRevision == operation.expectedRevision + 1 else {
            throw LearnParseError(message: "The review returned an unexpected revision. Please reload.")
        }
        let current = acknowledgement.currentCard.map { preserveCardText(before, $0) }
        if let current, current.id != before.id {
            throw LearnParseError(message: "The review returned a different verse. Please reload.")
        }
        let deferred = current.map { isCardDueAfterDay($0, instant: receivedAt, timezone: timezone) } ?? false
        var next = today
        next.knownCount = today.knownCount + (before.knownAt == nil && current?.knownAt != nil ? 1 : 0)
        if deferred || current == nil {
            next.cards = today.cards.filter { $0.id != before.id }
        } else {
            next.cards = today.cards.map { $0.id == before.id ? current! : $0 }
        }
        return next
    }
}

/// Instants and local days, matching what the TS clients do with `Date` and
/// `Intl.DateTimeFormat`.
enum LearnTime {
    /// `toISOString()`: always UTC, always milliseconds.
    static func format(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    static func parse(_ value: String) -> Date? {
        if let date = try? Date(value, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) {
            return date
        }
        return try? Date(value, strategy: Date.ISO8601FormatStyle())
    }

    /// An IANA zone the platform knows, or UTC - `validTimezone` in learnSync.ts.
    static func validTimezone(_ value: String) -> String {
        TimeZone(identifier: value) != nil ? value : "UTC"
    }

    private static func calendar(_ timezone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? TimeZone(identifier: "UTC")!
        return calendar
    }

    /// "YYYY-MM-DD" for the instant's local day in `timezone`.
    static func dayKey(_ instant: Date, timezone: String) -> String {
        let parts = calendar(timezone).dateComponents([.year, .month, .day], from: instant)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The local midnight `days` after the instant's local day, as an instant.
    static func startOfShiftedLocalDay(_ instant: Date, timezone: String, days: Int) -> Date {
        let calendar = calendar(timezone)
        var parts = calendar.dateComponents([.year, .month, .day], from: instant)
        parts.day = (parts.day ?? 1) + days
        parts.hour = 0
        parts.minute = 0
        parts.second = 0
        return calendar.date(from: parts) ?? instant
    }
}
