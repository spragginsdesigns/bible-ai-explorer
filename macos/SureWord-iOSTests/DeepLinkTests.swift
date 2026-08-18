import XCTest

@testable import SureWord

/// Deep-link parsing and the cold-start buffer (Lane 5).
final class DeepLinkTests: XCTestCase {
    func testParsesCrossRoute() {
        XCTAssertEqual(DeepLink.parse(URL(string: "sureword://cross")!), .cross)
    }

    func testParsesVerseRoute() throws {
        let link = DeepLink.parse(URL(string: "sureword://verse?ref=John%203:16")!)
        guard case .verse(let reference) = try XCTUnwrap(link) else {
            return XCTFail("expected a verse link")
        }
        XCTAssertEqual(reference, "John 3:16")
        // The reference resolves through the same grammar the reader uses.
        let resolved = Bible.resolveReference(reference)
        XCTAssertEqual(resolved?.order, 43)
        XCTAssertEqual(resolved?.chapter, 3)
        XCTAssertEqual(resolved?.verse, 16)
    }

    func testVerseRouteWithoutReferenceIsRejected() {
        XCTAssertNil(DeepLink.parse(URL(string: "sureword://verse")!))
        XCTAssertNil(DeepLink.parse(URL(string: "sureword://verse?ref=")!))
    }

    func testClerkCallbackAndForeignURLsAreNotDeepLinks() {
        // Clerk's OAuth return is claimed by Clerk.handle before parsing, but
        // the parser must not treat it as an app route if it ever gets here.
        XCTAssertNil(DeepLink.parse(URL(string: "sureword://sso-callback?code=abc")!))
        XCTAssertNil(DeepLink.parse(URL(string: "https://sureword.app/cross")!))
        XCTAssertNil(DeepLink.parse(URL(string: "sureword://unknown")!))
    }

    @MainActor
    func testPendingLinksDrainInOrderAndClear() {
        let links = PendingDeepLinks.shared
        links.post(.cross)
        links.post(.verse("Psalm 23:1"))

        XCTAssertEqual(links.drain(), [.cross, .verse("Psalm 23:1")])
        XCTAssertEqual(links.drain(), [])
    }
}
