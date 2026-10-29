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
/// | `links(noteId:)` | `GET /api/notes/{id}/links` | `{ outgoing, backlinks }`, server-resolved |
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

    /// A note started from a template (PRD E1): the same body Android sends,
    /// `title` plus the seed's `content`, `htmlContent`, `plainText` and
    /// `wordCount` (`createNote` in `mobile/src/features/notes/api.ts`).
    func createNote(folderId: String?, seed: NoteTemplates.Seed) async throws -> Note {
        struct Body: Encodable {
            let title: String
            let folderId: String?
            let content: String
            let htmlContent: String
            let plainText: String
            let wordCount: Int
        }
        return .loaded(
            from: try await api.json(
                "/api/notes",
                method: "POST",
                body: Body(
                    title: seed.title,
                    folderId: folderId,
                    content: seed.content,
                    htmlContent: seed.html,
                    plainText: seed.plainText,
                    wordCount: seed.wordCount
                ),
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

    /// The note's wikilink graph, both directions. The server rebuilds it from
    /// the *saved* plainText, so callers flush the editor first.
    func links(noteId: String) async throws -> NoteLinks {
        try await api.json("/api/notes/\(noteId)/links", as: NoteLinks.self)
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

    // MARK: Per-note AI operation receipts

    /// Reserve the same immutable request that will open the stream. A lost
    /// response is recovered by cancellation, never by submitting it again.
    func reserveAIOperation(_ request: NoteAIRequest) async throws -> NoteAIOperation {
        guard let operationID = request.operationId else {
            throw APIError(message: "The AI request has no safety identifier.")
        }
        let receipt = try await api.json(
            "/api/note-ai/operations", method: "POST", body: request, as: NoteAIOperation.self
        )
        return try checked(receipt, operationID: operationID)
    }

    func aiOperation(id: String, noteId: String) async throws -> NoteAIOperation {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "noteId", value: noteId)]
        let receipt = try await api.json(
            "/api/note-ai/operations/\(id)?\(query.percentEncodedQuery ?? "")", as: NoteAIOperation.self
        )
        return try checked(receipt, operationID: id)
    }

    /// The server also creates a cancelled tombstone when reservation never
    /// arrived, fencing a delayed reserve/stream after a lost response.
    func cancelAIOperation(id: String, noteId: String) async throws -> NoteAIOperation {
        struct Body: Encodable { let noteId: String }
        let receipt = try await api.json(
            "/api/note-ai/operations/\(id)/cancel", method: "POST", body: Body(noteId: noteId), as: NoteAIOperation.self
        )
        return try checked(receipt, operationID: id)
    }

    private func checked(_ receipt: NoteAIOperation, operationID: String) throws -> NoteAIOperation {
        guard receipt.id.caseInsensitiveCompare(operationID) == .orderedSame else {
            throw APIError(message: "The AI safety receipt did not match this request.")
        }
        return receipt
    }
}

struct NoteAIOperation: Decodable, Equatable, Sendable {
    enum State: String, Decodable, Sendable { case reserved, running, settled, cancelled }
    let id: String
    let state: State
    var isTerminal: Bool { state == .settled || state == .cancelled }
}

/// Request body for `POST /api/note-ai`. The route requires a non-empty
/// `noteId` and a non-empty `messages` array whose last entry is a user
/// message, and answers 400 otherwise
/// (`src/app/api/note-ai/route.ts`).
struct NoteAIRequest: Encodable {
    var timezone: String = TimeZone.current.identifier
    var messages: [JSONValue]
    var noteId: String
    var operationId: String? = nil
}
