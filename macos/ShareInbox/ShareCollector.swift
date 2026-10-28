import Foundation
import UniformTypeIdentifiers

/// Reads what the host app shared (`NSExtensionItem` attachments) and copies
/// it into a share folder in the App Group inbox. No Clerk, no network, no
/// validation: the app decides what can be attached (`ShareIntake`), so the
/// extension stays small and the rules live in one place.
///
/// Files are copied, never loaded into memory - a share extension is killed
/// well before an app would be, and a voice message can be 20 MB. Each copy
/// stops at the file's cap (`PendingShareCopy`); a file over it is listed
/// without bytes so the app can say why.
///
/// Both share extensions run it, the iOS one and the Mac one
/// (`SureWord-macOS-Share`). It lives in `ShareInbox` so the app's tests pin
/// it too; Foundation and UniformTypeIdentifiers only.
enum ShareCollector {
    /// One provider's contribution, already in Sendable form.
    private enum Loaded: Sendable {
        case text(String)
        case webURL(String)
        case file(PendingShareManifest.File)
        case nothing
    }

    @MainActor
    static func collect(_ items: [NSExtensionItem], into directory: URL) async -> PendingShareCollection {
        var collected = PendingShareCollection()
        var index = 0
        for item in items {
            // The message some apps put beside the attachments (Messages,
            // Mail's subject line). Often a copy of a plain-text attachment,
            // which the manifest drops as a duplicate.
            if let content = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines),
               !content.isEmpty {
                collected.texts.append(content)
            }
            for provider in item.attachments ?? [] {
                index += 1
                switch await load(provider, index: index, into: directory) {
                case .text(let text): collected.texts.append(text)
                case .webURL(let url): collected.webURLs.append(url)
                case .file(let file): collected.files.append(file)
                case .nothing: break
                }
            }
        }
        return collected
    }

    // MARK: Providers

    @MainActor
    private static func load(_ provider: NSItemProvider, index: Int, into directory: URL) async -> Loaded {
        let suggestedName = provider.suggestedName
        let registered = provider.registeredTypeIdentifiers

        // A content type that is a real file (photo, PDF, audio, document)
        // wins over the URL or text forms the same provider may also offer.
        if let fileType = fileType(among: registered.compactMap(UTType.init)) {
            return await loadFile(provider, type: fileType, suggestedName: suggestedName, index: index, into: directory)
        }
        // Finder also offers a file's URL as generic URL/text. Ask for its
        // explicit file form first, otherwise those fallbacks can turn a
        // shared document into a literal file:/// path in the composer.
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            return await loadItem(provider, type: .fileURL, suggestedName: suggestedName, index: index, into: directory)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            return await loadItem(provider, type: .url, suggestedName: suggestedName, index: index, into: directory)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            return await loadItem(provider, type: .plainText, suggestedName: suggestedName, index: index, into: directory)
        }
        if let anyData = registered.compactMap(UTType.init).first(where: { $0.conforms(to: .data) }) {
            return await loadFile(provider, type: anyData, suggestedName: suggestedName, index: index, into: directory)
        }
        return .nothing
    }

    /// The file form to copy when a provider offers several. iOS takes the
    /// first, since the app re-encodes any photo as the picker does
    /// (`ShareInboxIntake`). The Mac attaches images as they are, so when
    /// Photos offers its HEIC original beside a JPEG it takes the form the
    /// attachment allowlist accepts.
    static func fileType(among registered: [UTType]) -> UTType? {
        let files = registered.filter(isFileContent)
#if os(macOS)
        return files.first(where: isAllowlisted) ?? files.first
#else
        return files.first
#endif
    }

    /// A type the attachment allowlist (`AttachmentLimits`) takes as it is.
    static func isAllowlisted(_ type: UTType) -> Bool {
        guard let mime = type.preferredMIMEType else { return false }
        return AttachmentLimits.mediaTypeByExtension.values.contains(AttachmentLimits.canonicalMediaType(mime))
    }

    /// Bytes worth attaching rather than reading as text or a link. Plain text
    /// and URLs are excluded: a text selection is not a file, and the `url`
    /// branch handles a file URL itself.
    static func isFileContent(_ type: UTType) -> Bool {
        if type.conforms(to: .url) || type == .plainText || type == .utf8PlainText || type == .text {
            return false
        }
        return type.conforms(to: .image)
            || type.conforms(to: .pdf)
            || type.conforms(to: .audio)
            || type.conforms(to: .audiovisualContent)
            || type.conforms(to: .json)
            || type.conforms(to: .commaSeparatedText)
            || type.identifier == "net.daringfireball.markdown"
    }

    /// `loadFileRepresentation`: the provider writes a temporary copy that is
    /// deleted when the callback returns, so the copy happens inside it.
    @MainActor
    private static func loadFile(
        _ provider: NSItemProvider,
        type: UTType,
        suggestedName: String?,
        index: Int,
        into directory: URL
    ) async -> Loaded {
        await withCheckedContinuation { (continuation: CheckedContinuation<Loaded, Never>) in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { @Sendable url, _ in
                guard let url else {
                    continuation.resume(returning: .file(PendingShareManifest.File(
                        storedName: nil,
                        originalName: PendingShareNaming.name(suggested: suggestedName, url: nil, type: type),
                        typeIdentifier: type.identifier,
                        mediaType: PendingShareNaming.mediaType(for: type, filename: suggestedName),
                        size: nil
                    )))
                    return
                }
                continuation.resume(returning: .file(PendingShareCopy.file(from: url, type: type, suggestedName: suggestedName, index: index, into: directory)))
            }
        }
    }

    /// `loadItem`, for URLs and text: a web link, a text selection, or a file
    /// URL (Files hands a `.txt` over this way).
    @MainActor
    private static func loadItem(
        _ provider: NSItemProvider,
        type: UTType,
        suggestedName: String?,
        index: Int,
        into directory: URL
    ) async -> Loaded {
        await withCheckedContinuation { (continuation: CheckedContinuation<Loaded, Never>) in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { @Sendable item, _ in
                let loaded: Loaded
                // The same URL may arrive as NSURL, NSString or NSData. The
                // representation must not decide whether we copy its bytes.
                if let url = providedURL(item, type: type) {
                    if url.isFileURL {
                        let fileType = UTType(filenameExtension: url.pathExtension) ?? .data
                        loaded = .file(PendingShareCopy.file(from: url, type: fileType, suggestedName: suggestedName, index: index, into: directory))
                    } else {
                        loaded = type == .fileURL ? .nothing : .webURL(url.absoluteString)
                    }
                } else if type == .fileURL {
                    // An unreadable file URL is never a web link or message.
                    loaded = .nothing
                } else {
                    switch item {
                    case let text as String:
                        loaded = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? .nothing
                            : (type == .url ? .webURL(text) : .text(text))
                    case let attributed as NSAttributedString:
                        loaded = attributed.string.isEmpty ? .nothing : .text(attributed.string)
                    case let data as Data:
                        if let text = String(data: data, encoding: .utf8), suggestedName == nil {
                            loaded = .text(text)
                        } else {
                            loaded = .file(write(data, type: type, suggestedName: suggestedName, index: index, into: directory))
                        }
                    default:
                        loaded = .nothing
                    }
                }
                continuation.resume(returning: loaded)
            }
        }
    }

    /// Only an actual URL representation is decoded from text/data. A user
    /// sharing a text selection that happens to say file:/// keeps that text.
    private static func providedURL(_ item: Any?, type: UTType) -> URL? {
        if let url = item as? URL { return url }
        guard type.conforms(to: .url) else { return nil }
        if let data = item as? Data { return URL(dataRepresentation: data, relativeTo: nil) }
        if let text = item as? String {
            return URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return nil
    }

    // MARK: Copying

    private static func write(
        _ data: Data,
        type: UTType,
        suggestedName: String?,
        index: Int,
        into directory: URL
    ) -> PendingShareManifest.File {
        let original = PendingShareNaming.name(suggested: suggestedName, url: nil, type: type)
        var file = PendingShareManifest.File(
            storedName: nil,
            originalName: original,
            typeIdentifier: type.identifier,
            mediaType: PendingShareNaming.mediaType(for: type, filename: original),
            size: data.count
        )
        guard data.count <= PendingShareCopy.limit(filename: original, mediaType: file.mediaType) else { return file }
        let stored = PendingShareNaming.storedName(original, index: index)
        let destination = directory.appendingPathComponent(stored)
        do {
            try data.write(to: destination, options: .atomic)
            file.storedName = stored
        } catch {
            try? FileManager.default.removeItem(at: destination)
        }
        return file
    }
}
