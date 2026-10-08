import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The three iOS intake paths for chat files, standing in for Android's
/// `AttachmentSourceSheet` actions (camera / gallery / document / paste).
/// Everything funnels into `ChatViewModel.addAttachments(_:)` as
/// `LocalAttachment`s, so the shared validator sees the same shapes the Mac's
/// picker, drop and ⌘V produce.

// MARK: - Photos picker

/// A photo out of the system picker, normalised to an allowlisted media type:
/// PNGs keep their transparency, everything else (HEIC included) becomes JPEG —
/// the server rejects HEIC, and the picker hands iPhone photos over as-is.
struct PickedPhoto: Transferable {
    let attachment: LocalAttachment

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .image) { data in
            guard let upload = uploadReady(data) else {
                throw AttachmentError(
                    message: AttachmentValidator.unsupported("that photo")
                )
            }
            return PickedPhoto(attachment: LocalAttachment(
                filename: Self.filename(extension: upload.fileExtension),
                mediaType: upload.mediaType,
                data: upload.data
            ))
        }
    }

    /// Any image's bytes as what the server accepts. Like Android's
    /// `planImageDownscale`, an allowlisted image (PNG, JPEG, WebP, GIF) inside
    /// the 2048px budget ships untouched in its own format - a GIF keeps its
    /// animation, a JPEG is not re-compressed. Everything else (HEIC, or
    /// anything oversized) is downscaled to JPEG. Shared with "Share into
    /// SureWord", where Photos hands over HEIC just as the picker does. Nil
    /// when the bytes are not an image UIKit can decode.
    static func uploadReady(_ data: Data) -> (data: Data, mediaType: String, fileExtension: String)? {
        guard let image = UIImage(data: data) else { return nil }
        let pixels = ImageDownscale.pixelSize(of: image)
        let inBudget = ImageDownscale.targetSize(width: pixels.width, height: pixels.height) == nil
        if inBudget,
           let mediaType = AttachmentLimits.sniffImageMediaType(data),
           let ext = PastedImages.extensionByMediaType[mediaType] {
            return (data, mediaType, ext)
        }
        guard let jpeg = ImageDownscale.jpegForUpload(image) else { return nil }
        return (jpeg, "image/jpeg", "jpg")
    }

    /// The picker hands over no file names, so each photo gets
    /// `photo-<ms>.<ext>`, `photo-<ms>-2.<ext>` ... - unique within one pick,
    /// which `photo-<seconds>` was not.
    private static func filename(extension ext: String) -> String {
        PastedImages.sequencedName(prefix: "photo", timestamp: PastedImages.timestamp(), index: 0, fileExtension: ext)
    }

    /// The picked photo, renamed to its place in the batch.
    func named(index: Int, timestamp: Int) -> LocalAttachment {
        var renamed = attachment
        let ext = (attachment.filename as NSString).pathExtension
        renamed.filename = PastedImages.sequencedName(
            prefix: "photo", timestamp: timestamp, index: index, fileExtension: ext
        )
        return renamed
    }
}

// MARK: - Camera

/// `UIImagePickerController` wrapper — there is still no SwiftUI camera.
struct CameraPicker: UIViewControllerRepresentable {
    /// Receives the captured photo as a JPEG `LocalAttachment`; nil on cancel.
    var onCapture: (LocalAttachment?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (LocalAttachment?) -> Void

        init(onCapture: @escaping (LocalAttachment?) -> Void) {
            self.onCapture = onCapture
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let image = info[.originalImage] as? UIImage
            let attachment = image
                .flatMap { ImageDownscale.jpegForUpload($0) }
                .map {
                    LocalAttachment(
                        // Android's fallback name for a camera shot.
                        filename: PastedImages.sequencedName(
                            prefix: "photo", timestamp: PastedImages.timestamp(), index: 0, fileExtension: "jpg"
                        ),
                        mediaType: "image/jpeg",
                        data: $0
                    )
                }
            onCapture(attachment)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCapture(nil)
        }
    }
}

// MARK: - Clipboard

enum ClipboardAttachments {
    /// Android's copy when the clipboard holds no image.
    static let noImageMessage = "There isn't an image on the clipboard."

    /// The representations read off a clipboard item, best first: the
    /// allowlisted formats keep their original bytes, HEIC/TIFF are decoded and
    /// re-encoded by `PickedPhoto.uploadReady`.
    private static let preferredTypes: [UTType] = [.png, .jpeg, .webP, .gif, .heic, .heif, .tiff]

    /// **Every** image on the clipboard (a multi-select copy from Photos puts
    /// several there), as `LocalAttachment`s named `clipboard-<ms>.<ext>`,
    /// `clipboard-<ms>-2.<ext>` ... like Android's `pastedImageMetadata`.
    ///
    /// The original bytes are used, not `UIPasteboard.image` re-encoded as
    /// PNG: that turned a copied 12 MP JPEG into a PNG far over the 10 MB cap.
    /// An in-budget PNG/JPEG/WebP/GIF ships untouched; anything else is
    /// downscaled to JPEG the way a picked photo is.
    static func images(now: Date = Date()) -> [LocalAttachment] {
        let stamp = PastedImages.timestamp(now)
        var originals = UIPasteboard.general.items.compactMap(originalImageData(in:))
        if originals.isEmpty, let image = UIPasteboard.general.image, let png = image.pngData() {
            originals = [png]
        }
        return originals.compactMap(PickedPhoto.uploadReady).enumerated().map { index, upload in
            let named = PastedImages.metadata(
                name: nil,
                declaredType: upload.mediaType,
                index: index,
                timestamp: stamp
            )
            return LocalAttachment(filename: named.filename, mediaType: named.mediaType, data: upload.data)
        }
    }

    private static func originalImageData(in item: [String: Any]) -> Data? {
        for type in preferredTypes {
            if let data = item[type.identifier] as? Data { return data }
            if let image = item[type.identifier] as? UIImage { return image.pngData() }
        }
        for (key, value) in item where UTType(key)?.conforms(to: .image) == true {
            if let data = value as? Data { return data }
            if let image = value as? UIImage { return image.pngData() }
        }
        return nil
    }

    static var hasImage: Bool { UIPasteboard.general.hasImages }
}
