import Foundation

// MARK: - Wire types

/// Decoded morphology for one word, from the server's `decodeMorphology`.
///
/// Mirrors `VerseWordGrammar` in `src/lib/verse-words-contract.ts`. Decoded
/// leniently for the same reason every other wire type here is: a field the
/// server stops sending must cost one line of a card, never the whole study.
struct VerseWordGrammar: Decodable, Equatable, Sendable {
    var partOfSpeech: String
    var features: [String]
    var summary: String

    private enum CodingKeys: String, CodingKey {
        case partOfSpeech, features, summary
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        partOfSpeech = try container.decodeIfPresent(String.self, forKey: .partOfSpeech) ?? ""
        features = try container.decodeIfPresent([String].self, forKey: .features) ?? []
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
    }

    init(partOfSpeech: String = "", features: [String] = [], summary: String = "") {
        self.partOfSpeech = partOfSpeech
        self.features = features
        self.summary = summary
    }
}

/// One word of the original text, in text order, with everything deterministic.
///
/// Hebrew arrives with its cantillation already stripped by the server, so the
/// client renders `text` and `lemma` as they come.
struct VerseWordDetail: Decodable, Equatable, Sendable {
    var text: String
    var strongs: String
    var morph: String
    var lemma: String?
    var translit: String?
    var gloss: String?
    /// Plain-English grammar for the whole word, or nil when undecodable.
    var grammar: VerseWordGrammar?

    private enum CodingKeys: String, CodingKey {
        case text, strongs, morph, lemma, translit, gloss, grammar
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        strongs = try container.decodeIfPresent(String.self, forKey: .strongs) ?? ""
        morph = try container.decodeIfPresent(String.self, forKey: .morph) ?? ""
        lemma = try container.decodeIfPresent(String.self, forKey: .lemma)
        translit = try container.decodeIfPresent(String.self, forKey: .translit)
        gloss = try container.decodeIfPresent(String.self, forKey: .gloss)
        grammar = try container.decodeIfPresent(VerseWordGrammar.self, forKey: .grammar)
    }

    init(
        text: String,
        strongs: String = "",
        morph: String = "",
        lemma: String? = nil,
        translit: String? = nil,
        gloss: String? = nil,
        grammar: VerseWordGrammar? = nil
    ) {
        self.text = text
        self.strongs = strongs
        self.morph = morph
        self.lemma = lemma
        self.translit = translit
        self.gloss = gloss
        self.grammar = grammar
    }

    /// The Strong's number, only when it is one. An empty string in the payload
    /// is not a number, and asking the lexicon for `""` would 400 for nothing.
    var strongsNumber: String? {
        let trimmed = strongs.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed.uppercased()
    }
}

/// One row of the interlinear list: a word or a bound phrase, and the KJV
/// wording it became.
struct VerseWordRow: Decodable, Equatable, Sendable {
    /// Indexes into `VerseWordStudy.words`, in text order.
    var wordIndexes: [Int]
    var original: String
    /// A reader's transliteration: "melo kaph", "re'ut ruach", "agape".
    var translit: String
    var kjv: String
    var sense: String

    private enum CodingKeys: String, CodingKey {
        case wordIndexes, original, translit, kjv, sense
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        wordIndexes = try container.decodeIfPresent([Int].self, forKey: .wordIndexes) ?? []
        original = try container.decodeIfPresent(String.self, forKey: .original) ?? ""
        translit = try container.decodeIfPresent(String.self, forKey: .translit) ?? ""
        kjv = try container.decodeIfPresent(String.self, forKey: .kjv) ?? ""
        sense = try container.decodeIfPresent(String.self, forKey: .sense) ?? ""
    }

    init(
        wordIndexes: [Int],
        original: String,
        translit: String = "",
        kjv: String = "",
        sense: String = ""
    ) {
        self.wordIndexes = wordIndexes
        self.original = original
        self.translit = translit
        self.kjv = kjv
        self.sense = sense
    }
}

