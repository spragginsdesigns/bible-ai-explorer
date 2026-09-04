import Foundation

// MARK: - Wire types

/// The chat block of the account preferences document, on both the way in and
/// the way out.
///
/// Every field is **three-state**, and the distinction is the whole point:
///
/// - `.none` (a bare `nil`) - the key is absent. On a GET that means "the
///   server said nothing about it, keep what is local"; on a PATCH it means
///   "don't touch this column".
/// - `.some(nil)` - JSON `null`. On a GET that means "never chosen" and clears
///   the local value; on a PATCH it clears the column.
/// - `.some(value)` - a value.
///
/// Swift has one `nil` for both of the first two, which is exactly the bug this
/// shape exists to prevent: encoding an absent key as `null` would clear a
/// column the user never touched.
struct ChatPreferences: Sendable, Equatable {
    var modelId: String??
    var effort: String??
    var speed: String??
    var verbosity: String??
    var mode: String??

    init(
        modelId: String?? = nil,
        effort: String?? = nil,
        speed: String?? = nil,
        verbosity: String?? = nil,
        mode: String?? = nil
    ) {
        self.modelId = modelId
        self.effort = effort
        self.speed = speed
        self.verbosity = verbosity
        self.mode = mode
    }

    var isEmpty: Bool {
        modelId == nil && effort == nil && speed == nil && verbosity == nil && mode == nil
    }
}

extension ChatPreferences: Codable {
    private enum CodingKeys: String, CodingKey {
        case modelId, effort, speed, verbosity, mode
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func read(_ key: CodingKeys) throws -> String?? {
            // `contains` before `decodeIfPresent` is what separates an absent
            // key from an explicit null - `decodeIfPresent` collapses both to
            // nil on its own.
            guard container.contains(key) else { return nil }
            let value = try container.decodeIfPresent(String.self, forKey: key)
            return .some(value)
        }
        modelId = try read(.modelId)
        effort = try read(.effort)
        speed = try read(.speed)
        verbosity = try read(.verbosity)
        mode = try read(.mode)
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        func write(_ field: String??, _ key: CodingKeys) throws {
            // Written by hand rather than left to the synthesized encoder: the
            // synthesized one calls `encodeIfPresent`, and relying on it to
            // turn `.some(nil)` into a JSON null is a detail of the standard
            // library nobody should have to remember while reading this.
            guard let value = field else { return }
            if let value {
                try container.encode(value, forKey: key)
            } else {
                try container.encodeNil(forKey: key)
            }
        }
        try write(modelId, .modelId)
        try write(effort, .effort)
        try write(speed, .speed)
        try write(verbosity, .verbosity)
        try write(mode, .mode)
    }
}

/// The document `GET /api/preferences` returns, and the shape a rollback is
/// expressed in.
///
/// Every field is optional so a server that predates one of them - the deploy
/// window between this build and the API - leaves the local value alone instead
/// of failing the whole decode.
struct AccountPreferences: Codable, Sendable, Equatable {
    /// Read-only, as it is on every client: entitlements are the server's call.
    var plan: String?
    var webSearchEnabled: Bool?
    var memoryEnabled: Bool?
    var translation: String?
    var parchment: Bool?
    var listenRate: Double?
    var chat: ChatPreferences?

    init(
        plan: String? = nil,
        webSearchEnabled: Bool? = nil,
        memoryEnabled: Bool? = nil,
        translation: String? = nil,
        parchment: Bool? = nil,
        listenRate: Double? = nil,
        chat: ChatPreferences? = nil
    ) {
        self.plan = plan
        self.webSearchEnabled = webSearchEnabled
        self.memoryEnabled = memoryEnabled
        self.translation = translation
        self.parchment = parchment
        self.listenRate = listenRate
        self.chat = chat
    }
}

/// The body of `PATCH /api/preferences` - any subset of the synced fields.
/// Absent keys are omitted entirely; the server rejects an unknown one with a
/// 400, so nothing but these may appear here.
struct PreferencesPatch: Encodable, Sendable, Equatable {
    var webSearchEnabled: Bool?
    var memoryEnabled: Bool?
    var translation: String?
    var parchment: Bool?
    var listenRate: Double?
    var chat: ChatPreferences?

