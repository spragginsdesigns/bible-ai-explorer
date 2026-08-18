import Foundation

/// A verse the offline search matched.
struct KJVSearchHit: Sendable, Equatable, Identifiable {
    let order: Int
    let chapter: Int
    let verse: Int
    let text: String

    var id: String { "\(order):\(chapter):\(verse)" }
}

struct BibleError: LocalizedError, Equatable {
    let message: String
    var errorDescription: String? { message }
}

/// Lazy access to the bundled KJV text (`Bible/Data/kjv/*.json`, chapters →
/// verses). A book's JSON is parsed on first access and cached for the session.
///
/// Port of `mobile/src/features/bible/kjv.ts`. It is an actor rather than a
/// module of free functions because a whole-Bible search parses ~4 MB of JSON
/// and must not run on the main actor — the TS clients get that for free from
/// Metro's synchronous `require` cache, Swift has to say it.
actor KJVLibrary {
    static let shared = KJVLibrary()

    /// Matches the TS default and the reader's search cap.
    static let defaultSearchLimit = 100

    private var cache: [Int: [[String]]] = [:]
    /// Lowercased mirror of `cache`, built on first search. Folding case once
    /// per verse instead of once per keystroke is the difference between a
    /// search that feels instant and one that visibly stalls.
    private var folded: [Int: [[String]]] = [:]

    /// All verses of a chapter, 1-indexed by chapter number.
    func chapter(order: Int, chapter: Int) throws -> [String] {
        guard let meta = Bible.book(order: order), chapter >= 1, chapter <= meta.chapters else {
            throw BibleError(message: "Unknown chapter: book \(order), chapter \(chapter)")
        }
        return try book(order)[chapter - 1]
    }

    /// Case-insensitive substring match over every verse of the bundled KJV, in
    /// canonical book/chapter/verse order, capped at `limit` hits. Empty or
    /// whitespace-only queries return []. The first call parses all 66 books.
    func search(_ query: String, limit: Int = KJVLibrary.defaultSearchLimit) -> [KJVSearchHit] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty, limit > 0 else { return [] }

        var hits: [KJVSearchHit] = []
        for meta in Bible.books {
            guard let chapters = try? book(meta.order),
                  let haystack = try? foldedBook(meta.order)
            else { continue }
            for (chapterIndex, verses) in haystack.enumerated() {
                for (verseIndex, text) in verses.enumerated() {
                    guard text.contains(needle) else { continue }
                    hits.append(
                        KJVSearchHit(
                            order: meta.order,
                            chapter: chapterIndex + 1,
                            verse: verseIndex + 1,
                            text: chapters[chapterIndex][verseIndex]
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
        let lowered = try book(order).map { $0.map { $0.lowercased() } }
        folded[order] = lowered
        return lowered
    }

    private func book(_ order: Int) throws -> [[String]] {
        if let cached = cache[order] { return cached }
        guard let meta = Bible.book(order: order) else {
            throw BibleError(message: "Unknown book order: \(order)")
        }
        let name = (meta.file as NSString).deletingPathExtension
        guard let url = BibleBundle.url(json: name, subdirectory: "Data/kjv"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([[String]].self, from: data)
        else {
            throw BibleError(message: "\(meta.file) is missing from the app bundle")
        }
        cache[order] = decoded
        return decoded
    }
}