/// The whole Words tab for one verse, as served by `POST /api/verse-words`.
///
/// Swift mirror of `VerseWordStudy` in `src/lib/verse-words-contract.ts`, whose
/// other mirror is `mobile/src/features/bible/useVerseWords.ts`. Change all
/// three together.
struct VerseWordStudy: Decodable, Equatable, Sendable {
    var book: Int
    var chapter: Int
    var verse: Int
    /// "Ecclesiastes 4:6"
    var reference: String
    /// "Hebrew" or "Greek". Kept as a `String` rather than an enum so a third
    /// value one day is a label the reader sees, not a body that fails to decode.
    var language: String
    /// "Westminster Leningrad Codex" or "Scrivener 1894 Textus Receptus".
    var textName: String
    var kjvText: String
    var words: [VerseWordDetail]
    var rows: [VerseWordRow]
    /// One or two short paragraphs.
    var study: [String]
    /// One sentence to carry away.
    var carry: String
    var model: String?
    var cached: Bool

    private enum CodingKeys: String, CodingKey {
        case book, chapter, verse, reference, language, textName, kjvText
        case words, rows, study, carry, model, cached
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        book = try container.decodeIfPresent(Int.self, forKey: .book) ?? 0
        chapter = try container.decodeIfPresent(Int.self, forKey: .chapter) ?? 0
        verse = try container.decodeIfPresent(Int.self, forKey: .verse) ?? 0
        reference = try container.decodeIfPresent(String.self, forKey: .reference) ?? ""
        language = try container.decodeIfPresent(String.self, forKey: .language) ?? ""
        textName = try container.decodeIfPresent(String.self, forKey: .textName) ?? ""
        kjvText = try container.decodeIfPresent(String.self, forKey: .kjvText) ?? ""
        words = try container.decodeIfPresent([VerseWordDetail].self, forKey: .words) ?? []
        rows = try container.decodeIfPresent([VerseWordRow].self, forKey: .rows) ?? []
        study = try container.decodeIfPresent([String].self, forKey: .study) ?? []
        carry = try container.decodeIfPresent(String.self, forKey: .carry) ?? ""
        model = try container.decodeIfPresent(String.self, forKey: .model)
        cached = try container.decodeIfPresent(Bool.self, forKey: .cached) ?? false
    }

    init(
        book: Int = 0,
        chapter: Int = 0,
        verse: Int = 0,
        reference: String = "",
        language: String = "",
        textName: String = "",
        kjvText: String = "",
        words: [VerseWordDetail] = [],
        rows: [VerseWordRow] = [],
        study: [String] = [],
        carry: String = "",
        model: String? = nil,
        cached: Bool = false
    ) {
        self.book = book
        self.chapter = chapter
        self.verse = verse
        self.reference = reference
        self.language = language
        self.textName = textName
        self.kjvText = kjvText
        self.words = words
        self.rows = rows
        self.study = study
        self.carry = carry
        self.model = model
        self.cached = cached
    }
}

/// One other place a Strong's number occurs, from
/// `GET /api/bible/strongs?examples=`.
struct StrongsOccurrence: Decodable, Equatable, Sendable {
    var reference: String
    var text: String
}

struct StrongsOccurrences: Decodable, Equatable, Sendable {
    /// Every verse of the original text carrying the number, not just the
    /// examples served.
    var total: Int
    var examples: [StrongsOccurrence]

    private enum CodingKeys: String, CodingKey { case total, examples }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        examples = try container.decodeIfPresent([StrongsOccurrence].self, forKey: .examples) ?? []
    }

    init(total: Int, examples: [StrongsOccurrence]) {
        self.total = total
        self.examples = examples
    }
}

/// A Strong's lexicon entry, as served by `GET /api/bible/strongs?number=H430`.
/// `occurrences` rides along only when the caller asked for `examples`.
struct StrongsEntry: Decodable, Equatable, Sendable {
    var number: String
    var lemma: String?
    var translit: String?
    var def: String?
    var kjv: String?
    var occurrences: StrongsOccurrences?

    private enum CodingKeys: String, CodingKey {
        case number, lemma, translit, def, kjv, occurrences
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        number = try container.decodeIfPresent(String.self, forKey: .number) ?? ""
        lemma = try container.decodeIfPresent(String.self, forKey: .lemma)
        translit = try container.decodeIfPresent(String.self, forKey: .translit)
        def = try container.decodeIfPresent(String.self, forKey: .def)
        kjv = try container.decodeIfPresent(String.self, forKey: .kjv)
        occurrences = try container.decodeIfPresent(StrongsOccurrences.self, forKey: .occurrences)
    }

