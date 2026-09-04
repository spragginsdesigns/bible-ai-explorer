import Foundation
import XCTest

@testable import SureWord

/// The account-preferences pipe: the wire shapes, the stale-fetch guard, the
/// write-through from `SettingsStore`, and the rollback.
///
/// These run on the iOS target because that is the one whose tests execute in
/// CI (`xcodebuild test` on the simulator); the code under test is entirely in
/// `Shared/`, so the macOS client is covered by the same assertions.
@MainActor
final class PreferencesSyncTests: XCTestCase {
    /// `SettingsStore` is backed by `UserDefaults.standard`, so every test
    /// starts and ends from clean - the same discipline as
    /// `ChatModelSettingsTests`.
    private static let keys = [
        "settings.translation",
        "settings.bible.parchment",
        "settings.listen.rate",
        "settings.chat.modelId",
        "settings.chat.effort",
        "settings.chat.speed",
        "settings.chat.verbosity",
        "settings.chat.mode",
        "settings.account.userId",
        "settings.preferences.adopted",
    ]

    /// Everything at its column default, which is what a brand-new account's
    /// document looks like.
    private static let defaultLocal = LocalPreferences(
        translation: "KJV",
        parchment: true,
        listenRate: 1,
        modelId: nil,
        effort: nil,
        speed: nil,
        verbosity: nil,
        mode: nil
    )

    override func setUp() {
        super.setUp()
        for key in Self.keys { UserDefaults.standard.removeObject(forKey: key) }
    }

    override func tearDown() {
        for key in Self.keys { UserDefaults.standard.removeObject(forKey: key) }
        super.tearDown()
    }

    // MARK: - Wire shapes

    func testPatchEncodesValueNullAndAbsentChatFieldsDifferently() throws {
        let patch = PreferencesPatch(
            chat: ChatPreferences(
                modelId: .some("openai:gpt-5.6-terra"),
                // An explicit null clears the column: the user picked Auto, or
                // cleared the option.
                effort: .some(nil)
                // speed / verbosity / mode are absent and must not appear.
            )
        )
        let json = try Self.object(encoding: patch)
        let chat = try XCTUnwrap(json["chat"] as? [String: Any])

        XCTAssertEqual(chat["modelId"] as? String, "openai:gpt-5.6-terra")
        XCTAssertTrue(chat.keys.contains("effort"))
        XCTAssertTrue(chat["effort"] is NSNull)
        XCTAssertFalse(chat.keys.contains("speed"))
        XCTAssertFalse(chat.keys.contains("verbosity"))
        XCTAssertFalse(chat.keys.contains("mode"))
        // Top-level fields nobody touched stay out of the body - the server
        // writes every key it is sent.
        XCTAssertEqual(Set(json.keys), ["chat"])
    }

    func testPatchOmitsAnEmptyChatBlock() throws {
        // A body with no recognised keys is a 400, and `{ "chat": {} }` is one.
        let patch = PreferencesPatch(translation: "NKJV", chat: ChatPreferences())
        let json = try Self.object(encoding: patch)
        XCTAssertEqual(json["translation"] as? String, "NKJV")
        XCTAssertFalse(json.keys.contains("chat"))
    }

    func testPatchEncodesScalarsVerbatim() throws {
        let patch = PreferencesPatch(webSearchEnabled: false, parchment: true, listenRate: 1.25)
        let json = try Self.object(encoding: patch)
        XCTAssertEqual(json["webSearchEnabled"] as? Bool, false)
        XCTAssertEqual(json["parchment"] as? Bool, true)
        XCTAssertEqual(json["listenRate"] as? Double, 1.25)
    }

