import Foundation

/// A search hit and the translation whose wording matched.
struct BibleSearchHit: Sendable, Equatable, Identifiable {
    let order: Int
    let chapter: Int
    let verse: Int
    let text: String
    let translation: TranslationID

    var id: String { "\(translation.rawValue):\(order):\(chapter):\(verse)" }
}

struct BibleSearchResult: Sendable, Equatable {
    let hits: [BibleSearchHit]
    /// The translation the hits came from - the alternate when the reader's
    /// own translation had no match.
    let translation: TranslationID
}

/// Translation-aware phrase search: BSB and KJV offline from the bundle, NKJV
/// through bolls.life, and a check of the other wording when the reader's
/// translation has no match.
///
/// Port of `mobile/src/features/bible/search.ts`. The transport is injectable
/// so the tests pin the NKJV request and row validation without the network.
struct BibleSearch: Sendable {
    typealias Fetch = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    static let error = "Search could not finish. Check your connection and try again."
    static let defaultLimit = 100
    static let timeout: TimeInterval = 15

    var fetch: Fetch = { try await URLSession.shared.data(for: $0) }

    /// `searchBible`: KJV stays available offline; a miss checks the other
    /// supported wording (NKJV for KJV, KJV for everything else).
    func search(_ query: String, translation: TranslationID, limit: Int = defaultLimit) async throws -> BibleSearchResult {
        let normalized = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
        guard normalized.count >= 2 else { return BibleSearchResult(hits: [], translation: translation) }
        let cap = max(1, min(Self.defaultLimit, limit))
        let hits = try await searchTranslation(normalized, translation: translation, limit: cap)
        if !hits.isEmpty { return BibleSearchResult(hits: hits, translation: translation) }
        let alternate = Self.alternate(for: translation)
        return BibleSearchResult(
            hits: try await searchTranslation(normalized, translation: alternate, limit: cap),
            translation: alternate
        )
    }

    static func alternate(for translation: TranslationID) -> TranslationID {
        translation == .kjv ? .nkjv : .kjv
    }

    func searchTranslation(_ query: String, translation: TranslationID, limit: Int) async throws -> [BibleSearchHit] {
        try Task.checkCancellation()
        switch translation {
        case .bsb:
            do {
                return try await BSBLibrary.shared.search(query, limit: limit).map { Self.hit($0, .bsb) }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                throw BibleError(message: Self.error)
            }
        case .kjv:
            return await KJVLibrary.shared.search(query, limit: limit).map { Self.hit($0, .kjv) }
        case .nkjv:
            return try await searchNKJV(query, limit: limit)
        }
    }

    static func nkjvURL(query: String, limit: Int) -> URL? {
        var components = URLComponents(string: "https://bolls.life/v2/find/NKJV")
        // Explicit lexical matching: the provider's default is semantic search.
        components?.queryItems = [
            URLQueryItem(name: "search", value: query),
            URLQueryItem(name: "match_whole", value: "true"),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "page", value: "1"),
        ]
        return components?.url
    }

    private func searchNKJV(_ query: String, limit: Int) async throws -> [BibleSearchHit] {
        guard let url = Self.nkjvURL(query: query, limit: limit) else { throw BibleError(message: Self.error) }
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.timeout
        let data: Data
        do {
            let (body, response) = try await fetch(request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw BibleError(message: Self.error)
            }
            data = body
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw BibleError(message: Self.error)
        }
        return try Self.parseNKJV(data, limit: limit)
    }

    /// Every row must be a real NKJV verse, or the whole answer is rejected -
    /// the same all-or-nothing validation the TypeScript applies.
    static func parseNKJV(_ data: Data, limit: Int) throws -> [BibleSearchHit] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = object["results"] as? [Any]
        else { throw BibleError(message: error) }
        return try rows.prefix(limit).map { row in
            guard let value = row as? [String: Any],
                  value["translation"] as? String == "NKJV",
                  let book = integer(value["book"]),
                  let meta = Bible.book(order: book),
                  let chapter = integer(value["chapter"]), chapter >= 1, chapter <= meta.chapters,
                  let verse = integer(value["verse"]), verse >= 1,
                  let text = value["text"] as? String
            else { throw BibleError(message: error) }
            return BibleSearchHit(order: meta.order, chapter: chapter, verse: verse, text: plainText(text), translation: .nkjv)
        }
    }

    /// Bolls search returns HTML highlights and translator-supplied italics.
    static func plainText(_ text: String) -> String {
        let stripped = text.replacing(/<[^>]*>/, with: "")
        return VerseMarkup.decodeEntities(stripped)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.rounded() == double else { return nil }
        return number.intValue
    }

    private static func hit(_ hit: KJVSearchHit, _ translation: TranslationID) -> BibleSearchHit {
        BibleSearchHit(order: hit.order, chapter: hit.chapter, verse: hit.verse, text: hit.text, translation: translation)
    }
}

