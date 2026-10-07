import UIKit
import XCTest

@testable import SureWord

/// D9: mirrors `mobile/src/features/chat/imageDownscale.test.ts`.
final class ImageDownscaleTests: XCTestCase {
    private func image(_ width: Int, _ height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(
            size: CGSize(width: width, height: height), format: format
        ).image { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    func testLandscape4000x3000ScalesToLongestSide2048KeepingAspect() throws {
        let out = try XCTUnwrap(ImageDownscale.resized(image(4000, 3000)))
        let size = ImageDownscale.pixelSize(of: out)
        XCTAssertEqual(max(size.width, size.height), 2048)
        XCTAssertEqual(size.width, 2048)
        XCTAssertEqual(size.height, 1536)
        XCTAssertEqual(Double(size.width) / Double(size.height), 4000.0 / 3000.0, accuracy: 0.01)
    }

    func testPortraitScalesByHeight() throws {
        let out = try XCTUnwrap(ImageDownscale.resized(image(3000, 4000)))
        let size = ImageDownscale.pixelSize(of: out)
        XCTAssertEqual(size.height, 2048)
        XCTAssertEqual(size.width, 1536)
    }

    func testSmallImageIsUntouched() {
        XCTAssertNil(ImageDownscale.resized(image(1000, 500)))
        XCTAssertNil(ImageDownscale.targetSize(width: 2048, height: 2048))
    }

    func testInvalidDimensionsPassThrough() {
        XCTAssertNil(ImageDownscale.targetSize(width: 0, height: 100))
    }

    func testOversizedImageEncodesAsJPEGWithinBudget() throws {
        let data = try XCTUnwrap(ImageDownscale.jpegForUpload(image(4000, 3000)))
        XCTAssertTrue(data.starts(with: [0xFF, 0xD8]))
        let decoded = try XCTUnwrap(UIImage(data: data))
        let size = ImageDownscale.pixelSize(of: decoded)
        XCTAssertEqual(max(size.width, size.height), 2048)
    }

    func testMatchesAndroidConstants() {
        XCTAssertEqual(ImageDownscale.maxEdge, 2048)
        XCTAssertEqual(ImageDownscale.jpegQuality, 0.85)
    }
}