    func testDocumentDecodingSeparatesAbsentFromNull() throws {
        let payload = Data(
            """
            {
              "plan": "pro",
              "webSearchEnabled": true,
              "translation": "NKJV",
              "chat": { "modelId": null, "effort": "high" }
            }
            """.utf8
        )
        let document = try JSONDecoder().decode(AccountPreferences.self, from: payload)

        XCTAssertEqual(document.plan, "pro")
        XCTAssertEqual(document.webSearchEnabled, true)
        XCTAssertEqual(document.translation, "NKJV")
        // Absent at the top level: leave local alone.
        XCTAssertNil(document.parchment)
        XCTAssertNil(document.listenRate)

        let chat = try XCTUnwrap(document.chat)
        // Present and null: "never chosen", which clears local.
        XCTAssertEqual(chat.modelId, .some(nil))
        XCTAssertEqual(chat.effort, .some("high"))
        // Absent: not mentioned, so local stands.
        XCTAssertNil(chat.speed)
        XCTAssertNil(chat.mode)
    }

    // MARK: - Applying a document

    func testApplyReplacesEverySyncedField() {
        let settings = SettingsStore()
        settings.translation = .kjv
        settings.parchment = true
        settings.listenRate = 1
        settings.chatSpeed = "fast"
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: settings)

        sync.apply(
            AccountPreferences(
                webSearchEnabled: true,
                memoryEnabled: true,
                translation: "NKJV",
                parchment: false,
                listenRate: 1.5,
                chat: ChatPreferences(
                    modelId: .some("openai:gpt-5.6-terra"),
                    speed: .some(nil),
                    verbosity: .some("high")
                )
            ),
            fromServer: true
        )

