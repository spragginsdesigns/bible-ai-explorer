import UIKit

/// Mirrors `mobile/src/features/chat/imageDownscale.ts` (D9): a modern camera
/// hands back 4000px+ frames that cost seconds of upload for detail no vision
/// model reads. Anything whose longest side exceeds 2048px is resized to 2048
/// and re-encoded as JPEG; anything inside the budget passes through untouched.
enum ImageDownscale {
    /// Longest edge we upload (Android `MAX_UPLOAD_IMAGE_EDGE`).
    static let maxEdge = 2048
    /// JPEG quality for a re-encoded upload (Android `UPLOAD_JPEG_COMPRESS`).
    static let jpegQuality: CGFloat = 0.85

    /// Target pixel size, or nil when the image needs nothing. Pure, so the rule
    /// is testable without rendering. Unknown or non-positive sizes pass through.
    static func targetSize(width: Int, height: Int, maxEdge: Int = maxEdge) -> (width: Int, height: Int)? {
        guard width > 0, height > 0 else { return nil }
        if width <= maxEdge && height <= maxEdge { return nil }
        let scale = Double(maxEdge) / Double(max(width, height))
        if width >= height {
            return (maxEdge, max(1, Int((Double(height) * scale).rounded())))
        }
        return (max(1, Int((Double(width) * scale).rounded())), maxEdge)
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
