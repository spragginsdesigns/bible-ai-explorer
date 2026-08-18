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
            let isPNG = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
            if isPNG {
                return PickedPhoto(attachment: LocalAttachment(
                    filename: Self.filename(extension: "png"),
                    mediaType: "image/png",
                    data: data
                ))
            }
            guard let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.9)
            else {
                throw AttachmentError(
                    message: AttachmentValidator.unsupported("that photo")
                )
            }
            return PickedPhoto(attachment: LocalAttachment(
                filename: Self.filename(extension: "jpg"),
                mediaType: "image/jpeg",
                data: jpeg
            ))
        }
    }

    private static func filename(extension ext: String) -> String {
        "photo-\(Int(Date().timeIntervalSince1970)).\(ext)"
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
                .flatMap { $0.jpegData(compressionQuality: 0.9) }
                .map {
                    LocalAttachment(
                        filename: "camera-\(Int(Date().timeIntervalSince1970)).jpg",
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
    /// A copied image (screenshot, browser image) as a `LocalAttachment`,
    /// matching the Mac's ⌘V path. PNG stays PNG so text screenshots keep
    /// their sharpness; anything else goes out as JPEG.
    static func image() -> LocalAttachment? {
        guard let image = UIPasteboard.general.image else { return nil }
        let stamp = Int(Date().timeIntervalSince1970)
        if let png = image.pngData() {
            return LocalAttachment(
                filename: "clipboard-\(stamp).png",
                mediaType: "image/png",
                data: png
            )
        }
        return image.jpegData(compressionQuality: 0.9).map {
            LocalAttachment(filename: "clipboard-\(stamp).jpg", mediaType: "image/jpeg", data: $0)
        }
    }

    static var hasImage: Bool { UIPasteboard.general.hasImages }
}
