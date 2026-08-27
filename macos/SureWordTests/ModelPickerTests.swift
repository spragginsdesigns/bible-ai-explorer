import Foundation
import Testing
@testable import SureWord

/// The rules the chat header's model picker runs on. They mirror
/// `src/components/ModelPicker.tsx` and Android's `ModelPickerSheet.tsx`; the
/// gating of the reasoning control is pinned to the server's own rule that a
/// model advertising no `efforts` rejects the option outright
/// (`modelSupportsEffort` in `src/lib/ai/models.ts`).
@Suite("Model picker rules")
struct ModelPickerRulesTests {

    // MARK: - Fixtures

    private static func model(
        _ id: String,
        provider: String,
        label: String? = nil,
        efforts: [String] = ["low", "medium", "high"],
        available: Bool = true
    ) -> AIModel {
        AIModel(
            id: id,
            label: label ?? id,
            provider: provider,
            supportsAttachments: true,
            efforts: efforts,
            available: available
        )
    }

    /// OpenAI unlocked, Anthropic locked - the shape a free account sees once
    /// it has pasted one key.
    private static func response(
        providers: [AIProviderSummary]? = [
            AIProviderSummary(id: "openai", label: "OpenAI", available: true),
            AIProviderSummary(id: "anthropic", label: "Anthropic", available: false),
        ],
        defaultModelId: String = "openai/gpt-5.6-terra",
        defaultEffort: String? = nil
    ) -> AIModelsResponse {
        AIModelsResponse(
            providers: providers,
            models: [
                model("openai/gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra"),
                model("openai/gpt-4o-mini", provider: "openai", label: "GPT-4o mini", efforts: []),
                model(
                    "anthropic/claude-opus-5",
                    provider: "anthropic",
                    label: "Claude Opus 5",
                    available: false
                ),
                model(
                    "anthropic/claude-haiku-4-5",
                    provider: "anthropic",
                    label: "Claude Haiku 4.5",
                    efforts: [],
                    available: false
                ),
            ],
            defaults: .init(modelId: defaultModelId, effort: defaultEffort)
        )
    }

    // MARK: - Selection

    @Test("No list yet means no selection to render")
    func noDataNoSelection() {
        #expect(ModelPickerRules.selectedModelID(in: nil, stored: "openai/gpt-5.6-terra") == nil)
        #expect(ModelPickerRules.selectedModel(in: nil, stored: nil) == nil)
        #expect(ModelPickerRules.buttonLabel(in: nil, stored: "openai/gpt-5.6-terra") == "Model")
    }

