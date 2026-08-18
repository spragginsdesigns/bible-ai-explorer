import Foundation

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