    init(
        webSearchEnabled: Bool? = nil,
        memoryEnabled: Bool? = nil,
        translation: String? = nil,
        parchment: Bool? = nil,
        listenRate: Double? = nil,
        chat: ChatPreferences? = nil
    ) {
        self.webSearchEnabled = webSearchEnabled
        self.memoryEnabled = memoryEnabled
        self.translation = translation
        self.parchment = parchment
        self.listenRate = listenRate
        self.chat = chat
    }

    private enum CodingKeys: String, CodingKey {
        case webSearchEnabled, memoryEnabled, translation, parchment, listenRate, chat
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(webSearchEnabled, forKey: .webSearchEnabled)
        try container.encodeIfPresent(memoryEnabled, forKey: .memoryEnabled)
        try container.encodeIfPresent(translation, forKey: .translation)
        try container.encodeIfPresent(parchment, forKey: .parchment)
        try container.encodeIfPresent(listenRate, forKey: .listenRate)
        // An empty chat block would be a body with no recognised keys, which
        // the server answers with a 400.
        if let chat, !chat.isEmpty {
            try container.encode(chat, forKey: .chat)
        }
    }

    var isEmpty: Bool {
        webSearchEnabled == nil
            && memoryEnabled == nil
            && translation == nil
            && parchment == nil
            && listenRate == nil
            && (chat?.isEmpty ?? true)
    }
}

// MARK: - First-adopt seed

/// The synced fields as this device currently holds them, flattened so the
/// adoption rule can be a pure function over local + server.
struct LocalPreferences: Sendable, Equatable {
    var translation: String
    var parchment: Bool
    var listenRate: Double
    var modelId: String?
    /// Already normalised: the Auto sentinel arrives here as nil, because
    /// "no reasoning override" is exactly what a null column already means and
    /// seeding it would say nothing.
    var effort: String?
    var speed: String?
    var verbosity: String?
    var mode: String?
}

/// The one-time hand-off from device-local settings to the account.
///
/// Sync shipped after these preferences already existed on device, so an
/// existing user has real choices - NKJV, parchment off, a model - that the
/// server has never heard of. A plain hydrate would answer with the fresh
/// column defaults and silently reset them.
///
/// The rule is deliberately conservative: a local value is pushed **only where
/// the server is still at the column default**. Anything the account has
/// actually chosen wins, because an unadopted device can just as easily be
/// holding the last person's leftovers on a shared machine.
enum PreferencesAdoption {
    static let defaultTranslation = "KJV"
    static let defaultParchment = true
    static let defaultListenRate: Double = 1

    /// Which locally non-default fields the server has no opinion on yet.
    /// Empty means there is nothing to seed and the GET document stands.
    static func overrides(local: LocalPreferences, server: AccountPreferences) -> PreferencesPatch {
        var patch = PreferencesPatch()

        if local.translation != defaultTranslation,
           (server.translation ?? defaultTranslation) == defaultTranslation {
            patch.translation = local.translation
        }
        if local.parchment != defaultParchment,
           (server.parchment ?? defaultParchment) == defaultParchment {
            patch.parchment = local.parchment
        }
        if local.listenRate != defaultListenRate,
           (server.listenRate ?? defaultListenRate) == defaultListenRate {
            patch.listenRate = local.listenRate
        }

        // A chat column's default is null, and both "absent" and "explicit
        // null" mean the account never chose - `??` flattens them to the same
        // thing, which is the one place that collapse is correct.
        var chat = ChatPreferences()
        let serverChat = server.chat ?? ChatPreferences()
        func seed(_ localValue: String?, _ serverValue: String??) -> String?? {
            let established: String? = serverValue.flatMap { $0 }
            guard let localValue, established == nil else { return nil }
            return .some(localValue)
        }
        chat.modelId = seed(local.modelId, serverChat.modelId)
        chat.effort = seed(local.effort, serverChat.effort)
        chat.speed = seed(local.speed, serverChat.speed)
        chat.verbosity = seed(local.verbosity, serverChat.verbosity)
        chat.mode = seed(local.mode, serverChat.mode)
        if !chat.isEmpty { patch.chat = chat }

        return patch
    }
}

