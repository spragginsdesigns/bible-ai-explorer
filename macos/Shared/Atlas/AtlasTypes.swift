import Foundation

enum AtlasEra: String, Codable, CaseIterable, Identifiable, Sendable, Hashable {
    case creationAndPatriarchs = "Creation & the Patriarchs"
    case egyptAndExodus = "Egypt & the Exodus"
    case conquestAndJudges = "Conquest & Judges"
    case unitedKingdom = "United Kingdom"
    case dividedKingdom = "Divided Kingdom"
    case exileAndReturn = "Exile & Return"
    case betweenTheTestaments = "Between the Testaments"
    case lifeOfChrist = "Life of Christ"
    case earlyChurch = "The Early Church"

    var id: String { rawValue }
}

enum AtlasDateProvenance: String, Codable, Sendable, Hashable {
    case traditionalUssher = "traditional-ussher"
    case scriptureExplicit = "scripture-explicit"
    case undated
}

struct AtlasEventDate: Codable, Equatable, Sendable {
    let label: String
    let startYear: Int?
    let endYear: Int?
    let provenance: AtlasDateProvenance
}

enum AtlasEntityKind: String, Codable, Sendable, Hashable {
    case person
    case place
}

enum AtlasRelationType: String, Codable, Sendable, Hashable {
    case parent, spouse, sibling, mentor, disciple, companion
    case associatedPlace = "associated-place"
    case associated
}

enum AtlasRelationCertainty: String, Codable, Sendable, Hashable {
    case explicit, inferred, disputed
}

enum AtlasRelationLabels {
    static func label(for relation: AtlasRelation, perspectiveID: String) -> String {
        let from = relation.from == perspectiveID
        let to = relation.to == perspectiveID
        guard from || to else { return "Related" }
        switch relation.type {
        case .parent: return from ? "Child" : "Parent"
        case .spouse: return "Spouse"
        case .sibling: return "Sibling"
        case .mentor, .disciple: return from ? "Disciple" : "Mentor"
        case .companion: return "Companion"
        case .associatedPlace: return from ? "Associated place" : "Associated person"
        case .associated: return "Associated"
        }
    }
}

struct AtlasRelation: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let from: String
    let to: String
    let type: AtlasRelationType
    let refs: [String]
    let certainty: AtlasRelationCertainty
}

struct AtlasEntityRef: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: AtlasEntityKind
    let name: String
    let disambiguator: String?

    init(id: String, kind: AtlasEntityKind, name: String, disambiguator: String? = nil) {
        self.id = id
        self.kind = kind
        self.name = name
        self.disambiguator = disambiguator
    }
}

struct AtlasEntitySummary: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: AtlasEntityKind
    let name: String
    let disambiguator: String?
    let description: String
    let alsoCalled: [String]
    let era: AtlasEra?
    let modernRegion: String?

    private enum CodingKeys: String, CodingKey {
        case id, kind, name, disambiguator, description, alsoCalled, era, modernRegion
    }

    init(
        id: String,
        kind: AtlasEntityKind,
        name: String,
        disambiguator: String? = nil,
        description: String = "",
        alsoCalled: [String] = [],
        era: AtlasEra? = nil,
        modernRegion: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.disambiguator = disambiguator
        self.description = description
        self.alsoCalled = alsoCalled
        self.era = era
        self.modernRegion = modernRegion
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        kind = try values.decode(AtlasEntityKind.self, forKey: .kind)
        name = try values.decode(String.self, forKey: .name)
        disambiguator = try values.decodeIfPresent(String.self, forKey: .disambiguator)
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        alsoCalled = try values.decodeIfPresent([String].self, forKey: .alsoCalled) ?? []
        era = try values.decodeIfPresent(AtlasEra.self, forKey: .era)
        modernRegion = try values.decodeIfPresent(String.self, forKey: .modernRegion)
    }
}

struct AtlasEventView: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let title: String
    let era: AtlasEra
    let yearLabel: String
    let date: AtlasEventDate?
    let summary: String
    let refs: [String]
    let people: [AtlasEntityRef]
    let places: [AtlasEntityRef]
}

struct AtlasEntityEventSummary: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let title: String
    let era: AtlasEra
    let yearLabel: String
}

struct AtlasNeighborhoodEntry: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: AtlasEntityKind
    let name: String
    let disambiguator: String?
    let description: String
    let alsoCalled: [String]
    let era: AtlasEra?
    let modernRegion: String?
    let relation: AtlasRelation
    let entity: AtlasEntitySummary
    let direction: String
    let label: String

    private enum CodingKeys: String, CodingKey {
        case id, kind, name, disambiguator, description, alsoCalled, era, modernRegion
        case relation, entity, direction, label
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        kind = try values.decode(AtlasEntityKind.self, forKey: .kind)
        name = try values.decode(String.self, forKey: .name)
        disambiguator = try values.decodeIfPresent(String.self, forKey: .disambiguator)
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        alsoCalled = try values.decodeIfPresent([String].self, forKey: .alsoCalled) ?? []
        era = try values.decodeIfPresent(AtlasEra.self, forKey: .era)
        modernRegion = try values.decodeIfPresent(String.self, forKey: .modernRegion)
        relation = try values.decode(AtlasRelation.self, forKey: .relation)
        entity = try values.decode(AtlasEntitySummary.self, forKey: .entity)
        direction = try values.decodeIfPresent(String.self, forKey: .direction) ?? ""
        label = try values.decodeIfPresent(String.self, forKey: .label) ?? "Related"
    }
}

