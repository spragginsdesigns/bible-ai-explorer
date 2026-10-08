import Foundation

/// "Share into SureWord": what to do with the text and files another app hands
/// over - a port of `mobile/src/features/share/shareIntake.ts`. Pure, so the
/// decisions are pinned by tests; the iOS share extension and inbox
/// (`ShareInbox/`) carry the share to the app, and the chat applies the result.
///
/// A share opens a new chat with the files attached and the text in the
/// composer, plus one-tap actions: check it against Scripture (`/check`) or
/// help answer whoever sent it (`/reply`), and, when the share carries a link,
/// verify the video or page itself (`/verify`).
enum ShareAction: String, CaseIterable, Sendable, Identifiable {
    case verify, check, reply

    var id: String { rawValue }

    var label: String {
        switch self {
        case .verify: "Verify this link"
        case .check: "Check against Scripture"
        case .reply: "Help me reply"
        }
    }

    var command: String {
        switch self {
        case .verify: "/verify"
        case .check: "/check"
        case .reply: "/reply"
        }
    }

    /// The actions a share offers - `shareActionsFor` on Android. A shared link
    /// (the YouTube app's Share button sends just the URL) leads with Verify;
    /// without a link there is nothing to verify, so it is left out.
    static func actions(for composerText: String) -> [ShareAction] {
        let hasLink = VideoTranscript.findLink(in: composerText) != nil
            || composerText.range(of: #"https?://\S+"#, options: [.regularExpression, .caseInsensitive]) != nil
        return hasLink ? [.verify, .check, .reply] : [.check, .reply]
    }

    /// Verify is worded for a video when the link is one.
    func label(composerText: String) -> String {
        if self == .verify, VideoTranscript.findLink(in: composerText) != nil { return "Verify this video" }
        return label
    }

    /// The message a share action sends: the command, then whatever is in the
    /// composer. `shareActionMessage` on Android.
    func message(composerText: String) -> String {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? command : "\(command) \(text)"
    }
}

/// A share, decided on: what goes in the composer, what gets attached, and why
/// anything that was shared did not make it.
struct SharedChatDraft: Equatable, Sendable {
    /// Goes in the composer as-is, for the user to edit or send.
    var text: String
    var files: [LocalAttachment]
    /// Shown above the composer with the two actions.
    var notices: [String]
}

/// One shared file, after the platform layer has read it (and turned a photo
/// into an upload-ready JPEG or PNG).
struct IncomingSharedFile: Equatable, Sendable {
    var filename: String?
    var mediaType: String?
    /// Nil when the file could not be read; `size` may still say why.
    var data: Data?
    /// What the sharing app reported, used when there are no bytes to count.
    var size: Int?
}

enum ShareIntake {
    static func plan(text rawText: String?, webURL rawURL: String?, files incoming: [IncomingSharedFile]) -> SharedChatDraft {
        let text = composerText(text: rawText, webURL: rawURL)
        var notices: [String] = []
        var accepted: [LocalAttachment] = []

        for (index, file) in incoming.enumerated() {
            let filename = filenameForSharedFile(file.filename, mediaType: file.mediaType, fallbackStem: "shared-\(index + 1)")
            guard let data = file.data else {
                notices.append(unreadableNotice(filename: filename, mediaType: file.mediaType, size: file.size))
                continue
            }
            do {
                accepted.append(try AttachmentValidator.normalize(
                    filename: filename,
                    declaredMediaType: file.mediaType ?? "",
                    data: data
                ))
            } catch let error as AttachmentError {
                notices.append(error.message)
            } catch {
                notices.append("\(filename) is empty or unreadable.")
            }
        }

        let limit = AttachmentLimits.maxPerMessage
        var files = Array(accepted.prefix(limit))
        if accepted.count > files.count {
            notices.append("You can attach up to \(limit) files per message, so only the first \(limit) were attached.")
        }

        var total = 0
        files = files.filter { file in
            let next = total + file.size
            if next > AttachmentLimits.maxMessageBytes {
                notices.append("Attachments can total up to 25 MB per message, so \(file.filename) was left out.")
                return false
            }
            total = next
            return true
        }

        if text.isEmpty && files.isEmpty && notices.isEmpty {
            notices.append("Nothing in that share could be opened in SureWord.")
        }
        return SharedChatDraft(text: text, files: files, notices: notices)
    }

    /// Android uses the text, else the URL. Safari on iOS hands over the URL
    /// and, from some apps, a separate title or message; when both are there
    /// and the text does not already contain the link, both go in.
    static func composerText(text rawText: String?, webURL rawURL: String?) -> String {
        let text = (rawText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let url = (rawURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if url.isEmpty || text.contains(url) { return text }
        if text.isEmpty { return url }
        return "\(text)\n\n\(url)"
    }

    /// Give a shared file a name the server can check. Apps hand over names
    /// like "voice-message" or "PTT-20261007" with no extension; the type
    /// supplies one. `filenameForSharedFile` on Android.
    static func filenameForSharedFile(_ name: String?, mediaType: String?, fallbackStem: String) -> String {
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let last = trimmed.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        let base = last.isEmpty ? fallbackStem : last
        let ext = (base as NSString).pathExtension.lowercased()
        if AttachmentLimits.mediaTypeByExtension[ext] != nil { return base }
        guard let canonical = canonicalMediaType(mediaType),
              let preferred = preferredExtension[canonical]
        else { return base }
        return "\(base).\(preferred)"
    }

    static func canonicalMediaType(_ raw: String?) -> String? {
        let type = (raw ?? "")
            .lowercased()
            .split(separator: ";", maxSplits: 1)
            .first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        guard !type.isEmpty else { return nil }
        return AttachmentLimits.mediaTypeAliases[type] ?? type
    }

    /// `EXTENSION_BY_MEDIA_TYPE` on Android: the one extension each type gets.
    static let preferredExtension: [String: String] = [
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "application/pdf": "pdf",
        "text/plain": "txt",
        "text/markdown": "md",
        "text/csv": "csv",
        "application/json": "json",
        "audio/ogg": "ogg",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/webm": "webm",
    ]

    /// A file the extension listed but the app has no bytes for: too large to
    /// copy, or unreadable. The size message matches the picker's.
    private static func unreadableNotice(filename: String, mediaType: String?, size: Int?) -> String {
        // `filenameForSharedFile` already gave any allowlisted type its
        // extension, so no extension type means a format SureWord never takes.
        guard let type = AttachmentLimits.mediaTypeByExtension[(filename as NSString).pathExtension.lowercased()] else {
            return AttachmentValidator.unsupported(filename)
        }
        let limit = AttachmentLimits.byteLimit(for: type)
        if let size, size > limit {
            return "\(filename) exceeds the \(limit / (1024 * 1024)) MB file limit."
        }
        return "\(filename) is empty or unreadable."
    }
}
