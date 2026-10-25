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
    /// not display. It never re-asks anyone: the sheet is shown once per
    /// account, ever (Austin, 2026-10-13), and any recorded yes counts.
    static let version = 2

    static let title = "How SureWord answers you"

    static let body = "SureWord's answers are written by AI. To answer you, SureWord sends your question, the conversation, your attachments, and the study context you have shared (About me, your testimony, memories, notes, highlights and reading) to OpenAI, or through OpenRouter to the provider of the selected model. OpenAI also transcribes voice messages. Web searches go to Tavily, and spoken devotionals are voiced by ElevenLabs. They use it only to answer you; it is never sold or used for ads. The AI can be wrong, so search the Scriptures to see whether these things are so."

    static let privacyLabel = "Privacy Policy"

    static let privacyURL = "https://sureword.app/privacy"

    static let agree = "Agree and continue"

    static let decline = "No thanks"

    /// The confirmation "No thanks" leads to. SureWord is mostly AI, so a no
    /// is confirmed before it is saved; once saved it is never asked again.
    static let confirmTitle = "Turn off AI?"

    static let confirmBody = "SureWord is built around AI. Without it, chat, verse explanations, word studies, Pick Up Your Cross reflections and note help won't work. You can still read the Bible, highlight and write notes. You won't be asked again; to change your mind, go to Settings → AI."

    /// The confirmation's primary button: agrees, as "Agree and continue" does.
    static let confirmAllow = "Allow AI"

    /// The confirmation's no, saved on the account.
    static let confirmDecline = "Turn off AI"

    /// Settings → AI row title.
    static let settingsTitle = "AI data sharing"

    /// Settings → AI action that turns AI off, after a confirm dialog.
    static let withdraw = "Turn off AI"

    /// Settings → AI action that shows the disclosure again to turn AI on.
    static let enable = "Turn on AI"

    /// The Settings row's value while AI is off or was never allowed.
    static let notAllowedLabel = "Off"

    /// Shown in place of anything AI would have written while AI is off.
    static let declinedNotice = "AI is turned off for your account. You can turn it on in Settings → AI."

    /// True when AI is not allowed: no consent on record. Any recorded yes
    /// counts, whatever copy version it was given to. Same rule as
    /// `aiConsentNeeded` on the web.
    static func needed(_ consent: AIConsentRecord?) -> Bool {
        consent == nil
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
/// to agree, `{ "aiConsent": null }` to turn AI off (recorded as a no). The null is written
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

    /// The sheet currently on screen. One at a time: every AI action started
    /// while it is up waits for the same answer.
    struct Prompt: Identifiable, Equatable {
        let id = UUID()
        /// "No thanks" was tapped: the sheet shows the "Turn off AI?" step.
        var isConfirmingDecline = false
        var isSaving = false
        var error: String?
    }

    /// The consent on record for this account, nil when none.
    private(set) var record: AIConsentRecord?
    /// The person said no. The sheet never shows again; only Settings → AI
    /// can reopen it.
    private(set) var declined = false
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
    @ObservationIgnored private var continuations: [CheckedContinuation<Bool, Never>] = []
    /// The signed-in session's store raises the sheet by itself the first time
    /// the server says this account never chose, so it is asked once, up front.
    @ObservationIgnored private let askOnLaunch: Bool
    /// When this session last saved an answer. A preferences fetch that began
    /// before the save can land after it; within this window a document that
    /// disagrees with the saved answer is that stale fetch, not a newer
    /// choice from another device, and must not undo the answer or reopen
    /// the sheet.
    @ObservationIgnored private var lastLocalDecision: Date?
    private static let staleDocumentWindow: TimeInterval = 30

    init(
        account: String?,
        transport: any AIConsentTransport,
        defaults: UserDefaults = .standard,
        askOnLaunch: Bool = false
    ) {
        self.account = account
        self.transport = transport
        self.defaults = defaults
        self.askOnLaunch = askOnLaunch
        required = AIConsent.version
        if let account,
           let data = defaults.data(forKey: Self.cacheKey(account)),
           let cached = try? JSONDecoder().decode(Cached.self, from: data) {
            record = cached.record
            declined = cached.declined ?? false
            required = max(AIConsent.version, cached.required)
        }
    }

    /// True when AI actions may run without asking.
    var isCurrent: Bool { !AIConsent.needed(record) }

    /// The Settings row's value.
    var statusLabel: String {
        guard isCurrent else { return AIConsent.notAllowedLabel }
        return AIConsent.statusLabel(record) ?? AIConsent.notAllowedLabel
    }

    // MARK: Cache

    private struct Cached: Codable {
        var record: AIConsentRecord?
        /// Optional so a cache written before declines were recorded still reads.
        var declined: Bool?
        var required: Int
    }

    static func cacheKey(_ account: String) -> String { "aiConsent.cache.\(account)" }

    private func persist() {
        guard let account else { return }
        if let data = try? JSONEncoder().encode(Cached(record: record, declined: declined, required: required)) {
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
        if let lastLocalDecision, Date.now.timeIntervalSince(lastLocalDecision) < Self.staleDocumentWindow {
            let documentDeclined = document.aiConsent == nil && document.aiConsentDeclined == true
            if (document.aiConsent != nil) != (record != nil) || documentDeclined != declined { return true }
        }
        self.required = max(AIConsent.version, required)
        record = document.aiConsent
        declined = record == nil && document.aiConsentDeclined == true
        hasServerState = true
        persist()
        // Only a server that records a no can keep the promise of asking once.
        if askOnLaunch, lastLocalDecision == nil, record == nil, document.aiConsentDeclined == false, prompt == nil {
            prompt = Prompt()
        }
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
    /// false means AI is off for this account and nothing may be sent.
    ///
    /// Consent current → true at once, offline included. Otherwise, when this
    /// session has not heard from the server yet, a fresh GET comes first, so a
    /// person who agreed on another device is not asked again. A declined
    /// account is refused without a sheet. An undecided one waits on the sheet
    /// (joining it when it is already up), which suspends until it is answered.
    func ensureConsent(_ trigger: Trigger = .tap) async -> Bool {
        if isCurrent { return true }
        if !hasServerState {
            await refresh()
            if isCurrent { return true }
        }
        if declined { return false }
        if prompt == nil {
            if trigger == .automatic { return false }
            prompt = Prompt()
        }
        return await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    /// Settings → AI → Turn on AI: the disclosure again, even after a no.
    func reconsider() {
        guard !isCurrent, prompt == nil else { return }
        prompt = Prompt()
    }

    /// Run `action` once consent is current - at once if it already is, after
    /// "Agree and continue" if not, never while AI is off.
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
            if isCurrent { lastLocalDecision = .now }
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

    /// "No thanks" or Escape: never closes the sheet unanswered, it moves to
    /// the "Turn off AI?" confirmation.
    func decline() {
        guard prompt != nil, prompt?.isSaving != true else { return }
        // After a failed save (offline) it closes unrecorded, so nobody is trapped.
        if prompt?.error != nil { cancelPending(); return }
        prompt?.isConfirmingDecline = true
        prompt?.error = nil
    }

    /// Escape on the confirmation returns to the disclosure.
    func back() {
        guard prompt != nil, prompt?.isSaving != true else { return }
        if prompt?.error != nil { cancelPending(); return }
        prompt?.isConfirmingDecline = false
        prompt?.error = nil
    }

    /// The confirmed "Turn off AI": saved on the account, so the sheet never
    /// returns. Waiting actions are dropped unrun.
    func confirmDecline() async {
        guard let current = prompt, !current.isSaving else { return }
        prompt?.isSaving = true
        prompt?.error = nil
        do {
            let document = try await transport.saveAIConsent(version: nil)
            if !absorb(document) {
                record = nil
                declined = true
                persist()
            }
            lastLocalDecision = .now
            guard prompt?.id == current.id else { return }
            finish(granted: false)
        } catch {
            guard prompt?.id == current.id else { return }
            prompt?.isSaving = false
            prompt?.error = Self.message(error, fallback: "Your choice was not saved. Check your connection and try again.")
        }
    }

    /// The session ended, or the sheet could not stay on screen, unanswered:
    /// release the waiting actions without running them and record nothing,
    /// so an undecided account is asked on its next launch.
    func cancelPending() {
        finish(granted: false)
    }

    private func finish(granted: Bool) {
        prompt = nil
        let waiting = continuations
        continuations = []
        waiting.forEach { $0.resume(returning: granted) }
    }

    // MARK: Withdraw

    /// Settings → AI → Turn off AI. PATCHes an explicit `aiConsent: null`,
    /// which the server records as a no: nothing asks again until the person
    /// turns AI back on in Settings.
    @discardableResult
    func withdraw() async -> Bool {
        guard !isWithdrawing else { return false }
        isWithdrawing = true
        defer { isWithdrawing = false }
        do {
            let document = try await transport.saveAIConsent(version: nil)
            if !absorb(document) {
                record = nil
                declined = true
                persist()
            }
            lastLocalDecision = .now
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
    /// consent is current, never while AI is off.
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
