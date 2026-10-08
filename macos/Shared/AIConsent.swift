import Foundation

// MARK: - Copy

/// The one-time AI disclosure and consent sheet ("How SureWord answers you"),
/// PRD A4 and `docs/ios/ai-consent.md`.
///
/// Mirrored **by hand** from `src/lib/ai-consent.ts`, the single source of the
/// text; `tests/ai-consent.test.mjs` fails if this file drifts from it in text
/// or version. Change the copy there first, then here, never only here.
enum AIConsent {
    /// The copy version this build shows. The server refuses agreement to any
    /// other version, so a stale build can never record consent to text it did
    /// not display.
    static let version = 2

    static let title = "How SureWord answers you"

    static let body = "SureWord's answers are written by AI. To answer you, SureWord sends your question, the conversation, your attachments, and the study context you have shared (About me, your testimony, memories, notes, highlights and reading) to OpenAI, or through OpenRouter to the provider of the selected model, or to the provider of your own API key when you choose one of its models. OpenAI also transcribes voice messages. Web searches go to Tavily, and spoken devotionals are voiced by ElevenLabs. They use it only to answer you; it is never sold or used for ads. The AI can be wrong, so search the Scriptures to see whether these things are so."

    static let privacyLabel = "Privacy Policy"

    static let privacyURL = "https://sureword.app/privacy"

    static let agree = "Agree and continue"

    static let decline = "Not now"

    /// Settings → AI row title.
    static let settingsTitle = "AI data sharing"

    /// Settings → AI action that clears consent, after a confirm dialog.
    static let withdraw = "Withdraw"

    /// The Settings row's value while there is no current consent.
    static let notAllowedLabel = "Not allowed yet"

    /// Shown in place of an explanation or word study that would have started
    /// on its own (selecting a verse, opening the Words tab) while AI data
    /// sharing is not allowed. The section's own retry button is the tap that
    /// may raise the sheet.
    static let declinedNotice = "Written by AI, which needs your permission first. Try again to choose."

    /// True when the sheet must be shown before an AI action: no consent on
    /// record, or consent to a version other than the one the server requires.
    /// Same rule as `aiConsentNeeded` on the web.
    static func needed(_ consent: AIConsentRecord?, required: Int = version) -> Bool {
        consent?.version != required
    }

    /// "Allowed on October 7, 2026" for the Settings row; nil when not allowed
    /// or when the stamp cannot be read. Same output as `aiConsentStatusLabel`.
    static func statusLabel(
        _ consent: AIConsentRecord?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String? {
        guard let consent, let date = parseTimestamp(consent.acceptedAt) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var style = Date.FormatStyle(date: .long, time: .omitted)
        style.locale = locale
        style.calendar = calendar
        style.timeZone = timeZone
        return "Allowed on \(date.formatted(style))"
    }

    /// The server stamps with `Date.toISOString()` (fractional seconds); a
    /// stamp without them is accepted too.
    static func parseTimestamp(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }
}

// MARK: - Wire types

/// `aiConsent` in the preferences document: the copy version the person agreed
/// to and when the server recorded it.
struct AIConsentRecord: Codable, Sendable, Equatable {
    var version: Int
    /// ISO 8601, stamped by the server. The client never sends a time.
    var acceptedAt: String
}

/// The `PATCH /api/preferences` body for consent: `{ "aiConsent": { "version": 1 } }`
/// to agree, `{ "aiConsent": null }` to withdraw. The null is written
/// explicitly - an absent key would mean "leave consent alone" and the
/// withdrawal would silently do nothing.
struct AIConsentPatch: Encodable, Sendable, Equatable {
    /// nil withdraws.
    let version: Int?

    private enum CodingKeys: String, CodingKey { case aiConsent }
    private enum ConsentKeys: String, CodingKey { case version }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let version {
            var consent = container.nestedContainer(keyedBy: ConsentKeys.self, forKey: .aiConsent)
            try consent.encode(version, forKey: .version)
        } else {
            try container.encodeNil(forKey: .aiConsent)
        }
    }
}

/// The two calls the consent store makes, behind a protocol so tests can drive
/// it without a network. `loadPreferences` is the same GET the preference sync
/// uses; `APIClient` already provides it.
protocol AIConsentTransport: Sendable {
    func loadPreferences() async throws -> AccountPreferences
    func saveAIConsent(version: Int?) async throws -> AccountPreferences
}