/// State behind the iOS search screen - `mobile/app/(app)/bible/search.tsx`,
/// including its exact status lines.
@MainActor
@Observable
final class BibleSearchModel {
    static let debounce = Duration.milliseconds(300)

    var query = ""
    /// The chip the user picked on this screen; nil follows the account's.
    var selectedTranslation: TranslationID?
    private(set) var hits: [BibleSearchHit] = []
    private(set) var resultTranslation: TranslationID = .kjv
    /// The query `hits` answers; empty until a search has finished.
    private(set) var searched = ""
    private(set) var loading = false
    private(set) var error: String?
    /// Bumped by Retry so the driving task re-runs with the same query.
    private(set) var attempt = 0

    private let search: BibleSearch

    init(search: BibleSearch = BibleSearch()) {
        self.search = search
    }

    var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var referenceJump: Reference? {
        trimmed.isEmpty ? nil : Bible.resolveReference(trimmed)
    }

    func translation(account: TranslationID) -> TranslationID { selectedTranslation ?? account }

    /// The identity the screen's `.task(id:)` restarts on.
    func taskKey(account: TranslationID) -> String {
        "\(translation(account: account).rawValue)|\(attempt)|\(trimmed)"
    }

    func retry() { attempt += 1 }

    /// Debounced run, driven by `.task(id: taskKey)` so a superseded search is
    /// cancelled rather than raced.
    func run(account: TranslationID, debounce: Duration = BibleSearchModel.debounce) async {
        let translation = translation(account: account)
        let text = trimmed
        let isReference = referenceJump != nil
        hits = []
        searched = ""
        error = nil
        loading = text.count >= 2 && !isReference
        guard loading else { return }
        do {
            try await Task.sleep(for: debounce)
            let result = try await search.search(text, translation: translation, limit: BibleSearch.defaultLimit)
            guard !Task.isCancelled else { return }
            hits = result.hits
            resultTranslation = result.translation
            searched = text
            loading = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.error = BibleSearch.error
            loading = false
        }
    }

    /// The line above the results, word for word as Android shows it.
    func status(account: TranslationID) -> String? {
        let translation = translation(account: account)
        if error != nil { return nil }
        if loading { return "Searching \(translation.rawValue) and checking other wording…" }
        guard !searched.isEmpty else { return nil }
        var line: String
        if hits.isEmpty {
            line = referenceJump == nil
                ? "No phrase matches in KJV or NKJV. Try fewer words or a reference like Job 1:8."
                : ""
        } else if hits.count >= BibleSearch.defaultLimit {
            line = "First \(BibleSearch.defaultLimit) results. Refine your search."
        } else {
            line = "\(hits.count) result\(hits.count == 1 ? "" : "s")"
        }
        if !hits.isEmpty, resultTranslation != translation {
            line += " in \(resultTranslation.rawValue). No phrase matches in \(translation.rawValue)."
        }
        return line.isEmpty ? nil : line
    }

    /// Shown before any search has run.
    func hint(account: TranslationID) -> String {
        let translation = translation(account: account)
        let other = BibleSearch.alternate(for: translation)
        return "Search \(translation.rawValue) by word or phrase. If there are no matches, we check \(other.rawValue) too. NKJV requires a connection."
    }
}
