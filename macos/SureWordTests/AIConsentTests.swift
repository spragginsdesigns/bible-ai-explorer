import Foundation
import XCTest

@testable import SureWord

/// PRD A4, the one-time AI disclosure and consent sheet: the copy mirror, the
/// "consent needed" rule, the wire shapes, and the gate's behaviour - agree
/// runs the action, a confirmed "No thanks" is saved and never asked again,
/// and an account never inherits another account's consent. The code under test is all in `Shared/`.
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

    func testCopyIncludesTheCurrentProviders() {
        XCTAssertEqual(AIConsent.version, 2)
        XCTAssertEqual(AIConsent.title, "How SureWord answers you")
        XCTAssertEqual(AIConsent.privacyLabel, "Privacy Policy")
        XCTAssertEqual(AIConsent.privacyURL, "https://sureword.app/privacy")
        XCTAssertEqual(AIConsent.agree, "Agree and continue")
        XCTAssertEqual(AIConsent.decline, "No thanks")
        XCTAssertEqual(AIConsent.settingsTitle, "AI data sharing")
        XCTAssertEqual(AIConsent.withdraw, "Turn off AI")
        XCTAssertTrue(AIConsent.body.hasPrefix("SureWord's answers are written by AI."))
        XCTAssertLessThanOrEqual(AIConsent.body.split(whereSeparator: \.isWhitespace).count, 120)
    }

    // MARK: - Rules

    func testAnOlderCachedAgreementStillCounts() {
        defaults.set(Data(#"{"record":{"version":1,"acceptedAt":"2026-10-07T15:04:05Z"},"required":1}"#.utf8), forKey: AIConsentStore.cacheKey("old_user"))
        let store = AIConsentStore(account: "old_user", transport: FakeConsentTransport(), defaults: defaults)
        XCTAssertTrue(store.isCurrent)
        XCTAssertFalse(store.declined)
        XCTAssertEqual(store.required, AIConsent.version)
    }

    func testAnyRecordedAgreementCounts() {
        XCTAssertTrue(AIConsent.needed(nil))
        XCTAssertFalse(AIConsent.needed(Self.agreed))
        // A later copy version never re-asks someone who already said yes.
        XCTAssertFalse(AIConsent.needed(AIConsentRecord(version: 1, acceptedAt: "2026-10-07T15:04:05Z")))
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
                AIConsentRecord(version: 2, acceptedAt: "2026-10-07T15:04:05Z"),
                locale: locale,
                timeZone: utc
            ),
            "Allowed on October 7, 2026"
        )
        XCTAssertNil(AIConsent.statusLabel(nil, locale: locale, timeZone: utc))
        XCTAssertNil(
            AIConsent.statusLabel(AIConsentRecord(version: 2, acceptedAt: "yesterday"), locale: locale, timeZone: utc)
        )
    }

    // MARK: - Wire shapes

    func testDocumentDecodesConsentWhenPresent() throws {
        let document = try Self.decode(
            #"{"translation":"KJV","aiConsent":{"version":2,"acceptedAt":"2026-10-07T15:04:05.000Z"},"aiConsentRequired":2}"#
        )
        XCTAssertEqual(document.aiConsent, Self.agreed)
        XCTAssertEqual(document.aiConsentRequired, 2)
        XCTAssertEqual(document.translation, "KJV")
    }

    func testDocumentDecodesAnExplicitNoConsent() throws {
        let document = try Self.decode(#"{"aiConsent":null,"aiConsentDeclined":true,"aiConsentRequired":2}"#)
        XCTAssertNil(document.aiConsent)
        XCTAssertEqual(document.aiConsentDeclined, true)
        XCTAssertEqual(document.aiConsentRequired, 2)
    }

    func testDocumentFromAnOlderServerStillDecodes() throws {
        let document = try Self.decode(#"{"translation":"NKJV","parchment":false}"#)
        XCTAssertNil(document.aiConsent)
        XCTAssertNil(document.aiConsentRequired)
        XCTAssertEqual(document.translation, "NKJV")
        XCTAssertEqual(document.parchment, false)
    }

    func testAgreePatchCarriesOnlyTheVersion() throws {
        let json = try Self.object(encoding: AIConsentPatch(version: 2))
        XCTAssertEqual(Set(json.keys), ["aiConsent"])
        let consent = try XCTUnwrap(json["aiConsent"] as? [String: Any])
        XCTAssertEqual(Set(consent.keys), ["version"])
        XCTAssertEqual(consent["version"] as? Int, 2)
    }

    func testWithdrawPatchEncodesAnExplicitNull() throws {
        let data = try JSONEncoder().encode(AIConsentPatch(version: nil))
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"aiConsent":null}"#)
    }

    // MARK: - Store

    func testDocumentWithoutConsentFieldsSaysNothing() {
        let store = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        store.absorb(AccountPreferences(aiConsent: nil, aiConsentRequired: 2))
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
        XCTAssertEqual(saves, [2])

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

        store.cancelPending()
        let granted = await gate.value
        XCTAssertFalse(granted)
    }

    func testNoThanksConfirmsThenIsNeverAskedAgain() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)

        let first = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        store.decline()
        // "No thanks" asks to confirm; nothing is saved and the sheet stays.
        XCTAssertEqual(store.prompt?.isConfirmingDecline, true)
        var saves = await transport.saves
        XCTAssertTrue(saves.isEmpty)
        store.back()
        XCTAssertEqual(store.prompt?.isConfirmingDecline, false)
        store.decline()

        await store.confirmDecline()
        let firstResult = await first.value
        XCTAssertFalse(firstResult)
        XCTAssertNil(store.prompt)
        XCTAssertTrue(store.declined)
        saves = await transport.saves
        XCTAssertEqual(saves, [nil])

        // Never again: neither a verse selection nor a deliberate tap asks.
        let automatic = await store.ensureConsent(.automatic)
        XCTAssertFalse(automatic)
        let tap = await store.ensureConsent()
        XCTAssertFalse(tap)
        XCTAssertNil(store.prompt)

        // Nor after a cold start.
        let reopened = AIConsentStore(account: "user_a", transport: FakeConsentTransport(loadError: true), defaults: defaults)
        XCTAssertTrue(reopened.declined)
        let afterLaunch = await reopened.ensureConsent()
        XCTAssertFalse(afterLaunch)
        XCTAssertNil(reopened.prompt)
    }

    func testAllowOnTheConfirmationAgrees() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        let gate = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        store.decline()
        await store.agree()
        let granted = await gate.value
        XCTAssertTrue(granted)
        XCTAssertTrue(store.isCurrent)
    }

    func testActionsWhileTheSheetIsUpWaitForTheSameAnswer() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil))
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        let first = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        let second = Task { await store.ensureConsent(.automatic) }
        try await Task.sleep(for: .milliseconds(20))
        await store.agree()
        let firstResult = await first.value
        let secondResult = await second.value
        XCTAssertTrue(firstResult)
        XCTAssertTrue(secondResult)
    }

    func testTheSheetOpensByItselfOnlyForAnUndecidedAccount() {
        let undecided = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults, askOnLaunch: true)
        undecided.absorb(Self.document(nil))
        XCTAssertNotNil(undecided.prompt)

        let declined = AIConsentStore(account: "user_b", transport: FakeConsentTransport(), defaults: defaults, askOnLaunch: true)
        declined.absorb(Self.document(nil, declined: true))
        XCTAssertNil(declined.prompt)

        let allowed = AIConsentStore(account: "user_c", transport: FakeConsentTransport(), defaults: defaults, askOnLaunch: true)
        allowed.absorb(Self.document(Self.agreed))
        XCTAssertNil(allowed.prompt)

        // A server that does not record a no yet cannot promise "once".
        let older = AIConsentStore(account: "user_d", transport: FakeConsentTransport(), defaults: defaults, askOnLaunch: true)
        older.absorb(Self.document(nil, declined: nil))
        XCTAssertNil(older.prompt)
    }

    func testSettingsCanTurnAIBackOn() async {
        let store = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults)
        store.absorb(Self.document(nil, declined: true))
        store.reconsider()
        XCTAssertNotNil(store.prompt)
        await store.agree()
        XCTAssertTrue(store.isCurrent)
        XCTAssertFalse(store.declined)
    }

    func testAStaleFetchCannotUndoAnAnswerOrReopenTheSheet() async {
        let store = AIConsentStore(account: "user_a", transport: FakeConsentTransport(), defaults: defaults, askOnLaunch: true)
        store.absorb(Self.document(nil))
        XCTAssertNotNil(store.prompt)
        await store.agree()
        XCTAssertTrue(store.isCurrent)
        // A fetch that started before the save lands afterwards.
        store.absorb(Self.document(nil))
        XCTAssertTrue(store.isCurrent)
        XCTAssertNil(store.prompt)
    }

    func testAfterAFailedSaveBackClosesTheSheetUnrecorded() async throws {
        let transport = FakeConsentTransport(loadDocument: Self.document(nil), saveError: true)
        let store = AIConsentStore(account: "user_a", transport: transport, defaults: defaults)
        let gate = Task { await store.ensureConsent() }
        try await waitUntil { store.prompt != nil }
        store.decline()
        await store.confirmDecline()
        XCTAssertEqual(store.prompt?.error, "offline")
        store.back()
        XCTAssertNil(store.prompt)
        let granted = await gate.value
        XCTAssertFalse(granted)
        XCTAssertFalse(store.declined)
    }

    func testWithdrawClearsConsent() async {
        let transport = FakeConsentTransport(saveDocument: Self.document(nil, declined: true))
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
        XCTAssertTrue(reopened.declined)
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

    func testTheGateIsOpenWithNoSessionAndClosedOnNo() async throws {
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
        await store.confirmDecline()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertFalse(ran)
    }

    // MARK: - Helpers

    private static let agreed = AIConsentRecord(version: 2, acceptedAt: "2026-10-07T15:04:05.000Z")

    private static func document(_ consent: AIConsentRecord?, declined: Bool? = false) -> AccountPreferences {
        var document = AccountPreferences()
        document.aiConsent = consent
        document.aiConsentDeclined = consent == nil ? declined : false
        document.aiConsentRequired = 2
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
        document.aiConsentRequired = 2
        document.aiConsent = version.map { AIConsentRecord(version: $0, acceptedAt: "2026-10-07T15:04:05.000Z") }
        document.aiConsentDeclined = version == nil
        return document
    }
}