    init(
        number: String,
        lemma: String? = nil,
        translit: String? = nil,
        def: String? = nil,
        kjv: String? = nil,
        occurrences: StrongsOccurrences? = nil
    ) {
        self.number = number
        self.lemma = lemma
        self.translit = translit
        self.def = def
        self.kjv = kjv
        self.occurrences = occurrences
    }
}

// MARK: - API

enum VerseWordsAPI {
    /// The first reader of a verse waits on the model, so this is the one call
    /// in the app allowed past the client's 30s default.
    static let studyTimeout: TimeInterval = 60

    /// How many other verses the detail card offers.
    static let exampleCount = 3

    struct StudyRequest: Encodable {
        let book: Int
        let chapter: Int
        let verse: Int
        let modelId: String?
    }

    static func study(
        api: APIClient,
        book: Int,
        chapter: Int,
        verse: Int,
        modelId: String?
    ) async throws -> VerseWordStudy {
        try await api.json(
            "/api/verse-words",
            method: "POST",
            body: StudyRequest(book: book, chapter: chapter, verse: verse, modelId: modelId),
            timeout: studyTimeout,
            as: VerseWordStudy.self
        )
    }

    /// One lexicon entry plus where else the number occurs. `exclude` is the
    /// verse the reader is already looking at, so it never quotes itself back.
    static func strongs(
        api: APIClient,
        number: String,
        examples: Int = exampleCount,
        exclude: String?
    ) async throws -> StrongsEntry {
        let encoded =
            number.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? number
        var path = "/api/bible/strongs?number=\(encoded)&examples=\(examples)"
        if let exclude, !exclude.isEmpty {
            let safe = exclude.addingPercentEncoding(
                withAllowedCharacters: CharacterSet(charactersIn: "0123456789")
            ) ?? exclude
            path += "&exclude=\(safe)"
        }
        return try await api.json(path, as: StrongsEntry.self)
    }
}

// MARK: - Model

/// State behind the Words tab of the Tap-a-verse sheet, shared by both Apple
/// shells (the Mac pins the panel under the reader, iOS presents it in the
/// verse sheet).
///
/// One instance per host view, `@State`-owned and handed the session's client
/// through `configure` - the `OriginalLanguageModel` pattern it replaces, for
/// the same reason: the view cannot read the environment at init time.
@MainActor
@Observable
final class VerseWordsModel {
    /// How the section should render.
    ///
    /// Unlike the raw original-language section this replaces, the Words tab is
    /// the whole tab, so it cannot simply vanish on a failure. The three
    /// unhappy answers are told apart because the reader can act on exactly one
    /// of them: `.failed` earns a Retry, the other two do not.
    enum Status: Equatable {
        /// Nothing asked for yet.
        case idle
        case loading
        case ready
        /// 404: the source texts have nothing for this verse.
        case unavailable
        /// 403: the account's model credentials refused the request.
        case blocked
        /// 502 or a transport failure. Retryable.
        case failed
    }

    struct Target: Equatable, Sendable {
        var book: Int
        var chapter: Int
        var verse: Int
    }

    static let noTextMessage = "No original-language text for this verse."
    static let buildFailureMessage = "Couldn't build the word study."

    private(set) var status: Status = .idle
    private(set) var study: VerseWordStudy?
    /// The line shown for `.unavailable`, `.blocked` and `.failed`.
    private(set) var message: String?
    /// Index into `study.rows` of the open detail card, if any.
    private(set) var openRow: Int?
    /// Lexicon entries fetched for this instance, keyed as `cacheKey` builds
    /// them. Observed, unlike the process-wide cache behind it, so a definition
    /// arriving redraws the open card.
    private(set) var definitions: [String: StrongsEntry] = [:]

    /// Studies are cached server-side across accounts; this second cache only
    /// saves the round trip inside one launch. Lexicon entries are immutable,
    /// so one fetch per number per launch is plenty. Both are MainActor
    /// isolated with the rest of the type, which is what makes a mutable static
    /// safe here.
    private static var studyCache: [String: VerseWordStudy] = [:]
    private static var strongsCache: [String: StrongsEntry] = [:]

    private var api: APIClient?
    private var modelId: String?
    /// The verse the current state belongs to, and the staleness guard: a
    /// response for a verse the reader has already left is dropped.
    private var loadedKey: String?
    private(set) var target: Target?
    private var runID = 0
    private var pendingKeys: Set<String> = []

