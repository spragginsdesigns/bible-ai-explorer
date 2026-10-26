import Foundation

/// Bible translation the reader shows and the AI quotes back.
///
/// Note the split the mission depends on: the *AI's own voice* is always KJV
/// (`chatSystemPrompt`), and this only selects which translation it quotes and
/// which text the reader renders.
enum TranslationID: String, CaseIterable, Sendable, Codable {
    case kjv = "KJV"
    case nkjv = "NKJV"
    /// Berean Standard Bible, bundled for offline reading (Android 1.60.0).
    /// The server accepts it on every route that takes a translation.
    case bsb = "BSB"
    /// Reina-Valera 1909, the Spanish Bible, bundled like BSB
    /// (docs/languages/PLAN.md).
    case rv1909 = "RV1909"
    /// Lutherbibel 1912, the German Bible, bundled like BSB.
    case lut1912 = "LUT1912"

    /// The short id the chips, attachment pills and share text show.
    var label: String { rawValue }

    /// The edition's name on the reader's copyright line - Android's
    /// `TRANSLATIONS[id].label`, which spells BSB and the two non-English
    /// Bibles out and keeps KJV and NKJV as their abbreviations.
    var name: String {
        switch self {
        case .bsb: "Berean Standard Bible"
        case .rv1909: "Reina-Valera 1909"
        case .lut1912: "Lutherbibel 1912"
        case .kjv, .nkjv: rawValue
        }
    }

    var copyright: String {
        switch self {
        case .kjv, .rv1909, .lut1912: "Public domain"
        case .nkjv: "© Thomas Nelson - text via bolls.life"
        case .bsb: "Public domain · BSB Publishing"
        }
    }

    /// The language the edition is written in - `TRANSLATIONS[id].language`.
    var language: AnswerLanguage {
        switch self {
        case .kjv, .nkjv, .bsb: .en
        case .rv1909: .es
        case .lut1912: .de
        }
    }

    /// What the Bible pickers show: the bare id for the English editions, and
    /// the name with its language for the others ("Reina-Valera 1909 · Español").
    var pickerLabel: String {
        language == .en ? label : "\(name) · \(language.name)"
    }

    /// The editions that carry SureWord's KJV-only and BSB-sourced reader
    /// extras (section headings). Red letters and Strong's stay KJV-only on top
    /// of this; the Spanish and German Bibles are plain text, as NKJV is.
    var hasSectionHeadings: Bool {
        self == .kjv || self == .bsb
    }
}

/// Persisted user settings, mirroring
/// `mobile/src/features/settings/settingsStore.ts`.
@MainActor
@Observable
final class SettingsStore {
    private enum Key {
        static let appearance = "settings.appearance"
        static let translation = "settings.translation"
        static let verseOfDayEnabled = "settings.verseOfDay.enabled"
        static let verseOfDayHour = "settings.verseOfDay.hour"
        static let chatReplies = "settings.notifications.chatReplies"
        static let chatModelId = "settings.chat.modelId"
        static let chatEffort = "settings.chat.effort"
        static let chatSpeed = "settings.chat.speed"
        static let chatVerbosity = "settings.chat.verbosity"
        static let chatMode = "settings.chat.mode"
        /// Same preference the web app keeps under `sureword.listenRate` and
        /// Android keeps in its settings store.
        static let listenRate = "settings.listen.rate"
        static let parchment = "settings.bible.parchment"
        /// Device-only, like the other clients: never part of `/api/preferences`.
        static let offerQuiz = "settings.bible.offerQuiz"
        /// `[String: String]` is a property-list type, so both colour maps go
        /// into `UserDefaults` whole with no JSON step.
        static let highlightLabels = "settings.highlight.labels"
        static let highlightMeanings = "settings.highlight.meanings"
        static let aboutMe = "settings.aboutMe"
        static let testimony = "settings.testimony"
        static let textScale = "settings.textScale"
        static let voiceMode = "settings.voiceMode"
        static let answerLanguage = "settings.answerLanguage"
    }

    /// Matches `DEFAULT_SETTINGS` in
    /// `mobile/src/features/notifications/notificationSettings.ts` — on by
    /// default, 8 in the morning.
    static let defaultVerseOfDayHour = 8

