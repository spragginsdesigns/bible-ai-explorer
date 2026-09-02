import Foundation

// MARK: - Wire types

/// One word of the Hebrew or Greek behind a verse, as served by
/// `GET /api/bible/original`.
///
/// Everything but `text` is optional on purpose. A word can carry no Strong's
/// number at all (punctuation, a maqqef fragment, an untagged particle), and
/// the lemma/transliteration/gloss are enrichment the route fills in where it
/// can. A missing field must cost that one line of the detail card, never the
/// whole section.
struct OriginalWord: Decodable, Equatable, Sendable {
    var text: String
    var strongs: String?
    var morph: String?
    var lemma: String?
    var translit: String?
    var gloss: String?

    private enum CodingKeys: String, CodingKey {
        case text, strongs, morph, lemma, translit, gloss
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decode(String.self, forKey: .text)
        strongs = try container.decodeIfPresent(String.self, forKey: .strongs)
        morph = try container.decodeIfPresent(String.self, forKey: .morph)
        lemma = try container.decodeIfPresent(String.self, forKey: .lemma)
        translit = try container.decodeIfPresent(String.self, forKey: .translit)
        gloss = try container.decodeIfPresent(String.self, forKey: .gloss)
    }

    init(
        text: String,
        strongs: String? = nil,
        morph: String? = nil,
        lemma: String? = nil,
        translit: String? = nil,
        gloss: String? = nil
    ) {
        self.text = text
        self.strongs = strongs
        self.morph = morph
        self.lemma = lemma
        self.translit = translit
        self.gloss = gloss
    }

    /// The Strong's number, only when it is one. An empty string in the payload
    /// is not a number, and asking the API for `""` would 404 for nothing.
    var strongsNumber: String? {
        guard let strongs else { return nil }
        let trimmed = strongs.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// One verse of the Westminster Leningrad Codex (Hebrew) or Textus Receptus
/// (Greek), word by word.
struct OriginalVerse: Decodable, Equatable, Sendable {
    var book: Int
    var chapter: Int
    var verse: Int
    var reference: String
    /// `"Hebrew"` or `"Greek"` - the language, not the text edition.
    var language: String
    /// The edition, e.g. "Westminster Leningrad Codex".
    var textName: String
    var words: [OriginalWord]

    private enum CodingKeys: String, CodingKey {
        case book, chapter, verse, reference, language, textName, words
    }

    /// Written out rather than synthesized, for the same reason `AIModel`'s is:
    /// synthesis ignores a property's default, so one absent field would throw
    /// away a verse the reader could otherwise mostly render. Only `words` is
    /// genuinely required - without it there is nothing to draw.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        book = try container.decodeIfPresent(Int.self, forKey: .book) ?? 0
        chapter = try container.decodeIfPresent(Int.self, forKey: .chapter) ?? 0
        verse = try container.decodeIfPresent(Int.self, forKey: .verse) ?? 0
        reference = try container.decodeIfPresent(String.self, forKey: .reference) ?? ""
        language = try container.decodeIfPresent(String.self, forKey: .language) ?? ""
        textName = try container.decodeIfPresent(String.self, forKey: .textName) ?? ""
        words = try container.decode([OriginalWord].self, forKey: .words)
    }

    init(
        book: Int,
        chapter: Int,
        verse: Int,
        reference: String,
        language: String,
        textName: String,
        words: [OriginalWord]
    ) {
        self.book = book
        self.chapter = chapter
        self.verse = verse
        self.reference = reference
        self.language = language
        self.textName = textName
        self.words = words
    }
}

/// A Strong's lexicon entry, as served by `GET /api/bible/strongs?number=H430`.
struct StrongsEntry: Decodable, Equatable, Sendable {
    var number: String
    var lemma: String?
    var translit: String?
    var def: String?
    var kjv: String?
}

enum OriginalLanguageAPI {
    static func verse(api: APIClient, book: Int, chapter: Int, verse: Int) async throws
        -> OriginalVerse
    {
        try await api.json(
            "/api/bible/original?book=\(book)&chapter=\(chapter)&verse=\(verse)",
            as: OriginalVerse.self
        )
    }

    static func strongs(api: APIClient, number: String) async throws -> StrongsEntry {
        let encoded =
            number.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? number
        return try await api.json("/api/bible/strongs?number=\(encoded)", as: StrongsEntry.self)
    }
}

// MARK: - Model

/// State behind the Tap-a-verse panel's "Original language" section, shared by
/// both Apple shells (the Mac pins the panel under the reader, iOS presents it
/// in the verse sheet).
///
/// One instance per host view, `@State`-owned and handed the session's client
/// through `configure` - the `ChurchModel` pattern, for the same reason: the
/// view cannot read the environment at init time.
@MainActor
@Observable
final class OriginalLanguageModel {
    /// How the section should render. `.unavailable` covers both a 404 (the
    /// route has no text for this verse) and any transport failure: the section
    /// is enrichment, so it is drawn or it is absent, never an error the reader
    /// has to dismiss.
    enum Status: Equatable { case idle, loading, ready, unavailable }

