import Foundation

/// The LC Greek (LC-15842): SureWord's own modern-English translation of the
/// Textus Receptus, the text every Alive recording reads. The reader offers it
/// beside its translations on a book that has it, verse for verse in the
/// KJV's numbering. It is a reading text only: highlights, Explain, Learn and
/// Ask AI keep working on the KJV verse with the same number.
///
/// Same names, wording and parse rule as `LC_GREEK`, `hasLcGreek` and
/// `parseLcGreek` in src/lib/bible/audioBible.ts.
enum LCGreek {
    static let label = "LC Greek"
    static let note = "Our own translation of the Greek · the text Alive reads"
    static let copyright = "SureWord's own translation of the Textus Receptus"
    /// The reader's on/off choice, kept on this device only (web's
    /// `LC_GREEK_PREF_KEY`). Default off.
    static let preferenceKey = "sureword-lc-greek"

    /// Every book with an Alive recording has its LC Greek text.
    static func has(_ book: Int) -> Bool { ChapterAudio.hasAlive(book) }

    static func path(book: Int, chapter: Int) -> String {
        "/api/bible/lc-greek?book=\(book)&chapter=\(chapter)"
    }

    private struct Response: Decodable {
        let status: String?
        let book: Int?
        let chapter: Int?
        let verses: [String]?
    }

    /// The `GET /api/bible/lc-greek` answer, or nil when it is not a usable
    /// chapter: only a ready answer for this book and chapter whose verses are
    /// a non-empty list of non-blank strings.
    static func parse(_ data: Data, book: Int, chapter: Int) -> [String]? {
        guard let value = try? JSONDecoder().decode(Response.self, from: data),
              value.status == "ready", value.book == book, value.chapter == chapter,
              let verses = value.verses, !verses.isEmpty,
              verses.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        else { return nil }
        return verses
    }
}

/// LC Greek chapter fetching from the SureWord API, with a per-chapter memory
/// cache. The transport is injectable so the tests can pin the path, the parse
/// and the cache without touching the network.
actor LCGreekProvider {
    typealias Fetch = @Sendable (_ path: String) async throws -> Data

    private let fetch: Fetch
    private var cache: [String: [String]] = [:]

    init(fetch: @escaping Fetch) {
        self.fetch = fetch
    }

    /// The chapter's verses; any failure is the reader's one chapter error.
    func chapter(book: Int, chapter: Int) async throws -> [String] {
        let key = "\(book):\(chapter)"
        if let cached = cache[key] { return cached }
        guard LCGreek.has(book),
              let data = try? await fetch(LCGreek.path(book: book, chapter: chapter)),
              let verses = LCGreek.parse(data, book: book, chapter: chapter)
        else { throw BibleError(message: BibleTranslations.chapterLoadError) }
        cache[key] = verses
        return verses
    }
}