        XCTAssertEqual(sync.webSearchEnabled, true)
        XCTAssertEqual(sync.memoryEnabled, true)
        XCTAssertEqual(settings.translation, .nkjv)
        XCTAssertFalse(settings.parchment)
        XCTAssertEqual(settings.listenRate, 1.5)
        XCTAssertEqual(settings.chatModelId, "openai:gpt-5.6-terra")
        // Present and null clears, even though local had a value.
        XCTAssertNil(settings.chatSpeed)
        XCTAssertEqual(settings.chatVerbosity, "high")
        // Never mentioned, so untouched.
        XCTAssertNil(settings.chatMode)
    }

    func testApplyLeavesMemoryAloneWhenTheDocumentDoesNotMentionIt() {
        // A server that predates the field, or a rollback that never touched
        // it: absent means "not mentioned", not "off".
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: SettingsStore())

        sync.apply(AccountPreferences(webSearchEnabled: true), fromServer: true)

        XCTAssertNil(sync.memoryEnabled)
    }

    func testARecordedMemoryToggleKeepsTheNextHydrateComparable() {
        // The toggle PATCHes /api/memories itself; recording where it landed is
        // what lets a hydrate that flips it back again register as a change.
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: SettingsStore())
        sync.apply(AccountPreferences(memoryEnabled: true), fromServer: true)

        sync.recordMemoryEnabled(false)

        XCTAssertEqual(sync.memoryEnabled, false)
    }

    func testApplyIgnoresATranslationTheClientDoesNotKnow() {
        let settings = SettingsStore()
        settings.translation = .nkjv
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: settings)

        sync.apply(AccountPreferences(translation: "ESV"), fromServer: true)

        XCTAssertEqual(settings.translation, .nkjv)
    }

    func testServerNullNeverClobbersTheAutoEffortSentinelButARollbackDoes() {
        let settings = SettingsStore()
        settings.chatEffort = AskQuestionRequest.autoEffort
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: settings)

        // Auto has no representation on the wire - it is sent as the same null
        // "never chose" is - so a null coming back cannot contradict it.
        sync.apply(AccountPreferences(chat: ChatPreferences(effort: .some(nil))), fromServer: true)
        XCTAssertEqual(settings.chatEffort, AskQuestionRequest.autoEffort)

        // A rollback is this device restoring what it knows was there, so it
        // applies unconditionally.
        sync.apply(AccountPreferences(chat: ChatPreferences(effort: .some(nil))), fromServer: false)
        XCTAssertNil(settings.chatEffort)
    }

    func testApplyingADocumentDoesNotPatchItBack() async {
        let fake = FakeTransport()
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        sync.apply(AccountPreferences(translation: "NKJV"), fromServer: true)
        await Self.settle()

        let patches = await fake.patches
        XCTAssertTrue(patches.isEmpty)
    }

    func testApplyRemoteSuppressesWriteThrough() async {
        // The path the model picker's seeding from /api/ai/models takes: those
        // values came from the account and must not be sent back as choices.
        let fake = FakeTransport()
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        settings.applyRemote { $0.chatEffort = "high" }
        await Self.settle()

        XCTAssertEqual(settings.chatEffort, "high")
        let patches = await fake.patches
        XCTAssertTrue(patches.isEmpty)
        // `SettingsStore.sync` is weak, so the model has to be held here for
        // the write-through path to exist at all.
        XCTAssertNil(sync.errorAlert)
    }

    // MARK: - Write-through

    func testAUserEditPatchesJustThatField() async {
        let fake = FakeTransport()
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        settings.translation = .nkjv

        let arrived = await Self.wait { await fake.patches.count == 1 }
        XCTAssertTrue(arrived)
        let patches = await fake.patches
        XCTAssertEqual(patches.first, PreferencesPatch(translation: "NKJV"))
        XCTAssertNil(sync.errorAlert)
    }

    func testTheAutoEffortSentinelIsPatchedAsNull() async {
        let fake = FakeTransport()
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        settings.chatEffort = AskQuestionRequest.autoEffort

        let arrived = await Self.wait { await fake.patches.count == 1 }
        XCTAssertTrue(arrived)
        let patches = await fake.patches
        // "auto" is not in the server's effort vocabulary; sending it is a 400.
        XCTAssertEqual(patches.first, PreferencesPatch(chat: ChatPreferences(effort: .some(nil))))
        XCTAssertNil(sync.errorAlert)
    }

    func testAFailedPatchRollsTheValueBackAndRaisesAnAlert() async {
        let fake = FakeTransport()
        await fake.failSaves(true)
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        settings.parchment = false

        let rolledBack = await Self.wait { settings.parchment }
        XCTAssertTrue(rolledBack)
        XCTAssertNotNil(sync.errorAlert)
    }

    func testWebSearchTogglesOptimisticallyAndRollsBack() async {
        let fake = FakeTransport(document: AccountPreferences(webSearchEnabled: false))
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        await sync.setWebSearchEnabled(true)
        XCTAssertEqual(sync.webSearchEnabled, true)
        let patches = await fake.patches
        XCTAssertEqual(patches, [PreferencesPatch(webSearchEnabled: true)])

        await fake.failSaves(true)
        await sync.setWebSearchEnabled(false)
        XCTAssertEqual(sync.webSearchEnabled, true)
        XCTAssertNotNil(sync.errorAlert)
    }

    // MARK: - Stale-fetch guard

    func testEditSequenceInvalidatesRequestsIssuedBeforeAnEdit() {
        var sequence = EditSequence()
        let issued = sequence.current
        XCTAssertTrue(sequence.isCurrent(issued))
        sequence.bump()
        XCTAssertFalse(sequence.isCurrent(issued))
        // A request issued after the edit is current again.
        XCTAssertTrue(sequence.isCurrent(sequence.current))
    }

    func testAGetThatLandsAfterAnEditIsDiscarded() async {
        // The document in flight predates the tap, so applying it would undo
        // the user's change on screen a second after they made it.
        let fake = FakeTransport(document: AccountPreferences(translation: "KJV"))
        await fake.holdLoads(true)
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        sync.refresh(force: true)
        let started = await Self.wait { await fake.loadCount == 1 }
        XCTAssertTrue(started)

        settings.translation = .nkjv
        await fake.holdLoads(false)
        await Self.settle()

        XCTAssertEqual(settings.translation, .nkjv)
    }

    func testRefreshIsThrottled() async {
        let fake = FakeTransport()
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: fake, settings: settings)

        sync.refresh(force: true)
        let started = await Self.wait { await fake.loadCount == 1 }
        XCTAssertTrue(started)

        // Foregrounding fires this constantly; only the first one inside the
        // window may reach the network.
        sync.refresh()
        sync.refresh()
        await Self.settle()

        let count = await fake.loadCount
        XCTAssertEqual(count, 1)
    }

    // MARK: - Per-user caches

    func testASecondAccountStartsFromDefaults() {
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: settings)
        var cleared = 0

        sync.start(userID: "user_a") { cleared += 1 }
        settings.applyRemote { $0.translation = .nkjv }

        sync.start(userID: "user_b") { cleared += 1 }
        XCTAssertEqual(cleared, 2)
        XCTAssertEqual(settings.translation, .kjv)
    }

    func testTheSameAccountKeepsItsCaches() {
        let settings = SettingsStore()
        let sync = PreferencesSyncModel(transport: FakeTransport(), settings: settings)
        var cleared = 0

        sync.start(userID: "user_a") { cleared += 1 }
        settings.applyRemote { $0.translation = .nkjv }
        sync.start(userID: "user_a") { cleared += 1 }

        XCTAssertEqual(cleared, 1)
        XCTAssertEqual(settings.translation, .nkjv)
    }

    // MARK: - First-adopt seed

    func testSeedPushesALocalChoiceTheServerHasNoOpinionOn() {
        var local = Self.defaultLocal
        local.translation = "NKJV"
        let patch = PreferencesAdoption.overrides(
            local: local,
            server: AccountPreferences(translation: "KJV", parchment: true, listenRate: 1)
        )
        XCTAssertEqual(patch, PreferencesPatch(translation: "NKJV"))
    }

    func testSeedNeverOverwritesAnEstablishedAccount() {
        // The account chose NKJV elsewhere and this device is on the default.
        // Local is the stale one, so nothing goes up.
        let patch = PreferencesAdoption.overrides(
            local: Self.defaultLocal,
            server: AccountPreferences(translation: "NKJV")
        )
        XCTAssertTrue(patch.isEmpty)
    }

    func testSeedPushesOnlyTheFieldsTheServerStillDefaults() {
        var local = Self.defaultLocal
        local.listenRate = 1.5
        // Local translation is the default while the server has a real choice,
        // so only the listen rate is this device's to give.
        let patch = PreferencesAdoption.overrides(
            local: local,
            server: AccountPreferences(translation: "NKJV", parchment: true, listenRate: 1)
        )
        XCTAssertEqual(patch, PreferencesPatch(listenRate: 1.5))
    }

    func testSeedTreatsAbsentAndNullChatFieldsAsNeverChosen() {
        var local = Self.defaultLocal
        local.modelId = "openai/gpt-5.6-luna"
        local.speed = "fast"

        // `modelId` explicitly null, `speed` absent: both mean "never chose".
        let patch = PreferencesAdoption.overrides(
            local: local,
            server: AccountPreferences(chat: ChatPreferences(modelId: .some(nil)))
        )
        XCTAssertEqual(
            patch,
            PreferencesPatch(
                chat: ChatPreferences(modelId: .some("openai/gpt-5.6-luna"), speed: .some("fast"))
            )
        )
    }

    func testSeedLeavesAChatFieldTheAccountAlreadySet() {
        var local = Self.defaultLocal
        local.mode = "standard"
        let patch = PreferencesAdoption.overrides(
            local: local,
            server: AccountPreferences(chat: ChatPreferences(mode: .some("pro")))
        )
        XCTAssertTrue(patch.isEmpty)
    }

    func testSeedIgnoresTheAutoEffortSentinel() {
        // `syncedSnapshot` maps Auto to nil, and nil is exactly what the column
        // already holds, so there is nothing to hand over.
        let settings = SettingsStore()
        settings.applyRemote { $0.chatEffort = AskQuestionRequest.autoEffort }
        XCTAssertNil(settings.syncedSnapshot.effort)

        let patch = PreferencesAdoption.overrides(
            local: settings.syncedSnapshot,
            server: AccountPreferences()
        )
        XCTAssertTrue(patch.isEmpty)
    }

    func testFirstAdoptSeedsThenHydratesAndOnlyRunsOnce() async {
        // The upgrade case: this Mac chose NKJV before the column existed.
        let fake = FakeTransport(document: AccountPreferences(translation: "KJV", parchment: true, listenRate: 1))
        let settings = SettingsStore()
        settings.applyRemote { $0.translation = .nkjv }
        let sync = PreferencesSyncModel(transport: fake, settings: settings)
        sync.start(userID: "user_a") {}

        sync.refresh(force: true)
        let seeded = await Self.wait { await fake.patches.count == 1 }
        XCTAssertTrue(seeded)
        let patches = await fake.patches
        XCTAssertEqual(patches.first, PreferencesPatch(translation: "NKJV"))
        // The seeded document comes back and lands, so NKJV survives.
        XCTAssertEqual(settings.translation, .nkjv)

        // Second session, same account: the flag is set, so no second seed.
        let second = PreferencesSyncModel(transport: fake, settings: settings)
        second.start(userID: "user_a") {}
        second.refresh(force: true)
        await Self.settle()
        let after = await fake.patches
        XCTAssertEqual(after.count, 1)
    }

    func testAFailedFirstHydrateLeavesTheDeviceUnadopted() async {
        let fake = FakeTransport(document: AccountPreferences(translation: "KJV"))
        await fake.failSaves(true)
        let settings = SettingsStore()
        settings.applyRemote { $0.translation = .nkjv }
        let sync = PreferencesSyncModel(transport: fake, settings: settings)
        sync.start(userID: "user_a") {}

        sync.refresh(force: true)
        let tried = await Self.wait { await fake.patches.count == 1 }
        XCTAssertTrue(tried)
        await Self.settle()

        // Local is untouched and nothing was recorded, so the next launch
        // gets another go rather than losing the choice for good.
        XCTAssertEqual(settings.translation, .nkjv)
        XCTAssertNil(UserDefaults.standard.string(forKey: "settings.preferences.adopted"))
        XCTAssertNil(sync.errorAlert)
    }

    // MARK: - Helpers

    private static func object(encoding value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        // `JSONSerialization` rather than a round-trip through `Decodable`:
        // only it can tell an absent key from a null one.
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// Poll until a condition holds. The setters push their PATCH from a
    /// detached task, so there is nothing to await on directly.
    private static func wait(
        timeout: TimeInterval = 2,
        for condition: () async -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        return await condition()
    }

    /// Let every pending task run when what is being asserted is that nothing
    /// happened.
    private static func settle() async {
        try? await Task.sleep(nanoseconds: 50_000_000)
    }
}

