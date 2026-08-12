import Foundation

/// Saving a whole assistant answer into a note — port of
/// `mobile/src/features/chat/addToNote.ts` (and the web client's
/// `src/components/AddToNoteDialog.tsx`, which drives the same endpoint).
///
/// The markdown → HTML conversion deliberately lives on the server
/// (`src/lib/markdown.ts` via `src/lib/notes-io.ts`): every client posts the raw
/// answer markdown and the backend produces the note HTML, so all three stay
/// byte-identical without porting a Markdown parser three times.

// MARK: - Wire types

/// One row of the picker. Shape of `GET /api/notes?summary=1`, whose payload
/// omits the heavy `content` / `htmlContent` columns.
struct NoteSummary: Sendable, Equatable, Identifiable, Decodable {
    var id: String
    var title: String
    var plainText: String
    var updatedAt: String

    init(id: String, title: String, plainText: String = "", updatedAt: String = "") {
        self.id = id
        self.title = title
        self.plainText = plainText
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, plainText, updatedAt
    }

    /// Hand-written so a null/absent `plainText` or `title` degrades to an empty
    /// string instead of failing the whole list decode.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = (try? container.decode(String.self, forKey: .title)) ?? ""
        plainText = (try? container.decode(String.self, forKey: .plainText)) ?? ""
        updatedAt = (try? container.decode(String.self, forKey: .updatedAt)) ?? ""
    }

    /// What the picker shows when the note has never been titled.
    var displayTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled Note" : title
    }

    var preview: String {
        let trimmed = plainText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Empty note" : String(trimmed.prefix(160))
    }
}

/// Response shape of `POST /api/notes/append` — the contract shared with the
/// Android and web clients.
struct AppendToNoteResult: Sendable, Equatable, Decodable {
    var noteId: String
    var noteTitle: String
    var created: Bool
}

/// Body of `POST /api/notes/append`.
///
/// `noteId` is always present — `null` when creating — matching the Android
/// client; the route treats a non-string or empty `noteId` as "create". `title`
/// only rides along on the create path, and only when there is one to send: on
/// the append path the server ignores it, and an empty one would just override
/// nothing.
struct AppendToNoteRequest: Sendable, Equatable, Encodable {
    var markdown: String
    var noteId: String?
    var title: String?

    init(markdown: String, noteId: String?, defaultTitle: String? = nil) {
        self.markdown = markdown
        self.noteId = noteId
        let trimmed = defaultTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = (noteId == nil && !(trimmed ?? "").isEmpty) ? trimmed : nil
    }

    private enum CodingKeys: String, CodingKey {
        case markdown, noteId, title
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(markdown, forKey: .markdown)
        // Explicit `encode` (not `encodeIfPresent`) so a create posts
        // `"noteId": null` rather than dropping the key.
        try container.encode(noteId, forKey: .noteId)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

// MARK: - Actions

enum AddToNote {
    /// Note rows for the picker, newest first (the route orders by `updatedAt`).
    static func notes(api: APIClient) async throws -> [NoteSummary] {
        try await api.json("/api/notes?summary=1", as: [NoteSummary].self)
    }

    /// Save an answer into a note. `noteId: nil` creates a new one, titled after
    /// the active conversation when there is a title to use.
    @discardableResult
    static func append(
        api: APIClient,
        markdown: String,
        noteId: String?,
        defaultTitle: String? = nil
    ) async throws -> AppendToNoteResult {
        try await api.json(
            "/api/notes/append",
            method: "POST",
            body: AppendToNoteRequest(markdown: markdown, noteId: noteId, defaultTitle: defaultTitle),
            as: AppendToNoteResult.self
        )
    }

    /// Case-insensitive match on title or body preview; a blank query keeps
    /// every note. Port of `filterNotesByQuery`.
    static func filter(_ notes: [NoteSummary], query: String) -> [NoteSummary] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return notes }
        return notes.filter {
            $0.title.lowercased().contains(needle) || $0.plainText.lowercased().contains(needle)
        }
    }

    /// Port of `relativeTime` in `mobile/src/features/notes/utils.ts`.
    static func relativeTime(_ iso: String, now: Date = Date()) -> String {
        guard let then = parseISO(iso) else { return "" }
        let diff = now.timeIntervalSince(then)
        let minute: TimeInterval = 60
        let hour = 60 * minute
        let day = 24 * hour

        if diff < minute { return "Just now" }
        if diff < hour { return "\(Int(diff / minute))m ago" }
        if diff < day { return "\(Int(diff / hour))h ago" }
        if diff < 7 * day { return "\(Int(diff / day))d ago" }

        let calendar = Calendar.current
        let sameYear = calendar.component(.year, from: then) == calendar.component(.year, from: now)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = sameYear ? "MMM d" : "MMM d, yyyy"
        return formatter.string(from: then)
    }

    private static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }
}
