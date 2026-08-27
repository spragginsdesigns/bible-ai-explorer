import Foundation

// MARK: - Model list

/// One row of `GET /api/ai/models` - the same payload that drives the Android
/// and web pickers (`mobile/src/features/settings/aiApi.ts`).
///
/// Shared rather than per-shell: the iOS `ModelPickerSheet` and the macOS
/// `ModelPickerPopover` decode this exact payload, and a second copy of the
/// wire types is a second place for the server contract to drift.
struct AIModel: Sendable, Equatable, Identifiable, Decodable {
    var id: String
    var label: String
    var provider: String
    var supportsAttachments: Bool = false
    /// Reasoning efforts the model accepts. Empty means the model rejects the
    /// option outright (`modelSupportsEffort` in `src/lib/ai/models.ts`), so no
    /// reasoning control may be offered for it.
    var efforts: [String] = []
    var available: Bool

    private enum CodingKeys: String, CodingKey {
        case id, label, provider, supportsAttachments, efforts, available
    }

    /// Written out rather than synthesized: Swift's `Codable` synthesis ignores
    /// a property's default value, so an absent `efforts` or
    /// `supportsAttachments` would throw and cost the whole picker its list
    /// rather than one capability flag.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        provider = try container.decode(String.self, forKey: .provider)
        supportsAttachments =
            try container.decodeIfPresent(Bool.self, forKey: .supportsAttachments) ?? false
        efforts = try container.decodeIfPresent([String].self, forKey: .efforts) ?? []
        available = try container.decode(Bool.self, forKey: .available)
    }

    init(
        id: String,
        label: String,
        provider: String,
        supportsAttachments: Bool = false,
        efforts: [String] = [],
        available: Bool
    ) {
        self.id = id
        self.label = label
        self.provider = provider
        self.supportsAttachments = supportsAttachments
        self.efforts = efforts
        self.available = available
    }
}

struct AIProviderSummary: Sendable, Equatable, Identifiable, Decodable {
    var id: String
    var label: String
    var available: Bool
}

struct AIModelsResponse: Sendable, Equatable, Decodable {
    struct Defaults: Sendable, Equatable, Decodable {
        var modelId: String
        var effort: String?
    }

    /// Absent from older servers; the picker derives rows from `models` then.
    var providers: [AIProviderSummary]?
    var models: [AIModel]
    var defaults: Defaults
}

enum AIModelsAPI {
    static func load(api: APIClient) async throws -> AIModelsResponse {
        try await api.json("/api/ai/models", as: AIModelsResponse.self)
    }

    static let providerLabels: [String: String] = [
        "openai": "OpenAI",
        "anthropic": "Anthropic",
        "moonshot": "Moonshot",
    ]
}

// MARK: - Bring your own key

/// One bring-your-own-key provider row, as served by `GET /api/providers`.
///
/// Port of `ProviderStatus` in `mobile/src/features/settings/aiApi.ts`. The key
/// itself never comes back from the server — only its last four characters,
/// which is all the UI is allowed to show.
struct AIProviderStatus: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let label: String
    /// Where the user can mint a key, opened in Safari ("Get a key").
    let keyURL: URL?
    let connected: Bool
    let last4: String?
    let validatedAt: String?

    /// The status line under the provider name — Android's
    /// `Key ending in ${last4}` / `Not connected`.
    var statusLine: String {
        if connected, let last4 { return "Key ending in \(last4)" }
        return "Not connected"
    }

    private enum CodingKeys: String, CodingKey {
        case id, label, connected, last4, validatedAt
        case keyURL = "keyUrl"
    }
}

struct AIProvidersResponse: Decodable, Equatable, Sendable {
    /// True when the account can also use SureWord's built-in keys; adding a
    /// personal key then overrides them per provider.
    let serverCredentials: Bool
    let providers: [AIProviderStatus]
}

enum AIProviderAPI {
    static func fetch(api: APIClient) async throws -> AIProvidersResponse {
        try await api.json("/api/providers", as: AIProvidersResponse.self)
    }

    /// Validates the key against the provider before storing it; the server
    /// rejects a bad key with a message, which is surfaced verbatim.
    static func save(api: APIClient, provider: String, apiKey: String) async throws {
        struct Body: Encodable { let provider: String; let apiKey: String }
        struct Response: Decodable { let ok: Bool; let last4: String }
        try await api.json(
            "/api/providers",
            method: "POST",
            body: Body(provider: provider, apiKey: apiKey),
            as: Response.self
        )
    }

    static func remove(api: APIClient, provider: String) async throws {
        struct Body: Encodable { let provider: String }
        struct Response: Decodable { let ok: Bool }
        try await api.json(
            "/api/providers",
            method: "DELETE",
            body: Body(provider: provider),
            as: Response.self
        )
    }
}

/// Drives the Settings → AI Provider section (Android's
/// `ProviderSettingsSection`): list, add/replace with server-side validation,
/// and remove. Follows the `MemoriesModel` pattern — the view owns the
/// instance and calls `configure` once it has the session's API client.
@MainActor
@Observable
final class AIProviderSettingsModel {
    private(set) var response: AIProvidersResponse?
    private(set) var loadFailed = false

    /// The provider whose inline editor is open, if any.
    private(set) var editingProviderID: String?
    var keyInput = ""
    /// True while a save or remove round-trip is in flight.
    private(set) var isPending = false
    private(set) var error: String?

    private var api: APIClient?

    func configure(_ api: APIClient) {
        self.api = api
    }

    func load() async {
        guard let api else { return }
        loadFailed = false
        do {
            response = try await AIProviderAPI.fetch(api: api)
        } catch {
            loadFailed = true
        }
    }

    func beginEditing(_ providerID: String) {
        editingProviderID = providerID
        keyInput = ""
        error = nil
    }

    func cancelEditing() {
        editingProviderID = nil
        keyInput = ""
        error = nil
    }

    /// Validate & save the pasted key. Empty input is a no-op, matching the
    /// Android button's disabled state.
    func save() async {
        guard let api, let providerID = editingProviderID, !isPending else { return }
        let key = keyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }

        isPending = true
        error = nil
        defer { isPending = false }
        do {
            try await AIProviderAPI.save(api: api, provider: providerID, apiKey: key)
            editingProviderID = nil
            keyInput = ""
            await load()
        } catch {
            self.error = (error as? APIError)?.message ?? "Could not save the key."
        }
    }

    func remove(_ providerID: String) async {
        guard let api, !isPending else { return }
        isPending = true
        error = nil
        defer { isPending = false }
        do {
            try await AIProviderAPI.remove(api: api, provider: providerID)
            await load()
        } catch {
            self.error = (error as? APIError)?.message ?? "Could not remove the key."
        }
    }
}
