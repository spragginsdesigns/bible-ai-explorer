import Foundation

/// The Settings data that used to load on every open: My church and the
/// saved-memory count (the AI Providers section went with bring-your-own-key
/// on 2026-10-25). The Apple port of
/// `mobile/src/features/settings/settingsData.ts` (Android 1.54.0, PRD B7).
///
/// Each section used to sit on a spinner and then grow to its real height when
/// its request landed. This store fixes that at the source:
///
/// - the last response for each section is persisted, so Settings paints its
///   real content on the first frame of every later launch, offline included;
/// - all three are prefetched at sign-in, so even the first open usually finds
///   them here;
/// - sections revalidate in place (stale-while-revalidate) and never fall back
///   to a spinner once they have data.
///
/// Account data, so it lives and dies with the other per-account caches:
/// `PreferencesSyncModel.start` clears it when a different account signs in,
/// and `PreferencesSyncModel.clearAccountCaches` clears it on sign-out.
@MainActor
@Observable
final class SettingsDataStore {
    /// One row of the store: the last good answer plus the state of its refresh.
    struct Slice<Value: Equatable>: Equatable {
        var data: Value?
        /// A refresh is in flight.
        var loading = false
        /// The last refresh failed. Only meaningful to the UI while `data` is nil.
        var failed = false
    }

    /// `count` is the number of saved memories. `enabled` is the account's
    /// memory switch as `/api/memories` last reported it, so a launch whose
    /// preferences hydrate failed still paints the switch; absent when the
    /// count was set from the Memories screen alone.
    struct MemoryCount: Codable, Equatable, Sendable {
        var count: Int
        var enabled: Bool?
    }

    /// The network half, injectable so the tests can drive every timing.
    struct Loader: Sendable {
        var church: @Sendable () async throws -> ChurchResponse
        var memories: @Sendable () async throws -> MemoryCount

        static func live(_ api: APIClient) -> Loader {
            Loader(
                church: { try await api.fetchChurch() },
                memories: {
                    let response = try await api.fetchMemories()
                    return MemoryCount(count: response.memories.count, enabled: response.enabled)
                }
            )
        }
    }

    struct RefreshTimeout: LocalizedError {
        var errorDescription: String? { "Settings could not be refreshed. Check your connection." }
    }

    static let shared = SettingsDataStore()

    /// Same name and shape as Android's AsyncStorage key, versioned the same way.
    static let storageKey = "sureword.settings-data.v1"

    /// Hard ceiling on a refresh. The API layer times out the fetch itself, but
    /// the Clerk token step before it has no bound, and Android saw it hang for
    /// good after an offline launch. Without this, one hung request would hold
    /// the section's in-flight slot for the rest of the session and every later
    /// refresh would silently join it. A little above the API's own 30s so a
    /// real fetch timeout still surfaces with its own message.
    static let defaultRefreshTimeout: Duration = .seconds(35)

    private(set) var church = Slice<ChurchResponse>()
    private(set) var memories = Slice<MemoryCount>()
    /// True once the persisted cache has been read (or found absent).
    private(set) var hydrated = false

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let refreshTimeout: Duration
    /// Bumped by every clear. A request or a cache read issued before a
    /// sign-out is still in flight after it, and would otherwise resolve
    /// straight into the store and hand the next account the previous
    /// account's church.
    @ObservationIgnored private(set) var generation = 0
    /// One request per section at a time; a second caller joins the first.
    @ObservationIgnored private var inflight: [Section: (id: UUID, task: Task<Void, any Error>)] = [:]

    private enum Section: Hashable { case church, memories }

    /// A blob written before 2026-10-25 also holds a `providers` key; decoding
    /// ignores it and the next write drops it.
    private struct Persisted: Codable {
        var church: ChurchResponse?
        var memories: MemoryCount?
    }

    init(defaults: UserDefaults = .standard, refreshTimeout: Duration = SettingsDataStore.defaultRefreshTimeout) {
        self.defaults = defaults
        self.refreshTimeout = refreshTimeout
    }

    // MARK: Hydrate and clear

    /// Read the persisted cache once per run. Only fills sections that are
    /// still empty, so a prefetch that beat it here is not overwritten with
    /// older data. Synchronous because `UserDefaults` is.
    func hydrate() {
        guard !hydrated else { return }
        defer { hydrated = true }
        guard let raw = defaults.data(forKey: Self.storageKey),
              let parsed = try? JSONDecoder().decode(Persisted.self, from: raw)
        else { return }
        if church.data == nil, let value = parsed.church { church.data = value }
        if memories.data == nil, let value = parsed.memories { memories.data = value }
    }

