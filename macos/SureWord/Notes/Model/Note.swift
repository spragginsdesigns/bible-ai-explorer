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
            wordCount: api.wordCount
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

    enum CodingKeys: String, CodingKey {
        case title, isPinned, wordCount, folderId
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(isPinned, forKey: .isPinned)
        try container.encodeIfPresent(wordCount, forKey: .wordCount)
        if let folderId {
            try container.encode(folderId, forKey: .folderId)
        }
    }

    static func title(_ value: String) -> NotePatch { NotePatch(title: value) }
    static func pinned(_ value: Bool) -> NotePatch { NotePatch(isPinned: value) }
    static func folder(_ value: String?) -> NotePatch { NotePatch(folderId: .some(value)) }
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
