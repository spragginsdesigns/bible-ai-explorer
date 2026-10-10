import Foundation
import UniformTypeIdentifiers

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
    /// Voice messages: under OpenAI's 25 MB transcription ceiling, as on the server.
    static let maxAudioBytes = 20 * 1024 * 1024

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
        "ogg": "audio/ogg",
        "oga": "audio/ogg",
        "opus": "audio/ogg",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "wav": "audio/wav",
        "webm": "audio/webm",
    ]

    /// Other names platforms give the same audio formats, read as the canonical
    /// type the upload URL is locked to. Mirrors `MEDIA_TYPE_ALIASES` on the server.
    static let mediaTypeAliases: [String: String] = [
        "audio/opus": "audio/ogg",
        "audio/x-opus+ogg": "audio/ogg",
        "application/ogg": "audio/ogg",
        "audio/mp3": "audio/mpeg",
        "audio/x-m4a": "audio/mp4",
        "audio/m4a": "audio/mp4",
        "audio/aac-mp4": "audio/mp4",
        "audio/x-wav": "audio/wav",
        "audio/wave": "audio/wav",
        "audio/vnd.wave": "audio/wav",
    ]

    /// Every media type the picker and drop target accept.
    static var mediaTypes: [String] {
        Array(Set(mediaTypeByExtension.values)).sorted()
    }

    /// The allowlist as UTTypes, for the file importers. Built from the
    /// extensions as well as the media types because the system knows no MIME
    /// type for Ogg or WebM audio, and an `.opus` file only has a dynamic type
    /// derived from its extension; deriving that same type here is what lets the
    /// picker offer it.
    static var contentTypes: [UTType] {
        var seen = Set<String>()
        let byMediaType = mediaTypes.compactMap { UTType(mimeType: $0) }
        let byExtension = mediaTypeByExtension.keys.sorted().compactMap { UTType(filenameExtension: $0) }
        return (byMediaType + byExtension).filter { seen.insert($0.identifier).inserted }
    }

    /// The accepted audio types, canonical form (`AUDIO_MEDIA_TYPES`).
    static let audioMediaTypes: Set<String> = [
        "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm",
    ]

    /// Exact membership, like Android's `isAudioMediaType`: an unlisted
    /// `audio/flac` is not a voice message, it is an unsupported file.
    static func isAudio(_ mediaType: String) -> Bool {
        audioMediaTypes.contains(mediaType)
    }

    /// How many more photos the picker may offer, given what is already staged
    /// - Android's `selectionLimit: Math.max(1, 5 - fileAttachments.length)`.
    /// Never below one, so a full draft still opens the picker and the batch
    /// check then explains the cap.
    static func pickerSelectionLimit(staged: Int) -> Int {
        max(1, maxPerMessage - staged)
    }

    /// The allowlisted image type the bytes really are, from their magic
    /// numbers: PNG, JPEG, WebP or GIF. Nil for anything else (HEIC included),
    /// which has to be re-encoded before the server will take it.
    static func sniffImageMediaType(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: Array("GIF8".utf8)) { return "image/gif" }
        if bytes.count >= 12,
           bytes[0..<4].elementsEqual(Array("RIFF".utf8)),
           bytes[8..<12].elementsEqual(Array("WEBP".utf8)) {
            return "image/webp"
        }
        return nil
    }

    static func byteLimit(for mediaType: String) -> Int {
        if mediaType.hasPrefix("text/") || mediaType == "application/json" { return maxTextBytes }
        if isAudio(mediaType) { return maxAudioBytes }
        return maxImageOrPDFBytes
    }

    /// A declared type in canonical form: lowercased, parameters dropped,
    /// aliases resolved. Empty when nothing was declared.
    static func canonicalMediaType(_ declared: String) -> String {
        let raw = declared
            .lowercased()
            .split(separator: ";", maxSplits: 1)
            .first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return mediaTypeAliases[raw] ?? raw
    }

    /// The allowlisted type a file is accepted as, or nil when it is not
    /// accepted. The declared type wins unless it is empty or generic, and it
    /// must agree with the extension, because the server checks both. Shared
    /// by `AttachmentValidator` and the iOS share extension's copy cap
    /// (`ShareInbox/PendingShareCopy.swift`), so both read a file as one type.
    static func resolvedMediaType(filename: String, declaredMediaType: String) -> String? {
        let ext = (filename as NSString).pathExtension.lowercased()
        let extensionType = mediaTypeByExtension[ext]
        let declared = canonicalMediaType(declaredMediaType)
        let mediaType = !declared.isEmpty && declared != "application/octet-stream"
            ? declared
            : extensionType
        guard let extensionType, let mediaType, mediaType == extensionType else { return nil }
        return mediaType
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
    /// Audio only: what was said, transcribed once when the upload completed.
    var transcript: String? = nil
    /// Audio only: length in seconds.
    var durationSeconds: Double? = nil
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
        guard let mediaType = AttachmentLimits.resolvedMediaType(filename: filename, declaredMediaType: declaredMediaType) else {
            throw AttachmentError(message: Self.unsupported(filename))
        }

        guard data.count > 0 else {
            throw AttachmentError(message: "\(filename) is empty or unreadable.")
        }

        let limit = AttachmentLimits.byteLimit(for: mediaType)
        guard data.count <= limit else {
            throw AttachmentError(
                message: "\(filename) exceeds the \(limit / (1024 * 1024)) MB file limit."
            )
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
        "\(filename) is not a supported image (PNG, JPEG, WebP, GIF), PDF, text (TXT, Markdown, CSV, JSON), or audio (OGG, MP3, M4A, WAV, WebM) file."
    }
}