extension APIClient: AIConsentTransport {
    func saveAIConsent(version: Int?) async throws -> AccountPreferences {
        try await json(
            "/api/preferences",
            method: "PATCH",
            body: AIConsentPatch(version: version),
            as: AccountPreferences.self
        )
    }
}

// MARK: - Store and gate

/// The signed-in account's AI consent, and the gate every AI entry point
/// passes through.
///
/// Owned by `AppModel`, so it lives and dies with one signed-in session and one
/// account id. The last known state is cached per account id in
/// `UserDefaults`: an offline cold start does not re-prompt someone who agreed,
/// and an account switch reads a different key, so it can never inherit the
/// previous person's consent.
@MainActor
@Observable
final class AIConsentStore {
    /// How an AI action was started. A `.tap` asks; an `.automatic` start
    /// (tap-a-verse's explanation begins the moment a verse is selected, the
    /// Words tab loads on appear) never raises the sheet - without consent it
    /// is simply refused, so selecting a verse to read or highlight never
    /// interrupts anyone. Its section's own retry button is the `.tap`. Same
    /// rule as the web's `useVerseInsight` (`ask: true`).
    enum Trigger: Sendable {
        case tap
        case automatic
    }

    /// The sheet currently on screen. One at a time: a second AI action while
    /// it is up is refused rather than queued.
    struct Prompt: Identifiable, Equatable {
        let id = UUID()
        var isSaving = false
        var error: String?
    }

    /// The consent on record for this account, nil when none.
    private(set) var record: AIConsentRecord?
    /// The version the server requires (`aiConsentRequired`). Defaults to this
    /// build's copy version until a document says otherwise.
    private(set) var required: Int
    /// True once a server document has landed this session; until then the
    /// state is the per-account cache (or nothing).
    private(set) var hasServerState = false
    private(set) var prompt: Prompt?
    private(set) var isWithdrawing = false
    var withdrawError: String?

    /// The Clerk id this store belongs to. nil only in previews and tests.
    let account: String?

    @ObservationIgnored private let transport: any AIConsentTransport
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var continuation: CheckedContinuation<Bool, Never>?

    init(account: String?, transport: any AIConsentTransport, defaults: UserDefaults = .standard) {
        self.account = account
        self.transport = transport
        self.defaults = defaults
        required = AIConsent.version
        if let account,
           let data = defaults.data(forKey: Self.cacheKey(account)),
           let cached = try? JSONDecoder().decode(Cached.self, from: data) {
            record = cached.record
            required = max(AIConsent.version, cached.required)
        }
    }

    /// True when AI actions may run without asking.
    var isCurrent: Bool { !AIConsent.needed(record, required: required) }

    /// The Settings row's value.
    var statusLabel: String {
        guard isCurrent else { return AIConsent.notAllowedLabel }
        return AIConsent.statusLabel(record) ?? AIConsent.notAllowedLabel
    }

    // MARK: Cache

    private struct Cached: Codable {
        var record: AIConsentRecord?
        var required: Int
    }

    static func cacheKey(_ account: String) -> String { "aiConsent.cache.\(account)" }

    private func persist() {
        guard let account else { return }
        if let data = try? JSONEncoder().encode(Cached(record: record, required: required)) {
            defaults.set(data, forKey: Self.cacheKey(account))
        }
    }

    // MARK: Server state

    /// Land a preferences document: a hydrate from `PreferencesSyncModel`, this
    /// store's own GET, or a PATCH echo. A document without
    /// `aiConsentRequired` comes from a server that predates consent and says
    /// nothing about it, so it is ignored - its missing `aiConsent` is not a
    /// "no". Returns whether the document carried consent state.
    @discardableResult
    func absorb(_ document: AccountPreferences) -> Bool {
        guard let required = document.aiConsentRequired else { return false }
        self.required = max(AIConsent.version, required)
        record = document.aiConsent
        hasServerState = true
        persist()
        return true
    }

    /// Fetch the document and land it. Silent on failure: the cached state is
    /// still the last thing the server agreed to.
    func refresh() async {
        guard let document = try? await transport.loadPreferences() else { return }
        absorb(document)
    }

    // MARK: Gate

