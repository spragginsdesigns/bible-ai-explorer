import Foundation

// MARK: - Model list

/// One row of `GET /api/ai/models` - the same payload that drives the Android
/// and web pickers (`mobile/src/features/settings/aiApi.ts`).
///
/// Shared rather than per-shell: the iOS `ModelPickerSheet` and the macOS
/// `ModelPickerPopover` decode this exact payload, and a second copy of the
/// wire types is a second place for the server contract to drift.
struct AIModel: Sendable, Equatable, Identifiable, Decodable {
    /// USD per one million tokens, as the server curates it.
    struct Pricing: Sendable, Equatable, Decodable {
        var input: Double
        var output: Double
    }

    var id: String
    var label: String
    var provider: String
    var supportsAttachments: Bool = false
    /// Reasoning efforts the model accepts. Empty means the model rejects the
    /// option outright (`modelSupportsEffort` in `src/lib/ai/models.ts`), so no
    /// reasoning control may be offered for it.
    var efforts: [String] = []
    var available: Bool
    /// Service tiers the model accepts. `["standard"]` alone means there is no
    /// choice to offer, which is why it - not `[]` - is the default: a server
    /// too old to send the field has exactly one speed.
    var speeds: [String] = ["standard"]
    /// Answer-length settings the model accepts. Empty means no control at all,
    /// the same rule `efforts` follows.
    var verbosities: [String] = []
    /// Reasoning modes. `["standard"]` alone means no choice, as with `speeds`.
    var modes: [String] = ["standard"]
    /// What the provider runs when no effort is sent, when the server knows it.
    var defaultEffort: String?
    /// One curated line under the model's name. Nil for anything uncurated, in
    /// which case the picker derives a line from `contextWindow` and `pricing`.
    var tagline: String?
    /// `"flagship"` / `"balanced"` / `"fast"`, or nil.
    var tier: String?
    var contextWindow: Int?
    var pricing: Pricing?
    /// Caveat shown next to the Fast chip, e.g. "About 2x the standard price".
    var fastModeNote: String?
    /// SureWord Pro's row (2026-10-25): both plans are labelled "SureWord AI",
    /// and this flag is what earns the Pro one its premium mark. Absent from
    /// older servers, which reads as false.
    var premium: Bool = false

    private enum CodingKeys: String, CodingKey {
        case id, label, provider, supportsAttachments, efforts, available
        case speeds, verbosities, modes, defaultEffort, tagline, tier
        case contextWindow, pricing, fastModeNote, premium
    }

    /// Written out rather than synthesized: Swift's `Codable` synthesis ignores
    /// a property's default value, so an absent `efforts` or
    /// `supportsAttachments` would throw and cost the whole picker its list
    /// rather than one capability flag.
    ///
    /// **Every new field must be `decodeIfPresent … ?? default` for that same
    /// reason** - a new build talking to an older server would otherwise lose
    /// the entire list rather than one capability.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        provider = try container.decode(String.self, forKey: .provider)
        supportsAttachments =
            try container.decodeIfPresent(Bool.self, forKey: .supportsAttachments) ?? false
        efforts = try container.decodeIfPresent([String].self, forKey: .efforts) ?? []
        available = try container.decode(Bool.self, forKey: .available)
        speeds = try container.decodeIfPresent([String].self, forKey: .speeds) ?? ["standard"]
        verbosities = try container.decodeIfPresent([String].self, forKey: .verbosities) ?? []
        modes = try container.decodeIfPresent([String].self, forKey: .modes) ?? ["standard"]
        defaultEffort = try container.decodeIfPresent(String.self, forKey: .defaultEffort)
        tagline = try container.decodeIfPresent(String.self, forKey: .tagline)
        tier = try container.decodeIfPresent(String.self, forKey: .tier)
        contextWindow = try container.decodeIfPresent(Int.self, forKey: .contextWindow)
        pricing = try container.decodeIfPresent(Pricing.self, forKey: .pricing)
        fastModeNote = try container.decodeIfPresent(String.self, forKey: .fastModeNote)
        premium = try container.decodeIfPresent(Bool.self, forKey: .premium) ?? false
    }

    init(
        id: String,
        label: String,
        provider: String,
        supportsAttachments: Bool = false,
        efforts: [String] = [],
        available: Bool,
        speeds: [String] = ["standard"],
        verbosities: [String] = [],
        modes: [String] = ["standard"],
        defaultEffort: String? = nil,
        tagline: String? = nil,
        tier: String? = nil,
        contextWindow: Int? = nil,
        pricing: Pricing? = nil,
        fastModeNote: String? = nil,
        premium: Bool = false
    ) {
        self.id = id
        self.label = label
        self.provider = provider
        self.supportsAttachments = supportsAttachments
        self.efforts = efforts
        self.available = available
        self.speeds = speeds
        self.verbosities = verbosities
        self.modes = modes
        self.defaultEffort = defaultEffort
        self.tagline = tagline
        self.tier = tier
        self.contextWindow = contextWindow
        self.pricing = pricing
        self.fastModeNote = fastModeNote
        self.premium = premium
    }
}

