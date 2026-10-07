import Foundation

/// Notes domain types — a port of `mobile/src/features/notes/types.ts`, which is
/// itself a port of the web app's `src/types/notes.ts`. All three clients read
/// the same rows out of `/api/notes`, so the field names here are the column
/// names in `prisma/schema.prisma`, not Swift-flavoured renames.

struct Tag: Sendable, Equatable, Identifiable, Codable {
    var id: String
    var name: String
    var color: String
    var createdAt: String = ""
}

struct Folder: Sendable, Equatable, Identifiable, Codable {
    var id: String
    var name: String
    var parentId: String?
    var sortOrder: Int = 0
    var createdAt: String = ""
}

struct Note: Sendable, Equatable, Identifiable, Codable {
    var id: String
    /// Tiptap JSON when the note was last saved on the web, HTML when it was
    /// last saved on Android or here. Always read `htmlContent` to render or
    /// edit — see `NoteUtils.initialHTML(for:)`.
    var content: String = ""
    var htmlContent: String = ""
    var title: String
    var plainText: String = ""
    var folderId: String?
    var tagIds: [String] = []
    var createdAt: String = ""
    var updatedAt: String = ""
    var isPinned: Bool = false
    var wordCount: Int = 0
    /// Extra titles a `[[wikilink]]` may resolve through. Rides in the list
    /// summary, so the link picker can match on it from the cache.
    var aliases: [String] = []
    /// Free-form metadata beyond tags; nil when the note carries none. Not in
    /// list summaries - only single-note fetches and saves fill it.
    var properties: NoteProperties?
    /// Cache bookkeeping: true when `content`/`htmlContent` hold the real body
    /// (from a single-note fetch, a create, or a save) and false on the summary
    /// rows `/api/notes?summary=1` returns.
    var hasBody: Bool = false
}

/// A raw row from `/api/notes`. Tags arrive through the join table, and the
/// summary payload omits the two heavy body columns, so both are optional.
struct NoteAPIResponse: Sendable, Decodable {
    struct TagLink: Sendable, Decodable {
        var tag: Tag
    }

    var id: String
    var title: String
    var content: String?
    var htmlContent: String?
    var plainText: String
    var folderId: String?
    var isPinned: Bool
    var wordCount: Int
    var createdAt: String
    var updatedAt: String
    var tags: [TagLink]?
    /// Both arrived with wikilinks (Android 1.41.0); older servers omit them.
    var aliases: [String]?
    /// Decoded loosely and narrowed by `NoteProperties(json:)`, so one odd
    /// value degrades that property instead of failing the whole note.
    var properties: JSONValue?
}

extension Note {
    /// Port of `toNote` — note that `hasBody` is deliberately *not* set here.
    /// The callers that know they fetched a real body set it themselves, the
    /// same split the TS original relies on.
    init(api: NoteAPIResponse) {
        self.init(
            id: api.id,
            content: api.content ?? "",
            htmlContent: api.htmlContent ?? "",
            title: api.title,
            plainText: api.plainText,
            folderId: api.folderId,
            tagIds: (api.tags ?? []).map(\.tag.id),
            createdAt: api.createdAt,
            updatedAt: api.updatedAt,
            isPinned: api.isPinned,
            wordCount: api.wordCount,
            aliases: api.aliases ?? [],
            properties: api.properties.flatMap(NoteProperties.init(json:))
        )
    }

    /// The body a save hands back: the note as fetched, marked as carrying real
    /// content.
    static func loaded(from api: NoteAPIResponse) -> Note {
        var note = Note(api: api)
        note.hasBody = true
        return note
    }
}

/// The persisted cache (`NotesStore`) predates `aliases` and `properties`, and
/// a synthesized decoder would reject every row written before them - which
/// throws the whole cache away. Missing keys take their defaults instead, the
/// Swift equivalent of Android bumping its cache key to v2.
extension Note {
    private enum CodingKeys: String, CodingKey {
        case id, content, htmlContent, title, plainText, folderId, tagIds
        case createdAt, updatedAt, isPinned, wordCount, aliases, properties, hasBody
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            content: try c.decodeIfPresent(String.self, forKey: .content) ?? "",
            htmlContent: try c.decodeIfPresent(String.self, forKey: .htmlContent) ?? "",
            title: try c.decode(String.self, forKey: .title),
            plainText: try c.decodeIfPresent(String.self, forKey: .plainText) ?? "",
            folderId: try c.decodeIfPresent(String.self, forKey: .folderId),
            tagIds: try c.decodeIfPresent([String].self, forKey: .tagIds) ?? [],
            createdAt: try c.decodeIfPresent(String.self, forKey: .createdAt) ?? "",
            updatedAt: try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? "",
            isPinned: try c.decodeIfPresent(Bool.self, forKey: .isPinned) ?? false,
            wordCount: try c.decodeIfPresent(Int.self, forKey: .wordCount) ?? 0,
            aliases: try c.decodeIfPresent([String].self, forKey: .aliases) ?? [],
            properties: try c.decodeIfPresent(NoteProperties.self, forKey: .properties),
            hasBody: try c.decodeIfPresent(Bool.self, forKey: .hasBody) ?? false
        )
    }
}

/// What the editor hands back on every autosave — matches the PATCH body the
/// route accepts (`src/app/api/notes/[id]/route.ts`).
struct NoteSavePayload: Sendable, Equatable, Encodable {
    var content: String
    var htmlContent: String
    var plainText: String
    var wordCount: Int
}

/// Partial update for `PATCH /api/notes/{id}`.
///
/// `folderId` needs three states — absent, set, and explicitly `null` (unfile
/// the note) — and a plain `String??` does not survive `JSONEncoder`, which
/// drops a nil-wrapped optional entirely. Encoding it by hand is what makes
/// "move to no folder" reach the server instead of silently no-opping.
struct NotePatch: Sendable, Equatable, Encodable {
    var title: String?
    var isPinned: Bool?
    var wordCount: Int?
    var folderId: String??
    /// Validated server-side (`validateAliases`): trimmed, de-duplicated,
    /// at most 20 of up to 120 characters.
    var aliases: [String]?
    /// Replaces the whole object, the way Android's `setProperties` does - so
    /// a delete is just a write without that key.
    var properties: NoteProperties?

    enum CodingKeys: String, CodingKey {
        case title, isPinned, wordCount, folderId, aliases, properties
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(isPinned, forKey: .isPinned)
        try container.encodeIfPresent(wordCount, forKey: .wordCount)
        if let folderId {
            try container.encode(folderId, forKey: .folderId)
        }
        try container.encodeIfPresent(aliases, forKey: .aliases)
        try container.encodeIfPresent(properties, forKey: .properties)
    }

    static func title(_ value: String) -> NotePatch { NotePatch(title: value) }
    static func pinned(_ value: Bool) -> NotePatch { NotePatch(isPinned: value) }
    static func folder(_ value: String?) -> NotePatch { NotePatch(folderId: .some(value)) }
    static func aliases(_ value: [String]) -> NotePatch { NotePatch(aliases: value) }
    static func properties(_ value: NoteProperties) -> NotePatch { NotePatch(properties: value) }
}

/// The same eight swatches the web `TagManager` and the Android tag sheet offer.
enum TagPalette {
    static let colors: [String] = [
        "#f59e0b",
        "#ef4444",
        "#22c55e",
        "#3b82f6",
        "#a855f7",
        "#ec4899",
        "#06b6d4",
        "#f97316",
    ]

    /// Fallback matches the server's default in `POST /api/tags`.
    static let fallback = "#6b7280"
}
