import Foundation

/// Chat attachment previews are presigned for 15 minutes, so a conversation
/// reopened later would show blank thumbnails and open dead links. Android's
/// `FileAttachmentCards` re-mints the URL (`POST /api/chat/attachments/refresh`)
/// when an image fails to load and before every open; the iOS `AttachmentChip`
/// and the Mac's `AttachmentCard` do the same through this.
enum AttachmentPreviewRefresh {
    /// A fresh preview URL for one attachment, or nil when none came back
    /// (offline, or the file is gone). Never throws: the caller falls back to
    /// the URL it already has, as Android does.
    static func freshURL(for id: String, api: APIClient) async -> String? {
        guard !id.isEmpty,
              let refreshed = try? await AttachmentUploader(api: api).refresh([id])
        else { return nil }
        return (refreshed.first { $0.id == id } ?? refreshed.first)?.previewUrl
    }

    /// Where an open goes: the URL minted for this tap, else the last one
    /// minted for the chip, else the one the message carried.
    static func openTarget(fresh: String?, refreshed: String?, original: String) -> URL? {
        URL(string: fresh ?? refreshed ?? original)
    }
}