    @Test("A stored pick wins while it names a model the account can reach")
    func storedPickWins() {
        let data = Self.response()
        #expect(
            ModelPickerRules.selectedModelID(in: data, stored: "openai/gpt-4o-mini")
                == "openai/gpt-4o-mini"
        )
        #expect(ModelPickerRules.buttonLabel(in: data, stored: "openai/gpt-4o-mini") == "GPT-4o mini")
    }

    @Test("A pick the account can no longer reach falls back to the server default")
    func lockedPickFallsBack() {
        let data = Self.response()
        // The Anthropic key was removed in Settings: the stored id is still
        // there, but the picker must not claim a model that would now fail.
        #expect(
            ModelPickerRules.selectedModelID(in: data, stored: "anthropic/claude-opus-5")
                == "openai/gpt-5.6-terra"
        )
        // Same for an id the server no longer lists at all.
        #expect(
            ModelPickerRules.selectedModelID(in: data, stored: "openai/retired-model")
                == "openai/gpt-5.6-terra"
        )
        #expect(ModelPickerRules.selectedModelID(in: data, stored: nil) == "openai/gpt-5.6-terra")
    }

    @Test("An unknown default names nothing rather than inventing a label")
    func unknownDefault() {
        let data = Self.response(defaultModelId: "openai/not-in-the-list")
        #expect(ModelPickerRules.selectedModel(in: data, stored: nil) == nil)
        #expect(ModelPickerRules.buttonLabel(in: data, stored: nil) == "Model")
    }

    // MARK: - Grouping

    @Test("Provider rows come from the payload, in its order")
    func providersFromPayload() {
        let data = Self.response()
        let providers = ModelPickerRules.providers(in: data)
        #expect(providers.map(\.id) == ["openai", "anthropic"])
        #expect(providers.map(\.available) == [true, false])
    }

    @Test("An older payload with no providers key derives the rows from the models")
    func providersDerived() {
        let data = Self.response(providers: nil)
        let providers = ModelPickerRules.providers(in: data)
        #expect(providers.map(\.id) == ["openai", "anthropic"])
        #expect(providers.map(\.label) == ["OpenAI", "Anthropic"])
        // Availability is taken from the first model seen for that provider.
        #expect(providers.map(\.available) == [true, false])
    }

    @Test("An empty providers array is treated as absent, not as no providers")
    func emptyProvidersDerived() {
        let data = Self.response(providers: [])
        #expect(ModelPickerRules.providers(in: data).map(\.id) == ["openai", "anthropic"])
    }

    @Test("A provider we have no label for keeps its own id as its name")
    func unknownProviderLabel() {
        let data = AIModelsResponse(
            providers: nil,
            models: [Self.model("newco/some-model", provider: "newco")],
            defaults: .init(modelId: "newco/some-model", effort: nil)
        )
        #expect(ModelPickerRules.providers(in: data).map(\.label) == ["newco"])
    }

    @Test("Models group under their provider")
    func modelsGrouped() {
        let data = Self.response()
        #expect(
            ModelPickerRules.models(ofProvider: "openai", in: data).map(\.id)
                == ["openai/gpt-5.6-terra", "openai/gpt-4o-mini"]
        )
        #expect(ModelPickerRules.models(ofProvider: "moonshot", in: data).isEmpty)
    }

    @Test("The popover opens on the provider holding the current model")
    func initialExpansion() {
        let data = Self.response()
        #expect(
            ModelPickerRules.initialExpandedProvider(in: data, stored: "openai/gpt-4o-mini")
                == "openai"
        )
        // A locked stored pick resolves to the default first, so the section
        // that opens is the default's, not the locked one.
        #expect(
            ModelPickerRules.initialExpandedProvider(in: data, stored: "anthropic/claude-opus-5")
                == "openai"
        )
        // Nothing resolvable: fall back to the first row rather than nothing.
        let unknown = Self.response(defaultModelId: "openai/not-in-the-list")
        #expect(ModelPickerRules.initialExpandedProvider(in: unknown, stored: nil) == "openai")
    }

    @Test("Provider subtitle counts models, or tells a locked provider what it needs")
    func providerSubtitles() {
        let unlocked = AIProviderSummary(id: "openai", label: "OpenAI", available: true)
        let locked = AIProviderSummary(id: "anthropic", label: "Anthropic", available: false)
        #expect(ModelPickerRules.providerSubtitle(unlocked, modelCount: 2) == "2 models")
        #expect(ModelPickerRules.providerSubtitle(unlocked, modelCount: 1) == "1 model")
        #expect(ModelPickerRules.providerSubtitle(locked, modelCount: 9) == "Add your API key in Settings")
    }

    // MARK: - Geometry

    @Test("The list is measured from its rows, so a long provider fills the popover")
    func listHeightMeasured() {
        let data = Self.response()
        let collapsed = ModelPickerRules.listHeight(in: data, expandedProvider: nil)
        // Two provider rows and nothing else.
        #expect(collapsed == 2 * ModelPickerRules.providerRowHeight + 2 * Spacing.xs)

        let expanded = ModelPickerRules.listHeight(in: data, expandedProvider: "openai")
        #expect(expanded == collapsed + 2 * ModelPickerRules.modelRowHeight)

        // A locked provider adds its "Add a … key" row on top of its models.
        let locked = ModelPickerRules.listHeight(in: data, expandedProvider: "anthropic")
        #expect(locked == collapsed + 3 * ModelPickerRules.modelRowHeight)
    }

    @Test("A long list is capped rather than growing the popover past the screen")
    func listHeightCapped() {
        let many = (0..<60).map { Self.model("openai/m\($0)", provider: "openai") }
        let data = AIModelsResponse(
            providers: [AIProviderSummary(id: "openai", label: "OpenAI", available: true)],
            models: many,
            defaults: .init(modelId: "openai/m0", effort: nil)
        )
        #expect(
            ModelPickerRules.listHeight(in: data, expandedProvider: "openai")
                == ModelPickerRules.maxListHeight
        )
    }

    // MARK: - Reasoning effort

    @Test("Effort chips follow the model, in canonical order")
    func effortsCanonical() {
        let reasoning = Self.model("openai/gpt-5.6-terra", provider: "openai", efforts: ["high", "low"])
        #expect(ModelPickerRules.efforts(for: reasoning) == ["low", "high"])
        #expect(ModelPickerRules.supportsEffort(reasoning))
    }

    @Test("A model that rejects the option shows no reasoning control at all")
    func noEffortsNoControl() {
        let plain = Self.model("openai/gpt-4o-mini", provider: "openai", efforts: [])
        #expect(ModelPickerRules.efforts(for: plain).isEmpty)
        #expect(!ModelPickerRules.supportsEffort(plain))
        #expect(!ModelPickerRules.supportsEffort(nil))
        #expect(ModelPickerRules.efforts(for: nil).isEmpty)
    }

    @Test("An effort we don't understand never draws a chip")
    func unknownEffortIgnored() {
        let odd = Self.model("newco/x", provider: "newco", efforts: ["ludicrous", "medium"])
        #expect(ModelPickerRules.efforts(for: odd) == ["medium"])
    }

    @Test("An effort the current model rejects reads as Auto without being lost")
    func activeEffortIsDisplayOnly() {
        let reasoning = Self.model("openai/gpt-5.6-terra", provider: "openai")
        let plain = Self.model("openai/gpt-4o-mini", provider: "openai", efforts: [])
        let partial = Self.model("newco/x", provider: "newco", efforts: ["low"])

        #expect(ModelPickerRules.activeEffort("high", for: reasoning) == "high")
        #expect(ModelPickerRules.activeEffort("high", for: plain) == nil)
        #expect(ModelPickerRules.activeEffort("high", for: partial) == nil)
        #expect(ModelPickerRules.activeEffort("low", for: partial) == "low")
        // Auto stays Auto.
        #expect(ModelPickerRules.activeEffort(nil, for: reasoning) == nil)
        #expect(ModelPickerRules.activeEffort("high", for: nil) == nil)
    }

    @MainActor
    @Test("Picking a model keeps the stored effort - a detour must not cost it")
    func pickingAModelKeepsTheStoredEffort() {
        // The bug this pins: picking a non-reasoning model used to write the
        // normalized (nil) effort back into `SettingsStore`, so a two-second
        // look at GPT-4o mini permanently threw away a chosen "high". Web
        // keeps the preference (`pickModel` in `src/components/ModelPicker.tsx`
        // sets the model id and nothing else) and the server drops an effort
        // the model rejects itself (`resolveModel` in `src/lib/ai/provider.ts`).
        // `SettingsStore` is backed by `UserDefaults.standard`, so put back
        // whatever this machine actually had.
        let settings = SettingsStore()
        let priorEffort = settings.chatEffort
        let priorModelId = settings.chatModelId
        defer {
            settings.chatEffort = priorEffort
            settings.chatModelId = priorModelId
        }
        settings.chatEffort = "high"

        let plain = Self.model("openai/gpt-4o-mini", provider: "openai", efforts: [])
        // What the row's action does, in full.
        settings.chatModelId = plain.id

        #expect(settings.chatEffort == "high")
        // The reasoning control simply hides while such a model is picked...
        #expect(!ModelPickerRules.supportsEffort(plain))
        #expect(ModelPickerRules.activeEffort(settings.chatEffort, for: plain) == nil)

        // ...and the preference is still there when a reasoning model returns.
        let reasoning = Self.model("openai/gpt-5.6-terra", provider: "openai")
        settings.chatModelId = reasoning.id
        #expect(settings.chatEffort == "high")
        #expect(ModelPickerRules.supportsEffort(reasoning))
        #expect(ModelPickerRules.activeEffort(settings.chatEffort, for: reasoning) == "high")
    }

    @Test("Effort labels, with nil reading as Auto")
    func effortLabels() {
        #expect(ModelPickerRules.effortLabel(nil) == "Auto")
        #expect(ModelPickerRules.effortLabel("low") == "Low")
        #expect(ModelPickerRules.effortLabel("medium") == "Medium")
        #expect(ModelPickerRules.effortLabel("high") == "High")
        #expect(ModelPickerRules.effortLabel("ludicrous") == "Auto")
    }

    // MARK: - Wire decoding

    @Test("Decodes the /api/ai/models payload, defaults included")
    func decodesPayload() throws {
        let json = """
        {
          "providers": [
            { "id": "openai", "label": "OpenAI", "available": true },
            { "id": "anthropic", "label": "Anthropic", "available": false }
          ],
          "models": [
            {
              "id": "openai/gpt-5.6-terra",
              "label": "GPT-5.6 Terra",
              "provider": "openai",
              "supportsAttachments": true,
              "efforts": ["low", "medium", "high"],
              "available": true
            }
          ],
          "defaults": { "modelId": "openai/gpt-5.6-terra", "effort": null }
        }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        #expect(decoded.models.count == 1)
        #expect(decoded.models[0].label == "GPT-5.6 Terra")
        #expect(decoded.defaults.modelId == "openai/gpt-5.6-terra")
        #expect(decoded.defaults.effort == nil)
        #expect(decoded.providers?.count == 2)
    }

    @Test("A minimal model row still decodes - absent optionals take defaults")
    func decodesMinimalModel() throws {
        let json = """
        { "models": [{ "id": "a/b", "label": "B", "provider": "a", "available": true }],
          "defaults": { "modelId": "a/b" } }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        #expect(decoded.providers == nil)
        #expect(decoded.models[0].efforts.isEmpty)
        #expect(decoded.models[0].supportsAttachments == false)
        #expect(decoded.defaults.effort == nil)
    }
}

