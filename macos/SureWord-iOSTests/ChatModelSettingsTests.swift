import Foundation
import XCTest

@testable import SureWord

/// Lane 3 (iOS chat) wired the model picker through the shared settings and
/// the ask-question request - the pieces the Mac never needed. These pin the
/// persistence keys and the wire shape Android's
/// `prepareSendMessagesRequest` already sends.
@MainActor
final class ChatModelSettingsTests: XCTestCase {
    /// Every UserDefaults key the picker owns. `SettingsStore` is backed by
    /// `UserDefaults.standard`, so each test starts and ends from clean.
    private static let keys = [
        "settings.chat.modelId",
        "settings.chat.effort",
        "settings.chat.speed",
        "settings.chat.verbosity",
        "settings.chat.mode",
    ]

    override func setUp() {
        super.setUp()
        let defaults = UserDefaults.standard
        for key in Self.keys { defaults.removeObject(forKey: key) }
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        for key in Self.keys { defaults.removeObject(forKey: key) }
        super.tearDown()
    }

    func testModelAndEffortDefaultToNil() {
        let settings = SettingsStore()
        XCTAssertNil(settings.chatModelId)
        XCTAssertNil(settings.chatEffort)
    }

    func testModelAndEffortPersistAcrossInstances() {
        let settings = SettingsStore()
        settings.chatModelId = "anthropic/claude-sonnet-4"
        settings.chatEffort = "high"

        let reloaded = SettingsStore()
        XCTAssertEqual(reloaded.chatModelId, "anthropic/claude-sonnet-4")
        XCTAssertEqual(reloaded.chatEffort, "high")
    }

    func testClearingModelAndEffortRemovesThem() {
        let settings = SettingsStore()
        settings.chatModelId = "openai/gpt-5"
        settings.chatEffort = "low"
        settings.chatModelId = nil
        settings.chatEffort = nil

        let reloaded = SettingsStore()
        XCTAssertNil(reloaded.chatModelId)
        XCTAssertNil(reloaded.chatEffort)
    }

    func testRunOptionsDefaultToNil() {
        let settings = SettingsStore()
        // Nil here means "never chose", which is the one thing nil may mean:
        // picking the Standard/Normal chip stores its own value instead.
        XCTAssertNil(settings.chatSpeed)
        XCTAssertNil(settings.chatVerbosity)
        XCTAssertNil(settings.chatMode)
    }

    func testRunOptionsPersistAndClearAcrossInstances() {
        let settings = SettingsStore()
        settings.chatSpeed = "fast"
        settings.chatVerbosity = "high"
        settings.chatMode = "pro"

        let reloaded = SettingsStore()
        XCTAssertEqual(reloaded.chatSpeed, "fast")
        XCTAssertEqual(reloaded.chatVerbosity, "high")
        XCTAssertEqual(reloaded.chatMode, "pro")

        reloaded.chatSpeed = nil
        reloaded.chatVerbosity = nil
        reloaded.chatMode = nil

        let cleared = SettingsStore()
        XCTAssertNil(cleared.chatSpeed)
        XCTAssertNil(cleared.chatVerbosity)
        XCTAssertNil(cleared.chatMode)
    }