    /// The account-preferences pipe, set by `PreferencesSyncModel` when a
    /// signed-in session starts.
    ///
    /// Weak because the sync model holds this store: it is owned by `AppModel`
    /// and dies with the session, at which point this correctly reads nil again
    /// and edits stop being written through.
    @ObservationIgnored weak var sync: PreferencesSyncModel?

    /// True while a server document (or a rollback) is being landed, so the
    /// setters below know not to send it straight back as an edit.
    @ObservationIgnored private var isApplyingRemote = false

    /// Apply values *without* writing them through to the server. Used for
    /// hydration, for rollbacks, and for the model picker's seeding from
    /// `/api/ai/models` - which fills in the account's own defaults and would
    /// otherwise PATCH them back as if the user had chosen them.
    func applyRemote(_ body: (SettingsStore) -> Void) {
        let wasApplying = isApplyingRemote
        isApplyingRemote = true
        body(self)
        isApplyingRemote = wasApplying
    }

    /// Reset every synced field to its default, locally only. Runs when the
    /// signed-in account changes and on sign-out: these values belong to an
    /// account, not to the device.
    func resetSyncedPreferences() {
        applyRemote { settings in
            settings.translation = .kjv
            settings.parchment = true
            settings.textScale = .default
            settings.voiceMode = false
            settings.answerLanguage = .default
            settings.listenRate = Listen.defaultRate
            settings.highlightLabels = [:]
            settings.highlightMeanings = [:]
            settings.aboutMe = ""
            settings.testimony = ""
            settings.chatModelId = nil
            settings.chatEffort = nil
            settings.chatSpeed = nil
            settings.chatVerbosity = nil
            settings.chatMode = nil
        }
    }

    /// The synced fields as the first-adopt seed sees them
    /// (`PreferencesAdoption`).
    var syncedSnapshot: LocalPreferences {
        LocalPreferences(
            translation: translation.rawValue,
            parchment: parchment,
            listenRate: listenRate,
            modelId: chatModelId,
            // Auto is "no reasoning override for this turn", which is what a
            // null column already means, so it is never worth seeding.
            effort: Self.wireEffort(chatEffort),
            speed: chatSpeed,
            verbosity: chatVerbosity,
            mode: chatMode
        )
    }

    /// Write one changed field through to `PATCH /api/preferences`, with the
    /// value it had before so a failure can put it back.
    private func writeThrough(_ patch: PreferencesPatch, previous: AccountPreferences) {
        guard !isApplyingRemote else { return }
        sync?.push(patch, rollingBackTo: previous)
    }

