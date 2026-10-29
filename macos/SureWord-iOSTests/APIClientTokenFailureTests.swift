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

/// Hold the transport after its token is accepted, then replace its owner.
/// This tests the response boundary, independently of Clerk's token guard.
final class APIClientResponseOwnerTests: XCTestCase {
    private func scenario() -> (APIClient, ResponseOwner, OwnerResponseGate, Counter) {
        let owner = ResponseOwner()
        let gate = OwnerResponseGate()
        let signOuts = Counter()
        let key = UUID().uuidString
        OwnerHeldProtocol.registry.insert(gate, key: key)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OwnerHeldProtocol.self]
        let api = APIClient(
            baseURL: URL(string: "https://owner-response.invalid/\(key)/")!,
            token: { _ in "old-session-token" },
            onAuthFailure: { signOuts.increment() },
            requestOwner: { owner.snapshot() },
            session: URLSession(configuration: configuration)
        )
        return (api, owner, gate, signOuts)
    }

    func testLatePrivateDataIsRejectedAfterOwnerChanges() async throws {
        let (api, owner, gate, signOuts) = scenario()
        let request = Task { try await api.data("note") }
        defer { request.cancel() }
        try await gate.waitForRequest()
        owner.invalidate()
        gate.finish(status: 200)
        do {
            _ = try await request.value
            XCTFail("Old-account private data must not escape the client")
        } catch is CancellationError { }
        XCTAssertEqual(signOuts.value, 0)
        XCTAssertEqual(gate.requestCount, 1)
    }

    func testLateStatusResponseCannotReachANewOwner() async throws {
        let (api, owner, gate, _) = scenario()
        let request = Task { try await api.response("note") }
        defer { request.cancel() }
        try await gate.waitForRequest()
        owner.invalidate()
        gate.finish(status: 200)
        do {
            _ = try await request.value
            XCTFail("Raw response paths must enforce the same owner")
        } catch is CancellationError { }
    }

    func testStreamOpeningRejectsTheOldOwner() async throws {
        let (api, owner, gate, signOuts) = scenario()
        let request = Task { try await api.stream("note", body: ["question": "QA"]) }
        defer { request.cancel() }
        try await gate.waitForRequest()
        owner.replaceSession()
        gate.finish(status: 200)
        do {
            _ = try await request.value
            XCTFail("Old-session stream headers must not be accepted")
        } catch is CancellationError { }
        XCTAssertEqual(signOuts.value, 0)
    }

    func testOldSession401NeitherRetriesNorSignsOutReplacement() async throws {
        let (api, owner, gate, signOuts) = scenario()
        let request = Task { try await api.data("note") }
        defer { request.cancel() }
        try await gate.waitForRequest()
        owner.invalidate()
        gate.finish(status: 401)
        do {
            _ = try await request.value
            XCTFail("An old session's 401 must be discarded")
        } catch is CancellationError { }
        XCTAssertEqual(signOuts.value, 0)
        XCTAssertEqual(gate.requestCount, 1)
    }

    func testUnchangedOwnerStillReceivesItsResponse() async throws {
        let (api, _, gate, _) = scenario()
        let request = Task { try await api.data("note") }
        defer { request.cancel() }
        try await gate.waitForRequest()
        gate.finish(status: 200)
        let data = try await request.value
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "{\"private\":\"old owner\"}")
    }

    func testSameClientAcceptsNewSessionButRejectsItsOldResponse() async throws {
        let (api, owner, gate, signOuts) = scenario()
        let oldRequest = Task { try await api.data("note") }
        defer { oldRequest.cancel() }
        try await gate.waitForRequest()
        owner.replaceSession()
        gate.finish(status: 200)
        do {
            _ = try await oldRequest.value
            XCTFail("A replacement session must invalidate the old response")
        } catch is CancellationError { }
        let newData = try await api.data("note")
        XCTAssertEqual(String(decoding: newData, as: UTF8.self), "{\"private\":\"old owner\"}")
        XCTAssertEqual(gate.requestCount, 2)
        XCTAssertEqual(signOuts.value, 0)
    }

    func testInvalidOwnerNeverStartsTransport() async throws {
        let (api, owner, gate, _) = scenario()
        owner.invalidate()
        do {
            _ = try await api.data("note")
            XCTFail("An invalidated owner must not send another request")
        } catch is CancellationError { }
        XCTAssertEqual(gate.requestCount, 0)
    }
}

private final class ResponseOwner: @unchecked Sendable {
    private let lock = NSLock()
    private var valid = true
    private var generation = 0
    func snapshot() -> RequestOwner {
        let captured = lock.withLock { generation }
        return RequestOwner(isCurrent: { self.lock.withLock { self.valid && self.generation == captured } })
    }
    func invalidate() { lock.withLock { valid = false; generation += 1 } }
    func replaceSession() { lock.withLock { valid = true; generation += 1 } }
}

private final class OwnerResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var transport: OwnerHeldProtocol?
    private var finishedStatus: Int?
    private var count = 0
    var requestCount: Int { lock.withLock { count } }

    func attach(_ transport: OwnerHeldProtocol) {
        let completed = lock.withLock {
            self.transport = transport
            count += 1
            return finishedStatus
        }
        if let completed { transport.finish(status: completed) }
    }

    func waitForRequest() async throws {
        let deadline = Date().addingTimeInterval(5)
        while requestCount == 0, Date() < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        guard requestCount > 0 else { throw URLError(.timedOut) }
    }

    func finish(status: Int) {
        let active = lock.withLock {
            finishedStatus = status
            return transport
        }
        active?.finish(status: status)
    }
}

private final class OwnerProtocolRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var gates: [String: OwnerResponseGate] = [:]
    func insert(_ gate: OwnerResponseGate, key: String) { lock.withLock { gates[key] = gate } }
    func gate(_ key: String) -> OwnerResponseGate? { lock.withLock { gates[key] } }
}

private final class OwnerHeldProtocol: URLProtocol, @unchecked Sendable {
    static let registry = OwnerProtocolRegistry()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "owner-response.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let key = request.url?.pathComponents.dropFirst().first,
              let gate = Self.registry.gate(key) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        gate.attach(self)
    }
    func finish(status: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"private":"old owner"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
