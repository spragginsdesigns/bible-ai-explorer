import Foundation
import UniformTypeIdentifiers

/// How a shared file is copied into the inbox without trusting the size the
/// sending app reports (security scan 2026-10-09, #8; Android does the same in
/// `modules/sureword-share`). The copy is streamed in chunks and stops at the
/// first byte past the file's cap, and what lands is measured again before it
/// is kept, so an oversize or endless source never fills the inbox.
///
/// The iOS share extension copies this way into the App Group container, and
/// the Mac does too for the Services menu and drops (`MacShareInbox`). In
/// `ShareInbox` so the app's tests pin it; the caps are the app's own
/// `AttachmentLimits` (`Shared/Chat/FileAttachments.swift`, which the
/// extension also compiles).
enum PendingShareCopy {
    enum Outcome: Equatable, Sendable {
        /// Kept, at exactly this many bytes.
        case copied(bytes: Int)
        /// Stopped past the cap and deleted; `bytesRead` is over the limit, so
        /// the app says the file exceeds it.
        case tooLarge(bytesRead: Int)
        /// Unreadable or unwritable; nothing is left behind.
        case failed
    }

    static let chunkBytes = 64 * 1024

    /// The most bytes worth copying for a shared file: the per-file cap for the
    /// type `AttachmentValidator` will accept it as (one resolver,
    /// `AttachmentLimits.resolvedMediaType`). A name with no allowlisted
    /// extension ("PTT-20261007") resolves to nothing there, but the app names
    /// it from its declared type (`ShareIntake.filenameForSharedFile`), so an
    /// allowlisted declared type sets the cap. Anything else keeps the 25 MB
    /// message cap, so the app can still name it as unsupported.
    static func limit(filename: String, mediaType: String?) -> Int {
        let declared = mediaType ?? ""
        if let type = AttachmentLimits.resolvedMediaType(filename: filename, declaredMediaType: declared) {
            return AttachmentLimits.byteLimit(for: type)
        }
        let canonical = AttachmentLimits.canonicalMediaType(declared)
        guard AttachmentLimits.mediaTypeByExtension.values.contains(canonical) else {
            return AttachmentLimits.maxMessageBytes
        }
        return AttachmentLimits.byteLimit(for: canonical)
    }

    /// Copies `source` to `destination`, stopping past `limit` bytes. Anything
    /// but a complete copy that measures what was counted is deleted.
    static func copy(from source: URL, to destination: URL, limit: Int) -> Outcome {
        guard let input = try? FileHandle(forReadingFrom: source) else { return .failed }
        defer { try? input.close() }
        guard FileManager.default.createFile(atPath: destination.path, contents: nil),
              let output = try? FileHandle(forWritingTo: destination)
        else {
            try? FileManager.default.removeItem(at: destination)
            return .failed
        }

        var outcome = Outcome.failed
        var total = 0
        do {
            while true {
                guard let chunk = try input.read(upToCount: chunkBytes), !chunk.isEmpty else {
                    outcome = .copied(bytes: total)
                    break
                }
                total += chunk.count
                if total > limit {
                    outcome = .tooLarge(bytesRead: total)
                    break
                }
                try output.write(contentsOf: chunk)
            }
        } catch {
            outcome = .failed
        }
        try? output.close()

        if case .copied(let bytes) = outcome, measuredSize(destination) == bytes, bytes <= limit {
            return outcome
        }
        try? FileManager.default.removeItem(at: destination)
        if case .copied = outcome { return .failed }
        return outcome
    }

    /// Copy one shared file into a share folder and describe it for the
    /// manifest: stored when it fits under its cap, otherwise listed without
    /// bytes so the app can say why (too large, or unreadable).
    static func file(
        from source: URL,
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

    static func measuredSize(_ url: URL) -> Int? {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue
    }
}