    var appearance: AppearanceSetting {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: Key.appearance) }
    }

    var translation: TranslationID {
        didSet {
            UserDefaults.standard.set(translation.rawValue, forKey: Key.translation)
            guard translation != oldValue else { return }
            writeThrough(
                PreferencesPatch(translation: translation.rawValue),
                previous: AccountPreferences(translation: oldValue.rawValue)
            )
        }
    }

    var verseOfDayEnabled: Bool {
        didSet { UserDefaults.standard.set(verseOfDayEnabled, forKey: Key.verseOfDayEnabled) }
    }

    /// Notify when a chat answer finishes after this device dropped off the
    /// stream - Android's `chatReplies`. Device-local like the reminder, and
    /// independent of it: the push token stays registered for either stream.
    /// iOS delivers it through the server's push (`PushRegistration`); the Mac,
    /// which registers no token, posts a local notice instead while SureWord
    /// is in the background (`AnswerReadyNotifier`).
    var notifyChatReplies: Bool {
        didSet { UserDefaults.standard.set(notifyChatReplies, forKey: Key.chatReplies) }
    }

    /// Local hour the morning reminder should arrive, 0-23.
    var verseOfDayHour: Int {
        didSet {
            // Guarded for the reason spelled out on `listenRate` below: an
            // unconditional write-back from an `@Observable` property's
            // `didSet` recurses through its own setter until the stack runs
            // out. This clamp used to be unconditional.
            let clamped = min(max(verseOfDayHour, 0), 23)
            if clamped != verseOfDayHour {
                verseOfDayHour = clamped
                return
            }
            UserDefaults.standard.set(verseOfDayHour, forKey: Key.verseOfDayHour)
        }
    }

    /// The chat model picked in the model picker, nil for the account default.
    /// Rides every `/api/ask-question` request, like `chatModelId` in
    /// `mobile/src/features/settings/settingsStore.ts`.
    var chatModelId: String? {
        didSet {
            UserDefaults.standard.set(chatModelId, forKey: Key.chatModelId)
            guard chatModelId != oldValue else { return }
            writeThrough(
                PreferencesPatch(chat: ChatPreferences(modelId: .some(chatModelId))),
                previous: AccountPreferences(chat: ChatPreferences(modelId: .some(oldValue)))
            )
        }
    }

    /// Read at the start of a verse request so a picker change cannot reuse another model's explanation.
    static func selectedChatModelId() -> String? {
        UserDefaults.standard.string(forKey: Key.chatModelId)
    }

    /// Reasoning effort override. The vocabulary is the server's
    /// (`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`), and
    /// a value the chosen model does not accept is dropped server-side rather
    /// than erased here - see `ModelPickerRules.activeEffort`.
    ///
    /// Three states, not two. **Nil means "never chose"** and omits the key, so
    /// the server applies the account's stored default. The Auto chip stores
    /// `AskQuestionRequest.autoEffort` instead, which encodes as an explicit
    /// null - "no reasoning override for this turn". Picking Auto must not read
    /// as never having picked anything.
    var chatEffort: String? {
        didSet {
            UserDefaults.standard.set(chatEffort, forKey: Key.chatEffort)
            guard chatEffort != oldValue else { return }
            writeThrough(
                PreferencesPatch(chat: ChatPreferences(effort: .some(Self.wireEffort(chatEffort)))),
                // The rollback restores the *stored* value, sentinel and all -
                // it is putting this device back the way it was, not describing
                // a server column.
                previous: AccountPreferences(chat: ChatPreferences(effort: .some(oldValue)))
            )
        }
    }

    /// `auto` is a local sentinel, not a value the server's `isReasoningEffort`
    /// accepts, and `PATCH /api/preferences` answers an unknown effort with a
    /// 400. On the wire it is the same null the ask-question request sends for
    /// Auto (see `AskQuestionRequest.encode`).
    private static func wireEffort(_ effort: String?) -> String? {
        effort == AskQuestionRequest.autoEffort ? nil : effort
    }

    /// Service tier (`standard` / `fast`). **Nil means "never chose", not
    /// "standard"** - picking the Standard chip stores `"standard"` verbatim.
    /// The server reads an absent `speed` as "no opinion, apply the account's
    /// stored default", so writing nil for Standard would leave a user who once
    /// chose Fast running Fast for ever. Same rule for the two below.
    var chatSpeed: String? {
        didSet {
            UserDefaults.standard.set(chatSpeed, forKey: Key.chatSpeed)
            guard chatSpeed != oldValue else { return }
            writeThrough(
                PreferencesPatch(chat: ChatPreferences(speed: .some(chatSpeed))),
                previous: AccountPreferences(chat: ChatPreferences(speed: .some(oldValue)))
            )
        }
    }

    /// Answer length (`low` / `medium` / `high`), nil only if never chosen.
    var chatVerbosity: String? {
        didSet {
            UserDefaults.standard.set(chatVerbosity, forKey: Key.chatVerbosity)
            guard chatVerbosity != oldValue else { return }
            writeThrough(
                PreferencesPatch(chat: ChatPreferences(verbosity: .some(chatVerbosity))),
                previous: AccountPreferences(chat: ChatPreferences(verbosity: .some(oldValue)))
            )
        }
    }

    /// Reasoning mode (`standard` / `pro`), nil only if never chosen.
    var chatMode: String? {
        didSet {
            UserDefaults.standard.set(chatMode, forKey: Key.chatMode)
            guard chatMode != oldValue else { return }
            writeThrough(
                PreferencesPatch(chat: ChatPreferences(mode: .some(chatMode))),
                previous: AccountPreferences(chat: ChatPreferences(mode: .some(oldValue)))
            )
        }
    }

    /// Playback speed for the "Listen" spoken devotional. Normalised on the way
    /// in as well as on the way out: a rate this build no longer offers must
    /// never reach the player, however it got stored.
    /// **Never write back unconditionally from a `didSet` in this class.**
    /// `@Observable` rewrites every stored property into a computed one over a
    /// private `_name`, so an assignment inside `didSet` goes back through the
    /// *public setter* - which sets `_name` again, which fires `didSet` again.
    /// Swift's usual "assigning inside your own `didSet` does not re-enter"
    /// rule does not apply, because the two are different properties. Doing it
    /// segfaults the app with a stack overflow on the first keystroke; the
    /// guard below is what bounds it to a single extra pass.
    var listenRate: Double {
        didSet {
            let normalized = Listen.normalizeRate(listenRate)
            if normalized != listenRate {
                listenRate = normalized
                return
            }
            UserDefaults.standard.set(listenRate, forKey: Key.listenRate)
            guard listenRate != oldValue else { return }
            writeThrough(
                PreferencesPatch(listenRate: listenRate),
                // Normalised: `oldValue` can be a rate this build no longer
                // offers (the guard above is what replaced it), and a rollback
                // must put back a speed the player can actually run.
                previous: AccountPreferences(listenRate: Listen.normalizeRate(oldValue))
            )
        }
    }

    /// What the user calls each highlight colour, keyed by colour id
    /// ("yellow"), and why they reach for it. A colour with no entry keeps its
    /// hue name, so the default is an empty map rather than the preset names.
    ///
    /// **No write-through, unlike every other synced field here.** These two
    /// maps are stored whole, so a save has to re-read the account document and
    /// merge the touched colours over it first, which is what
    /// `PreferencesSyncModel.saveHighlightLabels` does. A `didSet` that PATCHed
    /// the local map would replace the account's labels with whatever this
    /// device last cached. What is kept here is the cache that paints the
    /// Settings rows before the network answers.
    var highlightLabels: [String: String] {
        didSet { UserDefaults.standard.set(highlightLabels, forKey: Key.highlightLabels) }
    }

    /// The longer sentence behind each colour, same keys, same no-write-through
    /// rule. Read by the assistant rather than shown on a chip.
    var highlightMeanings: [String: String] {
        didSet { UserDefaults.standard.set(highlightMeanings, forKey: Key.highlightMeanings) }
    }

    /// The user's own description of themselves, "" when they have written
    /// none. Saved through `PreferencesSyncModel.saveAboutMe` for the same
    /// reason as the maps above: it is a Save button, not a live setting.
    var aboutMe: String {
        didSet { UserDefaults.standard.set(aboutMe, forKey: Key.aboutMe) }
    }

    /// How the user came to faith, "" when they have written none. Saved
    /// through `PreferencesSyncModel.saveTestimony`, on the same no
    /// write-through rule as `aboutMe`.
    var testimony: String {
        didSet { UserDefaults.standard.set(testimony, forKey: Key.testimony) }
    }

    /// The chapter reader's parchment page surface (Android 1.19.0 / web's
    /// `.parchment-page`). On by default, exactly as on the other clients.
    var parchment: Bool {
        didSet {
            UserDefaults.standard.set(parchment, forKey: Key.parchment)
            guard parchment != oldValue else { return }
            writeThrough(
                PreferencesPatch(parchment: parchment),
                previous: AccountPreferences(parchment: oldValue)
            )
        }
    }

    /// App-wide text size (Walk with me's first card, and Settings). Synced
    /// with the account, so a size picked on the phone is the size here.
    var textScale: TextScale {
        didSet {
            UserDefaults.standard.set(textScale.rawValue, forKey: Key.textScale)
            guard textScale != oldValue else { return }
            var previous = AccountPreferences()
            previous.textScale = oldValue.rawValue
            writeThrough(PreferencesPatch(textScale: textScale.rawValue), previous: previous)
        }
    }

    /// The language SureWord answers in ("SureWord answers in" in Settings).
    /// Synced with the account like `textScale`; `auto` follows the device.
    var answerLanguage: AnswerLanguageSetting {
        didSet {
            UserDefaults.standard.set(answerLanguage.rawValue, forKey: Key.answerLanguage)
            guard answerLanguage != oldValue else { return }
            var previous = AccountPreferences()
            previous.answerLanguage = oldValue.rawValue
            writeThrough(PreferencesPatch(answerLanguage: answerLanguage.rawValue), previous: previous)
        }
    }

    /// The language chat and verse-insight requests carry.
    var effectiveAnswerLanguage: AnswerLanguage { answerLanguage.effective() }

    /// Read at the start of a verse request, the way `selectedChatModelId()`
    /// is, by models that hold no `SettingsStore`.
    static func selectedAnswerLanguage() -> AnswerLanguage {
        AnswerLanguageSetting.normalize(UserDefaults.standard.string(forKey: Key.answerLanguage)).effective()
    }

    /// Pick the answer language from Settings. A specific language also moves
    /// the reader to that language's Bible when the current one is in another
    /// language (English goes back to KJV); NKJV or BSB stay put for English.
    func chooseAnswerLanguage(_ setting: AnswerLanguageSetting) {
        answerLanguage = setting
        if let language = setting.language, translation.language != language {
            translation = language.bible
        }
    }

    /// "Read it to me" in the welcome conversation. Off by default.
    var voiceMode: Bool {
        didSet {
            UserDefaults.standard.set(voiceMode, forKey: Key.voiceMode)
            guard voiceMode != oldValue else { return }
            var previous = AccountPreferences()
            previous.voiceMode = oldValue
            writeThrough(PreferencesPatch(voiceMode: voiceMode), previous: previous)
        }
    }

    /// "Offer a quiz after each chapter" (docs/quiz/PLAN.md). Kept on this
    /// device only, the same as Android and web, so it has no write-through.
    var offerQuiz: Bool {
        didSet { UserDefaults.standard.set(offerQuiz, forKey: Key.offerQuiz) }
    }

    init() {
        let defaults = UserDefaults.standard
        appearance = AppearanceSetting(rawValue: defaults.string(forKey: Key.appearance) ?? "") ?? .system
        translation = TranslationID(rawValue: defaults.string(forKey: Key.translation) ?? "") ?? .kjv
        // `object(forKey:)` rather than `bool(forKey:)`: an unset key reads as
        // false, which would silently turn the reminder off for everyone who
        // has never opened Settings.
        verseOfDayEnabled = defaults.object(forKey: Key.verseOfDayEnabled) as? Bool ?? true
        notifyChatReplies = defaults.object(forKey: Key.chatReplies) as? Bool ?? true
        let storedHour = defaults.object(forKey: Key.verseOfDayHour) as? Int
        verseOfDayHour = min(max(storedHour ?? Self.defaultVerseOfDayHour, 0), 23)
        chatModelId = defaults.string(forKey: Key.chatModelId)
        chatEffort = defaults.string(forKey: Key.chatEffort)
        chatSpeed = defaults.string(forKey: Key.chatSpeed)
        chatVerbosity = defaults.string(forKey: Key.chatVerbosity)
        chatMode = defaults.string(forKey: Key.chatMode)
        // `object(forKey:)` so an unwritten key falls to the offered default
        // rather than to 0, which is not a speed.
        listenRate = Listen.normalizeRate(defaults.object(forKey: Key.listenRate))
        // `dictionary(forKey:)` hands back `[String: Any]`, so the cast is what
        // rejects anything an older build or a corrupt domain left behind.
        highlightLabels = defaults.dictionary(forKey: Key.highlightLabels) as? [String: String] ?? [:]
        highlightMeanings =
            defaults.dictionary(forKey: Key.highlightMeanings) as? [String: String] ?? [:]
        aboutMe = defaults.string(forKey: Key.aboutMe) ?? ""
        testimony = defaults.string(forKey: Key.testimony) ?? ""
        // Same reason as the reminder toggle: an unset key reads as false, and
        // would silently turn the parchment off for everyone.
        parchment = defaults.object(forKey: Key.parchment) as? Bool ?? true
        offerQuiz = defaults.object(forKey: Key.offerQuiz) as? Bool ?? true
        textScale = TextScale.normalize(defaults.string(forKey: Key.textScale))
        voiceMode = defaults.bool(forKey: Key.voiceMode)
        answerLanguage = AnswerLanguageSetting.normalize(defaults.string(forKey: Key.answerLanguage))
    }

    /// 0-23 → "8:00 AM" / "9:00 PM", matching `formatHour` on Android.
    static func formatHour(_ hour: Int) -> String {
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        return "\(hour12):00 \(hour < 12 ? "AM" : "PM")"
    }
}
