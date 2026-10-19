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

    /// Picker order: most recently updated first, as Android's
    /// `InsertWikilinkSheet` and the web's `sortByRecentlyUpdated` sort.
    static func sortedByRecentlyUpdated(_ notes: [Note]) -> [Note] {
        notes.sorted {
            (NoteUtils.parseISO($0.updatedAt) ?? .distantPast)
                > (NoteUtils.parseISO($1.updatedAt) ?? .distantPast)
        }
    }

    // MARK: - Links in the editor

    /// One `[[...]]` in the editor's text: where it sits (UTF-16, the unit
    /// `NSRange` and `NSTextStorage` count in) and the note title it targets.
    struct Match: Sendable, Equatable {
        var range: NSRange
        var target: String
    }

    /// Every `[[...]]` in `text`, for drawing links in the editor - the Apple
    /// side of the web's `WikilinkDecoration` (`src/components/notes/extensions/WikilinkDecoration.ts`).
    ///
    /// Same rule as the server's `/\[\[([^[\]]+?)\]\]/g` in
    /// `src/lib/note-links.ts`: the inside holds no bracket, and the leftmost
    /// match wins. Like the web, which decorates one text node at a time, a
    /// link never runs across a paragraph (`\n`) or a hard break (U+2028).
    /// `[[Target|display]]` and `[[Target#heading]]` both target "Target", and
    /// a link whose target is blank (`[[ ]]`, `[[#x]]`) is skipped.
    static func matches(in text: String) -> [Match] {
        let units = Array(text.utf16)
        let open = UInt16(UInt8(ascii: "["))
        let close = UInt16(UInt8(ascii: "]"))
        let newline = UInt16(UInt8(ascii: "\n"))
        let hardBreak: UInt16 = 0x2028

        var found: [Match] = []
        var index = 0
        while index + 1 < units.count {
            guard units[index] == open, units[index + 1] == open else {
                index += 1
                continue
            }
            var end = index + 2
            while end < units.count,
                  units[end] != open, units[end] != close,
                  units[end] != newline, units[end] != hardBreak {
                end += 1
            }
            guard end > index + 2, end + 1 < units.count,
                  units[end] == close, units[end + 1] == close
            else {
                index += 1
                continue
            }
            let inner = String(decoding: units[(index + 2)..<end], as: UTF16.self)
            let target = target(of: inner)
            if !target.isEmpty {
                found.append(Match(range: NSRange(location: index, length: end + 2 - index), target: target))
            }
            index = end + 2
        }
        return found
    }

    /// The note title inside a link: everything before the first `#` or `|`,
    /// trimmed (`targetOf` on the web, the `cut` in the server's parser).
    static func target(of inner: String) -> String {
        let cut = inner.firstIndex { $0 == "#" || $0 == "|" } ?? inner.endIndex
        return inner[..<cut].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The note a link opens, or nil when none carries that name yet - the
    /// web editor's `resolveTarget`, which mirrors the server's rule: titles
    /// and aliases match case-insensitively, and the most recently updated
    /// note wins a collision. Compared as ISO strings, as the web does.
    static func resolve(_ target: String, in notes: [Note]) -> String? {
        let key = target.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return nil }
        var winner: Note?
        for note in notes {
            let names = [note.title] + note.aliases
            guard names.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == key })
            else { continue }
            if let current = winner, note.updatedAt <= current.updatedAt { continue }
            winner = note
        }
        return winner?.id
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