    /// Views hand over the session's client the first time they appear. The
    /// model id is re-read every time, so changing the chat model in Settings
    /// reaches the next verse without rebuilding the view.
    func configure(api: APIClient, modelId: String?) {
        if self.api == nil { self.api = api }
        self.modelId = modelId
    }

    // MARK: Reading

    var rows: [VerseWordRow] { study?.rows ?? [] }

    var isRightToLeft: Bool { Self.isRightToLeft(language: study?.language ?? "") }

    /// The words one row covers, in text order, skipping indexes the payload
    /// points outside `words`.
    func words(inRow index: Int) -> [VerseWordDetail] {
        guard let study, study.rows.indices.contains(index) else { return [] }
        return study.rows[index].wordIndexes.compactMap { wordIndex in
            study.words.indices.contains(wordIndex) ? study.words[wordIndex] : nil
        }
    }

    /// The word a row's lexicon lookup follows: the first one carrying a
    /// Strong's number. A bound phrase is looked up by its head, and a row of
    /// pure particles has nothing to look up at all.
    func drivingWord(inRow index: Int) -> VerseWordDetail? {
        words(inRow: index).first { $0.strongsNumber != nil }
    }

    /// The lexicon entry for one row, once it has arrived.
    func entry(inRow index: Int) -> StrongsEntry? {
        guard let key = cacheKey(forRow: index) else { return nil }
        return definitions[key]
    }

    /// True while a row's entry is still on its way, so the card can show a
    /// placeholder instead of an empty gap.
    func isEntryLoading(inRow index: Int) -> Bool {
        guard let key = cacheKey(forRow: index) else { return false }
        return definitions[key] == nil && pendingKeys.contains(key)
    }

    // MARK: Loading

    /// Fetch the word study for one verse. Re-entrant per verse: asking again
    /// for the verse already loaded is a no-op, so a re-render never re-bills
    /// the model.
    func load(book: Int, chapter: Int, verse: Int) async {
        let key = Self.key(book: book, chapter: chapter, verse: verse)
        guard key != loadedKey else { return }

        runID += 1
        let id = runID
        loadedKey = key
        target = Target(book: book, chapter: chapter, verse: verse)
        openRow = nil
        message = nil

        if let cached = Self.studyCache[key] {
            study = cached
            status = .ready
            return
        }

        study = nil
        status = .loading

        guard let api else {
            // No client means the host never configured the view. Nothing was
            // sent, so nothing can be retried into existence.
            fail(status: .failed, message: Self.buildFailureMessage)
            return
        }

        do {
            let loaded = try await VerseWordsAPI.study(
                api: api,
                book: book,
                chapter: chapter,
                verse: verse,
                modelId: modelId
            )
            guard runID == id else { return }
            guard !loaded.rows.isEmpty, !loaded.words.isEmpty else {
                study = nil
                status = .unavailable
                message = Self.noTextMessage
                return
            }
            Self.studyCache[key] = loaded
            study = loaded
            status = .ready
        } catch {
            guard runID == id, !Task.isCancelled else { return }
            study = nil
            apply(error)
        }
    }

    /// Ask again after a `.failed`. The key is cleared first so `load` does not
    /// mistake the retry for a re-render of the verse it already answered.
    func retry() async {
        guard let target else { return }
        loadedKey = nil
        await load(book: target.book, chapter: target.chapter, verse: target.verse)
    }

    private func apply(_ error: any Error) {
        let apiError = error as? APIError
        switch apiError?.status {
        case 404:
            status = .unavailable
            message = Self.noTextMessage
        case 403:
            // The server's own words: it is the only side that knows which
            // credential or plan refused, and a generic line would send the
            // reader looking in the wrong place.
            status = .blocked
            message = Self.trimmed(apiError?.message) ?? Self.buildFailureMessage
        default:
            fail(status: .failed, message: Self.buildFailureMessage)
        }
    }

    /// Enter a retryable failure. The key is dropped with it, so the section
    /// tries again by itself the next time the host reappears.
    private func fail(status: Status, message: String) {
        loadedKey = nil
        self.status = status
        self.message = message
    }

    // MARK: Selection

