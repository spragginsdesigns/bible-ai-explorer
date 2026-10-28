import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The upload rule for chat images, Android's `planImageDownscale`
/// (`mobile/src/features/chat/imageDownscale.ts`, D9): a modern camera hands
/// back 4000px+ frames that cost seconds of upload for detail no vision model
/// reads, so anything whose longest side exceeds 2048px is resized to 2048
/// and re-encoded as JPEG 0.85; anything inside the budget passes through
/// untouched.
///
/// iOS applies it at intake with UIKit (`SureWord-iOS/.../ImageDownscale.swift`:
/// photos, camera, clipboard); the Mac applies `downscaledJPEG` to whatever is
/// pasted, dropped or picked as a file.
enum ImageUploadSizing {
    /// Longest edge we upload (Android `MAX_UPLOAD_IMAGE_EDGE`).
    static let maxEdge = 2048
    /// JPEG quality for a re-encoded upload (Android `UPLOAD_JPEG_COMPRESS`).
    static let jpegQuality = 0.85

    /// Target pixel size, or nil when the image needs nothing. Unknown or
    /// non-positive sizes pass through.
    static func targetSize(width: Int, height: Int, maxEdge: Int = maxEdge) -> (width: Int, height: Int)? {
        guard width > 0, height > 0 else { return nil }
        if width <= maxEdge && height <= maxEdge { return nil }
        let scale = Double(maxEdge) / Double(max(width, height))
        if width >= height {
            return (maxEdge, max(1, Int((Double(height) * scale).rounded())))
        }
        return (max(1, Int((Double(width) * scale).rounded())), maxEdge)
    }

    /// An oversized image's bytes resized to the budget as JPEG, orientation
    /// applied; nil when the bytes are not an image, are inside the budget, or
    /// cannot be re-encoded (the caller then uploads the original). ImageIO
    /// rather than AppKit, so the rule is tested on the iOS simulator too.
    static func downscaledJPEG(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let type = CGImageSourceGetType(source),
              // ImageIO also opens PDFs; a document must never become a photo.
              UTType(type as String)?.conforms(to: .image) == true,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              let target = targetSize(width: width, height: height)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(target.width, target.height),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }

    /// A file as it should upload: unchanged, unless it is an oversized image,
    /// which comes back as `<name>.jpg` holding the downscaled JPEG.
    static func prepared(filename: String, data: Data) -> (filename: String, data: Data) {
        guard let jpeg = downscaledJPEG(data) else { return (filename, data) }
        let base = (filename as NSString).deletingPathExtension
        return ("\(base.isEmpty ? "image" : base).jpg", jpeg)
    }
}