    func testAskQuestionRequestCarriesModelAndEffort() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: "c1",
            translation: "KJV",
            modelId: "openai/gpt-5",
            effort: "medium",
            speed: nil,
            verbosity: nil,
            mode: nil
        )
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        XCTAssertEqual(object?["modelId"] as? String, "openai/gpt-5")
        XCTAssertEqual(object?["effort"] as? String, "medium")
        XCTAssertEqual(object?["conversationId"] as? String, "c1")
        XCTAssertEqual(object?["translation"] as? String, "KJV")
    }

    func testAskQuestionRequestCarriesRunOptions() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: "c1",
            translation: "KJV",
            modelId: "openai/gpt-5.6-luna",
            effort: "xhigh",
            speed: "fast",
            verbosity: "low",
            mode: "pro"
        )
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        // Field names are the server's, verbatim - there is no request schema
        // on `/api/ask-question`, so a typo here is silently ignored in
        // production rather than rejected.
        XCTAssertEqual(object?["effort"] as? String, "xhigh")
        XCTAssertEqual(object?["speed"] as? String, "fast")
        XCTAssertEqual(object?["verbosity"] as? String, "low")
        XCTAssertEqual(object?["mode"] as? String, "pro")
    }

    /// Auto and "never chose" are different requests and must look different on
    /// the wire: an absent `effort` tells the server to apply the account's
    /// stored default, an explicit null tells it to apply no override at all.
    /// `JSONSerialization` turns the null into `NSNull`, which is how this
    /// distinguishes "present and null" from "absent".
    func testAskQuestionRequestEncodesAutoAsAnExplicitNull() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: "c1",
            translation: "KJV",
            modelId: "openai/gpt-5.6-luna",
            effort: AskQuestionRequest.autoEffort,
            speed: nil,
            verbosity: nil,
            mode: nil
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertTrue(object.keys.contains("effort"))
        XCTAssertTrue(object["effort"] is NSNull)
        // The sentinel is never sent as a string - "auto" is not in the
        // server's effort vocabulary and would be discarded on arrival.
        XCTAssertNotEqual(object["effort"] as? String, "auto")
        // The other three keep the plain rule: never chosen, so never sent.
        XCTAssertFalse(object.keys.contains("speed"))
        XCTAssertFalse(object.keys.contains("verbosity"))
        XCTAssertFalse(object.keys.contains("mode"))
        // And the hand-written encoder still carries everything else.
        XCTAssertEqual(object["modelId"] as? String, "openai/gpt-5.6-luna")
        XCTAssertEqual(object["conversationId"] as? String, "c1")
        XCTAssertEqual(object["translation"] as? String, "KJV")
        XCTAssertNotNil(object["messages"])
    }

    func testAskQuestionRequestOmitsUnsetModelAndEffort() throws {
        let request = AskQuestionRequest(
            messages: [],
            conversationId: nil,
            translation: "KJV",
            modelId: nil,
            effort: nil,
            speed: nil,
            verbosity: nil,
            mode: nil
        )
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(request)
        ) as? [String: Any]
        // Nil optionals synthesise to absent keys; the server treats a missing
        // or null value as "account default", so all of them are safe.
        XCTAssertNil(object?["modelId"])
        XCTAssertNil(object?["effort"])
        XCTAssertNil(object?["speed"])
        XCTAssertNil(object?["verbosity"])
        XCTAssertNil(object?["mode"])
        XCTAssertNil(object?["conversationId"])
    }
}

/// The picker rules the iOS sheet restates inline, because `ModelPickerRules`
/// lives in the macOS target. **These must stay in step with
/// `SureWordTests/ModelPickerTests.swift`** - if one copy changes, both do.
@MainActor
final class ModelPickerSheetRulesTests: XCTestCase {
    private func model(
        _ id: String,
        provider: String = "openai",
        label: String? = nil,
        efforts: [String] = ["low", "medium", "high"],
        speeds: [String] = ["standard"],
        verbosities: [String] = [],
        modes: [String] = ["standard"],
        tagline: String? = nil,
        contextWindow: Int? = nil,
        pricing: AIModel.Pricing? = nil
    ) -> AIModel {
        AIModel(
            id: id,
            label: label ?? id,
            provider: provider,
            supportsAttachments: true,
            efforts: efforts,
            available: true,
            speeds: speeds,
            verbosities: verbosities,
            modes: modes,
            tagline: tagline,
            contextWindow: contextWindow,
            pricing: pricing
        )
    }

    func testEffortLabelsCoverTheWholeVocabulary() {
        XCTAssertEqual(ModelPickerSheet.effortLabel(nil), "Auto")
        XCTAssertEqual(ModelPickerSheet.effortLabel("none"), "Off")
        XCTAssertEqual(ModelPickerSheet.effortLabel("minimal"), "Minimal")
        XCTAssertEqual(ModelPickerSheet.effortLabel("low"), "Low")
        XCTAssertEqual(ModelPickerSheet.effortLabel("medium"), "Medium")
        XCTAssertEqual(ModelPickerSheet.effortLabel("high"), "High")
        XCTAssertEqual(ModelPickerSheet.effortLabel("xhigh"), "Extra")
        XCTAssertEqual(ModelPickerSheet.effortLabel("max"), "Max")
        XCTAssertEqual(ModelPickerSheet.effortLabel("ludicrous"), "Auto")
    }

