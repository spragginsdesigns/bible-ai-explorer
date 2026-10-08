import Foundation
import XCTest

@testable import SureWord

/// Ports of `mobile/src/features/chat/modelPickerRules.test.ts` (Android is the
/// source of truth for the picker): house mode, selection, provider rows,
/// search, grid columns, the summary label and the header copy. Each
/// `// describe(...)` names the Android block it mirrors.
@MainActor
final class ModelPickerRulesTests: XCTestCase {
    private typealias Rules = ModelPickerSheet

    // MARK: Fixtures (same shapes as the Android test)

    private func model(_ id: String, _ provider: String, available: Bool = true) -> AIModel {
        AIModel(
            id: id,
            label: id,
            provider: provider,
            supportsAttachments: false,
            efforts: ["low", "medium", "high"],
            available: available
        )
    }

    private func labelled(_ id: String, _ provider: String, _ label: String, available: Bool = true) -> AIModel {
        var entry = model(id, provider, available: available)
        entry.label = label
        return entry
    }

    private func richModel() -> AIModel {
        AIModel(
            id: "openai/gpt-5.6-luna",
            label: "GPT-5.6 Luna",
            provider: "openai",
            supportsAttachments: true,
            efforts: ["none", "low", "medium", "high", "xhigh", "max"],
            available: true,
            speeds: ["standard", "fast"],
            verbosities: ["low", "medium", "high"],
            modes: ["standard", "pro"],
            defaultEffort: "medium",
            tagline: "Fastest and lowest cost",
            tier: "fast",
            contextWindow: 1_050_000,
            pricing: .init(input: 0.2, output: 1.2),
            fastModeNote: "About 2x the standard price"
        )
    }

    private func keysPayload(
        providers: [AIProviderSummary]? = [AIProviderSummary(id: "openai", label: "OpenAI", available: true)],
        models: [AIModel]? = nil,
        defaultModelId: String = "gpt-5.6"
    ) -> AIModelsResponse {
        AIModelsResponse(
            access: "keys",
            providers: providers,
            models: models ?? [model("gpt-5.6", "openai"), model("gpt-5.6-mini", "openai")],
            defaults: .init(modelId: defaultModelId, effort: nil),
            house: nil
        )
    }

    private func housePayload(note: String? = "Included with SureWord.") -> AIModelsResponse {
        AIModelsResponse(
            access: "house",
            providers: [],
            models: [model("gpt-5.6-luna", "openai")],
            defaults: .init(modelId: "gpt-5.6-luna", effort: "medium"),
            house: .init(modelId: "gpt-5.6-luna", label: "GPT-5.6 Luna", effort: "medium", note: note)
        )
    }

    private func many(_ count: Int) -> AIModelsResponse {
        keysPayload(models: (0..<count).map { model("m\($0)", "openai") })
    }

    private func ids(_ models: [AIModel]) -> [String] { models.map(\.id) }

    // MARK: describe("houseMode")

    func testHouseModeReturnsTheBlockOnlyInHouseMode() {
        XCTAssertEqual(Rules.houseMode(housePayload())?.modelId, "gpt-5.6-luna")
        XCTAssertNil(Rules.houseMode(keysPayload()))
        XCTAssertNil(Rules.houseMode(nil))
    }

    func testHouseModeStaysNilWhenTheServerSendsNoBlock() {
        var data = housePayload()
        data.house = nil
        XCTAssertNil(Rules.houseMode(data))
    }

    // MARK: describe("selectModelId") / describe("selectedModel")

    func testSelectKeepsAStoredPickTheServerStillOffers() {
        XCTAssertEqual(Rules.selectModelId(stored: "gpt-5.6-mini", data: keysPayload()), "gpt-5.6-mini")
    }

    func testSelectFallsBackToTheDefaultForAnUnknownOrRevokedPick() {
        XCTAssertEqual(Rules.selectModelId(stored: "nope", data: keysPayload()), "gpt-5.6")
        let revoked = keysPayload(models: [model("gpt-5.6", "openai"), model("gone", "anthropic", available: false)])
        XCTAssertEqual(Rules.selectModelId(stored: "gone", data: revoked), "gpt-5.6")
        XCTAssertEqual(Rules.selectModelId(stored: nil, data: keysPayload()), "gpt-5.6")
    }