// MARK: - Display helpers

extension ChatAttachmentDescriptor {
    var isImage: Bool { mediaType.hasPrefix("image/") }
    var isAudio: Bool { AttachmentLimits.isAudio(mediaType) }

    /// Short glyph for the non-image card, matching `FileAttachmentCards.tsx`.
    var glyph: String { mediaType == "application/pdf" ? "PDF" : "TXT" }
}

/// `formatBytes` from `mobile/src/features/chat/FileAttachmentCards.tsx`.
func formatAttachmentBytes(_ bytes: Int) -> String {
    guard bytes > 0 else { return "" }
    if bytes < 1024 * 1024 { return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB" }
    return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
}

/// `formatAudioDuration` from `src/lib/audio-transcription-rules.ts`: "5:32" for
/// 332.4 seconds. Hours never occur, since a voice message is capped at 15 minutes.
func formatAudioDuration(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded()))
    return "\(total / 60):" + String(format: "%02d", total % 60)
}

/// The subtitle on a voice message chip, in place of its byte size.
func voiceMessageLabel(durationSeconds: Double?) -> String {
    guard let durationSeconds else { return "Voice message" }
    return "Voice message \u{00B7} \(formatAudioDuration(durationSeconds))"
}

// MARK: - Pasted images

/// Names and types for images that arrive with no usable file name - a
/// clipboard paste, a photo out of the system picker. A port of
/// `mobile/src/features/chat/pastedImages.ts`: `clipboard-<ms>.png`, then
/// `clipboard-<ms>-2.jpg` and so on for the rest of one paste, so a batch never
/// carries two chips with the same name.
enum PastedImages {
    static let mediaTypeByExtension: [String: String] = [
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
    ]

    static let extensionByMediaType: [String: String] = [
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    ]

    /// The image extension a URI or file name implies, PNG when it implies none.
    static func imageExtension(_ uri: String) -> String {
        let path = uri.split(whereSeparator: { $0 == "?" || $0 == "#" })
            .first.map(String.init) ?? ""
        let ext = path.split(separator: ".", omittingEmptySubsequences: false)
            .last.map { $0.lowercased() } ?? ""
        return mediaTypeByExtension[ext] != nil ? ext : "png"
    }

    static func mediaType(forURI uri: String) -> String {
        mediaTypeByExtension[imageExtension(uri)] ?? "image/png"
    }

    /// `pastedImageMetadata`: the declared type wins when it is an image type
    /// we accept (`image/jpg` read as `image/jpeg`), else the name decides.
    static func metadata(
        name: String?,
        declaredType: String?,
        index: Int,
        timestamp: Int,
        prefix: String = "clipboard"
    ) -> (filename: String, mediaType: String) {
        let declared = declaredType?
            .lowercased()
            .split(separator: ";", maxSplits: 1)
            .first
            .map { $0.trimmingCharacters(in: .whitespaces) }
        let mediaType: String
        if let declared, extensionByMediaType[declared] != nil {
            mediaType = declared == "image/jpg" ? "image/jpeg" : declared
        } else {
            mediaType = Self.mediaType(forURI: name ?? "")
        }
        let ext = extensionByMediaType[mediaType] ?? "png"
        return (sequencedName(prefix: prefix, timestamp: timestamp, index: index, fileExtension: ext), mediaType)
    }

    /// `pastedImageFilename`.
    static func filename(uri: String, index: Int, timestamp: Int) -> String {
        sequencedName(prefix: "clipboard", timestamp: timestamp, index: index, fileExtension: imageExtension(uri))
    }

    /// `<prefix>-<ms>.<ext>` for the first file, `<prefix>-<ms>-<n>.<ext>` after.
    static func sequencedName(prefix: String, timestamp: Int, index: Int, fileExtension: String) -> String {
        let suffix = index == 0 ? "" : "-\(index + 1)"
        return "\(prefix)-\(timestamp)\(suffix).\(fileExtension)"
    }

    /// Milliseconds since 1970, the stamp Android's `Date.now()` writes.
    static func timestamp(_ date: Date = Date()) -> Int {
        Int((date.timeIntervalSince1970 * 1000).rounded(.down))
    }
}