    func testOptionLabels() {
        XCTAssertEqual(ModelPickerSheet.speedLabel(nil), "Standard")
        XCTAssertEqual(ModelPickerSheet.speedLabel("fast"), "Fast")
        XCTAssertEqual(ModelPickerSheet.verbosityLabel(nil), "Normal")
        XCTAssertEqual(ModelPickerSheet.verbosityLabel("low"), "Brief")
        XCTAssertEqual(ModelPickerSheet.verbosityLabel("high"), "Detailed")
        XCTAssertEqual(ModelPickerSheet.modeLabel(nil), "Standard")
        XCTAssertEqual(ModelPickerSheet.modeLabel("pro"), "Pro")
    }

    func testEffortsFollowCanonicalOrderAndDropStrangers() {
        let wide = model("openai/gpt-5.6-sol", efforts: ["max", "ludicrous", "none", "high"])
        XCTAssertEqual(ModelPickerSheet.efforts(for: wide), ["none", "high", "max"])
        // Auto leads the chips, and is nil rather than a value.
        let options = ModelPickerSheet.effortOptions(for: wide)
        XCTAssertEqual(options.count, 4)
        XCTAssertNil(options[0])
        XCTAssertEqual(options[1], "none")
        // A model that rejects reasoning outright draws no row at all.
        XCTAssertTrue(ModelPickerSheet.effortOptions(for: model("a/b", efforts: [])).isEmpty)
    }

    func testSpeedLengthAndModeRowsOnlyWhenThereIsAChoice() {
        let rich = model(
            "openai/gpt-5.6-luna",
            speeds: ["standard", "fast"],
            verbosities: ["low", "medium", "high"],
            modes: ["standard", "pro"]
        )
        XCTAssertEqual(ModelPickerSheet.speeds(for: rich), ["standard", "fast"])
        XCTAssertEqual(ModelPickerSheet.verbosities(for: rich), ["low", "medium", "high"])
        XCTAssertEqual(ModelPickerSheet.modes(for: rich), ["standard", "pro"])

        let plain = model("a/b")
        XCTAssertTrue(ModelPickerSheet.speeds(for: plain).isEmpty)
        XCTAssertTrue(ModelPickerSheet.verbosities(for: plain).isEmpty)
        XCTAssertTrue(ModelPickerSheet.modes(for: plain).isEmpty)
        XCTAssertTrue(ModelPickerSheet.speeds(for: nil).isEmpty)
    }

    func testActiveValuesFallBackToTheDefaultWithoutErasing() {
        let rich = model(
            "openai/gpt-5.6-luna",
            speeds: ["standard", "fast"],
            verbosities: ["low", "medium", "high"],
            modes: ["standard", "pro"]
        )
        let plain = model("a/b")

        XCTAssertEqual(ModelPickerSheet.activeSpeed("fast", for: rich), "fast")
        XCTAssertEqual(ModelPickerSheet.activeSpeed("fast", for: plain), "standard")
        XCTAssertEqual(ModelPickerSheet.activeSpeed(nil, for: rich), "standard")

        XCTAssertEqual(ModelPickerSheet.activeVerbosity("high", for: rich), "high")
        XCTAssertEqual(ModelPickerSheet.activeVerbosity("high", for: plain), "medium")

        XCTAssertEqual(ModelPickerSheet.activeMode("pro", for: rich), "pro")
        XCTAssertEqual(ModelPickerSheet.activeMode("pro", for: plain), "standard")

        // Reasoning keeps its own rule: an effort the model rejects reads as
        // Auto, and is left in the store untouched.
        XCTAssertEqual(ModelPickerSheet.activeEffort("high", for: rich), "high")
        XCTAssertNil(ModelPickerSheet.activeEffort("high", for: model("a/b", efforts: [])))
    }

