import Foundation
import UniformTypeIdentifiers

extension Notification.Name {
    /// Posted when a share has just been written to the inbox: on iOS when
    /// `sureword://share` opens the app after the share extension saved, on
    /// the Mac after the Services menu or a drop (`MacShareInbox`). The
    /// signed-in shell looks; signed out, the share simply waits on disk until
    /// it exists.
    static let pendingShareArrived = Notification.Name("sureword.pendingShareArrived")
}

/// Turns what is waiting in the share inbox (`ShareInbox/`) into a chat draft,
/// on both apps. The platform half of `ShareIntake`: on iOS, photos (HEIC from
/// Photos included) become the same upload-ready JPEG or PNG the picker
/// produces; the Mac attaches images as they are, like its own picker, drop
/// and paste. The pure planner then decides what is attached and what is said
/// about the rest.
enum ShareInboxIntake {
    /// Take the waiting share, if any, and plan it. Emptying the inbox is part
    /// of taking, so a share is never applied twice.
    static func takeDraft(from store: PendingShareStore?) -> SharedChatDraft? {
        guard let store, let share = store.take() else { return nil }
        return draft(for: share)
    }

    static func draft(for share: ReceivedShare) -> SharedChatDraft {
        ShareIntake.plan(
            text: share.text,
            webURL: share.webURL,
            files: share.files.map(incomingFile)
        )
    }

    static func incomingFile(_ file: ReceivedShare.File) -> IncomingSharedFile {
        // The media type here is the extension's guess from a UTType, not
        // something the sender declared, and the system calls a .webm voice
        // note "video/webm". When the name already has an allowlisted
        // extension, go by the extension alone - exactly what the Files
        // picker does - and keep the type only to name an extensionless file.
        let ext = ((file.name ?? "") as NSString).pathExtension.lowercased()
        let byExtension = AttachmentLimits.mediaTypeByExtension[ext] != nil
        let incoming = IncomingSharedFile(
            filename: file.name,
            mediaType: byExtension ? nil : file.mediaType,
            data: file.data,
            size: file.size
        )
#if os(iOS)
        guard let data = file.data, isImage(file) else { return incoming }
        guard let upload = PickedPhoto.uploadReady(data) else { return incoming }
        // Same stem, new extension: "IMG_0042.HEIC" goes up as "IMG_0042.jpg".
        let stem = ((file.name ?? "") as NSString).deletingPathExtension
        let name = (stem.isEmpty ? "photo" : stem) + "." + upload.fileExtension
        return IncomingSharedFile(filename: name, mediaType: upload.mediaType, data: upload.data, size: upload.data.count)
#else
        return incoming
#endif
    }

#if os(iOS)
    /// Photos and screenshots. GIFs stay as they are, like an image picked
    /// from Files, so an animation is not flattened; WebP/PNG/JPEG go through
    /// the picker's downscale.
    private static func isImage(_ file: ReceivedShare.File) -> Bool {
        let type = file.typeIdentifier.flatMap(UTType.init)
            ?? file.mediaType.flatMap { UTType(mimeType: $0) }
            ?? file.name.flatMap { UTType(filenameExtension: ($0 as NSString).pathExtension) }
        guard let type, type.conforms(to: .image) else { return false }
        return !type.conforms(to: .gif)
    }
#endif
}
