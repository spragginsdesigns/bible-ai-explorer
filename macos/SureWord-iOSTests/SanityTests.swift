import XCTest

@testable import SureWord

/// Sanity test proving the iOS test target hosts on the app and can see the
/// shared module. Real suites are ported from `SureWordTests/` by a later lane.
final class SanityTests: XCTestCase {
    func testSharedModuleIsLinked() {
        XCTAssertEqual(Config.redirectScheme, "sureword")
        XCTAssertEqual(Bible.books.count, 66)
    }
}
