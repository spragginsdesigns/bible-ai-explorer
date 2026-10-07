import Foundation

/// One "See also" passage: a reference label, and its text in the reader's
/// translation when the server could quote it.
struct CrossReferenceItem: Sendable, Equatable, Identifiable {
    let reference: String
    let text: String?

    var id: String { reference }

    /// Where tapping the reference opens. Ranges open at their first verse;
    /// a label the reference parser cannot read stays plain text.
    var target: Reference? {
        let start = reference.split(whereSeparator: { "-\u{2013}\u{2014}".contains($0) }).first.map(String.init) ?? reference
        return Bible.resolveReference(start)
    }
}

/// The verse sheet's "See also" list: `GET /api/bible/crossrefs`, the public,
/// edge-cached route Android's `CrossReferencesSection.tsx` calls (data from
/// `src/data/crossrefs`, openbible.info). Same query, same validation, same
/// top-five cap, same three states.
@MainActor
@Observable
final class CrossReferencesModel {
    typealias Fetch = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    enum State: Equatable {
        case idle
        case loading
        case ready([CrossReferenceItem])
        case error
    }

    nonisolated static let limit = 5
    nonisolated static let timeout: TimeInterval = 15

    private(set) var state: State = .idle
    private var key: String?
    private var runID = 0
    private let baseURL: URL
    private let fetch: Fetch

    init(baseURL: URL = Config.apiURL, fetch: @escaping Fetch = { try await URLSession.shared.data(for: $0) }) {
        self.baseURL = baseURL
        self.fetch = fetch
    }

    nonisolated static func url(baseURL: URL, reference: String, translation: TranslationID) -> URL? {
        var components = URLComponents(
            url: baseURL.appending(path: "api/bible/crossrefs"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "reference", value: reference),
            URLQueryItem(name: "translation", value: translation.rawValue),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        return components?.url
    }

    /// Load the list for one verse. A repeat for the list already shown (or
    /// loading) is a no-op, so the tab can call this on every appearance.
    func load(reference: String, translation: TranslationID, force: Bool = false) async {
        let key = "\(translation.rawValue)|\(reference)"
        if !force, self.key == key, state != .error { return }
        self.key = key
        runID += 1
        let id = runID
        state = .loading
        guard let url = Self.url(baseURL: baseURL, reference: reference, translation: translation) else {
            state = .error
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.timeout
        do {
            let (data, response) = try await fetch(request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw BibleError(message: "Cross-reference request failed: \(http.statusCode)")
            }
            let items = try Self.parse(data, translation: translation)
            guard id == runID else { return }
            state = .ready(items)
        } catch {
            guard id == runID else { return }
            state = .error
        }
    }

    func retry(reference: String, translation: TranslationID) async {
        await load(reference: reference, translation: translation, force: true)
    }

    /// Android's `parseResponse`: the translation must echo the request, every
    /// item needs a string reference and an optional string text, and verse
    /// markup is stripped. Anything else rejects the whole answer.
    nonisolated static func parse(_ data: Data, translation: TranslationID) throws -> [CrossReferenceItem] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["translation"] as? String == translation.rawValue,
              object["reference"] is String,
              let rows = object["crossReferences"] as? [Any]
        else { throw BibleError(message: "Unexpected cross-reference response") }
        var items: [CrossReferenceItem] = []
        for row in rows {
            guard let value = row as? [String: Any], let reference = value["reference"] as? String else {
                throw BibleError(message: "Unexpected cross-reference response")
            }
            var text: String?
            if let raw = value["text"] {
                guard let string = raw as? String else {
                    throw BibleError(message: "Unexpected cross-reference response")
                }
                let plain = VerseMarkup.plainText(string)
                text = plain.isEmpty ? nil : plain
            }
            items.append(CrossReferenceItem(reference: reference, text: text))
        }
        return Array(items.prefix(limit))
    }
}