/// Settings → AI Providers. Decoding and the status line are the whole of the
/// section's pure logic: everything else is a round-trip to `/api/providers`.
@Suite("AI provider settings")
struct AIProviderSettingsTests {

    @Test("Only the last four characters of a key are ever shown")
    func statusLine() throws {
        let connected = try JSONDecoder().decode(
            AIProviderStatus.self,
            from: Data(
                """
                { "id": "openai", "label": "OpenAI", "keyUrl": "https://platform.openai.com/api-keys",
                  "connected": true, "last4": "aB3z", "validatedAt": "2026-08-27T00:00:00.000Z" }
                """.utf8
            )
        )
        #expect(connected.statusLine == "Key ending in aB3z")
        #expect(connected.keyURL?.host() == "platform.openai.com")
    }

    @Test("A provider with no key reads as not connected")
    func notConnected() throws {
        let status = try JSONDecoder().decode(
            AIProviderStatus.self,
            from: Data(
                """
                { "id": "anthropic", "label": "Anthropic", "keyUrl": null,
                  "connected": false, "last4": null, "validatedAt": null }
                """.utf8
            )
        )
        #expect(status.statusLine == "Not connected")
        #expect(status.keyURL == nil)
    }

    @Test("A connected provider with no last4 does not claim a key ending in nothing")
    func connectedWithoutLast4() throws {
        let status = try JSONDecoder().decode(
            AIProviderStatus.self,
            from: Data(
                """
                { "id": "moonshot", "label": "Moonshot", "keyUrl": null,
                  "connected": true, "last4": null, "validatedAt": null }
                """.utf8
            )
        )
        #expect(status.statusLine == "Not connected")
    }

