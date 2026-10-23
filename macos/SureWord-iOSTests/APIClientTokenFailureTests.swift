import Foundation
import XCTest
@testable import SureWord

/// A Clerk token refresh that fails (a network blip mid-refresh) must read as
/// offline, never as a dead session. Before the fix the request went out with
/// no bearer, earned two 401s, and the auth-failure handler signed the reader
/// out over a dropped connection.
final class APIClientTokenFailureTests: XCTestCase {
    private func client(
        token: @escaping TokenProvider,
        onAuthFailure: @escaping @Sendable () async -> Void
    ) -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AlwaysUnauthorizedProtocol.self]
        return APIClient(
            baseURL: URL(string: "https://sureword-token.invalid")!,
            token: token,
            onAuthFailure: onAuthFailure,
            session: URLSession(configuration: configuration)
        )
    }

    func testFailedTokenFetchThrowsOfflineAndNeverSignsOut() async {
        let signOuts = Counter()
        AlwaysUnauthorizedProtocol.requests.reset()
        let api = client(
            token: { _ in throw URLError(.networkConnectionLost) },
            onAuthFailure: { signOuts.increment() }
        )
        do {
            _ = try await api.data("/api/ping")
            XCTFail("A failed token fetch must not succeed")
        } catch let error as APIError {
            XCTAssertTrue(error.isOffline)
        } catch {
            XCTFail("Unexpected error \(error)")
        }
        XCTAssertEqual(signOuts.value, 0)
        XCTAssertEqual(AlwaysUnauthorizedProtocol.requests.value, 0, "No unauthenticated request may go out")
    }

    func testNonNetworkTokenFailureStillReadsAsOffline() async {
        struct ClerkHiccup: Error {}
        let signOuts = Counter()
        let api = client(token: { _ in throw ClerkHiccup() }, onAuthFailure: { signOuts.increment() })
        do {
            _ = try await api.data("/api/ping")
            XCTFail("A failed token fetch must not succeed")
        } catch let error as APIError {
            XCTAssertTrue(error.isOffline)
        } catch {
            XCTFail("Unexpected error \(error)")
        }
        XCTAssertEqual(signOuts.value, 0)
    }

    func testTwoAuthenticated401sStillSignOut() async {
        let signOuts = Counter()
        let api = client(token: { _ in "jwt" }, onAuthFailure: { signOuts.increment() })
        _ = try? await api.data("/api/ping")
        XCTAssertEqual(signOuts.value, 1)
    }

    func testSignedOut401DoesNotReportAuthFailure() async {
        let signOuts = Counter()
        let api = client(token: { _ in nil }, onAuthFailure: { signOuts.increment() })
        _ = try? await api.data("/api/ping")
        XCTAssertEqual(signOuts.value, 0)
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.withLock { count } }
    func increment() { lock.withLock { count += 1 } }
    func reset() { lock.withLock { count = 0 } }
}

private final class AlwaysUnauthorizedProtocol: URLProtocol, @unchecked Sendable {
    static let requests = Counter()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "sureword-token.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.increment()
        let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"Unauthorized"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
