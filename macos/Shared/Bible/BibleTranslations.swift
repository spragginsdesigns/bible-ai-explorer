import Foundation

/// Chapter loading for the Bible reader. KJV, BSB, Reina-Valera 1909 and
/// Lutherbibel 1912 are bundled; NKJV is fetched from bolls.life per chapter
/// with a timeout and cached in memory for the session.
///
/// Port of `mobile/src/features/bible/translations.ts`. `TranslationID` itself
/// already lives in `Settings/SettingsStore.swift` (chat needs it too), so only
/// the loading half is here.
enum BibleTranslations {
    /// The one message the reader shows for every failure mode, exactly as the
    /// other two clients do — a chapter either arrives or it doesn't.
    static let chapterLoadError =
        "That chapter could not be loaded. Check your connection and try again."

    static func chapter(
        _ translation: TranslationID,
        order: Int,
        chapter: Int,
        nkjv: NKJVProvider = .shared
    ) async throws -> [String] {
        switch translation {
        case .kjv:
            do {
                return try await KJVLibrary.shared.chapter(order: order, chapter: chapter)
            } catch {
                throw BibleError(message: chapterLoadError)
            }
        case .nkjv:
            return try await nkjv.chapter(order: order, chapter: chapter)
        case .bsb:
            // Bundled, like KJV. The plain text carries the poetry line
            // breaks; the reader takes its formatting from `ReaderAnnotations`.
            do {
                return try await BSBLibrary.shared.chapter(order: order, chapter: chapter).map(\.text)
            } catch {
                throw BibleError(message: chapterLoadError)
            }
        case .rv1909, .lut1912:
            guard let library = BundledBible.library(translation) else {
                throw BibleError(message: chapterLoadError)
            }
            do {
                return try await library.chapter(order: order, chapter: chapter)
            } catch {
                throw BibleError(message: chapterLoadError)
            }
        }
    }
}

/// The plain-text Bibles bundled as `[[String]]` per book, the KJV shape:
/// `Bible/Data/rv1909/NN.json` and `Bible/Data/lut1912/NN.json`, written by
/// `scripts/bible/build-ebible.py`. Port of `src/lib/bible/ebible.ts`.
enum BundledBible {
    static let rv1909 = BundledBibleLibrary(directory: "rv1909")
    static let lut1912 = BundledBibleLibrary(directory: "lut1912")

    static func library(_ translation: TranslationID) -> BundledBibleLibrary? {
        switch translation {
        case .rv1909: rv1909
        case .lut1912: lut1912
        case .kjv, .nkjv, .bsb: nil
        }
    }
}

/// Lazy, cached access to one bundled plain-text Bible - a book is parsed on
/// first use, like `KJVLibrary`, and for the same off-main-actor reason.
///
/// The two folders are folder references in `project.yml`, so they keep their
/// directory in the bundle: both hold `01.json` ... `66.json`, which the flat
/// copy the rest of `Bible/Data/` gets would collide.
actor BundledBibleLibrary {
    private let directory: String
    private var cache: [Int: [[String]]] = [:]
    private var folded: [Int: [[String]]] = [:]

    init(directory: String) {
        self.directory = directory
    }

    /// All verses of a chapter, 1-indexed by chapter number.
    func chapter(order: Int, chapter: Int) throws -> [String] {
        guard let meta = Bible.book(order: order), chapter >= 1, chapter <= meta.chapters else {
            throw BibleError(message: "Invalid Bible reference")
        }
        let chapters = try book(order)
        guard chapter <= chapters.count else { throw BibleError(message: "Invalid Bible reference") }
        return chapters[chapter - 1]
    }

    /// Case- and accent-insensitive phrase match over every verse in canonical
    /// order, capped at `limit`: "senor" finds "Señor", "konig" finds "König".
    func search(_ needle: String, limit: Int) throws -> [KJVSearchHit] {
        let folded = Self.fold(needle)
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
                            text: chapters[chapterIndex][verseIndex]
                        )
                    )
                    if hits.count >= limit { return hits }
                }
            }
        }
        return hits
    }

    static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    // MARK: - Loading

    private func foldedBook(_ order: Int) throws -> [[String]] {
        if let cached = folded[order] { return cached }
        let lowered = try book(order).map { $0.map(Self.fold) }
        folded[order] = lowered
        return lowered
    }

    private func book(_ order: Int) throws -> [[String]] {
        if let cached = cache[order] { return cached }
        let name = String(format: "%02d", order)
        guard let url = BibleBundle.resources.url(forResource: name, withExtension: "json", subdirectory: directory),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([[String]].self, from: data)
        else {
            throw BibleError(message: "\(directory)/\(name).json is missing from the app bundle")
        }
        cache[order] = decoded
        return decoded
    }
}

/// bolls.life chapter fetching, with a per-chapter memory cache.
///
/// The transport is injectable so the behaviour tests can pin the URL, the row
/// mapping and the cache without touching the network — the Vitest suite stubs
/// `fetch` for the same reason.
actor NKJVProvider {
    typealias Fetch = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    static let timeout: TimeInterval = 15
    static let shared = NKJVProvider()

    private let fetch: Fetch
    private var cache: [String: [String]] = [:]

    init(fetch: @escaping Fetch = { try await URLSession.shared.data(for: $0) }) {
        self.fetch = fetch
    }

    static func url(order: Int, chapter: Int) -> URL? {
        URL(string: "https://bolls.life/get-chapter/NKJV/\(order)/\(chapter)/")
    }

    func chapter(order: Int, chapter: Int) async throws -> [String] {
        let key = "\(order):\(chapter)"
        if let cached = cache[key] { return cached }

        guard let url = Self.url(order: order, chapter: chapter) else {
            throw BibleError(message: BibleTranslations.chapterLoadError)
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.timeout

        do {
            let (data, response) = try await fetch(request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw BibleError(message: "bolls.life responded \(http.statusCode)")
            }
            let rows = try JSONDecoder().decode([Row].self, from: data)
            let verses = rows
                .sorted { $0.verse < $1.verse }
                .map { Self.tidy($0.text ?? "") }
            cache[key] = verses
            return verses
        } catch {
            throw BibleError(message: BibleTranslations.chapterLoadError)
        }
    }

    /// bolls.life rows carry extra fields (pk, comment); only verse and text are
    /// mapped, with stray runs of spaces collapsed.
    private struct Row: Decodable {
        let verse: Int
        let text: String?
    }

    private static func tidy(_ text: String) -> String {
        text
            .replacing(/[ ]{2,}/, with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
