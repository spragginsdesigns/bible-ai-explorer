import Foundation
import UniformTypeIdentifiers

/// What the share extension gathered from the host app, before it is written
/// as a manifest. Pure (no `NSItemProvider`), so the naming and de-duplication
/// rules are pinned by the app's tests even though only the extension uses them.
struct PendingShareCollection: Sendable, Equatable {
    var texts: [String] = []
    var webURLs: [String] = []
    var files: [PendingShareManifest.File] = []

    var isEmpty: Bool {
        manifestTexts.isEmpty && manifestURLs.isEmpty && files.isEmpty
    }

    func manifest(id: String, now: Date = Date()) -> PendingShareManifest {
        let texts = manifestTexts
        return PendingShareManifest(
            id: id,
            createdAt: now,
            text: texts.isEmpty ? nil : texts.joined(separator: "\n\n"),
            webURL: manifestURLs.first,
            files: files
        )
    }

    /// Trimmed and de-duplicated. A link that is also the shared text (Safari
    /// offers a page as both `public.url` and `public.plain-text`) stays as the
    /// link only, and the message an item carries beside an identical
    /// plain-text attachment is kept once.
    private var manifestURLs: [String] { Self.dedupe(webURLs) }

    private var manifestTexts: [String] {
        let urls = Set(manifestURLs)
        return Self.dedupe(texts).filter { !urls.contains($0) }
    }

    /// The extension's confirmation line: "A voice message and text".
    var summary: String {
        var parts: [String] = []
        let audio = files.filter { ($0.mediaType ?? "").hasPrefix("audio/") }.count
        let images = files.filter { ($0.mediaType ?? "").hasPrefix("image/") }.count
        let other = files.count - audio - images
        if audio > 0 { parts.append(audio == 1 ? "a voice message" : "\(audio) voice messages") }
        if images > 0 { parts.append(images == 1 ? "a picture" : "\(images) pictures") }
        if other > 0 { parts.append(other == 1 ? "a file" : "\(other) files") }
        if !manifestURLs.isEmpty { parts.append("a link") }
        if !manifestTexts.isEmpty { parts.append("text") }
        let joined: String
        switch parts.count {
        case 0: joined = "your share"
        case 1: joined = parts[0]
        default: joined = parts.dropLast().joined(separator: ", ") + " and " + parts[parts.count - 1]
        }
        return joined.prefix(1).uppercased() + joined.dropFirst()
    }

    private static func dedupe(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

/// Names and types for a shared file, decided in the extension.
enum PendingShareNaming {
    /// What the chip will show: the sharing app's name for the file, with an
    /// extension from the type when it has none ("voice-message" → ".m4a").
    static func name(suggested: String?, url: URL?, type: UTType) -> String {
        let suggestedName = suggested?.trimmingCharacters(in: .whitespacesAndNewlines)
        var base = (suggestedName?.isEmpty == false ? suggestedName : nil)
            ?? url?.lastPathComponent
            ?? "shared"
        if (base as NSString).pathExtension.isEmpty {
            let urlExtension = url?.pathExtension ?? ""
            if let ext = urlExtension.isEmpty ? preferredExtension(for: type) : urlExtension {
                base += ".\(ext)"
            }
        }
        return base
    }

    /// The type's extension, in the spelling the attachment allowlist uses:
    /// MPEG-4 audio prefers ".mp4", which the server reads as video, so a
    /// voice memo is named ".m4a".
    static func preferredExtension(for type: UTType) -> String? {
        if type.conforms(to: .mpeg4Audio) { return "m4a" }
        if type.conforms(to: .jpeg) { return "jpg" }
        return type.preferredFilenameExtension
    }

    /// The MIME type of the declared type, else of the file's extension. Nil
    /// for formats the system has no MIME type for; the app then goes by the
    /// extension, the same fallback the picker uses.
    static func mediaType(for type: UTType, filename: String?) -> String? {
        if let mime = type.preferredMIMEType { return mime }
        let ext = ((filename ?? "") as NSString).pathExtension
        return ext.isEmpty ? nil : UTType(filenameExtension: ext)?.preferredMIMEType
    }

    /// A unique, path-safe name inside the share folder.
    static func storedName(_ original: String, index: Int) -> String {
        let safe = original
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let visible = safe.hasPrefix(".") ? "_" + safe.dropFirst() : safe
        return "\(index)-\(visible)"
    }
}
