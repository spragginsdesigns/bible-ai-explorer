import Foundation

/// "My church" wire shapes and pure rules - a port of
/// `mobile/src/features/church/church.ts` and `src/lib/church-client.ts`,
/// talking to the same shared routes in `src/app/api/church/*`.
///
/// Every route answers `status: "unavailable"` when the deployment has no
/// Google Places key. All clients then render nothing at all for the section,
/// heading included, the same way the Listen card disappears without an
/// ElevenLabs key. That is why the response is an enum rather than an optional:
/// "not configured" and "no church saved" are different answers and must not
/// collapse into one.

struct ChurchProfile: Decodable, Sendable, Equatable, Identifiable {
    var id: String { placeId }

    let placeId: String
    let name: String
    let address: String
    let phone: String?
    let website: String?
    let mapsUrl: String?
    /// Absolute URL (the church's own logo, or our `/api/church/photo` proxy).
    let photoUrl: String?
    let mission: String?
    let about: String?
    /// Page the mission statement was read from, for the "From ..." credit.
    let missionSource: String?
    let updatedAt: String
}

struct ChurchSearchResult: Decodable, Sendable, Equatable, Identifiable {
    var id: String { placeId }

    let placeId: String
    let name: String
    let address: String
    let hasPhoto: Bool
}

enum ChurchResponse: Decodable, Sendable, Equatable {
    case unavailable
    case ok(church: ChurchProfile?)

    private enum CodingKeys: String, CodingKey { case status, church }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decode(String.self, forKey: .status) == "unavailable" {
            self = .unavailable
            return
        }
        self = .ok(church: try container.decodeIfPresent(ChurchProfile.self, forKey: .church))
    }
}

enum ChurchSearchResponse: Decodable, Sendable, Equatable {
    case unavailable
    case ok(results: [ChurchSearchResult])

    private enum CodingKeys: String, CodingKey { case status, results }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decode(String.self, forKey: .status) == "unavailable" {
            self = .unavailable
            return
        }
        self = .ok(results: try container.decodeIfPresent([ChurchSearchResult].self, forKey: .results) ?? [])
    }
}

/// Rules shared with the other two clients. Changing one of these without
/// changing `mobile/src/features/church/church.ts` breaks parity.
enum ChurchRules {
    /// `GET /api/church/search` 400s below this, so the client never sends a
    /// shorter query.
    static let minQueryLength = 3
    static let maxQueryLength = 120
    /// Keystroke debounce for the search box.
    static let searchDebounceMilliseconds = 350
    /// Collapsed height of the mission statement, in lines.
    static let missionClampLines = 6
    /// Length past which the collapsed mission is assumed to be truncated.
    /// SwiftUI has no `onTextLayout`, so this mirrors the web client's
    /// character/newline heuristic rather than measuring the laid-out lines the
    /// way React Native can.
    static let missionClampCharacters = 400

    /// `PUT /api/church` resolves the place, fetches the church's own website
    /// and runs a model extraction over it - measured at up to ~20s, and the
    /// route declares `maxDuration = 60`. The default 30s client budget leaves
    /// almost no headroom on a slow connection.
    static let saveTimeout: TimeInterval = 60

    /// True when the typed text is worth sending to `/api/church/search`.
    static func shouldSearch(_ query: String) -> Bool {
        query.trimmingCharacters(in: .whitespacesAndNewlines).count >= minQueryLength
    }

    /// Whether the collapsed mission statement is hiding anything.
    static func missionIsLong(_ mission: String) -> Bool {
        mission.count > missionClampCharacters
            || mission.components(separatedBy: "\n").count > missionClampLines
    }

    /// Stale-response guard for search-as-you-type: each request carries a
    /// monotonic id and only the newest may write to state.
    static func isLatestRequest(_ requestId: Int, latest: Int) -> Bool {
        requestId == latest
    }

    /// "https://www.gracechapel.org/about" -> "gracechapel.org".
    ///
    /// Regex-free and deliberately not `URLComponents`: this only ever labels a
    /// link, and it must agree character for character with `hostnameOf` in the
    /// TypeScript clients, including keeping the host's original case.
    static func hostname(of url: String?) -> String? {
        guard let url else { return nil }
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let schemeEnd = trimmed.range(of: "://") else { return nil }

        let scheme = trimmed[trimmed.startIndex..<schemeEnd.lowerBound]
        guard let first = scheme.first, first.isLetter else { return nil }
        guard scheme.dropFirst().allSatisfy({
            $0.isLetter || $0.isNumber || $0 == "+" || $0 == "." || $0 == "-"
        }) else { return nil }

        let rest = trimmed[schemeEnd.upperBound...]
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        guard !authority.isEmpty else { return nil }

        // Strip any userinfo, then the port, then a leading "www.".
        var host = String(authority.split(separator: "@", omittingEmptySubsequences: false).last ?? "")
        if let colon = host.lastIndex(of: ":") {
            let port = host[host.index(after: colon)...]
            if !port.isEmpty, port.allSatisfy(\.isNumber) {
                host = String(host[host.startIndex..<colon])
            }
        }
        if host.lowercased().hasPrefix("www.") { host = String(host.dropFirst(4)) }
        return host.isEmpty ? nil : host
    }

    /// `tel:` needs the digits and a leading `+`, nothing else.
    static func telURL(for phone: String) -> URL? {
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }
}

extension APIClient {
    func fetchChurch() async throws -> ChurchResponse {
        try await json("/api/church")
    }

    func searchChurches(query: String) async throws -> ChurchSearchResponse {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=?#")
        let escaped = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? query
        return try await json("/api/church/search?q=\(escaped)")
    }

    /// Slow by nature - see `ChurchRules.saveTimeout`.
    func saveChurch(placeId: String) async throws -> ChurchResponse {
        struct Body: Encodable { let placeId: String }
        return try await json(
            "/api/church",
            method: "PUT",
            body: Body(placeId: placeId),
            timeout: ChurchRules.saveTimeout,
            as: ChurchResponse.self
        )
    }

    func removeChurch() async throws {
        try await data("/api/church", method: "DELETE")
    }
}