struct AIProviderSummary: Sendable, Equatable, Identifiable, Decodable {
    var id: String
    var label: String
    var available: Bool
}

struct AIModelsResponse: Sendable, Equatable, Decodable {
    /// The account's stored picks, each nil when nothing has been chosen.
    /// Every field but `modelId` is optional on the wire as well as here, so an
    /// older server that only speaks `effort` still decodes.
    struct Defaults: Sendable, Equatable, Decodable {
        var modelId: String
        var effort: String?
        // `= nil` is load-bearing, not decoration: the synthesized memberwise
        // initializer only defaults a property that has an initial value, so
        // without it every existing `.init(modelId:effort:)` call stops
        // compiling.
        var speed: String? = nil
        var verbosity: String? = nil
        var mode: String? = nil
    }

    /// The single model a keyless account gets, served alongside
    /// `access: "house"`.
    ///
    /// House mode is not a degraded keys mode. There is nothing to choose, so
    /// the picker shows this one row, its note, and a way into Settings - and
    /// never a locked provider the user cannot act on from there.
    struct HouseModel: Sendable, Equatable, Decodable {
        var modelId: String
        /// "SureWord AI" on both plans since 2026-10-25; `premium` tells Pro
        /// apart.
        var label: String
        /// The effort the next answer runs at: the account's stored pick on Pro,
        /// `"medium"` on Free.
        var effort: String?
        var note: String?
        /// The reasoning efforts this account may choose on the included model:
        /// `low` / `medium` / `high` on Pro, empty on Free. Absent from servers
        /// before 2026-10-08, which read as "no choice". `= nil` keeps the
        /// existing memberwise `.init(modelId:label:effort:note:)` calls valid.
        var efforts: [String]? = nil
        /// True on SureWord Pro, which draws the premium mark beside the label.
        /// Absent from servers before 2026-10-25. Optional so the synthesized
        /// decoder reads it with `decodeIfPresent`; read through `isPremium`,
        /// so absence means Free.
        var premium: Bool? = nil

        var isPremium: Bool { premium ?? false }
    }

    /// `"house"` for every account on included AI, `"keys"` for the owner's
    /// list of SureWord plans (bring-your-own-key ended 2026-10-25). Absent
    /// from older servers, which only ever spoke the keys shape, so its
    /// absence must keep meaning "keys", not "unknown".
    var access: String? = nil
    /// Absent from older servers; the picker derives rows from `models` then.
    var providers: [AIProviderSummary]? = nil
    var models: [AIModel]
    var defaults: Defaults
    /// Present only in house mode.
    var house: HouseModel? = nil
}

enum AIModelsAPI {
    static func load(api: APIClient) async throws -> AIModelsResponse {
        try await api.json("/api/ai/models", as: AIModelsResponse.self)
    }

    static let providerLabels: [String: String] = [
        "openai": "OpenAI",
        "anthropic": "Anthropic",
        "moonshot": "Moonshot",
        "openrouter": "OpenRouter",
        "sureword": "SureWord",
    ]

    /// Whether the current pick is SureWord Pro: the house block's flag in
    /// house mode, else the selected model row's.
    static func isPremium(house: AIModelsResponse.HouseModel?, selected: AIModel?) -> Bool {
        if let house { return house.isPremium }
        return selected?.premium ?? false
    }
}