// MARK: - Transport

/// The two calls the sync model makes, behind a protocol so the tests can drive
/// it without a network or a Clerk session.
protocol PreferencesTransport: Sendable {
    func loadPreferences() async throws -> AccountPreferences
    func savePreferences(_ patch: PreferencesPatch) async throws -> AccountPreferences
}

extension APIClient: PreferencesTransport {
    func loadPreferences() async throws -> AccountPreferences {
        try await json("/api/preferences")
    }

    func savePreferences(_ patch: PreferencesPatch) async throws -> AccountPreferences {
        try await json("/api/preferences", method: "PATCH", body: patch, as: AccountPreferences.self)
    }
}

// MARK: - Stale-fetch guard

/// The monotonic edit counter behind the stale-fetch guard.
///
/// A GET issued before a user edit must never be applied after it: the document
/// in flight predates the tap and would silently undo it on screen. Every edit
/// bumps this, a request records the value it was issued at, and a response is
/// applied only while that value is still current.
struct EditSequence: Sendable, Equatable {
    private(set) var value: UInt64 = 0

    /// Records an edit and returns the value a request issued *after* it should
    /// carry.
    @discardableResult
    mutating func bump() -> UInt64 {
        value &+= 1
        return value
    }

    /// The value a request should carry when nothing has been edited since.
    var current: UInt64 { value }

    func isCurrent(_ issued: UInt64) -> Bool { issued == value }
}

// MARK: - Sync model

