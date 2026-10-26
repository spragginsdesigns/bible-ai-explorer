import Foundation

/// Groups an answer's retrieved verses into readable passages.
///
/// Port of `src/lib/chat/versePassages.ts` (byte-identical in
/// `mobile/src/lib/versePassages.ts`). `VersePassagesTests` mirrors
/// `tests/verse-passages.test.mjs` case for case, so change all of them together.
///
/// Why it exists: a getPassage call for "2 Peter 3:5-13" used to render as nine
/// separate rows, each with its own "100%" score and its own actions, so one
/// answer could scroll for screens (production, 2026-10: a quarter of answers
/// carried 20+ verses, the largest 85). Contiguous verses from one lookup now
/// read as one passage, ordered by where the answer cites them, and search hits
/// keep their scores in a section of their own.
struct VersePassage: Sendable, Equatable, Identifiable {
    enum Kind: Sendable, Equatable {
        case passage, search
    }

    struct Verse: Sendable, Equatable {
        var verse: Int
        var text: String?
    }

    /// Stable within one answer; used to focus the passage in the sheet.
    var key: String
    var kind: Kind
    /// "Psalms 56:1-4", or the verse's own reference for a single verse.
    var reference: String
    /// Reference of the first verse, for the reader hop.
    var firstReference: String
    var translation: TranslationID?
    var order: Int?
    var chapter: Int?
    var verses: [Verse]
    /// Best score in the group; nil for exact lookups, which have none.
    var similarity: Double?

    var id: String { key }

    /// "Be merciful unto me..." for one verse; "1 Be merciful... 2 Mine enemies..." for several.
    var plainText: String {
        if verses.count == 1 { return verses[0].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        return verses.compactMap { entry -> String? in
            guard let text = entry.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            return "\(entry.verse) \(text)"
        }
        .joined(separator: " ")
    }

    /// The passage as the existing verse callbacks take it (copy, save to note):
    /// the range label and the whole passage's text.
    var asRetrievedVerse: RetrievedVerse {
        RetrievedVerse(reference: reference, similarity: similarity ?? 0, text: plainText, translation: translation)
    }

    /// Where "Read in context" goes: the reader opens at the first verse.
    var readTarget: RetrievedVerse {
        RetrievedVerse(reference: firstReference, similarity: similarity ?? 0, text: nil, translation: translation)
    }
}

typealias VerseReferenceResolver = @Sendable (String) -> Reference?

struct GroupedVerses: Sendable, Equatable {
    /// Exact lookups, cited ones first in the order the answer cites them.
    var passages: [VersePassage]
    /// Search results in retrieval order, with any verse already shown as a passage removed.
    var searchHits: [VersePassage]

    /// Chips shown inline before the rest collapse into "+N more".
    static let inlineChipLimit = 4

    var all: [VersePassage] { passages + searchHits }

    /// The inline chips and how many collapse into "+N more".
    var inlineChips: (shown: [VersePassage], hidden: Int) {
        let shown = Array(all.prefix(Self.inlineChipLimit))
        return (shown, all.count - shown.count)
    }

