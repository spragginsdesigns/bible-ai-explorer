import XCTest

@testable import SureWord

/// B2: every API request names its platform so the server's
/// `platformFromHeaders` records `ios` / `macos` instead of guessing from the
/// user agent. `APIClient` is in `Shared/`, so this pins the macOS value too
/// through the platform conditional.
final class ClientHeaderTests: XCTestCase {
    func testAPIRequestsCarryPlatformClientHeader() async throws {
        let client = APIClient(
            baseURL: URL(string: "https://example.test")!,
            token: { _ in "jwt" },
            onAuthFailure: {}
        )
        let request = try await client.makeRequest("/api/ping", method: "GET", fresh: false)
        #if os(iOS)
        let expected = "ios"
        #else
        let expected = "macos"
        #endif
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-sureword-client"), expected)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer jwt")
    }
}
