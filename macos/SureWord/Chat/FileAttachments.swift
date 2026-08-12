import Foundation

/// Chat file attachments — a port of `mobile/src/features/chat/fileAttachments.ts`.
///
/// The limits and the error copy are duplicated deliberately: the server enforces
/// the same rules in `src/lib/chat-attachment-types.ts`, but a user who picks a
/// 40 MB video should be told so before a byte leaves the Mac, and the message
/// they see must be the one Android shows for the same mistake.
enum AttachmentLimits {
    static let maxPerMessage = 5
    static let maxMessageBytes = 25 * 1024 * 1024
    static let maxImageOrPDFBytes = 10 * 1024 * 1024
    static let maxTextBytes = 1024 * 1024

    /// The allowlist, keyed by lowercased file extension. Mirrors
    /// `EXTENSIONS_BY_MEDIA_TYPE` on the server — the server rejects any file
    /// whose declared type disagrees with its extension, so both must match.
    static let mediaTypeByExtension: [String: String] = [
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "pdf": "application/pdf",
        "txt": "text/plain",
        "md": "text/markdown",
        "markdown": "text/markdown",
        "csv": "text/csv",
        "json": "application/json",
    ]

    /// Every media type the picker and drop target accept.
    static var mediaTypes: [String] {
        Array(Set(mediaTypeByExtension.values)).sorted()
    }

    static func byteLimit(for mediaType: String) -> Int {
        mediaType.hasPrefix("text/") || mediaType == "application/json"
            ? maxTextBytes
            : maxImageOrPDFBytes
    }
}

/// A file staged on this Mac, before upload. Held as bytes rather than a URL so
/// the picker, a drop and a paste all converge on one path — a pasted image has
/// no file on disk to point at.
struct LocalAttachment: Sendable, Equatable {
    var filename: String
    var mediaType: String
    var data: Data

    var size: Int { data.count }
}

/// A durable attachment the server has accepted, as returned by
/// `POST /api/chat/attachments/{id}/complete`.
struct ChatAttachmentDescriptor: Sendable, Equatable, Identifiable, Decodable {
    var id: String
    var filename: String
    var mediaType: String
    var size: Int
    var previewUrl: String
    var previewExpiresAt: String
}

/// Raised for anything the user can fix by picking a different file. Its
/// `message` is shown verbatim, so the strings are the contract.
struct AttachmentError: Error, Equatable {
    var message: String
}

enum AttachmentValidator {
    /// Resolve a file's media type and check it against the allowlist and the
    /// per-file size cap. `declaredMediaType` is whatever the OS said, which for
    /// a dragged file is often `application/octet-stream` or empty.
    static func normalize(
        filename: String,
        declaredMediaType: String,
        data: Data
    ) throws -> LocalAttachment {
        let ext = (filename as NSString).pathExtension.lowercased()
        let extensionType = AttachmentLimits.mediaTypeByExtension[ext]

        let declared = declaredMediaType
            .lowercased()
            .split(separator: ";", maxSplits: 1)
            .first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""

        let mediaType = !declared.isEmpty && declared != "application/octet-stream"
            ? declared
            : extensionType

        guard let extensionType, let mediaType, mediaType == extensionType else {
            throw AttachmentError(message: Self.unsupported(filename))
        }

        guard data.count > 0 else {
            throw AttachmentError(message: "\(filename) is empty or unreadable.")
        }

        let limit = AttachmentLimits.byteLimit(for: mediaType)
        guard data.count <= limit else {
            let label = limit == AttachmentLimits.maxTextBytes ? "1 MB" : "10 MB"
            throw AttachmentError(message: "\(filename) exceeds the \(label) file limit.")
        }

        return LocalAttachment(filename: filename, mediaType: mediaType, data: data)
    }

    /// Count and total-size caps, applied across what is already staged.
    static func validateBatch(
        _ files: [LocalAttachment],
        existing: [ChatAttachmentDescriptor]
    ) throws {
        guard files.count + existing.count <= AttachmentLimits.maxPerMessage else {
            throw AttachmentError(
                message: "You can attach up to \(AttachmentLimits.maxPerMessage) files per message."
            )
        }
        let total = files.reduce(0) { $0 + $1.size } + existing.reduce(0) { $0 + $1.size }
        guard total <= AttachmentLimits.maxMessageBytes else {
            throw AttachmentError(message: "Attachments can total up to 25 MB per message.")
        }
    }

    static func unsupported(_ filename: String) -> String {
        "\(filename) is not a supported PNG, JPEG, WebP, GIF, PDF, TXT, Markdown, CSV, or JSON file."
    }
}

// MARK: - Display helpers

extension ChatAttachmentDescriptor {
    var isImage: Bool { mediaType.hasPrefix("image/") }

    /// Short glyph for the non-image card, matching `FileAttachmentCards.tsx`.
    var glyph: String { mediaType == "application/pdf" ? "PDF" : "TXT" }
}

/// `formatBytes` from `mobile/src/features/chat/FileAttachmentCards.tsx`.
func formatAttachmentBytes(_ bytes: Int) -> String {
    guard bytes > 0 else { return "" }
    if bytes < 1024 * 1024 { return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB" }
    return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
}