/// Stands in for `APIClient`, and behaves like the route: a PATCH merges into
/// the stored document and answers with the whole thing.
private actor FakeTransport: PreferencesTransport {
    private(set) var patches: [PreferencesPatch] = []
    private(set) var loadCount = 0

    private var document: AccountPreferences
    private var savesFail = false
    private var holdsLoads = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(document: AccountPreferences = AccountPreferences()) {
        self.document = document
    }

    func failSaves(_ value: Bool) { savesFail = value }

    /// Park every load until released, so a test can slip a user edit in
    /// between the request and its response.
    func holdLoads(_ value: Bool) {
        holdsLoads = value
        guard !value else { return }
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume() }
    }

    func loadPreferences() async throws -> AccountPreferences {
        loadCount += 1
        // Snapshot before parking: the response has to be the document as it
        // was when the request went out, which is the whole point of the test.
        let snapshot = document
        if holdsLoads {
            await withCheckedContinuation { waiters.append($0) }
        }
        return snapshot
    }

    func savePreferences(_ patch: PreferencesPatch) async throws -> AccountPreferences {
        patches.append(patch)
        if savesFail { throw APIError(message: "Preferences are unavailable.") }
        if let value = patch.webSearchEnabled { document.webSearchEnabled = value }
        if let value = patch.translation { document.translation = value }
        if let value = patch.parchment { document.parchment = value }
        if let value = patch.listenRate { document.listenRate = value }
        if let chat = patch.chat {
            var merged = document.chat ?? ChatPreferences()
            if let value = chat.modelId { merged.modelId = value }
            if let value = chat.effort { merged.effort = value }
            if let value = chat.speed { merged.speed = value }
            if let value = chat.verbosity { merged.verbosity = value }
            if let value = chat.mode { merged.mode = value }
            document.chat = merged
        }
        return document
    }
}
