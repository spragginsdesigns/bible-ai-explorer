import Foundation

/// How the share extension copies a shared file into the inbox without
/// trusting the size the sending app reports (security scan 2026-10-09, #8;
/// Android does the same in `modules/sureword-share`). The copy is streamed in
/// chunks and stops at the first byte past the file's cap, and what lands is
/// measured again before it is kept, so an oversize or endless source never
/// fills the App Group container.
///
/// In `ShareInbox` so the app's tests pin it; the caps are the app's own
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

    static func measuredSize(_ url: URL) -> Int? {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue
    }
}
