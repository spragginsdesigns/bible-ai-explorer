import Foundation

/// Bible translation the reader shows and the AI quotes back.
///
/// Note the split the mission depends on: the *AI's own voice* is always KJV
/// (`chatSystemPrompt`), and this only selects which translation it quotes and
/// which text the reader renders.
enum TranslationID: String, CaseIterable, Sendable, Codable {
    case kjv = "KJV"
    case nkjv = "NKJV"

    var label: String { rawValue }

    var copyright: String {
        switch self {
        case .kjv: "Public domain"
        case .nkjv: "© Thomas Nelson — text via bolls.life"
        }
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
        static let chatModelId = "settings.chat.modelId"
        static let chatEffort = "settings.chat.effort"
    }

    /// Matches `DEFAULT_SETTINGS` in
    /// `mobile/src/features/notifications/notificationSettings.ts` — on by
    /// default, 8 in the morning.
    static let defaultVerseOfDayHour = 8

    var appearance: AppearanceSetting {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: Key.appearance) }
    }

    var translation: TranslationID {
        didSet { UserDefaults.standard.set(translation.rawValue, forKey: Key.translation) }
    }

    var verseOfDayEnabled: Bool {
        didSet { UserDefaults.standard.set(verseOfDayEnabled, forKey: Key.verseOfDayEnabled) }
    }

    /// Local hour the morning reminder should arrive, 0-23.
    var verseOfDayHour: Int {
        didSet {
            verseOfDayHour = min(max(verseOfDayHour, 0), 23)
            UserDefaults.standard.set(verseOfDayHour, forKey: Key.verseOfDayHour)
        }
    }

    /// The chat model picked in the model picker, nil for the account default.
    /// Rides every `/api/ask-question` request, like `chatModelId` in
    /// `mobile/src/features/settings/settingsStore.ts`.
    var chatModelId: String? {
        didSet { UserDefaults.standard.set(chatModelId, forKey: Key.chatModelId) }
    }

    /// Reasoning effort override (`low` / `medium` / `high`), nil for Auto.
    var chatEffort: String? {
        didSet { UserDefaults.standard.set(chatEffort, forKey: Key.chatEffort) }
    }

    init() {
        let defaults = UserDefaults.standard
        appearance = AppearanceSetting(rawValue: defaults.string(forKey: Key.appearance) ?? "") ?? .system
        translation = TranslationID(rawValue: defaults.string(forKey: Key.translation) ?? "") ?? .kjv
        // `object(forKey:)` rather than `bool(forKey:)`: an unset key reads as
        // false, which would silently turn the reminder off for everyone who
        // has never opened Settings.
        verseOfDayEnabled = defaults.object(forKey: Key.verseOfDayEnabled) as? Bool ?? true
        let storedHour = defaults.object(forKey: Key.verseOfDayHour) as? Int
        verseOfDayHour = min(max(storedHour ?? Self.defaultVerseOfDayHour, 0), 23)
        chatModelId = defaults.string(forKey: Key.chatModelId)
        chatEffort = defaults.string(forKey: Key.chatEffort)
    }

    /// 0-23 → "8:00 AM" / "9:00 PM", matching `formatHour` on Android.
    static func formatHour(_ hour: Int) -> String {
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        return "\(hour12):00 \(hour < 12 ? "AM" : "PM")"
    }
}
