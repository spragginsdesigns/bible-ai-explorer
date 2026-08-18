#if os(macOS)
import AppKit
#else
import UIKit
#endif
import Foundation

/// A verse or whole chapter the user attached to their next question.
/// Port of `mobile/src/features/chat/verseActions.ts`.
struct VerseAttachment: Sendable, Equatable {
    var reference: String
    var text: String
    var translation: TranslationID
}

extension VerseAttachment {
    /// `John 3:16 — "For God so loved…" (KJV)` — the plain-text form used for
    /// copy, share, and the attachment block prepended to a question.
    static func formatForSharing(
        reference: String,
        text: String?,
        translation: TranslationID = .kjv
    ) -> String {
        let body = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let body, !body.isEmpty else { return "\(reference) (\(translation.rawValue))" }
        return "\(reference) — \"\(body)\" (\(translation.rawValue))"
    }

    /// Compose the outgoing user message: the passage first, then the question.
    /// There is no canned prompt — an empty question sends the passage alone.
    static func compose(_ question: String, attachment: VerseAttachment?) -> String {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let attachment else { return trimmed }
        let block = formatForSharing(
            reference: attachment.reference,
            text: attachment.text,
            translation: attachment.translation
        )
        return trimmed.isEmpty ? block : "\(block)\n\n\(trimmed)"
    }

    var summary: String {
        Self.formatForSharing(reference: reference, text: text, translation: translation)
    }
}

// MARK: - Verse actions

enum VerseActions {
    static func copy(reference: String, text: String?, translation: TranslationID = .kjv) {
        let value = VerseAttachment.formatForSharing(
            reference: reference,
            text: text,
            translation: translation
        )
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        #else
        UIPasteboard.general.string = value
        #endif
    }

    /// Save a verse as its own note, titled by the reference with the passage as
    /// a Scripture blockquote. The HTML shape matches the other two clients so
    /// the note round-trips through their rich-text editors.
    @discardableResult
    static func saveToNote(
        api: APIClient,
        reference: String,
        text: String?,
        translation: TranslationID = .kjv
    ) async throws -> String {
        let body = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let html = "<blockquote><p><strong>\(escapeHTML(reference))</strong></p>"
            + (body.isEmpty ? "" : "<p>\(escapeHTML(body))</p>")
            + "<p>(\(escapeHTML(translation.rawValue)))</p>"
            + "</blockquote>"
        let plainText = VerseAttachment.formatForSharing(
            reference: reference,
            text: text,
            translation: translation
        )
        let wordCount = plainText.split(whereSeparator: \.isWhitespace).count

        struct NewNote: Encodable {
            let title: String
            let folderId: String?
        }
        struct NoteContent: Encodable {
            let htmlContent: String
            let plainText: String
            let wordCount: Int
        }
        struct NoteRef: Decodable { let id: String }

        let note = try await api.json(
            "/api/notes",
            method: "POST",
            body: NewNote(title: reference, folderId: nil),
            as: NoteRef.self
        )
        do {
            try await api.data(
                "/api/notes/\(note.id)",
                method: "PATCH",
                body: NoteContent(htmlContent: html, plainText: plainText, wordCount: wordCount)
            )
        } catch {
            // Best-effort cleanup: without the content PATCH the note is an
            // empty orphan titled by the reference, so remove it before
            // reporting failure.
            try? await api.data("/api/notes/\(note.id)", method: "DELETE")
            throw error
        }
        return note.id
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
