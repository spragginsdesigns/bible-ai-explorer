import Foundation

/// A language SureWord answers in. Mirrors `AnswerLanguage` and
/// `LANGUAGE_NAMES` in `src/lib/bible/translations.ts` (docs/languages/PLAN.md,
/// "Implementation contract").
enum AnswerLanguage: String, CaseIterable, Sendable, Identifiable {
    case en, es, de

    var id: String { rawValue }

    /// The language's own name, as the Settings rows show it.
    var name: String {
        switch self {
        case .en: "English"
        case .es: "Español"
        case .de: "Deutsch"
        }
    }

    /// The language's own Bible - `LANGUAGE_BIBLES`. Choosing a language in
    /// Settings moves the reader here when its Bible is in another language.
    var bible: TranslationID {
        switch self {
        case .en: .kjv
        case .es: .rv1909
        case .de: .lut1912
        }
    }

    /// The device's language when SureWord answers in it, else English. Only
    /// the first preferred language counts: someone whose phone is in English
    /// with Spanish second still gets English, as on Android and web.
    static func device(preferredLanguages: [String] = Locale.preferredLanguages) -> AnswerLanguage {
        guard let first = preferredLanguages.first,
              let code = Locale.Language(identifier: first).languageCode?.identifier,
              let language = AnswerLanguage(rawValue: code.lowercased()),
              language != .en
        else { return .en }
        return language
    }
}

/// The synced `answerLanguage` preference: a specific language, or `auto`
/// ("Follow my device"), the default.
enum AnswerLanguageSetting: String, CaseIterable, Sendable, Identifiable {
    case auto, en, es, de

    static let `default`: AnswerLanguageSetting = .auto

    var id: String { rawValue }

    /// The explicit choice, nil for `auto`.
    var language: AnswerLanguage? {
        AnswerLanguage(rawValue: rawValue)
    }

    /// The language requests carry: the explicit choice, else the device's
    /// first preferred language when it is Spanish or German, else English.
    func effective(preferredLanguages: [String] = Locale.preferredLanguages) -> AnswerLanguage {
        language ?? AnswerLanguage.device(preferredLanguages: preferredLanguages)
    }

    /// The Settings row: "Follow my device (Español)" shows what `auto`
    /// resolved to; a specific language is its own name.
    func label(preferredLanguages: [String] = Locale.preferredLanguages) -> String {
        guard let language else {
            return "Follow my device (\(AnswerLanguage.device(preferredLanguages: preferredLanguages).name))"
        }
        return language.name
    }

    /// The line under the picker on both apps.
    static let hint =
        "Answers are written in this language and quote its Bible: the KJV in English, the "
        + "Reina-Valera 1909 in Español, the Lutherbibel 1912 in Deutsch. Choosing a language also "
        + "opens its Bible in the reader. Saved to your account."

    /// Unknown or missing values read as `auto`, as on the server.
    static func normalize(_ raw: String?) -> AnswerLanguageSetting {
        raw.flatMap(AnswerLanguageSetting.init(rawValue:)) ?? .default
    }
}