    /// Picking the default chip stores its own value. Writing nil instead would
    /// be read by the server as "no opinion, apply the account's stored
    /// default", so a user who once chose Fast and then deliberately chose
    /// Standard would keep running Fast. Nil means only "never chose".
    func testTheExplicitDefaultIsStoredAndReadsAsTheDefaultChip() {
        let rich = model(
            "openai/gpt-5.6-luna",
            speeds: ["standard", "fast"],
            verbosities: ["low", "medium", "high"],
            modes: ["standard", "pro"]
        )
        XCTAssertEqual(ModelPickerSheet.activeSpeed("standard", for: rich), "standard")
        XCTAssertEqual(ModelPickerSheet.activeSpeed(nil, for: rich), "standard")
        XCTAssertEqual(ModelPickerSheet.activeVerbosity("medium", for: rich), "medium")
        XCTAssertEqual(ModelPickerSheet.activeMode("standard", for: rich), "standard")

        // And it survives a round trip through the store, since that is what
        // the chip's action writes. `SettingsStore` is backed by
        // `UserDefaults.standard`, so put back whatever this machine had.
        let settings = SettingsStore()
        let prior = (settings.chatSpeed, settings.chatVerbosity, settings.chatMode)
        defer {
            settings.chatSpeed = prior.0
            settings.chatVerbosity = prior.1
            settings.chatMode = prior.2
        }
        settings.chatSpeed = "standard"
        settings.chatVerbosity = "medium"
        settings.chatMode = "standard"
        let reloaded = SettingsStore()
        XCTAssertEqual(reloaded.chatSpeed, "standard")
        XCTAssertEqual(reloaded.chatVerbosity, "medium")
        XCTAssertEqual(reloaded.chatMode, "standard")
    }

    func testMetaLinePrefersTheTaglineThenDerivesOne() {
        XCTAssertEqual(
            ModelPickerSheet.metaLine(for: model("a/b", tagline: "Fastest and lowest cost")),
            "Fastest and lowest cost"
        )
        XCTAssertEqual(
            ModelPickerSheet.metaLine(
                for: model("a/b", contextWindow: 1_050_000, pricing: .init(input: 2, output: 12))
            ),
            "1M context \u{00B7} $2 / $12 per M"
        )
        XCTAssertEqual(
            ModelPickerSheet.metaLine(for: model("a/b", contextWindow: 400_000)),
            "400K context"
        )
        XCTAssertNil(ModelPickerSheet.metaLine(for: model("a/b")))
    }

    func testContextAndPriceFormatting() {
        XCTAssertEqual(ModelPickerSheet.contextText(1_050_000), "1M")
        XCTAssertEqual(ModelPickerSheet.contextText(1_048_576), "1M")
        // Half-millions survive: rounding to a whole million reported a genuine
        // 1.5M model as "2M".
        XCTAssertEqual(ModelPickerSheet.contextText(1_500_000), "1.5M")
        XCTAssertEqual(ModelPickerSheet.contextText(2_000_000), "2M")
        XCTAssertEqual(ModelPickerSheet.contextText(400_000), "400K")
        XCTAssertEqual(ModelPickerSheet.contextText(900), "900")

        XCTAssertEqual(ModelPickerSheet.priceText(2), "$2")
        XCTAssertEqual(ModelPickerSheet.priceText(0.2), "$0.20")
        XCTAssertEqual(ModelPickerSheet.priceText(4.5), "$4.50")
        XCTAssertEqual(ModelPickerSheet.priceText(0.0715), "$0.0715")
    }

    func testAutoIsAStoredChoiceThatReadsAsAuto() {
        let wide = model("openai/gpt-5.6-sol")
        XCTAssertEqual(ModelPickerSheet.storedEffort(nil), AskQuestionRequest.autoEffort)
        XCTAssertEqual(ModelPickerSheet.storedEffort("high"), "high")
        XCTAssertNil(ModelPickerSheet.activeEffort(AskQuestionRequest.autoEffort, for: wide))
        XCTAssertEqual(ModelPickerSheet.effortLabel(AskQuestionRequest.autoEffort), "Auto")
        XCTAssertFalse(ModelPickerSheet.efforts(for: wide).contains(AskQuestionRequest.autoEffort))
    }

    /// Both shells must show the same copy under the MODE chips, and it carries
    /// no trailing period.
    func testProModeNoteMatchesTheOtherClients() {
        XCTAssertEqual(
            ModelPickerSheet.proModeNote,
            "Deeper multi-pass reasoning; slower and pricier"
        )
    }

