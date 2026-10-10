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
        if let fileType = registered.compactMap(UTType.init).first(where: isFileContent) {
            return await loadFile(provider, type: fileType, suggestedName: suggestedName, index: index, into: directory)
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
                continuation.resume(returning: .file(copy(url, type: type, suggestedName: suggestedName, index: index, into: directory)))
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
                switch item {
                case let url as URL where url.isFileURL:
                    let fileType = UTType(filenameExtension: url.pathExtension) ?? type
                    loaded = .file(copy(url, type: fileType, suggestedName: suggestedName, index: index, into: directory))
                case let url as URL:
                    loaded = .webURL(url.absoluteString)
                case let text as String:
                    loaded = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? .nothing
                        : (type == .url ? .webURL(text) : .text(text))
                case let attributed as NSAttributedString:
                    loaded = attributed.string.isEmpty ? .nothing : .text(attributed.string)
                case let data as Data:
                    if type == .url, let url = URL(dataRepresentation: data, relativeTo: nil) {
                        loaded = .webURL(url.absoluteString)
                    } else if let text = String(data: data, encoding: .utf8), suggestedName == nil {
                        loaded = .text(text)
                    } else {
                        loaded = .file(write(data, type: type, suggestedName: suggestedName, index: index, into: directory))
                    }
                default:
                    loaded = .nothing
                }
                continuation.resume(returning: loaded)
            }
        }
    }

    // MARK: Copying

    private static func copy(
        _ source: URL,
        type: UTType,
        suggestedName: String?,
        index: Int,
        into directory: URL
    ) -> PendingShareManifest.File {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }

        let original = PendingShareNaming.name(suggested: suggestedName, url: source, type: type)
        let size = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize)
        var file = PendingShareManifest.File(
            storedName: nil,
            originalName: original,
            typeIdentifier: type.identifier,
            mediaType: PendingShareNaming.mediaType(for: type, filename: original),
            size: size
        )
        // The reported size only saves a doomed copy; the copy itself stops at
        // the cap, since the sending app controls the bytes it serves.
        let limit = PendingShareCopy.limit(filename: original, mediaType: file.mediaType)
        if let size, size > limit { return file }
        let stored = PendingShareNaming.storedName(original, index: index)
        switch PendingShareCopy.copy(from: source, to: directory.appendingPathComponent(stored), limit: limit) {
        case .copied(let bytes):
            file.storedName = stored
            file.size = bytes
        case .tooLarge(let bytesRead):
            // Listed without bytes; the app says it exceeds the file limit.
            file.size = bytesRead
        case .failed:
            // Listed without bytes; the app reports it as unreadable.
            break
        }
        return file
    }

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
        if (try? data.write(to: directory.appendingPathComponent(stored))) != nil {
            file.storedName = stored
        }
        return file
    }
}