    func testSelectPinsTheHouseModelRegardlessOfWhatIsStored() {
        XCTAssertEqual(Rules.selectModelId(stored: "gpt-5.6-mini", data: housePayload()), "gpt-5.6-luna")
    }

    func testSelectHasNothingBeforeThePayloadLands() {
        XCTAssertNil(Rules.selectModelId(stored: "gpt-5.6", data: nil))
        XCTAssertNil(Rules.selectedModel(data: nil, stored: "gpt-5.6"))
    }

    func testSelectedModelResolvesTheEntryOrNil() {
        XCTAssertEqual(Rules.selectedModel(data: keysPayload(), stored: "gpt-5.6-mini")?.id, "gpt-5.6-mini")
        let orphan = keysPayload(defaultModelId: "not-listed")
        XCTAssertNil(Rules.selectedModel(data: orphan, stored: nil))
    }

    // MARK: describe("visibleProviders")

    func testProvidersDropLockedOnes() {
        let data = keysPayload(
            providers: [
                AIProviderSummary(id: "openai", label: "OpenAI", available: true),
                AIProviderSummary(id: "anthropic", label: "Anthropic", available: false),
            ],
            models: [model("gpt-5.6", "openai"), model("claude", "anthropic", available: false)]
        )
        XCTAssertEqual(Rules.visibleProviders(data).map(\.id), ["openai"])
    }

    func testProvidersDropAnUnlockedProviderThatListedNoModels() {
        let data = keysPayload(
            providers: [
                AIProviderSummary(id: "openai", label: "OpenAI", available: true),
                AIProviderSummary(id: "moonshot", label: "Moonshot", available: true),
            ]
        )
        XCTAssertEqual(Rules.visibleProviders(data).map(\.id), ["openai"])
    }

    func testProvidersDeriveFromTheFlatListWhenAnOlderServerOmitsThem() {
        // The first anthropic model is unavailable; a later one is not. The
        // provider must still get its row, built from the runnable model.
        let data = keysPayload(
            providers: nil,
            models: [
                model("gpt-5.6", "openai"),
                model("claude-gone", "anthropic", available: false),
                model("claude-opus-5", "anthropic"),
                model("kimi", "moonshot", available: false),
            ]
        )
        let rows = Rules.visibleProviders(data)
        XCTAssertEqual(rows.map(\.id), ["openai", "anthropic"])
        XCTAssertEqual(rows.map(\.label), ["OpenAI", "Anthropic"])
        XCTAssertTrue(rows.allSatisfy(\.available))
    }

    func testProvidersAreEmptyInHouseMode() {
        XCTAssertTrue(Rules.visibleProviders(housePayload()).isEmpty)
        XCTAssertTrue(Rules.visibleProviders(nil).isEmpty)
    }

    // MARK: describe("modelsForProvider") / describe("providerLabel")

    func testModelsForProviderReturnsOnlyItsAvailableModels() {
        let data = keysPayload(models: [
            model("a", "openai"), model("b", "anthropic"), model("c", "openai", available: false),
        ])
        XCTAssertEqual(ids(Rules.models(in: data, provider: "openai")), ["a"])
        XCTAssertTrue(Rules.models(in: nil, provider: "openai").isEmpty)
    }

    func testProviderLabelPrefersTheServerThenOursThenTheId() {
        let data = keysPayload(providers: [AIProviderSummary(id: "openai", label: "OpenAI (work key)", available: true)])
        XCTAssertEqual(Rules.providerLabel(in: data, provider: "openai"), "OpenAI (work key)")
        XCTAssertEqual(Rules.providerLabel(in: data, provider: "anthropic"), "Anthropic")
        XCTAssertEqual(Rules.providerLabel(in: data, provider: "somethingnew"), "somethingnew")
    }

    func testInitialExpandedProviderIsTheSelectedModelsWhenItHasARow() {
        let data = keysPayload(
            providers: [
                AIProviderSummary(id: "openai", label: "OpenAI", available: true),
                AIProviderSummary(id: "anthropic", label: "Anthropic", available: true),
            ],
            models: [model("gpt", "openai"), model("claude", "anthropic"), model("stale", "moonshot", available: false)]
        )
        XCTAssertEqual(Rules.initialExpandedProvider(data: data, selectedId: "claude"), "anthropic")
        XCTAssertEqual(Rules.initialExpandedProvider(data: data, selectedId: "stale"), "openai")
        XCTAssertEqual(Rules.initialExpandedProvider(data: data, selectedId: nil), "openai")
    }

