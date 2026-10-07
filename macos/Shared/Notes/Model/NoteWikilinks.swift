import Foundation

/// Client-side wikilink helpers - a port of `mobile/src/features/notes/wikilinks.ts`.
///
/// The server parses `[[Target]]`, `[[Target|display]]` and `[[Target#heading]]`
/// out of `plainText` and owns resolution and backlinks
/// (`src/lib/note-links.ts`); nothing here computes a link graph. These only
/// cover writing a link into the editor and choosing what to write, with the
/// same rules as Android so a link typed on either phone resolves identically.
enum NoteWikilinks {

    /// The four characters that carry meaning inside `[[...]]`.
    private static let reserved: Set<Character> = ["[", "]", "|", "#"]

    /// A title is only usable as a link target once its delimiters are gone.
    /// JS `\s` and Swift's `Character.isWhitespace` agree on every whitespace
    /// a title can realistically hold (spaces, tabs, newlines, NBSP).
    static func sanitizeTarget(_ raw: String) -> String {
        let replaced = String(raw.map { reserved.contains($0) ? " " : $0 })
        return replaced
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// Returns "" when nothing usable survives sanitizing, so callers can skip
    /// the insert.
    static func format(_ raw: String) -> String {
        let target = sanitizeTarget(raw)
        return target.isEmpty ? "" : "[[\(target)]]"
    }

    /// Titles and aliases are matched the same way, so a note is findable by
    /// either. Keeps the input order; the picker sorts.
    static func filterNotesForLinking(_ notes: [Note], query: String, excludeID: String) -> [Note] {
        let pool = notes.filter { $0.id != excludeID }
        let needle = sanitizeTarget(query).lowercased()
        guard !needle.isEmpty else { return pool }
        return pool.filter { note in
            note.title.lowercased().contains(needle)
                || note.aliases.contains { $0.lowercased().contains(needle) }
        }
    }

    /// Drives the "Link to: <query>" row: offered only when the query names
    /// something that does not exist yet, so the row never duplicates a real
    /// note. A blank query counts as "exists" - there is nothing to create.
    static func hasExactTarget(_ notes: [Note], query: String, excludeID: String) -> Bool {
        let needle = sanitizeTarget(query).lowercased()
        guard !needle.isEmpty else { return true }
        return notes.contains { note in
            note.id != excludeID
                && (note.title.lowercased() == needle
                    || note.aliases.contains { $0.lowercased() == needle })
        }
    }

    /// Unresolved links have no note behind them, so fall back to what was typed.
    static func outgoingLabel(_ link: NoteOutgoingLink) -> String {
        let resolved = link.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return resolved.isEmpty ? link.targetTitle : resolved
    }
}

// MARK: - Link graph wire types

/// One `[[target]]` written in this note. `noteId` is nil until a note claims
/// that title - the server keeps the raw typed text so the client can render
/// an unresolved link without a second lookup.
struct NoteOutgoingLink: Sendable, Equatable, Decodable {
    var targetTitle: String
    var noteId: String?
    var title: String?
}

/// A note that links here. The server captured the snippet at parse time.
struct NoteBacklink: Sendable, Equatable, Decodable {
    var noteId: String
    var title: String
    var snippet: String
    var updatedAt: String
}

/// Both directions of a note's wikilink graph, as `GET /api/notes/{id}/links`
/// returns them (`src/app/api/notes/[id]/links/route.ts`).
struct NoteLinks: Sendable, Equatable, Decodable {
    var outgoing: [NoteOutgoingLink]
    var backlinks: [NoteBacklink]
}
