import Foundation

/// Ways to Serve wire shapes (GitHub issue #28, `docs/FEATURES.md`): the
/// Apple mirror of `GET/PATCH /api/serve`, `/api/serve/nearby` and
/// `/api/serve/journal` (`src/lib/serve.ts`).
///
/// The server owns every word a reader sees here, the faith-first intro, the
/// ways and their KJV verses included, so the clients cannot drift into a
/// works-based message. Decoding is lenient for the same reason the server's
/// list can grow: an action or mode this build does not know reads as "no
/// button" or the default mode, never as a failed screen.

struct ServeVerse: Codable, Sendable, Equatable {
    let reference: String
    let text: String
}

struct ServeSettings: Codable, Sendable, Equatable {
    var mode: ServeMode
    var givesToChurch: Bool

    private enum CodingKeys: String, CodingKey { case mode, givesToChurch }

    init(mode: ServeMode, givesToChurch: Bool) {
        self.mode = mode
        self.givesToChurch = givesToChurch
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decodeIfPresent(String.self, forKey: .mode)
        mode = ServeMode.read(raw)
        givesToChurch = (try? container.decodeIfPresent(Bool.self, forKey: .givesToChurch)) ?? false
    }
}

struct ServeWay: Codable, Sendable, Equatable, Identifiable {
    let id: String
    /// "online" or "nearby"; kept as text because it only labels the row.
    let kind: String
    let title: String
    let detail: String
    /// nil for no action, including any action newer than this build.
    let action: ServeAction?
    let needsChurch: Bool?
    let giving: String?
    let verse: ServeVerse

    private enum CodingKeys: String, CodingKey {
        case id, kind, title, detail, action, needsChurch, giving, verse
    }

    init(
        id: String, kind: String, title: String, detail: String, action: ServeAction?,
        needsChurch: Bool? = nil, giving: String? = nil, verse: ServeVerse
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.action = action
        self.needsChurch = needsChurch
        self.giving = giving
        self.verse = verse
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = (try? container.decodeIfPresent(String.self, forKey: .kind)) ?? "online"
        title = try container.decode(String.self, forKey: .title)
        detail = (try? container.decodeIfPresent(String.self, forKey: .detail)) ?? ""
        let rawAction = try? container.decodeIfPresent(String.self, forKey: .action)
        action = rawAction.flatMap { ServeAction(rawValue: $0) }
        needsChurch = try? container.decodeIfPresent(Bool.self, forKey: .needsChurch)
        giving = try? container.decodeIfPresent(String.self, forKey: .giving)
        verse = (try? container.decodeIfPresent(ServeVerse.self, forKey: .verse))
            ?? ServeVerse(reference: "", text: "")
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encode(detail, forKey: .detail)
        try container.encodeIfPresent(action?.rawValue, forKey: .action)
        try container.encodeIfPresent(needsChurch, forKey: .needsChurch)
        try container.encodeIfPresent(giving, forKey: .giving)
        try container.encode(verse, forKey: .verse)
    }
}

struct ServeIntro: Codable, Sendable, Equatable {
    let text: String
    let verses: [ServeVerse]
}

struct ServeChurch: Codable, Sendable, Equatable {
    let name: String
    let website: String?
}

struct ServeNearbySearch: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let label: String
}

struct ServeNearbyInfo: Codable, Sendable, Equatable {
    let available: Bool
    let searches: [ServeNearbySearch]
}

struct ServeJournalInfo: Codable, Sendable, Equatable {
    let title: String
    let prompt: String
    let verse: ServeVerse
}

/// The whole page, as `buildServeView` returns it.
struct ServeView: Codable, Sendable, Equatable {
    let title: String
    var settings: ServeSettings
    let intro: ServeIntro
    /// One way for today, or nil when Ways to Serve is off.
    let today: ServeWay?
    let ways: [ServeWay]
    let church: ServeChurch?
    let nearby: ServeNearbyInfo
    let journal: ServeJournalInfo
}

struct ServeResponse: Decodable, Sendable {
    let serve: ServeView
}

struct ServePlace: Codable, Sendable, Equatable, Identifiable {
    var id: String { placeId }

    let placeId: String
    let name: String
    let address: String
    let phone: String?
    let website: String?
    let mapsUrl: String?
}

enum ServeNearbyResponse: Decodable, Sendable, Equatable {
    case unavailable
    case ok(results: [ServePlace])

    private enum CodingKeys: String, CodingKey { case status, results }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decodeIfPresent(String.self, forKey: .status) == "unavailable" {
            self = .unavailable
            return
        }
        self = .ok(results: try container.decodeIfPresent([ServePlace].self, forKey: .results) ?? [])
    }
}

struct ServeEntry: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let text: String
    let verseRef: String?
    let createdAt: String
}

struct ServeEntriesResponse: Decodable, Sendable {
    let entries: [ServeEntry]
}

struct ServeEntryResponse: Decodable, Sendable {
    let entry: ServeEntry
}

extension APIClient {
    func fetchServe() async throws -> ServeView {
        try await json("/api/serve", as: ServeResponse.self).serve
    }

    /// Either field may be nil; the route writes only what is sent.
    func updateServe(mode: ServeMode? = nil, givesToChurch: Bool? = nil) async throws -> ServeView {
        struct Body: Encodable {
            let mode: String?
            let givesToChurch: Bool?

            func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encodeIfPresent(mode, forKey: .mode)
                try container.encodeIfPresent(givesToChurch, forKey: .givesToChurch)
            }

            private enum CodingKeys: String, CodingKey { case mode, givesToChurch }
        }
        return try await json(
            "/api/serve",
            method: "PATCH",
            body: Body(mode: mode?.rawValue, givesToChurch: givesToChurch),
            as: ServeResponse.self
        ).serve
    }

    func searchServeNearby(location: String, kind: String) async throws -> ServeNearbyResponse {
        try await json(ServeRules.nearbyPath(location: location, kind: kind))
    }

    func fetchServeEntries() async throws -> [ServeEntry] {
        try await json("/api/serve/journal", as: ServeEntriesResponse.self).entries
    }

    func addServeEntry(text: String, verseRef: String?) async throws -> ServeEntry {
        struct Body: Encodable {
            let text: String
            let verseRef: String?
        }
        return try await json(
            "/api/serve/journal",
            method: "POST",
            body: Body(text: text, verseRef: verseRef),
            as: ServeEntryResponse.self
        ).entry
    }

    func deleteServeEntry(id: String) async throws {
        try await data(ServeRules.entryPath(id: id), method: "DELETE")
    }
}