    // MARK: describe("showSearch / filterModels")

    func testSearchGrowsWheneverThereIsMoreThanOneModel() {
        XCTAssertEqual(Rules.searchThreshold, 1)
        XCTAssertFalse(Rules.showsSearch(many(1)))
        XCTAssertTrue(Rules.showsSearch(many(2)))
        XCTAssertTrue(Rules.showsSearch(many(9)))
        XCTAssertFalse(Rules.showsSearch(housePayload()))
        XCTAssertFalse(Rules.showsSearch(nil))
    }

    func testSearchDoesNotCountModelsTheAccountCannotRun() {
        let data = keysPayload(models: [model("m0", "openai"), model("revoked", "anthropic", available: false)])
        XCTAssertFalse(Rules.showsSearch(data))
    }

    func testSearchMatchesEveryTokenIgnoresPunctuationAndRanksLabelHitsFirst() {
        let data = keysPayload(models: [
            model("gpt-5.6-luna", "openai"),
            model("gpt-5.6-sol", "openai"),
            model("claude-opus-5", "anthropic"),
            model("anthropic/claude-opus-4.7", "openrouter"),
        ])
        XCTAssertEqual(ids(Rules.filterModels(data, query: "gpt sol")), ["gpt-5.6-sol"])
        XCTAssertEqual(ids(Rules.filterModels(data, query: "gpt56")), ["gpt-5.6-luna", "gpt-5.6-sol"])
        XCTAssertEqual(
            ids(Rules.filterModels(data, query: "opus")),
            ["claude-opus-5", "anthropic/claude-opus-4.7"]
        )
        XCTAssertEqual(ids(Rules.filterModels(data, query: "anthropic")), ["anthropic/claude-opus-4.7"])
    }

    func testSearchRanksAPrefixHitAboveAContainsHitAboveAnIdOnlyHit() {
        let data = keysPayload(models: [
            labelled("x/one", "openai", "Something Luna"),
            labelled("luna/two", "openai", "Other"),
            labelled("x/three", "openai", "Luna Prime"),
        ])
        XCTAssertEqual(ids(Rules.filterModels(data, query: "luna")), ["x/three", "x/one", "luna/two"])
    }

    func testSearchMatchesLabelOrIdCaseInsensitivelyAcrossProviders() {
        let data = keysPayload(
            providers: [
                AIProviderSummary(id: "openai", label: "OpenAI", available: true),
                AIProviderSummary(id: "anthropic", label: "Anthropic", available: true),
            ],
            models: [
                labelled("openai/gpt-5.6-luna", "openai", "GPT-5.6 Luna"),
                labelled("anthropic/claude-opus-5", "anthropic", "Claude Opus 5"),
                labelled("anthropic/gone", "anthropic", "Claude Gone", available: false),
            ]
        )
        XCTAssertEqual(ids(Rules.filterModels(data, query: "LUNA")), ["openai/gpt-5.6-luna"])
        XCTAssertEqual(ids(Rules.filterModels(data, query: "opus")), ["anthropic/claude-opus-5"])
        XCTAssertEqual(ids(Rules.filterModels(data, query: "anthropic/")), ["anthropic/claude-opus-5"])
        XCTAssertTrue(Rules.filterModels(data, query: "zzz").isEmpty)
        XCTAssertEqual(
            ids(Rules.filterModels(data, query: "  ")),
            ["openai/gpt-5.6-luna", "anthropic/claude-opus-5"]
        )
        XCTAssertTrue(Rules.filterModels(nil, query: "luna").isEmpty)
    }

    func testEmptySearchCopyMatchesAndroid() {
        XCTAssertEqual(Rules.emptySearchText, "No models match that.")
    }

    // MARK: describe("optionGridColumns")

    func testGridKeepsUpToFourChoicesOnOneRow() {
        XCTAssertEqual(Rules.optionGridColumns(1), 1)
        XCTAssertEqual(Rules.optionGridColumns(2), 2)
        XCTAssertEqual(Rules.optionGridColumns(3), 3)
        XCTAssertEqual(Rules.optionGridColumns(4), 4)
    }

