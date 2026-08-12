import Foundation

/// Book metadata for the reader (`Bible/Data/books.json` — the same generated
/// file the Android and web clients bundle) plus a loose reference parser, so
/// verse cards and Ask-AI links can turn "John 3:16"-style strings into a
/// book/chapter/verse location.
///
/// Port of `mobile/src/features/bible/books.ts`.
struct Book: Sendable, Equatable, Identifiable, Decodable {
    let order: Int
    let name: String
    let abbr: String
    let testament: Testament
    let chapters: Int
    /// Filename of this book's KJV text inside `Bible/Data/kjv/`.
    let file: String

    var id: Int { order }

    enum Testament: String, Sendable, Equatable, Decodable, CaseIterable, Identifiable {
        case ot = "OT"
        case nt = "NT"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .ot: "Old Testament"
            case .nt: "New Testament"
            }
        }
    }
}

/// A resolved location. `verse` is nil for a chapter-only reference.
struct Reference: Sendable, Equatable {
    var order: Int
    var chapter: Int
    var verse: Int?
}

/// Genre groupings used to subdivide each testament on the book list.
enum BookGroup: String, Sendable, CaseIterable, Identifiable {
    case law = "Law"
    case history = "History"
    case poetry = "Poetry & Wisdom"
    case majorProphets = "Major Prophets"
    case minorProphets = "Minor Prophets"
    case gospels = "Gospels"
    case paulsEpistles = "Paul's Epistles"
    case generalEpistles = "General Epistles"
    case prophecy = "Prophecy"

    var id: String { rawValue }
    var title: String { rawValue }
}

/// Anchors `Bundle(for:)` on the app binary. `Bundle.main` is the wrong answer
/// under `xcodebuild test`, where the tests are hosted by — but are not — the
/// app, so resolve the bundle from a type that ships inside it instead.
private final class BibleBundleToken {}

enum BibleBundle {
    static var resources: Bundle { Bundle(for: BibleBundleToken.self) }

    /// XcodeGen adds everything under `Bible/Data/` to the target's resources,
    /// and Xcode copies those into `Contents/Resources` **flat** — the `kjv/`
    /// directory does not survive. Look in the subdirectory first anyway, so a
    /// later switch to a folder reference keeps working.
    static func url(json name: String, subdirectory: String? = nil) -> URL? {
        if let subdirectory,
           let url = resources.url(forResource: name, withExtension: "json", subdirectory: subdirectory) {
            return url
        }
        return resources.url(forResource: name, withExtension: "json")
    }
}

enum Bible {
    /// All 66 books in canonical order.
    static let books: [Book] = loadBooks()

    static func book(order: Int) -> Book? {
        books.first { $0.order == order }
    }

    static func books(in testament: Book.Testament) -> [Book] {
        books.filter { $0.testament == testament }
    }

    /// Map a book's canonical order (1–66) to its genre group.
    static func group(order: Int) -> BookGroup? {
        switch order {
        case 1...5: .law
        case 6...17: .history
        case 18...22: .poetry
        case 23...27: .majorProphets
        case 28...39: .minorProphets
        case 40...43: .gospels
        case 44: .history
        case 45...57: .paulsEpistles
        case 58...65: .generalEpistles
        case 66: .prophecy
        default: nil
        }
    }

    // MARK: - Chapter neighbours

    /// A book/chapter pair the reader can page to.
    struct Location: Sendable, Equatable {
        var order: Int
        var chapter: Int
    }

    /// Previous chapter, rolling back into the last chapter of the previous
    /// book — nil at Genesis 1.
    static func previous(from location: Location) -> Location? {
        guard book(order: location.order) != nil else { return nil }
        if location.chapter > 1 {
            return Location(order: location.order, chapter: location.chapter - 1)
        }
        guard let previousBook = book(order: location.order - 1) else { return nil }
        return Location(order: previousBook.order, chapter: previousBook.chapters)
    }

    /// Next chapter, rolling forward into chapter 1 of the next book — nil at
    /// Revelation 22.
    static func next(from location: Location) -> Location? {
        guard let current = book(order: location.order) else { return nil }
        if location.chapter < current.chapters {
            return Location(order: location.order, chapter: location.chapter + 1)
        }
        guard let nextBook = book(order: location.order + 1) else { return nil }
        return Location(order: nextBook.order, chapter: 1)
    }

    // MARK: - Reference parsing

    /// Extra aliases beyond the data's name/abbr (e.g. "Psalm" vs "Psalms").
    private static let extraAliases: [String: String] = [
        "psalm": "Psalms",
        "song of songs": "Song of Solomon",
    ]