    /// Drop everything, in memory and on disk. Called when the signed-in
    /// account is not the one this cache was written for, and on sign-out. The
    /// store is left marked hydrated so the sections go straight to a server
    /// load instead of re-reading the key being deleted.
    func clear() {
        generation += 1
        for entry in inflight.values { entry.task.cancel() }
        inflight.removeAll()
        church = Slice()
        memories = Slice()
        hydrated = true
        defaults.removeObject(forKey: Self.storageKey)
    }

    private func persist() {
        // A write that beats the first read must not replace the sections it
        // did not touch with nothing: read them in first (only empty ones fill).
        hydrate()
        let blob = Persisted(church: church.data, memories: memories.data)
        guard let data = try? JSONEncoder().encode(blob) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    // MARK: Refresh

    /// Throws on failure so a section can show its Retry row; the cached data
    /// stays in place either way.
    func refreshChurch(_ loader: Loader) async throws {
        try await refresh(.church, \.church, load: loader.church)
    }

    func refreshMemories(_ loader: Loader) async throws {
        try await refresh(.memories, \.memories, load: loader.memories)
    }

    /// Warm every section. Called at sign-in, right after the caches are
    /// claimed for the account, and every time the Settings hub appears.
    /// Never throws: a section that fails keeps whatever it had and reports
    /// through its own `failed` flag.
    func prefetch(_ loader: Loader) async {
        hydrate()
        async let church: Void? = try? refreshChurch(loader)
        async let memories: Void? = try? refreshMemories(loader)
        _ = await (church, memories)
    }

    private func refresh<Value: Equatable & Sendable>(
        _ section: Section,
        _ slice: ReferenceWritableKeyPath<SettingsDataStore, Slice<Value>>,
        load: @escaping @Sendable () async throws -> Value
    ) async throws {
        if let existing = inflight[section] {
            return try await existing.task.value
        }
        let startedAt = generation
        let id = UUID()
        let timeout = refreshTimeout
        // Key paths are not Sendable; this one only ever runs on the main actor.
        nonisolated(unsafe) let slice = slice
        self[keyPath: slice].loading = true
        let task = Task { [weak self] in
            do {
                let value = try await Self.withCeiling(timeout, load)
                guard let self, self.generation == startedAt else { return }
                self[keyPath: slice] = Slice(data: value, loading: false, failed: false)
                self.persist()
                self.finish(section, id)
            } catch {
                guard let self, self.generation == startedAt else { return }
                self[keyPath: slice].loading = false
                self[keyPath: slice].failed = true
                self.finish(section, id)
                throw error
            }
        }
        inflight[section] = (id, task)
        try await task.value
    }

    private func finish(_ section: Section, _ id: UUID) {
        if inflight[section]?.id == id { inflight[section] = nil }
    }

    /// Run `operation`, giving up after `limit`. Unstructured on purpose: a task
    /// group waits for every child, so a hung Clerk token step that ignores
    /// cancellation would hold the group, and the ceiling, forever. A load that
    /// outlives the ceiling is simply dropped when it settles.
    nonisolated static func withCeiling<Value: Sendable>(
        _ limit: Duration,
        _ operation: @escaping @Sendable () async throws -> Value
    ) async throws -> Value {
        let gate = ResumeOnce<Value>()
        return try await withCheckedThrowingContinuation { continuation in
            gate.install(continuation)
            let work = Task {
                do { gate.resume(.success(try await operation())) } catch { gate.resume(.failure(error)) }
            }
            Task {
                try? await Task.sleep(for: limit)
                if gate.resume(.failure(RefreshTimeout())) { work.cancel() }
            }
        }
    }

    // MARK: Writes from the pages

    /// A church save or remove answers with the new profile, so the store takes
    /// it straight from the mutation instead of paying for another GET.
    func noteChurch(_ response: ChurchResponse) {
        church = Slice(data: response, loading: church.loading, failed: false)
        persist()
    }

    /// The Memories screen knows the exact count after every add, delete and clear.
    func noteMemoryCount(_ count: Int) {
        guard memories.data?.count != count else { return }
        memories.data = MemoryCount(count: count, enabled: memories.data?.enabled)
        memories.failed = false
        persist()
    }

    /// The Settings switch, so the fallback never disagrees with a tap.
    func noteMemoryEnabled(_ enabled: Bool) {
        guard var current = memories.data, current.enabled != enabled else { return }
        current.enabled = enabled
        memories.data = current
        persist()
    }
}

/// Resumes a continuation exactly once, whichever side gets there first.
private final class ResumeOnce<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, any Error>?
    private var result: Result<Value, any Error>?

    func install(_ continuation: CheckedContinuation<Value, any Error>) {
        lock.lock()
        defer { lock.unlock() }
        if let result {
            continuation.resume(with: result)
        } else {
            self.continuation = continuation
        }
    }

    /// Returns true when this call is the one that settled it.
    @discardableResult
    func resume(_ value: Result<Value, any Error>) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard result == nil else { return false }
        result = value
        continuation?.resume(with: value)
        continuation = nil
        return true
    }
}
