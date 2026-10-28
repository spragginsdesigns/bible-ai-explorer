import UIKit

/// The UIKit encoder for `ImageUploadSizing` (`Shared/Chat/ImageUploadSizing.swift`),
/// Android's D9 rule: anything whose longest side exceeds 2048px is resized to
/// 2048 and re-encoded as JPEG; anything inside the budget passes through
/// untouched. The Mac applies the same rule through ImageIO.
enum ImageDownscale {
    /// Longest edge we upload (Android `MAX_UPLOAD_IMAGE_EDGE`).
    static let maxEdge = ImageUploadSizing.maxEdge
    /// JPEG quality for a re-encoded upload (Android `UPLOAD_JPEG_COMPRESS`).
    static let jpegQuality = CGFloat(ImageUploadSizing.jpegQuality)

    /// Target pixel size, or nil when the image needs nothing: the shared rule.
    static func targetSize(width: Int, height: Int, maxEdge: Int = maxEdge) -> (width: Int, height: Int)? {
        ImageUploadSizing.targetSize(width: width, height: height, maxEdge: maxEdge)
    }

    /// Pixel dimensions of `image`, orientation applied (what `draw` produces).
    static func pixelSize(of image: UIImage) -> (width: Int, height: Int) {
        (Int((image.size.width * image.scale).rounded()),
         Int((image.size.height * image.scale).rounded()))
    }

    /// The resized image (scale 1, so points are pixels), or nil when no work is
    /// needed.
    static func resized(_ image: UIImage) -> UIImage? {
        let source = pixelSize(of: image)
        guard let target = targetSize(width: source.width, height: source.height) else {
            return nil
        }
        let size = CGSize(width: target.width, height: target.height)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// JPEG bytes for upload. Oversized images are downscaled and encoded at
    /// 0.85 like Android; others keep the existing 0.9 re-encode (still needed to
    /// turn HEIC into an allowlisted type). Nil only if encoding fails.
    static func jpegForUpload(_ image: UIImage, defaultQuality: CGFloat = 0.9) -> Data? {
        if let small = resized(image) {
            return small.jpegData(compressionQuality: jpegQuality)
        }
        return image.jpegData(compressionQuality: defaultQuality)
    }
}
