import Foundation

/// Chapter loading for the Bible reader. KJV is bundled with the app; NKJV is
/// fetched from bolls.life per chapter with a timeout and cached in memory for
/// the session.
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
        }
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