struct AtlasEntityView: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: AtlasEntityKind
    let name: String
    let disambiguator: String?
    let alsoCalled: [String]
    let description: String
    let era: AtlasEra?
    let modernRegion: String?
    let refs: [String]
    let related: [AtlasEntityRef]
    let relations: [AtlasRelation]
    let relationDetails: [AtlasNeighborhoodEntry]
    let events: [AtlasEntityEventSummary]

    private enum CodingKeys: String, CodingKey {
        case id, kind, name, disambiguator, alsoCalled, description, era, modernRegion
        case refs, related, relations, relationDetails, events
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        kind = try values.decode(AtlasEntityKind.self, forKey: .kind)
        name = try values.decode(String.self, forKey: .name)
        disambiguator = try values.decodeIfPresent(String.self, forKey: .disambiguator)
        alsoCalled = try values.decodeIfPresent([String].self, forKey: .alsoCalled) ?? []
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        era = try values.decodeIfPresent(AtlasEra.self, forKey: .era)
        modernRegion = try values.decodeIfPresent(String.self, forKey: .modernRegion)
        refs = try values.decodeIfPresent([String].self, forKey: .refs) ?? []
        related = try values.decodeIfPresent([AtlasEntityRef].self, forKey: .related) ?? []
        relations = try values.decodeIfPresent([AtlasRelation].self, forKey: .relations) ?? []
        relationDetails = try values.decodeIfPresent([AtlasNeighborhoodEntry].self, forKey: .relationDetails) ?? []
        events = try values.decodeIfPresent([AtlasEntityEventSummary].self, forKey: .events) ?? []
    }
}

struct AtlasSearchHit: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let kind: AtlasHitKind
    let name: String
    let disambiguator: String?
    let description: String
    let era: AtlasEra?
    let yearLabel: String?
    let refs: [String]
    let score: Double
}

enum AtlasHitKind: String, Codable, Sendable, Hashable {
    case person, place, event
}

struct AtlasSearchCounts: Codable, Equatable, Sendable {
    let total: Int
    let person: Int
    let place: Int
    let event: Int

    init(total: Int = 0, person: Int = 0, place: Int = 0, event: Int = 0) {
        self.total = total
        self.person = person
        self.place = place
        self.event = event
    }

    private enum CodingKeys: String, CodingKey { case total, person, place, event }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        total = try values.decodeIfPresent(Int.self, forKey: .total) ?? 0
        person = try values.decodeIfPresent(Int.self, forKey: .person) ?? 0
        place = try values.decodeIfPresent(Int.self, forKey: .place) ?? 0
        event = try values.decodeIfPresent(Int.self, forKey: .event) ?? 0
    }
}

struct AtlasSearchResponse: Codable, Equatable, Sendable {
    let query: String
    let results: [AtlasSearchHit]
    let counts: AtlasSearchCounts

    private enum CodingKeys: String, CodingKey { case query, results, counts }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        query = try values.decodeIfPresent(String.self, forKey: .query) ?? ""
        results = try values.decodeIfPresent([AtlasSearchHit].self, forKey: .results) ?? []
        counts = try values.decodeIfPresent(AtlasSearchCounts.self, forKey: .counts) ?? AtlasSearchCounts()
    }
}

struct AtlasEntityListResponse: Codable, Equatable, Sendable {
    let kind: AtlasEntityKind?
    let results: [AtlasEntitySummary]
    let nextCursor: String?
}

struct AtlasEraGroup: Codable, Equatable, Sendable, Identifiable {
    let era: AtlasEra
    let events: [AtlasEventView]
    var id: String { era.rawValue }
}

struct AtlasTimelineResponse: Codable, Equatable, Sendable {
    let allEras: [AtlasEra]
    let groups: [AtlasEraGroup]
    let events: [AtlasEventView]

    private enum CodingKeys: String, CodingKey {
        case allEras
        case groups = "eras"
        case events
    }
}

struct AtlasPersonConnectionPath: Codable, Equatable, Sendable {
    let ids: [String]
    let entities: [AtlasEntitySummary]
    let relations: [AtlasRelation]
}

struct AtlasConnectionResponse: Codable, Equatable, Sendable {
    let path: AtlasPersonConnectionPath?
}