/// Hydrates every synced preference from the server and writes each change
/// straight back - the Apple half of the account-preferences contract shared
/// with web and Android.
///
/// The server row is the source of truth; `SettingsStore` is a first-paint
/// cache of it. That is why hydration overwrites local values even when local
/// has one, and why every setter in `SettingsStore` pushes through here.
@MainActor
@Observable
final class PreferencesSyncModel {
    struct ErrorAlert: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let message: String
    }

    /// At most one hydrate per this many seconds. Foregrounding the app fires
    /// a refresh, and on macOS that happens every time the user clicks back
    /// into the window.
    static let refreshInterval: TimeInterval = 15

    /// Which account the local caches belong to. A different id means the
    /// caches are someone else's and must be discarded before hydrating.
    private static let userIDKey = "settings.account.userId"

    /// Which account this device has already handed its pre-sync settings to.
    /// See `PreferencesAdoption`.
    private static let adoptedKey = "settings.preferences.adopted"

    /// `nil` until the first successful load; the Settings toggle stays
    /// disabled while unknown rather than showing a guess the server never
    /// agreed to - the same rule `MemoriesModel.isEnabled` follows.
    private(set) var webSearchEnabled: Bool?
    private(set) var isWebSearchPending = false

    var errorAlert: ErrorAlert?

    /// True while a sheet that presents this alert itself is up. An alert
    /// attached to the view *underneath* a presented sheet never appears, so
    /// the shell stands down while the sheet owns it - the same rule
    /// `memoryErrorAlert(_:isActive:)` follows for the Memories route.
    var isAlertOwnedBySheet = false

    @ObservationIgnored private let transport: any PreferencesTransport
    @ObservationIgnored private let settings: SettingsStore
    @ObservationIgnored private var userID: String?
    @ObservationIgnored private var editSeq = EditSequence()
    @ObservationIgnored private var lastRefreshStartedAt: Date?
    @ObservationIgnored private var refreshTask: Task<Void, Never>?

    init(transport: any PreferencesTransport, settings: SettingsStore) {
        self.transport = transport
        self.settings = settings
        settings.sync = self
    }

    // No `deinit` teardown: the refresh task holds `self` weakly, so a session
    // that ends mid-fetch simply lands on a nil and does nothing.

    // MARK: Session start

    /// Called once per signed-in session, from `AppModel.init`. Discards the
    /// previous account's local caches when the signed-in user changed.
    ///
    /// Deliberately does **not** fetch: the shells hydrate from their own
    /// `.task`, so building an `AppModel` stays free of network work - as every
    /// other model it owns already is. What has to happen here is the clearing,
    /// before the notes and highlights stores hydrate themselves lazily.
    ///
    /// `clearCaches` is passed in rather than reached for directly so this file
    /// stays about preferences: the notes and highlights caches belong to
    /// `AppModel`, which owns the live stores.
    func start(userID: String?, clearCaches: () -> Void) {
        self.userID = userID
        let previous = UserDefaults.standard.string(forKey: Self.userIDKey)
        defer { UserDefaults.standard.set(userID, forKey: Self.userIDKey) }
        guard previous != userID else { return }
        // The notes and highlights caches go whenever the recorded id does not
        // match, the first run of this build included: they were never keyed by
        // user before it, so they may be the last account's.
        clearCaches()
        // The synced settings are reset only for a *known different* account.
        // An absent id means this build has simply never recorded one, and the
        // local values may be this user's own pre-sync choices - the
        // first-adopt seed decides their fate, and it needs them intact.
        if previous != nil { settings.resetSyncedPreferences() }
    }

    /// Every persisted per-account cache, gone. Used on sign-out; the caller
    /// supplies the live stores it still holds.
    static func clearAccountCaches(settings: SettingsStore, highlights: HighlightsStore?) {
        settings.resetSyncedPreferences()
        NotesStore.shared.clearCache()
        if let highlights {
            highlights.clearCache()
        } else if let url = HighlightsStore.defaultCacheURL {
            // Sign-out drops the `AppModel` that owned the store, so on that
            // path only the file is left to remove.
            try? FileManager.default.removeItem(at: url)
        }
        UserDefaults.standard.removeObject(forKey: Self.userIDKey)
        // The adoption flag goes with them. Signing back in re-runs the seed
        // against settings that are now defaults, so it finds nothing to push
        // and simply hydrates - and a *different* account on this machine gets
        // the same protection a fresh device would.
        UserDefaults.standard.removeObject(forKey: Self.adoptedKey)
    }

    // MARK: Hydrate

    /// Pull the whole document and apply it: on sign-in, and on every return to
    /// the foreground. Throttled, because "became active" fires far more often
    /// than preferences change.
    func refresh(force: Bool = false) {
        if !force,
           let lastRefreshStartedAt,
           Date().timeIntervalSince(lastRefreshStartedAt) < Self.refreshInterval {
            return
        }
        lastRefreshStartedAt = Date()
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in await self?.load() }
    }

    private func load() async {
        let issued = editSeq.current
        do {
            let document = try await transport.loadPreferences()
            guard !Task.isCancelled, editSeq.isCurrent(issued) else { return }
            let seeded = try await adopt(document)
            // Checked again: the seed is a second round trip, and a tap during
            // it must still win over everything this function is holding.
            guard !Task.isCancelled, editSeq.isCurrent(issued) else { return }
            apply(seeded ?? document, fromServer: true)
        } catch {
            // Deliberately silent, including the 401 an expired session gives:
            // the cached values are still the last thing the server agreed to,
            // and nothing on screen was asked for. The adopted flag is left
            // unset too, so a failed first hydrate simply tries again later.
        }
    }

    /// The one-time seed, run in place of the first hydrate. Returns the
    /// document to apply when it pushed something, and nil when the GET
    /// document stands as-is.
    ///
    /// A throw here propagates to `load`'s catch, which leaves the flag unset -
    /// a half-adopted device must get another go, not be recorded as done.
    private func adopt(_ document: AccountPreferences) async throws -> AccountPreferences? {
        guard UserDefaults.standard.string(forKey: Self.adoptedKey) != userID else { return nil }
        let patch = PreferencesAdoption.overrides(local: settings.syncedSnapshot, server: document)
        guard !patch.isEmpty else {
            UserDefaults.standard.set(userID, forKey: Self.adoptedKey)
            return nil
        }
        let seeded = try await transport.savePreferences(patch)
        UserDefaults.standard.set(userID, forKey: Self.adoptedKey)
        return seeded
    }

    // MARK: Write-through

    /// Fire-and-forget PATCH for the `SettingsStore` setters, which have no
    /// async context of their own.
    ///
    /// `rollback` is a document, not a closure: it is applied through the same
    /// path as a server response, so there is exactly one place that knows how
    /// a document lands in `SettingsStore`.
    func push(_ patch: PreferencesPatch, rollingBackTo rollback: AccountPreferences) {
        guard !patch.isEmpty else { return }
        // Bumped here, not inside the task: the edit happened *now*, and a GET
        // already in flight has to be discarded even if the task that sends the
        // PATCH is not scheduled for another hop.
        let issued = editSeq.bump()
        Task { [weak self] in await self?.send(patch, rollingBackTo: rollback, issued: issued) }
    }

    func send(_ patch: PreferencesPatch, rollingBackTo rollback: AccountPreferences) async {
        guard !patch.isEmpty else { return }
        await send(patch, rollingBackTo: rollback, issued: editSeq.bump())
    }

    private func send(
        _ patch: PreferencesPatch,
        rollingBackTo rollback: AccountPreferences,
        issued: UInt64
    ) async {
        do {
            let document = try await transport.savePreferences(patch)
            // A newer edit has already been made, so this response is one
            // version behind the screen. The newer PATCH carries the truth.
            guard editSeq.isCurrent(issued) else { return }
            apply(document, fromServer: true)
        } catch {
            // Rolled back unconditionally: the rollback names only the fields
            // this patch touched, so a *different* field edited meanwhile is
            // untouched. The one case it can lose is the same field edited
            // twice while the first PATCH was failing, which is worth the
            // simplicity of not tracking a sequence per field.
            apply(rollback, fromServer: false)
            errorAlert = ErrorAlert(
                title: "Could not save that setting",
                message: Self.message(error, fallback: "Your setting was not changed. Try again.")
            )
        }
    }

    // MARK: Web Search

    /// Optimistic, like the Memory toggle: the switch moves immediately and
    /// rolls back with an alert if the PATCH fails.
    func setWebSearchEnabled(_ enabled: Bool) async {
        guard !isWebSearchPending else { return }
        // Never nil in practice: the row is disabled until the first load has
        // said what the value is, which is what stops the switch showing a
        // guess the server never agreed to.
        let previous = webSearchEnabled
        webSearchEnabled = enabled
        isWebSearchPending = true
        defer { isWebSearchPending = false }
        await send(
            PreferencesPatch(webSearchEnabled: enabled),
            rollingBackTo: AccountPreferences(webSearchEnabled: previous)
        )
    }

    // MARK: Applying a document

    /// Land a document - a server response, or a rollback to the values a
    /// failed PATCH left behind. Absent fields are left alone; present ones
    /// replace local, which is the contract's "the server document REPLACES the
    /// local cache".
    ///
    /// `fromServer` gates one exception, spelled out on `chatEffort` below.
    func apply(_ document: AccountPreferences, fromServer: Bool) {
        if let webSearchEnabled = document.webSearchEnabled {
            self.webSearchEnabled = webSearchEnabled
        }
        settings.applyRemote { settings in
            if let translation = document.translation,
               let value = TranslationID(rawValue: translation) {
                settings.translation = value
            }
            if let parchment = document.parchment {
                settings.parchment = parchment
            }
            if let listenRate = document.listenRate {
                settings.listenRate = listenRate
            }
            guard let chat = document.chat else { return }
            if let modelId = chat.modelId {
                settings.chatModelId = modelId
            }
            if let effort = chat.effort {
                // The Auto chip has no representation on the wire: it is sent
                // as a null, and so is "never chose". A null coming back can
                // therefore never contradict a local `auto`, and clobbering it
                // would make tapping Auto snap straight back to the account
                // default. A rollback is different - it is restoring a value
                // this device knows was there - so it applies unconditionally.
                let keepsAuto =
                    fromServer && effort == nil && settings.chatEffort == AskQuestionRequest.autoEffort
                if !keepsAuto { settings.chatEffort = effort }
            }
            if let speed = chat.speed {
                settings.chatSpeed = speed
            }
            if let verbosity = chat.verbosity {
                settings.chatVerbosity = verbosity
            }
            if let mode = chat.mode {
                settings.chatMode = mode
            }
        }
    }

    // MARK: Helpers

    /// Surfaces the server's own `{ "error": … }` text when there is one, the
    /// way `MemoriesModel` does.
    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? fallback : described
    }
}
