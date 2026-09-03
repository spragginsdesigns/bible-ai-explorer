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
        available: Bool = true,
        speeds: [String] = ["standard"],
        verbosities: [String] = [],
        modes: [String] = ["standard"],
        tagline: String? = nil,
        contextWindow: Int? = nil,
        pricing: AIModel.Pricing? = nil,
        fastModeNote: String? = nil
    ) -> AIModel {
        AIModel(
            id: id,
            label: label ?? id,
            provider: provider,
            supportsAttachments: true,
            efforts: efforts,
            available: available,
            speeds: speeds,
            verbosities: verbosities,
            modes: modes,
            tagline: tagline,
            contextWindow: contextWindow,
            pricing: pricing,
            fastModeNote: fastModeNote
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

    /// What a keyless account gets: `access: "house"`, one model, no provider
    /// rows at all, and the effort pinned server-side.
    private static func houseResponse(
        note: String? = "SureWord's own model, tuned for Scripture.",
        effort: String? = "medium"
    ) -> AIModelsResponse {
        AIModelsResponse(
            access: "house",
            providers: [],
            models: [
                model("openai/gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna")
            ],
            defaults: .init(modelId: "openai/gpt-5.6-luna", effort: effort),
            house: .init(
                modelId: "openai/gpt-5.6-luna",
                label: "GPT-5.6 Luna",
                effort: effort,
                note: note
            )
        )
    }

    // MARK: - House mode

    @Test("House mode shows one model, selected, whatever was stored before")
    func houseMode() {
        let data = Self.houseResponse()
        #expect(ModelPickerRules.isHouse(data))
        #expect(ModelPickerRules.house(in: data)?.label == "GPT-5.6 Luna")

        // A pick left over from a key the account no longer has must not read
        // as active beside the one model it can actually reach.
        #expect(
            ModelPickerRules.selectedModelID(in: data, stored: "anthropic/claude-opus-5")
                == "openai/gpt-5.6-luna"
        )
        #expect(ModelPickerRules.selectedModelID(in: data, stored: nil) == "openai/gpt-5.6-luna")
        #expect(ModelPickerRules.buttonLabel(in: data, stored: "anthropic/claude-opus-5") == "GPT-5.6 Luna")

        // No provider rows, no chevrons, no effort chips: nothing here is a
        // choice, and a locked row would only advertise one that is missing.
        #expect(ModelPickerRules.providers(in: data).isEmpty)
        #expect(ModelPickerRules.initialExpandedProvider(in: data, stored: nil) == nil)
        #expect(ModelPickerRules.efforts(in: data, stored: nil).isEmpty)
        #expect(!ModelPickerRules.supportsEffort(in: data, stored: nil))
    }

    @Test("The house note is the server's, or ours when it sends none")
    func houseNoteCopy() throws {
        let served = try #require(ModelPickerRules.house(in: Self.houseResponse()))
        #expect(ModelPickerRules.houseNote(served) == "SureWord's own model, tuned for Scripture.")

        // Whitespace is not a note: it would render as a blank line under the
        // model name and read as a layout bug.
        let blank = try #require(ModelPickerRules.house(in: Self.houseResponse(note: "   ")))
        #expect(ModelPickerRules.houseNote(blank) == ModelPickerRules.fallbackHouseNote)

        let absent = try #require(ModelPickerRules.house(in: Self.houseResponse(note: nil)))
        #expect(ModelPickerRules.houseNote(absent) == ModelPickerRules.fallbackHouseNote)
    }

    @Test("Keys mode is the default reading, including for a server too old to say")
    func keysModeUnlessSaidOtherwise() {
        // No `access` field at all: the older payload only ever spoke keys, and
        // its silence must not be read as house.
        #expect(!ModelPickerRules.isHouse(Self.response()))
        #expect(ModelPickerRules.house(in: Self.response()) == nil)
        #expect(!ModelPickerRules.isHouse(nil))

        // `access: "house"` with no block to render is not house mode either -
        // there would be nothing to draw.
        var broken = Self.houseResponse()
        broken.house = nil
        #expect(!ModelPickerRules.isHouse(broken))
        #expect(ModelPickerRules.providers(in: broken).map(\.id) == ["openai"])
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

    @Test("Provider rows come from the payload, in its order, locked ones dropped")
    func providersFromPayload() {
        let data = Self.response()
        let providers = ModelPickerRules.providers(in: data)
        // Anthropic has no key on this account. It used to draw a locked row
        // with an "Add your API key" subtitle - an advert the picker cannot act
        // on, which made a keyless account's list read as mostly broken.
        #expect(providers.map(\.id) == ["openai"])
        #expect(providers.allSatisfy { $0.available })
    }

    @Test("An older payload with no providers key derives the rows from the models")
    func providersDerived() {
        let data = Self.response(providers: nil)
        let providers = ModelPickerRules.providers(in: data)
        // Availability is taken from the first model seen for that provider,
        // and the locked one is dropped just as it is from a modern payload.
        #expect(providers.map(\.id) == ["openai"])
        #expect(providers.map(\.label) == ["OpenAI"])
    }

    @Test("An empty providers array is treated as absent, not as no providers")
    func emptyProvidersDerived() {
        let data = Self.response(providers: [])
        #expect(ModelPickerRules.providers(in: data).map(\.id) == ["openai"])
    }

    @Test("A payload whose providers are all locked draws no rows at all")
    func everyProviderLocked() {
        let data = Self.response(
            providers: [AIProviderSummary(id: "anthropic", label: "Anthropic", available: false)]
        )
        #expect(ModelPickerRules.providers(in: data).isEmpty)
        // The account default still names an OpenAI model, but there is no
        // OpenAI row to open - expanding one that is not drawn opens nothing.
        #expect(ModelPickerRules.initialExpandedProvider(in: data, stored: nil) == nil)
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

    @Test("Models group under their provider, and only reachable ones list")
    func modelsGrouped() {
        let data = Self.response()
        #expect(
            ModelPickerRules.models(ofProvider: "openai", in: data).map(\.id)
                == ["openai/gpt-5.6-terra", "openai/gpt-4o-mini"]
        )
        // Anthropic's models are in the payload but unreachable, so the picker
        // never draws them - the same rule that drops their provider row.
        #expect(ModelPickerRules.models(ofProvider: "anthropic", in: data).isEmpty)
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

    @Test("Provider subtitle counts models")
    func providerSubtitles() {
        #expect(ModelPickerRules.providerSubtitle(modelCount: 2) == "2 models")
        #expect(ModelPickerRules.providerSubtitle(modelCount: 1) == "1 model")
        #expect(ModelPickerRules.providerSubtitle(modelCount: 0) == "0 models")
    }

    // MARK: - Geometry

    @Test("The list is measured from its rows, so a long provider fills the popover")
    func listHeightMeasured() {
        let data = Self.response()
        let collapsed = ModelPickerRules.listHeight(in: data, expandedProvider: nil)
        // One provider row: the locked one is not drawn, so it is not measured.
        #expect(collapsed == ModelPickerRules.providerRowHeight + 2 * Spacing.xs)

        let expanded = ModelPickerRules.listHeight(in: data, expandedProvider: "openai")
        #expect(expanded == collapsed + 2 * ModelPickerRules.modelRowHeight)

        // A provider with no row of its own contributes nothing at all.
        #expect(ModelPickerRules.listHeight(in: data, expandedProvider: "anthropic") == collapsed)
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
        #expect(ModelPickerRules.effortLabel("none") == "Off")
        #expect(ModelPickerRules.effortLabel("minimal") == "Minimal")
        #expect(ModelPickerRules.effortLabel("low") == "Low")
        #expect(ModelPickerRules.effortLabel("medium") == "Medium")
        #expect(ModelPickerRules.effortLabel("high") == "High")
        #expect(ModelPickerRules.effortLabel("xhigh") == "Extra")
        #expect(ModelPickerRules.effortLabel("max") == "Max")
        #expect(ModelPickerRules.effortLabel("ludicrous") == "Auto")
    }

    @Test("The whole effort vocabulary draws, lowest to highest")
    func fullEffortVocabulary() {
        #expect(
            ModelPickerRules.effortOrder
                == ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
        )
        // Served out of order and with a value we don't know: canonical order
        // wins and the stranger never draws a chip.
        let wide = Self.model(
            "openai/gpt-5.6-sol",
            provider: "openai",
            efforts: ["max", "ludicrous", "none", "high", "minimal"]
        )
        #expect(ModelPickerRules.efforts(for: wide) == ["none", "minimal", "high", "max"])
        // "none" is a real choice, not the absence of one - Auto is still nil.
        #expect(ModelPickerRules.activeEffort("none", for: wide) == "none")
        #expect(ModelPickerRules.activeEffort("medium", for: wide) == nil)
    }

    @Test("Auto is a stored choice, and reads as Auto rather than as a value")
    func autoSentinel() {
        let wide = Self.model(
            "openai/gpt-5.6-sol",
            provider: "openai",
            efforts: ["low", "medium", "high"]
        )
        // Tapping Auto stores the sentinel. Nil would mean "never chose", which
        // the server reads as "apply the account default" - the opposite.
        #expect(ModelPickerRules.storedEffort(nil) == AskQuestionRequest.autoEffort)
        #expect(ModelPickerRules.storedEffort("high") == "high")

        // ...and it reads back as Auto: no chip value matches it, and the
        // summary says nothing about it.
        #expect(ModelPickerRules.activeEffort(AskQuestionRequest.autoEffort, for: wide) == nil)
        #expect(ModelPickerRules.effortLabel(AskQuestionRequest.autoEffort) == "Auto")
        #expect(!ModelPickerRules.efforts(for: wide).contains(AskQuestionRequest.autoEffort))
    }

    // MARK: - Speed, length and mode

    @Test("Speed chips only for a model that has a second speed")
    func speedRules() {
        let fast = Self.model(
            "openai/gpt-5.6-luna",
            provider: "openai",
            speeds: ["standard", "fast"]
        )
        #expect(ModelPickerRules.speeds(for: fast) == ["standard", "fast"])
        // One speed is not a choice, and a row whose every chip does the same
        // thing is worse than no row.
        #expect(ModelPickerRules.speeds(for: Self.model("openai/x", provider: "openai")).isEmpty)
        #expect(ModelPickerRules.speeds(for: nil).isEmpty)

        // Display: nil and "standard" both read as the default chip, and a
        // value this model cannot honour falls back to it without being erased.
        #expect(ModelPickerRules.activeSpeed(nil, for: fast) == "standard")
        #expect(ModelPickerRules.activeSpeed("standard", for: fast) == "standard")
        #expect(ModelPickerRules.activeSpeed("fast", for: fast) == "fast")
        #expect(
            ModelPickerRules.activeSpeed("fast", for: Self.model("openai/x", provider: "openai"))
                == "standard"
        )
    }

    @Test("Length chips need more than the default to be worth drawing")
    func verbosityRules() {
        let full = Self.model(
            "anthropic/claude-opus-5",
            provider: "anthropic",
            verbosities: ["low", "medium", "high"]
        )
        #expect(ModelPickerRules.verbosities(for: full) == ["low", "medium", "high"])
        // No verbosities at all: the model rejects the option outright.
        #expect(ModelPickerRules.verbosities(for: Self.model("a/b", provider: "a")).isEmpty)
        // Only the default: nothing to choose between.
        #expect(
            ModelPickerRules.verbosities(
                for: Self.model("a/b", provider: "a", verbosities: ["medium"])
            ).isEmpty
        )
        #expect(ModelPickerRules.activeVerbosity(nil, for: full) == "medium")
        #expect(ModelPickerRules.activeVerbosity("high", for: full) == "high")
        #expect(ModelPickerRules.activeVerbosity("high", for: nil) == "medium")
    }

    @Test("Mode chips only where Pro is actually offered")
    func modeRules() {
        let pro = Self.model(
            "openai/gpt-5.6-sol",
            provider: "openai",
            modes: ["standard", "pro"]
        )
        #expect(ModelPickerRules.modes(for: pro) == ["standard", "pro"])
        #expect(ModelPickerRules.modes(for: Self.model("a/b", provider: "a")).isEmpty)
        #expect(ModelPickerRules.activeMode(nil, for: pro) == "standard")
        #expect(ModelPickerRules.activeMode("pro", for: pro) == "pro")
        #expect(ModelPickerRules.activeMode("pro", for: nil) == "standard")
    }

    @MainActor
    @Test("Picking the default chip stores it verbatim, never nil")
    func defaultChipStoresItsOwnValue() {
        // The bug this pins: writing nil for Standard would be read by the
        // server as "no opinion, apply the account's stored default", so a user
        // who once chose Fast and then deliberately chose Standard would keep
        // running Fast. Nil means one thing only - never chose.
        // `SettingsStore` is backed by `UserDefaults.standard`, so put back
        // whatever this machine actually had.
        let settings = SettingsStore()
        let prior = (settings.chatSpeed, settings.chatVerbosity, settings.chatMode)
        defer {
            settings.chatSpeed = prior.0
            settings.chatVerbosity = prior.1
            settings.chatMode = prior.2
        }

        let rich = Self.model(
            "openai/gpt-5.6-luna",
            provider: "openai",
            speeds: ["standard", "fast"],
            verbosities: ["low", "medium", "high"],
            modes: ["standard", "pro"]
        )

        // What the chips' actions do, in full.
        settings.chatSpeed = "fast"
        settings.chatVerbosity = "high"
        settings.chatMode = "pro"
        #expect(ModelPickerRules.activeSpeed(settings.chatSpeed, for: rich) == "fast")

        settings.chatSpeed = "standard"
        settings.chatVerbosity = "medium"
        settings.chatMode = "standard"
        #expect(settings.chatSpeed == "standard")
        #expect(settings.chatVerbosity == "medium")
        #expect(settings.chatMode == "standard")

        // ...and the explicit default is invisible in the UI: it reads as the
        // default chip and adds nothing to the summary, exactly as nil does.
        #expect(ModelPickerRules.activeSpeed("standard", for: rich) == "standard")
        #expect(ModelPickerRules.activeSpeed(nil, for: rich) == "standard")
        #expect(ModelPickerRules.activeVerbosity("medium", for: rich) == "medium")
        #expect(ModelPickerRules.activeMode("standard", for: rich) == "standard")
    }

    @Test("Option labels")
    func optionLabels() {
        #expect(ModelPickerRules.speedLabel(nil) == "Standard")
        #expect(ModelPickerRules.speedLabel("standard") == "Standard")
        #expect(ModelPickerRules.speedLabel("fast") == "Fast")

        #expect(ModelPickerRules.verbosityLabel(nil) == "Normal")
        #expect(ModelPickerRules.verbosityLabel("medium") == "Normal")
        #expect(ModelPickerRules.verbosityLabel("low") == "Brief")
        #expect(ModelPickerRules.verbosityLabel("high") == "Detailed")

        #expect(ModelPickerRules.modeLabel(nil) == "Standard")
        #expect(ModelPickerRules.modeLabel("standard") == "Standard")
        #expect(ModelPickerRules.modeLabel("pro") == "Pro")

        // Both shells must show the same copy under the MODE chips, and it
        // carries no trailing period.
        #expect(
            ModelPickerRules.proModeNote == "Deeper multi-pass reasoning; slower and pricier"
        )
    }

    @Test("House mode offers none of the four option rows")
    func houseModeHasNoOptions() {
        let data = Self.houseResponse()
        #expect(ModelPickerRules.efforts(in: data, stored: nil).isEmpty)
        #expect(ModelPickerRules.speeds(in: data, stored: nil).isEmpty)
        #expect(ModelPickerRules.verbosities(in: data, stored: nil).isEmpty)
        #expect(ModelPickerRules.modes(in: data, stored: nil).isEmpty)
    }

    @MainActor
    @Test("An account default seeds only what was never chosen here")
    func seedingFromServerDefaults() {
        // `SettingsStore` is backed by `UserDefaults.standard`, so put back
        // whatever this machine actually had.
        let settings = SettingsStore()
        let prior = (
            settings.chatEffort, settings.chatSpeed,
            settings.chatVerbosity, settings.chatMode
        )
        defer {
            settings.chatEffort = prior.0
            settings.chatSpeed = prior.1
            settings.chatVerbosity = prior.2
            settings.chatMode = prior.3
        }

        var data = Self.response()
        data.defaults = .init(
            modelId: "openai/gpt-5.6-terra",
            effort: "high",
            speed: "fast",
            verbosity: "low",
            mode: "pro"
        )

        settings.chatEffort = nil
        settings.chatSpeed = nil
        settings.chatVerbosity = nil
        settings.chatMode = nil
        ModelPickerRules.seedDefaults(from: data, into: settings)
        #expect(settings.chatEffort == "high")
        #expect(settings.chatSpeed == "fast")
        #expect(settings.chatVerbosity == "low")
        #expect(settings.chatMode == "pro")

        // A local pick always wins - seeding fills a gap, it never corrects a
        // choice. Auto counts as a choice, which is the whole point of the
        // sentinel: nil would be overwritten here, "auto" is not.
        settings.chatEffort = AskQuestionRequest.autoEffort
        settings.chatSpeed = "standard"
        ModelPickerRules.seedDefaults(from: data, into: settings)
        #expect(settings.chatEffort == AskQuestionRequest.autoEffort)
        #expect(settings.chatSpeed == "standard")

        // Nothing to seed from leaves the gap open, so the request keeps
        // omitting the key rather than pinning a value nobody chose.
        settings.chatEffort = nil
        ModelPickerRules.seedDefaults(from: Self.response(), into: settings)
        #expect(settings.chatEffort == nil)

        // House mode pins its options server-side: there is no user default to
        // honour, and seeding one would make an inert chip look chosen.
        settings.chatEffort = nil
        ModelPickerRules.seedDefaults(from: Self.houseResponse(), into: settings)
        #expect(settings.chatEffort == nil)
    }

    // MARK: - Summary

    @Test("The summary names the model and only what is off its default")
    func summaryLabelCopy() {
        let data = AIModelsResponse(
            providers: [AIProviderSummary(id: "openai", label: "OpenAI", available: true)],
            models: [
                Self.model(
                    "openai/gpt-5.6-luna",
                    provider: "openai",
                    label: "GPT-5.6 Luna",
                    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
                    speeds: ["standard", "fast"],
                    verbosities: ["low", "medium", "high"],
                    modes: ["standard", "pro"]
                )
            ],
            defaults: .init(modelId: "openai/gpt-5.6-luna", effort: nil)
        )

        // Everything at its default: just the model. Auto contributes nothing,
        // or every default would read as a setting somebody chose.
        #expect(
            ModelPickerRules.summaryLabel(
                in: data, stored: nil, effort: nil, speed: nil, verbosity: nil, mode: nil
            ) == "GPT-5.6 Luna"
        )
        #expect(
            ModelPickerRules.summaryLabel(
                in: data,
                stored: nil,
                effort: "high",
                speed: "fast",
                verbosity: "high",
                mode: nil
            ) == "GPT-5.6 Luna \u{00B7} High \u{00B7} Fast \u{00B7} Detailed"
        )
        // Two rules at once: an effort this model cannot honour is not spoken
        // for, and an *explicitly stored* default ("standard" / "medium", which
        // is what picking those chips now writes) is as silent as nil.
        #expect(
            ModelPickerRules.summaryLabel(
                in: data,
                stored: nil,
                effort: "minimal",
                speed: "standard",
                verbosity: "medium",
                mode: "pro"
            ) == "GPT-5.6 Luna \u{00B7} Pro"
        )
        // House mode has no options at all, whatever is stored.
        #expect(
            ModelPickerRules.summaryLabel(
                in: Self.houseResponse(),
                stored: nil,
                effort: "high",
                speed: "fast",
                verbosity: "low",
                mode: "pro"
            ) == "GPT-5.6 Luna"
        )
    }

    // MARK: - Meta line and pills

    @Test("A curated tagline wins; otherwise the line is derived")
    func metaLineCopy() {
        let curated = Self.model(
            "openai/gpt-5.6-luna",
            provider: "openai",
            tagline: "Fastest and lowest cost",
            contextWindow: 1_050_000,
            pricing: .init(input: 0.2, output: 1.2)
        )
        #expect(ModelPickerRules.metaLine(for: curated) == "Fastest and lowest cost")

        let derived = Self.model(
            "openai/gpt-5.6-terra",
            provider: "openai",
            contextWindow: 1_050_000,
            pricing: .init(input: 2, output: 12)
        )
        #expect(
            ModelPickerRules.metaLine(for: derived)
                == "1M context \u{00B7} $2 / $12 per M"
        )

        // Half a line is still a line worth showing.
        #expect(
            ModelPickerRules.metaLine(
                for: Self.model("a/b", provider: "a", contextWindow: 400_000)
            ) == "400K context"
        )
        // Nothing to say: nil rather than an empty line, which would read as a
        // layout bug under the model's name.
        #expect(ModelPickerRules.metaLine(for: Self.model("a/b", provider: "a")) == nil)
        #expect(
            ModelPickerRules.metaLine(for: Self.model("a/b", provider: "a", tagline: "   ")) == nil
        )
    }

    @Test("Millions round to the nearest half, thousands to the nearest whole")
    func contextAbbreviation() {
        #expect(ModelPickerRules.contextText(1_050_000) == "1M")
        #expect(ModelPickerRules.contextText(1_048_576) == "1M")
        #expect(ModelPickerRules.contextText(1_000_000) == "1M")
        #expect(ModelPickerRules.contextText(2_000_000) == "2M")
        // Half-millions survive. Rounding these to a whole million reported a
        // genuine 1.5M model as "2M".
        #expect(ModelPickerRules.contextText(1_500_000) == "1.5M")
        #expect(ModelPickerRules.contextText(2_500_000) == "2.5M")
        #expect(ModelPickerRules.contextText(400_000) == "400K")
        #expect(ModelPickerRules.contextText(128_000) == "128K")
        #expect(ModelPickerRules.contextText(900) == "900")
    }

    @Test("Prices keep their cents without rounding a cheap model to nothing")
    func priceFormatting() {
        #expect(ModelPickerRules.priceText(2) == "$2")
        #expect(ModelPickerRules.priceText(12) == "$12")
        #expect(ModelPickerRules.priceText(0.2) == "$0.20")
        #expect(ModelPickerRules.priceText(1.2) == "$1.20")
        #expect(ModelPickerRules.priceText(4.5) == "$4.50")
        #expect(ModelPickerRules.priceText(0.0715) == "$0.0715")
    }

    @Test("Pills name capabilities, never more than three")
    func capabilityPills() {
        let everything = Self.model(
            "openai/gpt-5.6-sol",
            provider: "openai",
            speeds: ["standard", "fast"],
            modes: ["standard", "pro"]
        )
        #expect(ModelPickerRules.pills(for: everything) == ["Files", "Fast", "Pro"])
        #expect(ModelPickerRules.pills(for: everything).count <= 3)

        let plain = AIModel(
            id: "a/b",
            label: "B",
            provider: "a",
            supportsAttachments: false,
            available: true
        )
        #expect(ModelPickerRules.pills(for: plain).isEmpty)
    }

    // MARK: - Search

    @Test("Search appears only once the groups stop being the faster route")
    func searchThreshold() {
        let few = Self.response()
        #expect(!ModelPickerRules.showsSearch(in: few))
        #expect(!ModelPickerRules.showsSearch(in: nil))
        #expect(!ModelPickerRules.showsSearch(in: Self.houseResponse()))

        let many = (0..<9).map { Self.model("openai/m\($0)", provider: "openai") }
        let data = AIModelsResponse(
            providers: [AIProviderSummary(id: "openai", label: "OpenAI", available: true)],
            models: many,
            defaults: .init(modelId: "openai/m0", effort: nil)
        )
        #expect(ModelPickerRules.showsSearch(in: data))
    }

    @Test("Search matches label or id, across providers, reachable models only")
    func searchMatching() {
        let data = Self.response()
        #expect(!ModelPickerRules.isSearching("   "))
        #expect(ModelPickerRules.searchResults(in: data, query: "  ").isEmpty)
        #expect(
            ModelPickerRules.searchResults(in: data, query: "TERRA").map(\.id)
                == ["openai/gpt-5.6-terra"]
        )
        #expect(
            ModelPickerRules.searchResults(in: data, query: "gpt-4o").map(\.id)
                == ["openai/gpt-4o-mini"]
        )
        // Anthropic's models are in the payload but unreachable, so a search
        // must not offer one that would fail.
        #expect(ModelPickerRules.searchResults(in: data, query: "claude").isEmpty)
    }

    @Test("Chips wrap into rows of four rather than shrinking")
    func chipWrapping() {
        let eight: [String?] = [
            nil, "none", "minimal", "low", "medium", "high", "xhigh", "max",
        ]
        let rows = ModelPickerRules.chipRows(eight)
        #expect(rows.count == 2)
        #expect(rows[0] == [nil, "none", "minimal", "low"])
        #expect(rows[1] == ["medium", "high", "xhigh", "max"])

        let two: [String?] = ["standard", "fast"]
        #expect(ModelPickerRules.chipRows(two) == [["standard", "fast"]])
        #expect(ModelPickerRules.chipRows([]).isEmpty)
    }

    // MARK: - Wire decoding

    @Test("Decodes the house payload the server sends a keyless account")
    func decodesHousePayload() throws {
        let json = """
        {
          "access": "house",
          "providers": [],
          "models": [
            {
              "id": "openai/gpt-5.6-luna",
              "label": "GPT-5.6 Luna",
              "provider": "openai",
              "supportsAttachments": true,
              "efforts": ["medium"],
              "available": true
            }
          ],
          "defaults": { "modelId": "openai/gpt-5.6-luna", "effort": "medium" },
          "house": {
            "modelId": "openai/gpt-5.6-luna",
            "label": "GPT-5.6 Luna",
            "effort": "medium",
            "note": "SureWord's own model, tuned for Scripture."
          }
        }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        #expect(decoded.access == "house")
        #expect(decoded.house?.modelId == "openai/gpt-5.6-luna")
        #expect(decoded.house?.label == "GPT-5.6 Luna")
        #expect(decoded.house?.effort == "medium")
        #expect(ModelPickerRules.isHouse(decoded))
        #expect(ModelPickerRules.providers(in: decoded).isEmpty)
    }

    @Test("Decodes the /api/ai/models payload, defaults included")
    func decodesPayload() throws {
        let json = """
        {
          "access": "keys",
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
        #expect(decoded.access == "keys")
        #expect(decoded.house == nil)
        #expect(!ModelPickerRules.isHouse(decoded))
    }

    @Test("Decodes the run-options payload, model capabilities and defaults")
    func decodesRunOptionsPayload() throws {
        let json = """
        {
          "access": "keys",
          "providers": [{ "id": "openai", "label": "OpenAI", "available": true }],
          "models": [
            {
              "id": "openai/gpt-5.6-luna",
              "label": "GPT-5.6 Luna",
              "provider": "openai",
              "supportsAttachments": true,
              "efforts": ["none", "low", "medium", "high", "xhigh", "max"],
              "available": true,
              "speeds": ["standard", "fast"],
              "verbosities": ["low", "medium", "high"],
              "modes": ["standard", "pro"],
              "defaultEffort": "medium",
              "tagline": "Fastest and lowest cost",
              "tier": "fast",
              "contextWindow": 1050000,
              "pricing": { "input": 0.2, "output": 1.2 },
              "fastModeNote": "About 2x the standard price"
            }
          ],
          "defaults": {
            "modelId": "openai/gpt-5.6-luna",
            "effort": "high",
            "speed": "fast",
            "verbosity": "low",
            "mode": "pro"
          }
        }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        let model = try #require(decoded.models.first)
        #expect(model.speeds == ["standard", "fast"])
        #expect(model.verbosities == ["low", "medium", "high"])
        #expect(model.modes == ["standard", "pro"])
        #expect(model.defaultEffort == "medium")
        #expect(model.tagline == "Fastest and lowest cost")
        #expect(model.tier == "fast")
        #expect(model.contextWindow == 1_050_000)
        #expect(model.pricing?.input == 0.2)
        #expect(model.pricing?.output == 1.2)
        #expect(model.fastModeNote == "About 2x the standard price")

        #expect(decoded.defaults.speed == "fast")
        #expect(decoded.defaults.verbosity == "low")
        #expect(decoded.defaults.mode == "pro")

        // And the rules read the capabilities back out.
        #expect(ModelPickerRules.speeds(for: model) == ["standard", "fast"])
        #expect(ModelPickerRules.modes(for: model) == ["standard", "pro"])
        #expect(ModelPickerRules.metaLine(for: model) == "Fastest and lowest cost")
        #expect(ModelPickerRules.pills(for: model) == ["Files", "Fast", "Pro"])
    }

    @Test("A payload from a server too old to send the options still decodes")
    func decodesPreOptionsPayload() throws {
        // The exact shape shipped before the run options existed. Written as
        // raw JSON on purpose: `AIModel.init(from:)` is hand-written, and a new
        // field added there as a plain `decode` would cost the whole list
        // rather than one capability.
        let json = """
        {
          "access": "keys",
          "providers": [{ "id": "openai", "label": "OpenAI", "available": true }],
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
          "defaults": { "modelId": "openai/gpt-5.6-terra", "effort": "medium" }
        }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        let model = try #require(decoded.models.first)
        // One speed, no length control, one mode: no option row but Reasoning.
        #expect(model.speeds == ["standard"])
        #expect(model.verbosities.isEmpty)
        #expect(model.modes == ["standard"])
        #expect(model.defaultEffort == nil)
        #expect(model.tagline == nil)
        #expect(model.tier == nil)
        #expect(model.contextWindow == nil)
        #expect(model.pricing == nil)
        #expect(model.fastModeNote == nil)

        #expect(decoded.defaults.speed == nil)
        #expect(decoded.defaults.verbosity == nil)
        #expect(decoded.defaults.mode == nil)

        #expect(ModelPickerRules.efforts(for: model) == ["low", "medium", "high"])
        #expect(ModelPickerRules.speeds(for: model).isEmpty)
        #expect(ModelPickerRules.verbosities(for: model).isEmpty)
        #expect(ModelPickerRules.modes(for: model).isEmpty)
        #expect(ModelPickerRules.metaLine(for: model) == nil)
        #expect(ModelPickerRules.pills(for: model) == ["Files"])
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
        // `["standard"]` rather than `[]`: a server that says nothing about
        // speeds has exactly one, and an empty list would read as "no speeds".
        #expect(decoded.models[0].speeds == ["standard"])
        #expect(decoded.models[0].modes == ["standard"])
        #expect(decoded.models[0].verbosities.isEmpty)
        #expect(decoded.defaults.effort == nil)
        #expect(decoded.defaults.speed == nil)
        // A server too old to speak `access` is a keys server, not an unknown
        // one: silence must never render the house panel.
        #expect(decoded.access == nil)
        #expect(decoded.house == nil)
        #expect(!ModelPickerRules.isHouse(decoded))
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
