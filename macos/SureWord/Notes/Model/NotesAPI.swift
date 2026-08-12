import Foundation

/// The notes REST surface — a port of `mobile/src/features/notes/api.ts`.
///
/// Contracts confirmed against the route handlers in `src/app/api/`:
///
/// | Call | Route | Notes |
/// |---|---|---|
/// | `notes()` | `GET /api/notes?summary=1` | omits `content`/`htmlContent` |
/// | `note(id:)` | `GET /api/notes/{id}` | full row, no AI messages |
/// | `createNote` | `POST /api/notes` | 201, defaults title to "Untitled Note" |
/// | `patchNote` | `PATCH /api/notes/{id}` | only the keys present are written |
/// | `deleteNote` | `DELETE /api/notes/{id}` | `{ success: true }` |
/// | `folders()` | `GET /api/folders` | ordered by `sortOrder` |
/// | `createFolder` | `POST /api/folders` | `sortOrder` = current count |
/// | `deleteFolder` | `DELETE /api/folders/{id}` | unfiles its notes first |
/// | `tags()` | `GET /api/tags` | ordered by `createdAt` |
/// | `createTag` | `POST /api/tags` | colour defaults to `#6b7280` |
/// | `deleteTag` | `DELETE /api/tags/{id}` | cascades the join rows |
/// | `toggleTag` | `POST /api/notes/{id}/tags/{tagId}` | `{ action: "added"｜"removed" }` |
/// | `aiMessages` | `GET /api/notes/{id}/ai-messages` | ascending by `createdAt` |
/// | `clearAIMessages` | `DELETE /api/notes/{id}/ai-messages` | `{ success: true }` |
struct NotesAPI: Sendable {
    let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    // MARK: Notes

    /// List rows come back without the body columns; the editor fetches those
    /// per note. Skipping `summary=1` would make the list response carry every
    /// note's full HTML.
    func notes() async throws -> [Note] {
        try await api.json("/api/notes?summary=1", as: [NoteAPIResponse].self).map(Note.init(api:))
    }

    func note(id: String) async throws -> Note {
        .loaded(from: try await api.json("/api/notes/\(id)", as: NoteAPIResponse.self))
    }

    func createNote(title: String, folderId: String?) async throws -> Note {
        struct Body: Encodable {
            let title: String
            let folderId: String?
        }
        return .loaded(
            from: try await api.json(
                "/api/notes",
                method: "POST",
                body: Body(title: title, folderId: folderId),
                as: NoteAPIResponse.self
            )
        )
    }

    func patchNote(id: String, _ patch: NotePatch) async throws -> Note {
        .loaded(
            from: try await api.json(
                "/api/notes/\(id)",
                method: "PATCH",
                body: patch,
                as: NoteAPIResponse.self
            )
        )
    }

    func saveNote(id: String, _ payload: NoteSavePayload) async throws -> Note {
        .loaded(
            from: try await api.json(
                "/api/notes/\(id)",
                method: "PATCH",
                body: payload,
                as: NoteAPIResponse.self
            )
        )
    }

    func deleteNote(id: String) async throws {
        try await api.data("/api/notes/\(id)", method: "DELETE")
    }

    // MARK: Folders

    func folders() async throws -> [Folder] {
        try await api.json("/api/folders", as: [Folder].self)
    }

    func createFolder(name: String) async throws -> Folder {
        struct Body: Encodable { let name: String }
        return try await api.json(
            "/api/folders",
            method: "POST",
            body: Body(name: name),
            as: Folder.self
        )
    }

    func renameFolder(id: String, name: String) async throws -> Folder {
        struct Body: Encodable { let name: String }
        return try await api.json(
            "/api/folders/\(id)",
            method: "PATCH",
            body: Body(name: name),
            as: Folder.self
        )
    }

    func deleteFolder(id: String) async throws {
        try await api.data("/api/folders/\(id)", method: "DELETE")
    }

    // MARK: Tags

    func tags() async throws -> [Tag] {
        try await api.json("/api/tags", as: [Tag].self)
    }

    func createTag(name: String, color: String) async throws -> Tag {
        struct Body: Encodable {
            let name: String
            let color: String
        }
        return try await api.json(
            "/api/tags",
            method: "POST",
            body: Body(name: name, color: color),
            as: Tag.self
        )
    }

    func deleteTag(id: String) async throws {
        try await api.data("/api/tags/\(id)", method: "DELETE")
    }

    /// The endpoint toggles: it adds the tag when missing and removes it when
    /// present, so the caller must already know which way it will go.
    func toggleTag(noteId: String, tagId: String) async throws {
        try await api.data("/api/notes/\(noteId)/tags/\(tagId)", method: "POST")
    }

    // MARK: Per-note AI history

    func aiMessages(noteId: String) async throws -> [UIMessage] {
        let rows = try await api.json("/api/notes/\(noteId)/ai-messages", as: [JSONValue].self)
        return rows.compactMap(UIMessage.init(storedRow:))
    }

    func clearAIMessages(noteId: String) async throws {
        try await api.data("/api/notes/\(noteId)/ai-messages", method: "DELETE")
    }
}

/// Request body for `POST /api/note-ai`. The route requires a non-empty
/// `noteId` and a non-empty `messages` array whose last entry is a user
/// message, and answers 400 otherwise
/// (`src/app/api/note-ai/route.ts`).
struct NoteAIRequest: Encodable {
    var messages: [JSONValue]
    var noteId: String
}