    /// Run before any request that reaches an AI provider. True means go ahead;
    /// false means the person chose "Not now" (or another sheet is already up)
    /// and nothing may be sent.
    ///
    /// Consent current → true at once, offline included. Otherwise, when this
    /// session has not heard from the server yet, a fresh GET comes first, so a
    /// person who agreed on another device is not asked again. Then the sheet;
    /// this suspends until it is answered.
    func ensureConsent(_ trigger: Trigger = .tap) async -> Bool {
        if isCurrent { return true }
        if !hasServerState {
            await refresh()
            if isCurrent { return true }
        }
        if trigger == .automatic { return false }
        guard prompt == nil, continuation == nil else { return false }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            prompt = Prompt()
        }
    }

    /// Run `action` once consent is current - at once if it already is, after
    /// "Agree and continue" if not, never after "Not now".
    func require(_ trigger: Trigger = .tap, _ action: @escaping @MainActor () async -> Void) {
        Task {
            guard await ensureConsent(trigger) else { return }
            await action()
        }
    }

    /// "Agree and continue": record consent, then release the waiting action
    /// so the person never has to tap twice. A failure stays on the sheet with
    /// the server's words, and the action is not performed.
    func agree() async {
        guard let current = prompt, !current.isSaving else { return }
        prompt?.isSaving = true
        prompt?.error = nil
        do {
            let document = try await transport.saveAIConsent(version: AIConsent.version)
            if !absorb(document) {
                // The PATCH succeeded, so the server recorded it; an echo
                // without the fields only means an older document shape.
                record = AIConsentRecord(
                    version: AIConsent.version,
                    acceptedAt: ISO8601DateFormatter().string(from: .now)
                )
                hasServerState = true
                persist()
            }
            guard prompt?.id == current.id else { return }
            guard isCurrent else {
                prompt?.isSaving = false
                prompt?.error = "SureWord needs an update before it can use AI. Update the app and try again."
                return
            }
            finish(granted: true)
        } catch {
            guard prompt?.id == current.id else { return }
            prompt?.isSaving = false
            prompt?.error = Self.message(error, fallback: "Your choice was not saved. Check your connection and try again.")
        }
    }

    /// "Not now", a swipe down or Escape: nothing is sent and the action is
    /// dropped. The next AI action asks again.
    func decline() {
        guard prompt != nil else { return }
        finish(granted: false)
    }

    /// The session ended with the sheet up: release the waiting action
    /// without running it.
    func cancelPending() {
        finish(granted: false)
    }

    private func finish(granted: Bool) {
        prompt = nil
        let waiting = continuation
        continuation = nil
        waiting?.resume(returning: granted)
    }

    // MARK: Withdraw

    /// Settings → AI → Withdraw. PATCHes an explicit `aiConsent: null`; the
    /// next AI action asks again.
    @discardableResult
    func withdraw() async -> Bool {
        guard !isWithdrawing else { return false }
        isWithdrawing = true
        defer { isWithdrawing = false }
        do {
            let document = try await transport.saveAIConsent(version: nil)
            if !absorb(document) {
                record = nil
                persist()
            }
            return true
        } catch {
            withdrawError = Self.message(error, fallback: "Your choice was not saved. Try again.")
            return false
        }
    }

    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        return fallback
    }
}

/// The process-wide way in to the signed-in session's consent store, so every
/// AI entry point - most of which live in models with no environment - needs
/// one line: `guard await AIConsentGate.ensure() else { return }`.
///
/// With no store installed (signed out, or under XCTest, where the host app's
/// own session must never put a sheet in front of a unit test) the gate is
/// open: nothing can reach an AI route without a session anyway.
@MainActor
enum AIConsentGate {
    static weak var current: AIConsentStore?

    /// Called by `AppModel` for each signed-in session.
    static func install(_ store: AIConsentStore) {
        guard !Analytics.isRunningTests else { return }
        current = store
    }

    static func ensure(_ trigger: AIConsentStore.Trigger = .tap) async -> Bool {
        guard let current else { return true }
        return await current.ensureConsent(trigger)
    }

    /// For a synchronous call site (a button action): run `action` once
    /// consent is current, never after "Not now".
    static func require(
        _ trigger: AIConsentStore.Trigger = .tap,
        _ action: @escaping @MainActor () async -> Void
    ) {
        Task {
            guard await ensure(trigger) else { return }
            await action()
        }
    }
}