    /// Open (or close) the detail card for one row, fetching its Strong's entry
    /// the first time it is needed.
    func toggle(row index: Int) {
        guard let study, study.rows.indices.contains(index) else { return }
        // Tapping the open row closes it, which is the only way back to the
        // plain list.
        if openRow == index {
            openRow = nil
            return
        }
        openRow = index

        guard let number = drivingWord(inRow: index)?.strongsNumber,
              let key = cacheKey(forRow: index)
        else { return }
        if let cached = Self.strongsCache[key] {
            definitions[key] = cached
            return
        }
        loadEntry(number: number, key: key, exclude: excludeParameter)
    }

    func closeRow() {
        openRow = nil
    }

    private func loadEntry(number: String, key: String, exclude: String?) {
        guard let api, definitions[key] == nil, !pendingKeys.contains(key) else { return }
        pendingKeys.insert(key)

        Task { @MainActor [weak self] in
            let entry = try? await VerseWordsAPI.strongs(
                api: api,
                number: number,
                exclude: exclude
            )
            guard let self else { return }
            pendingKeys.remove(key)
            guard let entry else { return }
            Self.strongsCache[key] = entry
            definitions[key] = entry
        }
    }

    /// `book:chapter:verse` for the `exclude` parameter, so the card never
    /// quotes the verse the reader is already reading back at them.
    private var excludeParameter: String? {
        guard let target else { return nil }
        return "\(target.book):\(target.chapter):\(target.verse)"
    }

    /// Entries are cached per number *and* per excluded verse: the definition
    /// is the same everywhere, but the three examples beside it are not.
    private func cacheKey(forRow index: Int) -> String? {
        guard let number = drivingWord(inRow: index)?.strongsNumber else { return nil }
        return "\(number)@\(excludeParameter ?? "")"
    }

    private static func key(book: Int, chapter: Int, verse: Int) -> String {
        "\(book):\(chapter):\(verse)"
    }

    /// Test seam: both caches are process-wide by design, which would otherwise
    /// leak one test's fixture into the next.
    static func clearCache() {
        studyCache.removeAll()
        strongsCache.removeAll()
    }

    // MARK: - Pure helpers

    /// Hebrew reads right to left; Greek does not.
    static func isRightToLeft(language: String) -> Bool {
        language.caseInsensitiveCompare("Hebrew") == .orderedSame
    }

    /// Which language a verse is in before the study has arrived, so the
    /// loading line can already say "Reading the Hebrew". Malachi is book 39.
    static func isHebrew(book: Int) -> Bool { book <= 39 }

    /// The edition named in the footer. Spelled out for Hebrew, short for
    /// Greek, exactly as the other clients word it.
    static func sourceName(language: String) -> String {
        isRightToLeft(language: language) ? "Westminster Leningrad Codex" : "Textus Receptus"
    }

    /// `H5183 \u{00B7} a feminine noun`, with whichever half the payload has.
    static func metaLine(_ word: VerseWordDetail) -> String? {
        let summary = word.grammar?.summary.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let parts = [word.strongsNumber, summary.isEmpty ? nil : summary].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// The lexicon definition, falling back to the word's own KJV glosses when
    /// the dictionary has nothing, and to nil when neither does.
    static func definitionText(entry: StrongsEntry?, word: VerseWordDetail?) -> String? {
        if let def = trimmed(entry?.def) { return def }
        if let gloss = trimmed(word?.gloss) { return gloss }
        return trimmed(entry?.kjv)
    }

    /// The word the detail card puts in script: the lemma when the payload
    /// carries one, the word as it stands in the verse otherwise.
    static func headword(_ word: VerseWordDetail) -> String {
        trimmed(word.lemma) ?? word.text
    }

    /// `nachat`: the reader's spelling from the row, falling back to Strong's
    /// own notation.
    static func headTranslit(row: VerseWordRow?, word: VerseWordDetail?) -> String? {
        trimmed(row?.translit) ?? trimmed(word?.translit)
    }

    /// The prompt behind "Ask about this word". Attaches the verse, so chat
    /// answers it in the passage the reader is actually in.
    static func askPrompt(language: String, lemma: String, translit: String?, number: String)
        -> String
    {
        let named = trimmed(translit).map { "\(lemma) (\($0), \(number))" } ?? "\(lemma) (\(number))"
        return "What does the \(language) word \(named) carry in this verse?"
    }

    /// The prompt behind "Every verse". A lexicon search, so it travels without
    /// the verse attached.
    static func everyVersePrompt(language: String, lemma: String, number: String) -> String {
        "Show me every verse where the \(language) word \(lemma) (\(number)) appears."
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let value else { return nil }
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }
}