    @Test("Decodes the /api/providers envelope")
    func decodesEnvelope() throws {
        let json = """
        { "serverCredentials": true,
          "providers": [
            { "id": "openai", "label": "OpenAI", "keyUrl": "https://platform.openai.com/api-keys",
              "connected": false, "last4": null, "validatedAt": null }
          ] }
        """
        let decoded = try JSONDecoder().decode(AIProvidersResponse.self, from: Data(json.utf8))
        #expect(decoded.serverCredentials)
        #expect(decoded.providers.map(\.id) == ["openai"])
    }

    @Test("Whitespace is not a key: Save stays disabled for it")
    func saveGate() {
        #expect(!ProviderSettingsSection.canSave(""))
        #expect(!ProviderSettingsSection.canSave("   "))
        #expect(!ProviderSettingsSection.canSave("\n\t "))
        #expect(ProviderSettingsSection.canSave("sk-live-abc"))
        #expect(ProviderSettingsSection.canSave("  sk-live-abc  "))
    }

    @MainActor
    @Test("Editing state opens and closes without touching the network")
    func editingState() {
        let model = AIProviderSettingsModel()
        #expect(model.editingProviderID == nil)

        model.keyInput = "leftover"
        model.beginEditing("openai")
        #expect(model.editingProviderID == "openai")
        // Opening the editor must never carry another provider's typed key in.
        #expect(model.keyInput.isEmpty)

        model.keyInput = "sk-live-abc"
        model.cancelEditing()
        #expect(model.editingProviderID == nil)
        #expect(model.keyInput.isEmpty)
        #expect(model.error == nil)
    }

    @MainActor
    @Test("An unconfigured model is inert rather than crashing")
    func unconfiguredIsInert() async {
        let model = AIProviderSettingsModel()
        await model.load()
        #expect(model.response == nil)
        #expect(!model.loadFailed)

        model.beginEditing("openai")
        model.keyInput = "sk-live-abc"
        await model.save()
        // No API client, so nothing was sent and the editor stays as it was.
        #expect(model.editingProviderID == "openai")
        #expect(!model.isPending)
    }
}

@MainActor
@Suite("Model picker model")
struct ModelPickerModelTests {

    @Test("Without an API client the picker loads nothing and reports no failure")
    func unconfigured() async {
        let model = ModelPickerModel()
        await model.load()
        #expect(model.data == nil)
        #expect(!model.loadFailed)
        #expect(!model.isLoading)
    }

    @Test("A failed load with no data behind it is a visible failure")
    func failedLoadSurfaces() async {
        // A client pointed at a port nothing answers on: the request fails
        // fast, and with no cached list the popover must offer Retry rather
        // than spin forever.
        let model = ModelPickerModel()
        model.configure(
            APIClient(
                baseURL: URL(string: "http://127.0.0.1:9")!,
                token: { _ in nil },
                onAuthFailure: {}
            )
        )
        await model.load()
        #expect(model.data == nil)
        #expect(model.loadFailed)
        #expect(!model.isLoading)
    }
}