    func testGridSplitsFiveOrSixIntoThreesAndSevenOrEightIntoFours() {
        XCTAssertEqual(Rules.optionGridColumns(5), 3)
        XCTAssertEqual(Rules.optionGridColumns(6), 3)
        XCTAssertEqual(Rules.optionGridColumns(7), 4)
        XCTAssertEqual(Rules.optionGridColumns(8), 4)
    }

    func testGridNeverAnswersZeroColumns() {
        XCTAssertEqual(Rules.optionGridColumns(0), 1)
        XCTAssertEqual(Rules.optionGridColumns(-1), 1)
    }

    func testGridFitsEveryReasoningSectionTheRulesCanBuild() {
        // Auto plus the full seven-effort vocabulary: two rows of four.
        let full = Rules.effortOptions(for: richModel())
        XCTAssertEqual(full.count, 7)
        XCTAssertEqual(Rules.gridRows(full).map(\.count), [4, 3])
        var everything = richModel()
        everything.efforts = Rules.effortOrder
        let eight = Rules.effortOptions(for: everything)
        XCTAssertEqual(Rules.gridRows(eight).map(\.count), [4, 4])
        XCTAssertEqual(Rules.gridRows(["standard", "fast"]).map(\.count), [2])
        XCTAssertEqual(Rules.gridRows([1, 2, 3, 4, 5]).map(\.count), [3, 2])
    }

    // MARK: describe("optionSections") - visibility and copy

    func testOptionsExistOnlyForAModelWithSomethingToTune() {
        XCTAssertTrue(Rules.hasOptions(richModel()))
        var inert = richModel()
        inert.efforts = []
        inert.speeds = ["standard"]
        inert.verbosities = []
        inert.modes = ["standard"]
        XCTAssertFalse(Rules.hasOptions(inert))
        XCTAssertFalse(Rules.hasOptions(nil))
        // A model from a server that predates run options shows only reasoning.
        XCTAssertTrue(Rules.hasOptions(model("gpt-5.6", "openai")))
        XCTAssertTrue(Rules.speeds(for: model("gpt-5.6", "openai")).isEmpty)
    }

    func testLengthMapsOntoBriefNormalDetailedWithNormalStoringMedium() {
        XCTAssertEqual(Rules.verbosities(for: richModel()), ["low", "medium", "high"])
        XCTAssertEqual(Rules.verbosities(for: richModel()).map(Rules.verbosityLabel), ["Brief", "Normal", "Detailed"])
        var detailedOnly = richModel()
        detailedOnly.verbosities = ["high"]
        XCTAssertEqual(Rules.verbosities(for: detailedOnly), ["medium", "high"])
    }

    func testChipAccessibilityLabelNamesTheSection() {
        XCTAssertEqual(Rules.chipAccessibilityLabel(section: "Reasoning", choice: "High"), "Reasoning: High")
    }

    func testOptionsIntroCopy() {
        XCTAssertEqual(
            Rules.optionsIntro(for: richModel()),
            "How GPT-5.6 Luna answers. Changes apply to your next message."
        )
    }

    // MARK: describe("summaryLabel")

    func testSummaryIsJustTheModelWhenEverythingIsDefault() {
        XCTAssertEqual(
            Rules.summaryLabel(model: richModel(), effort: nil, speed: nil, verbosity: nil, mode: nil),
            "GPT-5.6 Luna"
        )
    }

    func testSummaryAppendsEachNonDefaultOptionInPickerOrder() {
        XCTAssertEqual(
            Rules.summaryLabel(model: richModel(), effort: "high", speed: "fast", verbosity: "high", mode: "pro"),
            "GPT-5.6 Luna \u{00B7} High \u{00B7} Fast \u{00B7} Detailed \u{00B7} Pro"
        )
    }

    func testSummarySaysNothingAboutAnOptionTheModelDoesNotSupport() {
        var plain = richModel()
        plain.efforts = ["low", "medium", "high"]
        plain.speeds = ["standard"]
        plain.verbosities = []
        plain.modes = ["standard"]
        XCTAssertEqual(
            Rules.summaryLabel(model: plain, effort: "max", speed: "fast", verbosity: "low", mode: "pro"),
            "GPT-5.6 Luna"
        )
    }

