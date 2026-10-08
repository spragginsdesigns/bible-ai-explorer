import Foundation
import XCTest

@testable import SureWord

/// PRD A4, the one-time AI disclosure and consent sheet: the copy mirror, the
/// "consent needed" rule, the wire shapes, and the gate's behaviour - agree
/// runs the action, "Not now" sends nothing, and an account never inherits
/// another account's consent. The code under test is all in `Shared/`.
@MainActor
final class AIConsentTests: XCTestCase {
    private static let suite = "AIConsentTests"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        UserDefaults().removePersistentDomain(forName: Self.suite)
        defaults = UserDefaults(suiteName: Self.suite)
    }

    override func tearDown() {
        UserDefaults().removePersistentDomain(forName: Self.suite)
        defaults = nil
        super.tearDown()
    }

    // MARK: - Copy

    func testCopyMatchesTheApprovedText() {
        XCTAssertEqual(AIConsent.version, 1)
        XCTAssertEqual(AIConsent.title, "How SureWord answers you")
        XCTAssertEqual(AIConsent.privacyLabel, "Privacy Policy")
        XCTAssertEqual(AIConsent.privacyURL, "https://sureword.app/privacy")
        XCTAssertEqual(AIConsent.agree, "Agree and continue")
        XCTAssertEqual(AIConsent.decline, "Not now")
        XCTAssertEqual(AIConsent.settingsTitle, "AI data sharing")
        XCTAssertEqual(AIConsent.withdraw, "Withdraw")
        XCTAssertTrue(AIConsent.body.hasPrefix("SureWord's answers are written by AI."))
        XCTAssertEqual(AIConsent.body.split(whereSeparator: \.isWhitespace).count, 99)
    }

    // MARK: - Rules

    func testConsentIsNeededUnlessTheRequiredVersionWasAgreed() {
        XCTAssertTrue(AIConsent.needed(nil, required: 1))
        XCTAssertFalse(AIConsent.needed(Self.agreed, required: 1))
        // The server bumped the copy: the old agreement no longer counts.
        XCTAssertTrue(AIConsent.needed(Self.agreed, required: 2))
    }

    func testStatusLabelIsALongDate() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(
            AIConsent.statusLabel(Self.agreed, locale: locale, timeZone: utc),
            "Allowed on October 7, 2026"
        )
        XCTAssertEqual(
            AIConsent.statusLabel(
                AIConsentRecord(version: 1, acceptedAt: "2026-10-07T15:04:05Z"),
                locale: locale,
                timeZone: utc
            ),
            "Allowed on October 7, 2026"
        )
        XCTAssertNil(AIConsent.statusLabel(nil, locale: locale, timeZone: utc))
        XCTAssertNil(
            AIConsent.statusLabel(AIConsentRecord(version: 1, acceptedAt: "yesterday"), locale: locale, timeZone: utc)
        )
    }

    // MARK: - Wire shapes

    func testDocumentDecodesConsentWhenPresent() throws {
        let document = try Self.decode(
            #"{"translation":"KJV","aiConsent":{"version":1,"acceptedAt":"2026-10-07T15:04:05.000Z"},"aiConsentRequired":1}"#
        )
        XCTAssertEqual(document.aiConsent, Self.agreed)
        XCTAssertEqual(document.aiConsentRequired, 1)
        XCTAssertEqual(document.translation, "KJV")
    }

    func testDocumentDecodesAnExplicitNoConsent() throws {
        let document = try Self.decode(#"{"aiConsent":null,"aiConsentRequired":1}"#)
        XCTAssertNil(document.aiConsent)
        XCTAssertEqual(document.aiConsentRequired, 1)
    }

    func testDocumentFromAnOlderServerStillDecodes() throws {
        let document = try Self.decode(#"{"translation":"NKJV","parchment":false}"#)
        XCTAssertNil(document.aiConsent)
        XCTAssertNil(document.aiConsentRequired)
        XCTAssertEqual(document.translation, "NKJV")
        XCTAssertEqual(document.parchment, false)
    }

    func testAgreePatchCarriesOnlyTheVersion() throws {
        let json = try Self.object(encoding: AIConsentPatch(version: 1))
        XCTAssertEqual(Set(json.keys), ["aiConsent"])
        let consent = try XCTUnwrap(json["aiConsent"] as? [String: Any])
        XCTAssertEqual(Set(consent.keys), ["version"])
        XCTAssertEqual(consent["version"] as? Int, 1)
    }

    func testWithdrawPatchEncodesAnExplicitNull() throws {
        let data = try JSONEncoder().encode(AIConsentPatch(version: nil))
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"aiConsent":null}"#)
    }

    // MARK: - Store

    func testDocumentWithoutConsentFieldsSaysNothing() {
        let store = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        store.absorb(AccountPreferences(aiConsent: nil, aiConsentRequired: 1))
        XCTAssertFalse(store.isCurrent)
        store.absorb(Self.document(Self.agreed))
        XCTAssertTrue(store.isCurrent)
        // An older server's document has no `aiConsentRequired`; its missing
        // `aiConsent` is not a withdrawal.
        XCTAssertFalse(store.absorb(AccountPreferences(translation: "KJV")))
        XCTAssertTrue(store.isCurrent)
    }

    func testConsentIsCachedPerAccountAndNeverInherited() async {
        let first = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        first.absorb(Self.document(Self.agreed))
        XCTAssertTrue(first.isCurrent)

        // A different account on the same device starts with nothing.
        let other = AIConsentStore(account: "user_b", transport: FakeConsentTransport(), defaults: defaults)
        XCTAssertFalse(other.isCurrent)
        XCTAssertNil(other.record)

        // The first account again, offline: no re-prompt, no request.
        let offline = FakeConsentTransport(loadError: true)
        let again = AIConsentStore(account: "user_a", transport: offline, defaults: defaults)
        XCTAssertTrue(again.isCurrent)
        let granted = await again.ensureConsent()
        XCTAssertTrue(granted)
        XCTAssertNil(again.prompt)
        let loads = await offline.loadCount
        XCTAssertEqual(loads, 0)
    }

    func testCurrentConsentRunsAtOnce() async {
        let transport = FakeConsentTransport()
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        store.absorb(Self.document(Self.agreed))
        let granted = await store.ensureConsent()
        XCTAssertTrue(granted)
        XCTAssertNil(store.prompt)
        let saves = await transport.saves
        XCTAssertTrue(saves.isEmpty)
    }

    func testAnUnknownDocumentIsFetchedBeforeAsking() async {
        // Agreed on another device: the fresh GET says so, and no sheet shows.
        let transport = FakeConsentTransport(loadDocument: Self.document(Self.agreed))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        let granted = await store.ensureConsent()
        XCTAssertTrue(granted)
        XCTAssertNil(store.prompt)
        let loads = await transport.loadCount
        XCTAssertEqual(loads, 1)
    }

    func testAgreeRecordsConsentThenReleasesTheAction() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil), saveDocument: Self.document(Self.agreed))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)

        var ran = false
        store.require { ran = true }
        try await waitUntil { store.prompt != nil }
        XCTAssertFalse(ran)

        await store.agree()
        try await waitUntil { ran }
        XCTAssertNil(store.prompt)
        XCTAssertTrue(store.isCurrent)
        let saves = await transport.saves
        XCTAssertEqual(saves, [1])

        // Persisted for the next cold start.
        let reopened = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        XCTAssertTrue(reopened.isCurrent)
    }

    func testAFailedAgreeKeepsTheSheetAndDoesNotRunTheAction() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil), saveError: true)
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)

        let gate = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        await store.agree()

        XCTAssertNotNil(store.prompt)
        XCTAssertEqual(store.prompt?.error, "offline")
        XCTAssertEqual(store.prompt?.isSaving, false)
        XCTAssertFalse(store.isCurrent)

        store.decline()
        let granted = await gate.value
        XCTAssertFalse(granted)
    }

    func testNotNowSendsNothingAndAsksAgainNextTime() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)

        let first = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        store.decline()
        let firstResult = await first.value
        XCTAssertFalse(firstResult)
        XCTAssertNil(store.prompt)
        let saves = await transport.saves
        XCTAssertTrue(saves.isEmpty)

        // A verse selection never raises the sheet...
        let automatic = await store.ensureConsent(.automatic)
        XCTAssertFalse(automatic)
        XCTAssertNil(store.prompt)

        // ...but the next deliberate AI action does.
        let second = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        store.decline()
        let secondResult = await second.value
        XCTAssertFalse(secondResult)
    }

    func testOnlyOneSheetAtATime() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        let first = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        let second = await store.ensureConsent()
        XCTAssertFalse(second)
        store.cancelPending()
        let firstResult = await first.value
        XCTAssertFalse(firstResult)
    }

    func testWithdrawClearsConsent() async {
        let transport = FakeConsentTransport(saveDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        store.absorb(Self.document(Self.agreed))
        XCTAssertEqual(store.statusLabel.hasPrefix("Allowed on "), true)

        let withdrew = await store.withdraw()
        XCTAssertTrue(withdrew)
        XCTAssertFalse(store.isCurrent)
        XCTAssertEqual(store.statusLabel, AIConsent.notAllowedLabel)
        let saves = await transport.saves
        XCTAssertEqual(saves, [nil])

        let reopened = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        XCTAssertFalse(reopened.isCurrent)
    }

    func testAFailedWithdrawKeepsConsentAndReports() async {
        let transport = FakeConsentTransport(saveError: true)
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        store.absorb(Self.document(Self.agreed))
        let withdrew = await store.withdraw()
        XCTAssertFalse(withdrew)
        XCTAssertTrue(store.isCurrent)
        XCTAssertEqual(store.withdrawError, "offline")
    }

    func testTheGateIsOpenWithNoSessionAndClosedOnNotNow() async throws {
        let previous = AIConsentGate.current
        defer { AIConsentGate.current = previous }

        AIConsentGate.current = nil
        let open = await AIConsentGate.ensure()
        XCTAssertTrue(open)

        let store = AIConsentStore(
            account: "user_a",
            transport: FakeConsentTransport(loadDocument: Self.document(nil)),
            defaults: defaults
        )
        AIConsentGate.current = store
        var ran = false
        AIConsentGate.require { ran = true }
        try await waitUntil { store.prompt != nil }
        store.decline()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertFalse(ran)
    }

    // MARK: - Helpers

    private static let agreed = AIConsentRecord(version: 1, acceptedAt: "2026-10-07T15:04:05.000Z")

    private static func document(_ consent: AIConsentRecord?) -> AccountPreferences {
        var document = AccountPreferences()
        document.aiConsent = consent
        document.aiConsentRequired = 1
        return document
    }

    private static func decode(_ json: String) throws -> AccountPreferences {
        try JSONDecoder().decode(AccountPreferences.self, from: Data(json.utf8))
    }

    private static func object(encoding value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for the condition")
    }
}

