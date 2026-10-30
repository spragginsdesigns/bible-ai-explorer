import Foundation
import XCTest

@testable import SureWord

/// Smoke tests for the signed-in iOS shell (Lane 1): the session root model
/// the tab bar is driven from, and the IA it mirrors from Android.
@MainActor
final class TabShellTests: XCTestCase {
    func testAppModelDefaultsToTodayHome() {
        let app = AppModel(settings: SettingsStore(), userID: nil)
        XCTAssertEqual(app.section, .today)
    }

    func testTabSectionsMatchAndroidIA() {
        XCTAssertEqual(AppSection.allCases.map(\.title), ["Today", "Bible", "Chat", "Connections", "Study"])
        XCTAssertEqual(AppSection.bible.symbol, "book")
        XCTAssertEqual(AppSection.notes.symbol, "note.text")
    }

    private func heldOnboarding() -> (AppModel, OnboardingModel, OnboardingResponseGate, URLSession, String) {
        let host = "onboarding-\(UUID().uuidString.lowercased()).invalid"
        let gate = OnboardingResponseGate()
        OnboardingHeldProtocol.registry.insert(gate, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OnboardingHeldProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = APIClient(baseURL: URL(string: "https://\(host)")!, token: { _ in nil },
                            onAuthFailure: {}, session: session)
        // A unique nonexistent Clerk account makes every AppModel-owned
        // client fail its owner guard before transport. Only the separately
        // injected onboarding client above can reach our local URLProtocol.
        let account = "unit-onboarding-\(UUID().uuidString)"
        let app = AppModel(settings: SettingsStore(), userID: account)
        return (app, OnboardingModel(api: api, account: account), gate, session, host)
    }

    func testAutomaticOnboardingKeepsSectionChosenBeforeConsentSettles() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        app.section = .bible
        await onboarding.autoStartIfNeeded(consentSettled: false, app: app)
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        gate.finishActive()
        await startup.value
        XCTAssertEqual(app.section, .bible)
        XCTAssertNil(onboarding.welcomeConversationID)
        XCTAssertNil(app.chat.activeConversationID)
    }

    func testLateAutomaticOnboardingKeepsNewerSectionChoice() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        app.section = .bible
        gate.finishActive()
        await startup.value
        XCTAssertEqual(app.section, .bible)
        XCTAssertNil(onboarding.welcomeConversationID)
        XCTAssertNil(app.chat.activeConversationID)
    }

    func testLateAutomaticOnboardingKeepsExplicitEqualTodayAssignment() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        XCTAssertEqual(app.section, .today)
        let previousIntent = app.navigationIntentID
        app.section = .today
        XCTAssertNotEqual(app.navigationIntentID, previousIntent)
        gate.finishActive()
        await startup.value
        XCTAssertEqual(app.section, .today)
        XCTAssertNil(onboarding.welcomeConversationID)
        XCTAssertNil(app.chat.activeConversationID)
    }

    func testLateAutomaticOnboardingKeepsEqualTabIntentBeforeSectionChanges() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        // The iOS binding records this even when selectedTab is unchanged
        // and no onChange(section) callback will be delivered.
        app.recordNavigationIntent()
        gate.finishActive()
        await startup.value
        XCTAssertEqual(app.section, .today)
        XCTAssertNil(onboarding.welcomeConversationID)
        XCTAssertNil(app.chat.activeConversationID)
    }

    func testAutomaticOnboardingStillOpensWithoutNewerNavigation() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        gate.finishActive()
        await startup.value
        XCTAssertEqual(app.section, .chat)
        XCTAssertEqual(onboarding.welcomeConversationID, "unit-welcome")
    }

    func testCancelledAutomaticOnboardingDoesNotOpenLateResponse() async throws {
        let (app, onboarding, gate, session, host) = heldOnboarding()
        defer { session.invalidateAndCancel(); OnboardingHeldProtocol.registry.remove(host) }
        let startup = Task { await onboarding.autoStartIfNeeded(consentSettled: true, app: app) }
        defer { startup.cancel() }
        try await gate.waitForRequest()
        // Deliver the response, then cancel before the MainActor startup
        // continuation can apply it. This does not rely on a network timeout.
        gate.finishActive()
        startup.cancel()
        await startup.value
        XCTAssertEqual(app.section, .today)
        XCTAssertNil(onboarding.welcomeConversationID)
        XCTAssertNil(app.chat.activeConversationID)
    }
}

private final class OnboardingResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var transport: OnboardingHeldProtocol?

    func attach(_ transport: OnboardingHeldProtocol) {
        lock.withLock { self.transport = transport }
    }

    func waitForRequest() async throws {
        let deadline = Date().addingTimeInterval(5)
        while !lock.withLock({ transport != nil }), Date() < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        guard lock.withLock({ transport != nil }) else { throw URLError(.timedOut) }
    }

    func finishActive() {
        lock.withLock { transport }?.finishActive()
    }
}

private final class OnboardingProtocolRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var gates: [String: OnboardingResponseGate] = [:]
    func insert(_ gate: OnboardingResponseGate, host: String) { lock.withLock { gates[host] = gate } }
    func gate(_ host: String) -> OnboardingResponseGate? { lock.withLock { gates[host] } }
    func remove(_ host: String) { _ = lock.withLock { gates.removeValue(forKey: host) } }
}

private final class OnboardingHeldProtocol: URLProtocol, @unchecked Sendable {
    static let registry = OnboardingProtocolRegistry()
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host.map { registry.gate($0) != nil } == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.httpMethod == "POST", request.url?.path == "/api/onboarding/start",
              let host = request.url?.host, let gate = Self.registry.gate(host) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        gate.attach(self)
    }
    func finishActive() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"status":"active","conversationId":"unit-welcome","created":false}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