    func testSummarySaysNothingAboutTheAutoSentinel() {
        XCTAssertEqual(
            Rules.summaryLabel(
                model: richModel(),
                effort: AskQuestionRequest.autoEffort,
                speed: nil,
                verbosity: nil,
                mode: nil
            ),
            "GPT-5.6 Luna"
        )
    }

    func testSummarySaysNothingAboutAnExplicitlyStoredDefault() {
        XCTAssertEqual(
            Rules.summaryLabel(model: richModel(), effort: nil, speed: "standard", verbosity: "medium", mode: "standard"),
            "GPT-5.6 Luna"
        )
    }

    func testSummaryIsEmptyBeforeAModelIsResolved() {
        XCTAssertEqual(Rules.summaryLabel(model: nil, effort: "high", speed: nil, verbosity: nil, mode: nil), "")
    }

    // MARK: Header copy (ModelPickerSheet.tsx header)

    func testTitleAndUsingLine() {
        XCTAssertEqual(Rules.title(house: nil), "Choose a model")
        XCTAssertEqual(Rules.title(house: housePayload().house), "Your model")
        XCTAssertEqual(Rules.summaryLine("GPT-5.6 Luna \u{00B7} High"), "Using GPT-5.6 Luna \u{00B7} High")
        XCTAssertNil(Rules.summaryLine(""))
        XCTAssertEqual(Rules.addKeyTitle, "Add an API key")
        XCTAssertEqual(Rules.addKeyDetail, "Unlock more models in Settings")
    }

    func testHouseNoteFallsBackOnlyWhenTheServerSendsNone() {
        XCTAssertEqual(Rules.houseNote(housePayload().house!), "Included with SureWord.")
        XCTAssertEqual(Rules.houseNote(housePayload(note: "  ").house!), Rules.fallbackHouseNote)
    }

    // MARK: Store adoption (seedRunOptions + house-mode pinning)

    private static let keys = [
        "settings.chat.modelId",
        "settings.chat.effort",
        "settings.chat.speed",
        "settings.chat.verbosity",
        "settings.chat.mode",
    ]

    private func clearStore() {
        for key in Self.keys { UserDefaults.standard.removeObject(forKey: key) }
    }

    func testSeedingIgnoresAnEmptyString() {
        clearStore()
        defer { clearStore() }
        let settings = SettingsStore()
        let served = AIModelsResponse(
            models: [model("gpt-5.6", "openai")],
            defaults: .init(modelId: "gpt-5.6", effort: "", speed: "", verbosity: "low", mode: "")
        )
        Rules.seedDefaults(from: served, into: settings)
        XCTAssertNil(settings.chatEffort)
        XCTAssertNil(settings.chatSpeed)
        XCTAssertEqual(settings.chatVerbosity, "low")
        XCTAssertNil(settings.chatMode)
    }

    func testHouseModePinsTheModelAndEffortAndClearsTheRunOptions() {
        clearStore()
        defer { clearStore() }
        let settings = SettingsStore()
        settings.applyRemote { settings in
            settings.chatModelId = "anthropic/claude-opus-5"
            settings.chatEffort = "max"
            settings.chatSpeed = "fast"
            settings.chatVerbosity = "high"
            settings.chatMode = "pro"
        }
        Rules.pinHouseMode(from: housePayload(), into: settings)
        XCTAssertEqual(settings.chatModelId, "gpt-5.6-luna")
        XCTAssertEqual(settings.chatEffort, "medium")
        XCTAssertNil(settings.chatSpeed)
        XCTAssertNil(settings.chatVerbosity)
        XCTAssertNil(settings.chatMode)
    }

    func testKeysModeIsNeverPinned() {
        clearStore()
        defer { clearStore() }
        let settings = SettingsStore()
        settings.applyRemote { settings in
            settings.chatModelId = "gpt-5.6-mini"
            settings.chatSpeed = "fast"
        }
        Rules.pinHouseMode(from: keysPayload(), into: settings)
        XCTAssertEqual(settings.chatModelId, "gpt-5.6-mini")
        XCTAssertEqual(settings.chatSpeed, "fast")
    }
}