    func testSeedingFillsOnlyWhatWasNeverChosenHere() {
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

        let served = AIModelsResponse(
            models: [model("openai/gpt-5.6-terra")],
            defaults: .init(
                modelId: "openai/gpt-5.6-terra",
                effort: "high",
                speed: "fast",
                verbosity: "low",
                mode: "pro"
            )
        )

        settings.chatEffort = nil
        settings.chatSpeed = nil
        settings.chatVerbosity = nil
        settings.chatMode = nil
        ModelPickerSheet.seedDefaults(from: served, into: settings)
        XCTAssertEqual(settings.chatEffort, "high")
        XCTAssertEqual(settings.chatSpeed, "fast")
        XCTAssertEqual(settings.chatVerbosity, "low")
        XCTAssertEqual(settings.chatMode, "pro")

        // A local pick always wins. Auto counts as a pick, which is the whole
        // point of the sentinel: nil would be overwritten here, "auto" is not.
        settings.chatEffort = AskQuestionRequest.autoEffort
        ModelPickerSheet.seedDefaults(from: served, into: settings)
        XCTAssertEqual(settings.chatEffort, AskQuestionRequest.autoEffort)

        // House mode pins its options server-side, so it seeds nothing.
        settings.chatEffort = nil
        let house = AIModelsResponse(
            access: "house",
            models: [model("openai/gpt-5.6-luna")],
            defaults: .init(modelId: "openai/gpt-5.6-luna", effort: "medium"),
            house: .init(
                modelId: "openai/gpt-5.6-luna",
                label: "GPT-5.6 Luna",
                effort: "medium",
                note: nil
            )
        )
        ModelPickerSheet.seedDefaults(from: house, into: settings)
        XCTAssertNil(settings.chatEffort)
    }

    func testPillsNameCapabilitiesAndNeverExceedThree() {
        let everything = model("a/b", speeds: ["standard", "fast"], modes: ["standard", "pro"])
        XCTAssertEqual(ModelPickerSheet.pills(for: everything), ["Files", "Fast", "Pro"])

        let plain = AIModel(
            id: "a/b",
            label: "B",
            provider: "a",
            supportsAttachments: false,
            available: true
        )
        XCTAssertTrue(ModelPickerSheet.pills(for: plain).isEmpty)
    }

    /// The one payload shape that costs the whole list rather than one flag if
    /// `AIModel.init(from:)` ever gains a plain `decode`.
    func testDecodesAPayloadFromAServerTooOldToSendTheOptions() throws {
        let json = """
        { "models": [{ "id": "a/b", "label": "B", "provider": "a", "available": true }],
          "defaults": { "modelId": "a/b" } }
        """
        let decoded = try JSONDecoder().decode(AIModelsResponse.self, from: Data(json.utf8))
        let model = try XCTUnwrap(decoded.models.first)
        XCTAssertEqual(model.speeds, ["standard"])
        XCTAssertEqual(model.modes, ["standard"])
        XCTAssertTrue(model.verbosities.isEmpty)
        XCTAssertNil(model.pricing)
        XCTAssertNil(decoded.defaults.speed)
        XCTAssertNil(decoded.defaults.verbosity)
        XCTAssertNil(decoded.defaults.mode)
    }

    func testDecodesTheRunOptionsPayload() throws {
        let json = """
        {
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
        let model = try XCTUnwrap(decoded.models.first)
        XCTAssertEqual(model.speeds, ["standard", "fast"])
        XCTAssertEqual(model.verbosities, ["low", "medium", "high"])
        XCTAssertEqual(model.modes, ["standard", "pro"])
        XCTAssertEqual(model.defaultEffort, "medium")
        XCTAssertEqual(model.tier, "fast")
        XCTAssertEqual(model.contextWindow, 1_050_000)
        XCTAssertEqual(model.pricing?.input, 0.2)
        XCTAssertEqual(model.pricing?.output, 1.2)
        XCTAssertEqual(model.fastModeNote, "About 2x the standard price")
        XCTAssertEqual(decoded.defaults.speed, "fast")
        XCTAssertEqual(decoded.defaults.verbosity, "low")
        XCTAssertEqual(decoded.defaults.mode, "pro")
        XCTAssertEqual(ModelPickerSheet.pills(for: model), ["Files", "Fast", "Pro"])
    }
}
