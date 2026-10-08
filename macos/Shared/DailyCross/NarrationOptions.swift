import Foundation

/// The reader's narrator choice for today's spoken devotional.
///
/// A port of `mobile/src/features/cross/narrationOptions.ts` (itself a mirror
/// of `src/lib/daily-cross-audio-options.ts` on the server). The choices are
/// deliberately bounded and apply to speech only, never to Scripture text.

/// One delivery preset. Raw values are the wire contract for
/// `POST /api/verse-of-day/audio { style }`.
enum NarrationStyle: String, Codable, CaseIterable, Identifiable, Sendable {
    case calm, natural, expressive

    var id: String { rawValue }

    /// The server's default when a request names no style.
    static let defaultStyle: NarrationStyle = .natural

    var label: String {
        switch self {
        case .calm: "Calm"
        case .natural: "Natural"
        case .expressive: "Expressive"
        }
    }

    var description: String {
        switch self {
        case .calm: "Steady and reflective"
        case .natural: "Warm and conversational"
        case .expressive: "More feeling and emphasis"
        }
    }
}

/// The body of `POST /api/verse-of-day/audio`, and the JSON stored under
/// `NarrationPreferences.key`. Both fields are optional: an empty body is still
/// valid on the server (default voice, natural delivery), and `JSONEncoder`
/// drops a nil optional, so absence is the contract.
struct NarrationOptions: Codable, Equatable, Sendable {
    var voiceId: String?
    var style: NarrationStyle?

    init(voiceId: String? = nil, style: NarrationStyle? = nil) {
        self.voiceId = voiceId
        self.style = style
    }

    /// What the setup panel sends: the chosen voice when there is one (a
    /// voice catalog that failed to load leaves it empty, and the server then
    /// uses its default narrator), and always the delivery.
    static func request(voiceId: String, style: NarrationStyle) -> NarrationOptions {
        NarrationOptions(voiceId: voiceId.isEmpty ? nil : voiceId, style: style)
    }

    /// Lenient: a stored style this build no longer offers decodes as nil
    /// rather than discarding the saved voice with it.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        voiceId = try? container.decodeIfPresent(String.self, forKey: .voiceId)
        let rawStyle = try? container.decodeIfPresent(String.self, forKey: .style)
        style = rawStyle.flatMap(NarrationStyle.init(rawValue:))
    }

    private enum CodingKeys: String, CodingKey {
        case voiceId, style
    }
}

/// One narrator from `GET /api/verse-of-day/audio/voices`.
struct NarrationVoice: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String
    /// ElevenLabs' own https sample, or nil when the voice has none - the
    /// preview button is only offered when this is present.
    let previewUrl: String?

    init(id: String, name: String, description: String, previewUrl: String? = nil) {
        self.id = id
        self.name = name
        self.description = description
        self.previewUrl = previewUrl
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        previewUrl = try container.decodeIfPresent(String.self, forKey: .previewUrl)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, previewUrl
    }
}

/// The voice catalog. A locked or unavailable account gets `voices: []` and an
/// empty `defaultVoiceId`.
struct NarrationVoices: Decodable, Equatable, Sendable {
    let voices: [NarrationVoice]
    let defaultVoiceId: String

    init(voices: [NarrationVoice], defaultVoiceId: String) {
        self.voices = voices
        self.defaultVoiceId = defaultVoiceId
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        voices = try container.decodeIfPresent([NarrationVoice].self, forKey: .voices) ?? []
        defaultVoiceId = try container.decodeIfPresent(String.self, forKey: .defaultVoiceId) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case voices, defaultVoiceId
    }
}

/// The selection the setup panel opens with.
struct NarrationSelection: Equatable, Sendable {
    var voiceId: String
    var style: NarrationStyle

    static let initial = NarrationSelection(voiceId: "", style: NarrationStyle.defaultStyle)

    /// Android's restore rules (`NarrationSetup.tsx`): the saved voice only if
    /// the catalog still offers it, otherwise the catalog's default; the saved
    /// style only if it is one this build offers, otherwise natural.
    static func restore(saved: NarrationOptions?, catalog: NarrationVoices) -> NarrationSelection {
        let voiceId: String
        if let saved = saved?.voiceId, catalog.voices.contains(where: { $0.id == saved }) {
            voiceId = saved
        } else {
            voiceId = catalog.defaultVoiceId
        }
        return NarrationSelection(voiceId: voiceId, style: saved?.style ?? NarrationStyle.defaultStyle)
    }
}

/// Device-local memory of the last narrator choice - Android keeps the same
/// JSON in AsyncStorage under the same key. Written only when the reader
/// generates; not part of the account preferences.
struct NarrationPreferences {
    static let key = "sureword.narrationOptions"

    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> NarrationOptions? {
        guard let text = defaults.string(forKey: Self.key), let data = text.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(NarrationOptions.self, from: data)
    }

    func save(_ options: NarrationOptions) {
        guard let data = try? JSONEncoder().encode(options),
              let text = String(data: data, encoding: .utf8) else { return }
        defaults.set(text, forKey: Self.key)
    }
}