private extension AccountPreferences {
    init(aiConsent: AIConsentRecord?, aiConsentRequired: Int?) {
        self.init()
        self.aiConsent = aiConsent
        self.aiConsentRequired = aiConsentRequired
    }
}

private actor FakeConsentTransport: AIConsentTransport {
    private let loadDocument: AccountPreferences
    private let loadError: Bool
    private let saveDocument: AccountPreferences?
    private let saveError: Bool
    private(set) var loadCount = 0
    private(set) var saves: [Int?] = []

    init(
        loadDocument: AccountPreferences = AccountPreferences(),
        loadError: Bool = false,
        saveDocument: AccountPreferences? = nil,
        saveError: Bool = false
    ) {
        self.loadDocument = loadDocument
        self.loadError = loadError
        self.saveDocument = saveDocument
        self.saveError = saveError
    }

    func loadPreferences() async throws -> AccountPreferences {
        loadCount += 1
        if loadError { throw APIError(message: "offline", isNetworkError: true) }
        return loadDocument
    }

    func saveAIConsent(version: Int?) async throws -> AccountPreferences {
        saves.append(version)
        if saveError { throw APIError(message: "offline", isNetworkError: true) }
        if let saveDocument { return saveDocument }
        var document = AccountPreferences()
        document.aiConsentRequired = 1
        document.aiConsent = version.map { AIConsentRecord(version: $0, acceptedAt: "2026-10-07T15:04:05.000Z") }
        return document
    }
}