    private static let nameIndex: [String: Book] = {
        var map: [String: Book] = [:]
        for book in books {
            map[normalize(book.name)] = book
            map[normalize(book.abbr)] = book
        }
        for (alias, name) in extraAliases {
            if let book = books.first(where: { $0.name == name }) {
                map[normalize(alias)] = book
            }
        }
        return map
    }()

    /// Lowercase, drop punctuation, collapse whitespace: "1 Sam." → "1 sam".
    private static func normalize(_ value: String) -> String {
        value.lowercased()
            .filter { $0 != "." && $0 != "," }
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// Parse "John 3:16", "1 Samuel 2:1-10", "Psalm 23", "Gen 1"
    /// (case-insensitive, full names and abbreviations) into a location. A verse
    /// range resolves to its start verse. Returns nil when the input cannot be
    /// resolved.
    ///
    /// Hand-written rather than a `Regex`, which is not `Sendable` and so cannot
    /// be hoisted into a `static let`; the grammar below is the TypeScript
    /// pattern `^([1-3])?\s*([a-zA-Z. ]+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*\d+)?)?$`
    /// read left to right.
    static func resolveReference(_ input: String) -> Reference? {
        let characters = Array(input.trimmingCharacters(in: .whitespacesAndNewlines))
        var index = 0

        // ([1-3])? — only leading "1"–"3", so "1 Cor" keeps its number while the
        // name charset below stays digit-free.
        var leadingDigit: Character?
        if let first = characters.first, first == "1" || first == "2" || first == "3" {
            leadingDigit = first
            index = 1
        }

        // \s*
        while index < characters.count, characters[index].isWhitespace { index += 1 }

        // ([a-zA-Z. ]+?)\s+ — the name runs up to the whitespace before the
        // chapter number, since the charset cannot contain digits.
        let nameStart = index
        while index < characters.count, isNameCharacter(characters[index]) { index += 1 }
        var nameEnd = index
        // Whitespace the name charset does not cover (a tab, say) still counts
        // as the separator.
        while index < characters.count, characters[index].isWhitespace { index += 1 }
        var sawSeparator = index > nameEnd
        while nameEnd > nameStart, characters[nameEnd - 1].isWhitespace {
            nameEnd -= 1
            sawSeparator = true
        }
        guard sawSeparator, nameEnd > nameStart else { return nil }

        let namePart = String(characters[nameStart..<nameEnd])
        let bookName = leadingDigit.map { "\($0) \(namePart)" } ?? namePart
        guard let book = nameIndex[normalize(bookName)] else { return nil }

        // (\d+)
        guard let chapter = readNumber(characters, &index) else { return nil }
        guard chapter >= 1, chapter <= book.chapters else { return nil }

        // (?:\s*:\s*(\d+)(?:\s*[-–—]\s*\d+)?)?
        var verse: Int?
        if index < characters.count {
            skipWhitespace(characters, &index)
            guard index < characters.count, characters[index] == ":" else { return nil }
            index += 1
            skipWhitespace(characters, &index)
            guard let parsed = readNumber(characters, &index), parsed >= 1 else { return nil }
            verse = parsed

            if index < characters.count {
                skipWhitespace(characters, &index)
                guard index < characters.count, "-–—".contains(characters[index]) else { return nil }
                index += 1
                skipWhitespace(characters, &index)
                guard readNumber(characters, &index) != nil else { return nil }
            }
        }

        // $
        guard index == characters.count else { return nil }
        return Reference(order: book.order, chapter: chapter, verse: verse)
    }

    /// `[a-zA-Z. ]`
    private static func isNameCharacter(_ character: Character) -> Bool {
        (character.isLetter && character.isASCII) || character == "." || character == " "
    }

    private static func skipWhitespace(_ characters: [Character], _ index: inout Int) {
        while index < characters.count, characters[index].isWhitespace { index += 1 }
    }

    private static func readNumber(_ characters: [Character], _ index: inout Int) -> Int? {
        let start = index
        while index < characters.count, characters[index].isASCII, characters[index].isNumber {
            index += 1
        }
        guard index > start else { return nil }
        return Int(String(characters[start..<index]))
    }

    // MARK: - Loading

    private static func loadBooks() -> [Book] {
        guard let url = BibleBundle.url(json: "books", subdirectory: "Data"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([Book].self, from: data)
        else {
            assertionFailure("books.json is missing from the app bundle")
            return []
        }
        return decoded
    }
}
