import Foundation

/// The reader's "Note" action and the Notes tab's "Add to a note": the verse
/// goes through the note picker (`AddToNoteSheet`) as a markdown blockquote,
/// created as a new note or appended to an existing one by
/// `POST /api/notes/append` with `compose: false`, so the Scripture is stored
/// verbatim. Port of `formatVerseNoteMarkdown` in
/// `mobile/src/features/chat/verseActions.ts`.
enum VerseNoteMarkdown {
    /// `> **John 3:16**`, then the words, then the translation label, each its
    /// own quoted paragraph. An empty body or label drops its paragraph.
    static func format(reference: String, text: String?, translation: String?) -> String {
        let body = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var lines = ["> **\(reference)**"]
        if !body.isEmpty { lines += [">", "> \(body)"] }
        if let translation, !translation.isEmpty { lines += [">", "> (\(translation))"] }
        return lines.joined(separator: "\n")
    }
}

/// What the note picker saves for a verse: the blockquote above, titled by
/// the reference on the create path (Android's `notePickerTarget`).
struct VerseNotePick: Identifiable, Sendable {
    let id = UUID()
    let markdown: String
    let title: String
}
