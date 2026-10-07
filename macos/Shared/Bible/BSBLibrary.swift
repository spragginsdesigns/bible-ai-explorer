import Foundation

/// One run of reader text with the publisher's formatting flags. The BSB data
/// carries these per verse; KJV gets them from the speech sidecar
/// (`ReaderAnnotations`); NKJV only ever has `italic`.
struct ReaderSegment: Sendable, Equatable {
    var text: String
    var italic: Bool
    var jesusSpeech: Bool

    init(text: String, italic: Bool, jesusSpeech: Bool = false) {
        self.text = text
        self.italic = italic
        self.jesusSpeech = jesusSpeech
    }
}

/// A Berean Standard Bible verse as the publisher formats it. Port of
/// `FormattedVerse` in `mobile/src/features/bible/bsb.ts`.
///
/// The bundled files (`Bible/Data/bsb/bsb-NN.json`) are a lossless compact form
/// of Android's, written by `macos/scripts/build-bible-data.py`: verse numbers
/// are positional, the plain text is the segments joined, and the headings live
/// in `section-headings.json` - the script proves all three before it writes.
struct BSBVerse: Sendable, Equatable {
    let number: Int
    let segments: [ReaderSegment]
    /// The edition prints the verse number but no text (textual-variant verses
    /// such as Matthew 17:21). The reader says so in place of the text.
    let omitted: Bool

    /// Android's `text`. Carries the poetry line breaks the segments do.
    var text: String { segments.map(\.text).joined() }
}

/// Lazy, cached access to the bundled BSB - a book is parsed on first use.
/// An actor for the same reason `KJVLibrary` is: a whole-Bible search parses
/// several megabytes of JSON and must stay off the main actor.
actor BSBLibrary {
    static let shared = BSBLibrary()

    private var cache: [Int: [[BSBVerse]]] = [:]
    private var folded: [Int: [[String]]] = [:]

    /// Every verse of a chapter. Throws for a reference outside the canon.
    func chapter(order: Int, chapter: Int) throws -> [BSBVerse] {
        guard let meta = Bible.book(order: order), chapter >= 1, chapter <= meta.chapters else {
            throw BibleError(message: "Invalid Bible reference")
        }
        let chapters = try book(order)
        guard chapter <= chapters.count else { throw BibleError(message: "Invalid Bible reference") }
        return chapters[chapter - 1]
    }

    /// Case-insensitive phrase match over every verse in canonical order,
    /// capped at `limit` - the BSB branch of `searchTranslation` in
    /// `mobile/src/features/bible/search.ts`.
    func search(_ needle: String, limit: Int) throws -> [KJVSearchHit] {
        let folded = needle.lowercased()
        guard !folded.isEmpty, limit > 0 else { return [] }
        var hits: [KJVSearchHit] = []
        for meta in Bible.books {
            try Task.checkCancellation()
            let chapters = try book(meta.order)
            let haystack = try foldedBook(meta.order)
            for (chapterIndex, verses) in haystack.enumerated() {
                for (verseIndex, text) in verses.enumerated() where text.contains(folded) {
                    hits.append(
                        KJVSearchHit(
                            order: meta.order,
                            chapter: chapterIndex + 1,
                            verse: verseIndex + 1,
                            text: chapters[chapterIndex][verseIndex].text
                        )
                    )
                    if hits.count >= limit { return hits }
                }
            }
        }
        return hits
    }

    // MARK: - Loading

    private func foldedBook(_ order: Int) throws -> [[String]] {
        if let cached = folded[order] { return cached }
        let lowered = try book(order).map { $0.map { $0.text.lowercased() } }
        folded[order] = lowered
        return lowered
    }

    private func book(_ order: Int) throws -> [[BSBVerse]] {
        if let cached = cache[order] { return cached }
        let name = String(format: "bsb-%02d", order)
        guard let url = BibleBundle.url(json: name, subdirectory: "Data/bsb"),
              let data = try? Data(contentsOf: url),
              let decoded = try? Self.decode(data)
        else {
            throw BibleError(message: "\(name).json is missing from the app bundle")
        }
        cache[order] = decoded
        return decoded
    }

    /// Parse one compact book file. Internal so the tests can pin the format.
    static func decode(_ data: Data) throws -> [[BSBVerse]] {
        let chapters = try JSONDecoder().decode([[CompactVerse]].self, from: data)
        return chapters.map { verses in
            verses.enumerated().map { index, verse in
                BSBVerse(
                    number: index + 1,
                    segments: verse.s.map {
                        ReaderSegment(text: $0.text, italic: $0.flags & 1 != 0, jesusSpeech: $0.flags & 2 != 0)
                    },
                    omitted: (verse.o ?? 0) != 0
                )
            }
        }
    }

    private struct CompactVerse: Decodable {
        let s: [CompactSegment]
        let o: Int?
    }

    /// `[text, flags]` - an array on disk, because keys on 31,102 verses'
    /// worth of segments are most of the file.
    private struct CompactSegment: Decodable {
        let text: String
        let flags: Int

        init(from decoder: any Decoder) throws {
            var container = try decoder.unkeyedContainer()
            text = try container.decode(String.self)
            flags = try container.decode(Int.self)
        }
    }
}
