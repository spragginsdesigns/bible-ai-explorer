import Foundation
import XCTest

@testable import SureWord

/// The persisted per-account Settings data (PRD B7), test for test the cases
/// of `mobile/src/features/settings/settingsData.test.ts`, plus the cache-owner
/// hygiene `cacheOwner.ts` gives Android: a different account or a sign-out
/// leaves nothing of the previous account behind.
///
/// Runs on the iOS target like `PreferencesSyncTests`; the code under test is
/// all in `Shared/`, so the Mac is covered by the same assertions.
@MainActor
final class SettingsDataTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() async throws {
        suiteName = "settings-data-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private static let providers = AIProvidersResponse(
        serverCredentials: false,
        providers: [
            AIProviderStatus(
                id: "openai",
                label: "OpenAI",
                keyURL: URL(string: "https://example.com"),
                connected: true,
                last4: "abcd",
                validatedAt: nil
            ),
        ]
    )

    private static let church = ChurchResponse.ok(
        church: ChurchProfile(
            placeId: "p1",
            name: "First Church",
            address: "1 Main St",
            phone: nil,
            website: nil,
            mapsUrl: nil,
            photoUrl: nil,
            mission: nil,
            about: nil,
            missionSource: nil,
            updatedAt: "2026-09-11T00:00:00.000Z"
        )
    )

    private struct Offline: Error {}

    /// A loader whose every call answers from the queue given, in order.
    private func loader(
        providers: [Result<AIProvidersResponse, any Error>] = [],
        church: [Result<ChurchResponse, any Error>] = [],
        memories: [Result<SettingsDataStore.MemoryCount, any Error>] = [],
        calls: CallCounter = CallCounter()
    ) -> SettingsDataStore.Loader {
        let providerQueue = Queue(providers)
        let churchQueue = Queue(church)
        let memoryQueue = Queue(memories)
        return SettingsDataStore.Loader(
            providers: { await calls.bump(); return try await providerQueue.next() },
            church: { try await churchQueue.next() },
            memories: { try await memoryQueue.next() }
        )
    }

    private func store(timeout: Duration = .seconds(35)) -> SettingsDataStore {
        SettingsDataStore(defaults: defaults, refreshTimeout: timeout)
    }

    private func persisted() throws -> [String: Any]? {
        guard let data = defaults.data(forKey: SettingsDataStore.storageKey) else { return nil }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // MARK: settingsData.test.ts

    func testHydrateFillsOnlyTheSectionsThatAreStillEmpty() throws {
        let seed = SettingsDataStore(defaults: defaults)
        seed.noteProviders(Self.providers)
        seed.noteChurch(Self.church)
        seed.noteMemoryCount(3)

        // A fresh run: the persisted blob is read once.
        let fresh = store()
        XCTAssertFalse(fresh.hydrated)
        // A count that lands before the disk read must not be overwritten by it.
        fresh.noteMemoryCount(7)
        fresh.hydrate()
        XCTAssertTrue(fresh.hydrated)
        XCTAssertEqual(fresh.providers.data, Self.providers)
        XCTAssertEqual(fresh.church.data, Self.church)
        XCTAssertEqual(fresh.memories.data, .init(count: 7, enabled: nil))
    }

    func testPersistsASuccessfulRefreshAndClearsTheFailedFlag() async throws {
        let store = store()
        try await store.refreshProviders(loader(providers: [.success(Self.providers)]))
        XCTAssertEqual(store.providers, .init(data: Self.providers, loading: false, failed: false))
        let blob = try XCTUnwrap(try persisted())
        XCTAssertNotNil(blob["providers"] as? [String: Any])
    }

    func testKeepsTheCachedDataAndFlagsTheFailureWhenARefreshFails() async throws {
        let store = store()
        let loader = loader(providers: [.success(Self.providers), .failure(Offline())])
        try await store.refreshProviders(loader)
        do {
            try await store.refreshProviders(loader)
            XCTFail("the second refresh should throw")
        } catch {}
        XCTAssertEqual(store.providers, .init(data: Self.providers, loading: false, failed: true))
    }

    func testSharesOneInFlightRequestPerSection() async throws {
        let store = store()
        let gate = Gate<AIProvidersResponse>()
        let calls = CallCounter()
        let loader = SettingsDataStore.Loader(
            providers: { await calls.bump(); return try await gate.wait() },
            church: { throw Offline() },
            memories: { throw Offline() }
        )
        async let first: Void = store.refreshProviders(loader)
        async let second: Void = store.refreshProviders(loader)
        await Self.settle()
        XCTAssertTrue(store.providers.loading)
        await gate.open(Self.providers)
        _ = try await (first, second)
        let count = await calls.value
        XCTAssertEqual(count, 1)
        XCTAssertFalse(store.providers.loading)
        XCTAssertEqual(store.providers.data, Self.providers)
    }

    func testGivesUpOnARequestThatNeverSettlesSoTheNextRefreshCanStart() async throws {
        // A Clerk token step that hangs offline never reaches the fetch timeout.
        let store = store(timeout: .milliseconds(150))
        let calls = CallCounter()
        let eventually = Self.providers
        let hung = SettingsDataStore.Loader(
            providers: {
                await calls.bump()
                try? await Task.sleep(for: .seconds(3600))
                return eventually
            },
            church: { throw Offline() },
            memories: { throw Offline() }
        )
        do {
            try await store.refreshProviders(hung)
            XCTFail("the ceiling should have thrown")
        } catch {
            XCTAssertTrue(error is SettingsDataStore.RefreshTimeout)
        }
        XCTAssertEqual(store.providers, .init(data: nil, loading: false, failed: true))

        try await store.refreshProviders(loader(providers: [.success(Self.providers)], calls: calls))
        let count = await calls.value
        XCTAssertEqual(count, 2)
        XCTAssertEqual(store.providers.data, Self.providers)
    }

    func testDropsAResponseThatLandsAfterTheCachesChangedHands() async throws {
        let store = store()
        let gate = Gate<AIProvidersResponse>()
        let loader = SettingsDataStore.Loader(
            providers: { try await gate.wait() },
            church: { throw Offline() },
            memories: { throw Offline() }
        )
        async let request: Void = store.refreshProviders(loader)
        await Self.settle()
        store.clear()
        await gate.open(Self.providers)
        try await request
        XCTAssertNil(store.providers.data)
        XCTAssertNil(defaults.data(forKey: SettingsDataStore.storageKey))
    }

    func testPrefetchWarmsEverySectionAndNeverThrows() async {
        let store = store()
        await store.prefetch(loader(
            providers: [.success(Self.providers)],
            church: [.failure(Offline())],
            memories: [.success(.init(count: 2, enabled: false))]
        ))
        XCTAssertEqual(store.providers.data, Self.providers)
        XCTAssertEqual(store.church, .init(data: nil, loading: false, failed: true))
        XCTAssertEqual(store.memories.data, .init(count: 2, enabled: false))
    }

    func testTakesAChurchMutationsAnswerWithoutAnotherRequest() {
        let store = store()
        store.noteChurch(Self.church)
        XCTAssertEqual(store.church.data, Self.church)
        store.noteChurch(.ok(church: nil))
        XCTAssertEqual(store.church.data, .ok(church: nil))
    }

    func testKeepsTheMemorySwitchWhenTheMemoriesScreenReportsANewCount() async throws {
        let store = store()
        try await store.refreshMemories(loader(memories: [.success(.init(count: 1, enabled: true))]))
        store.noteMemoryCount(4)
        XCTAssertEqual(store.memories.data, .init(count: 4, enabled: true))
        store.noteMemoryEnabled(false)
        XCTAssertEqual(store.memories.data, .init(count: 4, enabled: false))
    }

    func testClearEmptiesMemoryAndDisk() async throws {
        let store = store()
        try await store.refreshProviders(loader(providers: [.success(Self.providers)]))
        XCTAssertNotNil(defaults.data(forKey: SettingsDataStore.storageKey))
        store.clear()
        XCTAssertNil(store.providers.data)
        XCTAssertTrue(store.hydrated)
        XCTAssertNil(defaults.data(forKey: SettingsDataStore.storageKey))
        // The hydrate after a clear must not resurrect anything.
        store.hydrate()
        XCTAssertNil(store.providers.data)
    }

    // MARK: Wire shapes survive the round trip

    func testPersistedChurchKeepsUnavailableApartFromNoChurch() throws {
        for response in [ChurchResponse.unavailable, .ok(church: nil), Self.church] {
            let data = try JSONEncoder().encode(response)
            XCTAssertEqual(try JSONDecoder().decode(ChurchResponse.self, from: data), response)
        }
        let providers = try JSONEncoder().encode(Self.providers)
        XCTAssertEqual(try JSONDecoder().decode(AIProvidersResponse.self, from: providers), Self.providers)
    }

    // MARK: cacheOwner.ts - per-account hygiene

    /// The real path: `PreferencesSyncModel.start` with a different account
    /// clears the shared store, and so does sign-out.
    func testADifferentAccountAndSignOutBothClearTheSharedStore() {
        let ownerKey = "settings.account.userId"
        let savedOwner = UserDefaults.standard.string(forKey: ownerKey)
        defer { UserDefaults.standard.set(savedOwner, forKey: ownerKey) }

        let settings = SettingsStore()
        let shared = SettingsDataStore.shared

        UserDefaults.standard.set("user_a", forKey: ownerKey)
        shared.noteChurch(Self.church)
        PreferencesSyncModel(transport: NoTransport(), settings: settings).start(userID: "user_a") {}
        XCTAssertEqual(shared.church.data, Self.church, "the same account keeps its cache")

        PreferencesSyncModel(transport: NoTransport(), settings: settings).start(userID: "user_b") {}
        XCTAssertNil(shared.church.data, "another account must not see user_a's church")

        shared.noteMemoryCount(5)
        PreferencesSyncModel.clearAccountCaches(settings: settings, highlights: nil)
        XCTAssertNil(shared.memories.data)
        XCTAssertNil(UserDefaults.standard.data(forKey: SettingsDataStore.storageKey))
    }

    // MARK: Helpers

    /// Let queued main-actor work (the refresh task's first hop) run.
    private static func settle() async {
        for _ in 0..<5 { await Task.yield() }
    }
}

private struct NoTransport: PreferencesTransport {
    struct Unused: Error {}
    func loadPreferences() async throws -> AccountPreferences { throw Unused() }
    func savePreferences(_ patch: PreferencesPatch) async throws -> AccountPreferences { throw Unused() }
}

private actor CallCounter {
    private(set) var value = 0
    func bump() { value += 1 }
}

/// A queue of canned results, one per call.
private actor Queue<Value: Sendable> {
    private var results: [Result<Value, any Error>]
    init(_ results: [Result<Value, any Error>]) { self.results = results }
    func next() throws -> Value {
        guard !results.isEmpty else { throw CancellationError() }
        return try results.removeFirst().get()
    }
}

/// A result that is held until the test opens it.
private actor Gate<Value: Sendable> {
    private var value: Value?
    private var waiters: [CheckedContinuation<Value, Never>] = []

    func wait() async throws -> Value {
        if let value { return value }
        return await withCheckedContinuation { waiters.append($0) }
    }

    func open(_ value: Value) {
        self.value = value
        for waiter in waiters { waiter.resume(returning: value) }
        waiters.removeAll()
    }
}