    /// "3 passages \u{00B7} 12 search results"
    var summary: String {
        var parts: [String] = []
        if !passages.isEmpty {
            parts.append("\(passages.count) \(passages.count == 1 ? "passage" : "passages")")
        }
        if !searchHits.isEmpty {
            parts.append("\(searchHits.count) \(searchHits.count == 1 ? "search result" : "search results")")
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    init(
        verses: [RetrievedVerse],
        citedReferences: [String] = [],
        resolve: VerseReferenceResolver = VersePassages.resolveCitation
    ) {
        var seen = Set<String>()
        var passageRows: [RetrievedVerse] = []
        for row in verses where row.source == .passage {
            if seen.insert(VersePassages.dedupeKey(row)).inserted { passageRows.append(row) }
        }
        var searchRows: [RetrievedVerse] = []
        for row in verses where row.source != .passage {
            if seen.insert(VersePassages.dedupeKey(row)).inserted { searchRows.append(row) }
        }

        let passages = VersePassages.buildGroups(passageRows, kind: .passage, resolve: resolve, keyPrefix: "p")
        let searchHits = VersePassages.buildGroups(searchRows, kind: .search, resolve: resolve, keyPrefix: "s")

        // Order passages by their first citation; uncited ones keep retrieval
        // order after them (the index breaks ties, so the sort is stable).
        let cited = citedReferences.compactMap { VersePassages.resolveCited($0, resolve: resolve) }
        func firstCitation(_ passage: VersePassage) -> Int {
            cited.firstIndex { VersePassages.contains(passage, $0) } ?? Int.max
        }
        self.passages = passages.enumerated()
            .map { (rank: firstCitation($0.element), index: $0.offset, passage: $0.element) }
            .sorted { ($0.rank, $0.index) < ($1.rank, $1.index) }
            .map(\.passage)
        self.searchHits = searchHits
    }

    /// The passage a tapped reference points at, or nil when none holds it.
    func passage(for reference: String, resolve: VerseReferenceResolver = VersePassages.resolveCitation) -> VersePassage? {
        guard let cited = VersePassages.resolveCited(reference, resolve: resolve) else { return nil }
        return passages.first { VersePassages.contains($0, cited) }
            ?? searchHits.first { VersePassages.contains($0, cited) }
    }
}

extension ChatViewMessage {
    /// The answer's Scripture as passages, ordered by where the answer cites them.
    var groupedVerses: GroupedVerses {
        GroupedVerses(verses: retrievedVerses, citedReferences: VersePassages.citedReferences(in: content))
    }
}

enum VersePassages {
    // MARK: Grouping

    private struct ParsedRow {
        var row: RetrievedVerse
        var book: String
        var chapter: Int
        var verse: Int
        var resolved: Reference?
    }

    private static let verseReference = try? NSRegularExpression(pattern: "^(.*\\S)\\s+(\\d{1,3}):(\\d{1,3})$")

    private static func parseRow(_ row: RetrievedVerse, resolve: VerseReferenceResolver) -> ParsedRow? {
        let reference = row.reference.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(reference.startIndex..., in: reference)
        guard let match = verseReference?.firstMatch(in: reference, range: range),
              let bookRange = Range(match.range(at: 1), in: reference),
              let chapterRange = Range(match.range(at: 2), in: reference),
              let verseRange = Range(match.range(at: 3), in: reference),
              let chapter = Int(reference[chapterRange]),
              let verse = Int(reference[verseRange])
        else { return nil }
        return ParsedRow(
            row: row,
            book: String(reference[bookRange]),
            chapter: chapter,
            verse: verse,
            resolved: resolve(row.reference)
        )
    }

    fileprivate static func dedupeKey(_ row: RetrievedVerse) -> String {
        "\(row.reference.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())|\(row.translation?.rawValue ?? "")"
    }

    fileprivate static func buildGroups(
        _ rows: [RetrievedVerse],
        kind: VersePassage.Kind,
        resolve: VerseReferenceResolver,
        keyPrefix: String
    ) -> [VersePassage] {
        var groups: [VersePassage] = []
        var current: [ParsedRow] = []

        func flush() {
            guard let first = current.first, let last = current.last else { return }
            groups.append(VersePassage(
                key: "\(keyPrefix)\(groups.count)",
                kind: kind,
                reference: first.verse == last.verse
                    ? first.row.reference
                    : "\(first.book) \(first.chapter):\(first.verse)-\(last.verse)",
                firstReference: first.row.reference,
                translation: first.row.translation,
                order: first.resolved?.order,
                chapter: first.chapter,
                verses: current.map { VersePassage.Verse(verse: $0.verse, text: $0.row.text) },
                similarity: scoreOf(current.map(\.row))
            ))
            current = []
        }

        for row in rows {
            guard let parsed = parseRow(row, resolve: resolve) else {
                // An unexpected reference shape still shows, as a group of its own.
                flush()
                groups.append(VersePassage(
                    key: "\(keyPrefix)\(groups.count)",
                    kind: kind,
                    reference: row.reference,
                    firstReference: row.reference,
                    translation: row.translation,
                    order: nil,
                    chapter: nil,
                    verses: [VersePassage.Verse(verse: 0, text: row.text)],
                    similarity: scoreOf([row])
                ))
                continue
            }
            // Search hits are ranked individually, so they never merge; passage
            // verses join while they continue one chapter in one translation.
            let continues: Bool
            if kind == .passage, let previous = current.last {
                continues = previous.book == parsed.book
                    && previous.chapter == parsed.chapter
                    && previous.row.translation == parsed.row.translation
                    && parsed.verse == previous.verse + 1
            } else {
                continues = false
            }
            if !continues { flush() }
            current.append(parsed)
        }
        flush()
        return groups
    }

    /// Best score among the scored rows; nil when every row is an exact lookup.
    private static func scoreOf(_ rows: [RetrievedVerse]) -> Double? {
        rows.filter { $0.source == nil }.map(\.similarity).max()
    }

    /// A resolved citation, plus the last verse of a same-chapter range
    /// ("3:5-13"), which the resolvers drop.
    fileprivate struct CitedReference {
        var reference: Reference
        var verseEnd: Int?
    }

    // A same-chapter range tail, before any translation tag: "3:5-13", "3:5-13 KJV".
    private static let rangeTail = try? NSRegularExpression(
        pattern: ":(\\d{1,3})\\s*\(rangeDashes)\\s*(\\d{1,3})(?:\\s+[A-Za-z]+)?\\s*$"
    )

    fileprivate static func resolveCited(_ raw: String, resolve: VerseReferenceResolver) -> CitedReference? {
        guard let resolved = resolve(raw) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = rangeTail?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              let endRange = Range(match.range(at: 2), in: trimmed),
              let end = Int(trimmed[endRange]),
              let start = resolved.verse, end > start
        else { return CitedReference(reference: resolved, verseEnd: nil) }
        return CitedReference(reference: resolved, verseEnd: end)
    }

    /// Does a cited reference (or any verse of its range) land inside this passage?
    fileprivate static func contains(_ passage: VersePassage, _ cited: CitedReference) -> Bool {
        guard let order = passage.order, order == cited.reference.order,
              passage.chapter == cited.reference.chapter
        else { return false }
        guard let start = cited.reference.verse else { return true }
        let end = cited.verseEnd ?? start
        return passage.verses.contains { $0.verse >= start && $0.verse <= end }
    }

    // MARK: Citations in the answer text

    // Port of the detection pattern in `mobile/src/features/chat/verseLinks.ts`
    // (itself from the web's `src/utils/verseParser.ts`). The Apple chat has no
    // tappable verse links, so here it only orders passages by citation.
    private static let fullBookNames = [
        "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
        "Joshua", "Judges", "Ruth",
        "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
        "1 Chronicles", "2 Chronicles",
        "Ezra", "Nehemiah", "Esther",
        "Job", "Psalms?", "Proverbs", "Ecclesiastes", "Song of Solomon", "Song of Songs",
        "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
        "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
        "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
        "Matthew", "Mark", "Luke", "John",
        "Acts", "Romans",
        "1 Corinthians", "2 Corinthians",
        "Galatians", "Ephesians", "Philippians", "Colossians",
        "1 Thessalonians", "2 Thessalonians",
        "1 Timothy", "2 Timothy",
        "Titus", "Philemon", "Hebrews", "James",
        "1 Peter", "2 Peter",
        "1 John", "2 John", "3 John",
        "Jude", "Revelation",
    ]

    private static let bookAbbreviations = [
        "Gen", "Exod", "Ex", "Lev", "Num", "Deut",
        "Josh", "Judg", "Sam", "Kgs", "Chr",
        "Neh", "Esth", "Ps", "Prov", "Eccles", "Eccl",
        "Isa", "Jer", "Lam", "Ezek", "Dan",
        "Hos", "Obad", "Ob", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
        "Matt", "Mk", "Lk", "Jn",
        "Rom", "Cor", "Gal", "Eph", "Phlm", "Phil", "Col",
        "Thess", "Tim", "Tit", "Heb", "Jas",
        "Pet", "Rev", "Song",
    ]

    /// Abbreviations the bundled book table does not carry. Same map as
    /// `ABBREVIATION_ALIASES` in `verseLinks.ts`.
    private static let abbreviationAliases: [String: String] = [
        "exod": "Exodus",
        "eccles": "Ecclesiastes",
        "ob": "Obadiah",
        "mk": "Mark",
        "lk": "Luke",
        "jn": "John",
        "tit": "Titus",
    ]

    // Hyphen, en dash and em dash all separate a range; written as ICU escapes
    // so this file stays ASCII.
    private static let rangeDashes = "[-\\u2013\\u2014]"
    private static let translations = "(?:BSB|KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP|RV1909|LUT1912)"

    /// Spanish and German book names ("Juan", "Johannes", "Apostelgeschichte")
    /// with any leading volume number taken off, since the branch below
    /// matches "1 ", "1. " or "1" itself. Each name is listed as written and
    /// with its accents folded, so an answer that drops an accent still links.
    /// Longest first, so "Hechos de los Apostoles" wins over "Hechos".
    static let localizedBookStems: [String] = {
        var seen = Set<String>()
        var stems: [String] = []
        for (name, _) in BookNames.shared.allNames {
            let stem = name.replacing(/^[123]\.?\s*/, with: "")
            for variant in [stem, stem.folding(options: .diacriticInsensitive, locale: nil)]
            where seen.insert(variant.lowercased()).inserted {
                stems.append(variant)
            }
        }
        return stems.sorted { $0.count > $1.count }
    }()

    private static let citationRegex: NSRegularExpression? = {
        let numberedPrefix = "(?:[123]\\s?)?"
        let fullNameBranch = "\(numberedPrefix)(?:\(fullBookNames.joined(separator: "|")))\\s+"
        let abbreviationBranch = "\(numberedPrefix)(?:\(bookAbbreviations.joined(separator: "|")))(?:\\.\\s*|\\s+)"
        let localizedNames = localizedBookStems.map(NSRegularExpression.escapedPattern(for:))
        let localizedBranch = localizedNames.isEmpty
            ? ""
            : "|(?:[123]\\.?\\s?)?(?:\(localizedNames.joined(separator: "|")))\\s+"
        let book = "(?:\(fullNameBranch)|\(abbreviationBranch)\(localizedBranch))"
        let reference = "\\d{1,3}:\\d{1,3}(?:\\s*\(rangeDashes)\\s*\\d{1,3}(?::\\d{1,3})?)?"
        let boundary = "(?!\\d)(?!:\\d)"
        let translation = "(?:\\s+\(translations))?"
        return try? NSRegularExpression(pattern: "(\(book)\(reference)\(boundary)\(translation))", options: [.caseInsensitive])
    }()

    private static let trailingTranslation = try? NSRegularExpression(pattern: "\\s+\(translations)$", options: [.caseInsensitive])
    private static let trailingRange = try? NSRegularExpression(pattern: "\\s*\(rangeDashes)\\s*\\d{1,3}(?::\\d{1,3})?$")
    private static let periodBeforeChapter = try? NSRegularExpression(pattern: "\\.(\\d)")
    private static let singleWordBook = try? NSRegularExpression(pattern: "^((?:[123]\\s?)?)([A-Za-z]+)\\.?(\\s+\\d.*)$")

    private static func replacingFirst(_ regex: NSRegularExpression?, in text: String, with template: String) -> String {
        guard let regex,
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return text }
        let replacement = regex.replacementString(for: match, in: text, offset: 0, template: template)
        guard let range = Range(match.range, in: text) else { return text }
        return text.replacingCharacters(in: range, with: replacement)
    }

    private static func expandAbbreviation(_ reference: String) -> String {
        guard let regex = singleWordBook,
              let match = regex.firstMatch(in: reference, range: NSRange(reference.startIndex..., in: reference)),
              let volumeRange = Range(match.range(at: 1), in: reference),
              let stemRange = Range(match.range(at: 2), in: reference),
              let restRange = Range(match.range(at: 3), in: reference),
              let full = abbreviationAliases[reference[stemRange].lowercased()]
        else { return reference }
        // "1Jn 5:1" and "1 Jn 5:1" both come out as "1 John 5:1".
        let volume = reference[volumeRange].trimmingCharacters(in: .whitespaces)
        return "\(volume.isEmpty ? "" : "\(volume) ")\(full)\(reference[restRange])"
    }

    /// Resolve a cited or retrieved reference ("Ps 56:3", "John 3:16-4:2 KJV",
    /// "Gen.1:1") to a location, the way Android's `resolveVerseReference` does.
    static let resolveCitation: VerseReferenceResolver = { raw in
        var bare = replacingFirst(trailingTranslation, in: raw, with: "")
        bare = replacingFirst(trailingRange, in: bare, with: "")
        bare = replacingFirst(periodBeforeChapter, in: bare, with: ". $1")
        return Bible.resolveReference(expandAbbreviation(bare))
    }

    /// References in the order the answer text cites them. A match that starts
    /// mid-word ("xJohn 3:16") or does not resolve is skipped.
    static func citedReferences(in text: String) -> [String] {
        guard let regex = citationRegex, !text.isEmpty else { return [] }
        let nsText = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)).compactMap { match in
            if match.range.location > 0 {
                let previous = nsText.substring(with: NSRange(location: match.range.location - 1, length: 1))
                if previous.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) && $0.isASCII }) {
                    return nil
                }
            }
            let value = nsText.substring(with: match.range(at: 1))
            return resolveCitation(value) == nil ? nil : value
        }
    }
}