    private(set) var status: Status = .idle
    private(set) var verse: OriginalVerse?
    /// Index into `verse.words` of the open detail card, if any.
    private(set) var selectedIndex: Int?
    /// Strong's entries fetched for this instance. Observed, unlike the
    /// process-wide cache behind it, so a definition arriving redraws the card.
    private(set) var definitions: [String: StrongsEntry] = [:]

    /// Definitions are immutable, so one fetch per number per launch is plenty.
    /// MainActor-isolated with the rest of the type, which is what makes a
    /// mutable static safe here - the same arrangement `VerseInsightModel`
    /// uses for its answer cache.
    private static var cache: [String: StrongsEntry] = [:]

    private var api: APIClient?
    /// The verse the current state belongs to. Also the staleness guard: a
    /// response for a verse the reader has already left is dropped.
    private var loadedKey: String?
    /// Strong's numbers with a request in flight, so a double tap on the same
    /// chip does not open a second one.
    private var pendingNumbers: Set<String> = []

    /// Views hand over the session's client the first time they appear.
    func configure(_ api: APIClient) {
        if self.api == nil { self.api = api }
    }

    // MARK: Reading

    var words: [OriginalWord] { verse?.words ?? [] }

    var selectedWord: OriginalWord? {
        guard let selectedIndex, words.indices.contains(selectedIndex) else { return nil }
        return words[selectedIndex]
    }

    /// The lexicon entry for the open word, once it has arrived.
    var selectedDefinition: StrongsEntry? {
        guard let number = selectedWord?.strongsNumber else { return nil }
        return definitions[number]
    }

    /// True while the open word's definition is still on its way, so the card
    /// can show a placeholder instead of collapsing and reopening.
    var isDefinitionLoading: Bool {
        guard let number = selectedWord?.strongsNumber else { return false }
        return definitions[number] == nil && pendingNumbers.contains(number)
    }

    // MARK: Loading

    /// Fetch the original-language text for one verse. Re-entrant per verse:
    /// asking again for the verse already loaded is a no-op, so a re-render
    /// never re-bills the round trip.
    func load(book: Int, chapter: Int, verse: Int) async {
        let key = Self.key(book: book, chapter: chapter, verse: verse)
        guard key != loadedKey else { return }

        loadedKey = key
        self.verse = nil
        selectedIndex = nil
        status = .loading

        guard let api else {
            status = .unavailable
            return
        }

        do {
            let loaded = try await OriginalLanguageAPI.verse(
                api: api,
                book: book,
                chapter: chapter,
                verse: verse
            )
            guard loadedKey == key else { return }
            self.verse = loaded.words.isEmpty ? nil : loaded
            status = loaded.words.isEmpty ? .unavailable : .ready
        } catch {
            // A 404 is the common case (the New Testament has no WLC text, and
            // vice versa) and is not worth a word to the reader.
            guard loadedKey == key else { return }
            self.verse = nil
            // Leaving the key set would strand the section on a transient
            // failure until the reader moved verses; clearing it lets the next
            // appearance try again.
            loadedKey = nil
            status = .unavailable
        }
    }

    /// Open (or close) the detail card for one word, fetching its Strong's
    /// entry the first time it is needed.
    func select(word index: Int) {
        guard words.indices.contains(index) else { return }
        // Tapping the open word closes it, which is the only way back to the
        // plain row of chips.
        if selectedIndex == index {
            selectedIndex = nil
            return
        }
        selectedIndex = index

        guard let number = words[index].strongsNumber else { return }
        if let cached = Self.cache[number] {
            definitions[number] = cached
            return
        }
        loadDefinition(number)
    }

    func clearSelection() {
        selectedIndex = nil
    }

    private func loadDefinition(_ number: String) {
        guard let api, definitions[number] == nil, !pendingNumbers.contains(number) else { return }
        pendingNumbers.insert(number)

        Task { @MainActor [weak self] in
            let entry = try? await OriginalLanguageAPI.strongs(api: api, number: number)
            guard let self else { return }
            pendingNumbers.remove(number)
            guard let entry else { return }
            Self.cache[number] = entry
            definitions[number] = entry
        }
    }

    private static func key(book: Int, chapter: Int, verse: Int) -> String {
        "\(book):\(chapter):\(verse)"
    }

    /// Test seam: the definition cache is process-wide by design, which would
    /// otherwise leak one test's fixture into the next.
    static func clearCache() {
        cache.removeAll()
    }

    // MARK: - Pure helpers

    /// Strip Hebrew cantillation and accent marks (U+0591-U+05AF).
    ///
    /// They are chant notation, not reading aids: at chip size they crowd the
    /// consonants into an unreadable smear, and they play no part in looking a
    /// word up. Vowel points (U+05B0 and above) are deliberately kept.
    static func stripCantillation(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars where !(0x0591...0x05AF).contains(scalar.value) {
            scalars.append(scalar)
        }
        return String(scalars)
    }

    /// Hebrew reads right to left; Greek does not.
    static func isRightToLeft(language: String) -> Bool {
        language.caseInsensitiveCompare("Hebrew") == .orderedSame
    }
}
