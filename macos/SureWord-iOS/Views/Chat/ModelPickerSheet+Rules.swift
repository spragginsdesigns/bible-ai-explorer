import Foundation

/// The pure selection rules behind `ModelPickerSheet`, a port of
/// `mobile/src/features/chat/modelPickerRules.ts` (Android is the source of
/// truth). They live outside the view body so the branches that actually bite
/// - house mode, a stored pick for a provider whose key is gone, a server that
/// predates the `providers` array, a stored run option the current model does
/// not offer - are unit tested without a renderer
/// (`SureWord-iOSTests/ModelPickerRulesTests.swift`).
///
/// The macOS `ModelPickerPopover` keeps its own copy in `ModelPickerRules`,
/// which lives in the macOS target. **If one changes, change both** (and the
/// web and Android pickers with them).
extension ModelPickerSheet {
    // MARK: - Vocabulary

    /// Canonical order of the reasoning chips, lowest to highest. The server's
    /// `efforts` array is filtered *through* this rather than rendered
    /// directly, so a value we don't understand can never draw a chip that
    /// sends garbage upstream.
    static let effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
    static let speedOrder = ["standard", "fast"]
    static let verbosityOrder = ["low", "medium", "high"]
    static let modeOrder = ["standard", "pro"]

    /// What each of speed / length / mode runs at when nothing is stored.
    /// Unlike reasoning they have no Auto chip: the default *is* a chip, and
    /// picking it stores `"standard"` / `"medium"` / `"standard"` **verbatim**.
    ///
    /// Storing nil for the default would be a bug, not a tidy-up. The server
    /// reads a missing `speed` / `verbosity` / `mode` as "no opinion, apply the
    /// account's stored default", so a user who once chose Fast and then
    /// deliberately chose Standard would keep running Fast for ever. Nil means
    /// only one thing here: never chose.
    static let defaultSpeed = "standard"
    static let defaultVerbosity = "medium"
    static let defaultMode = "standard"

    /// Fixed copy under the MODE chips - Pro is expensive enough that the row
    /// must say so before it is tapped. No trailing period: it matches the
    /// other clients' string byte for byte.
    static let proModeNote = "Deeper multi-pass reasoning; slower and pricier"

    /// Search shows whenever there is more than one model to choose between
    /// (Android `SEARCH_THRESHOLD`, web the same).
    static let searchThreshold = 1

    /// Copy under the house model when the server sends no `note` of its own.
    /// Kept in step with `ModelPickerRules.fallbackHouseNote` on macOS.
    static let fallbackHouseNote =
        "Included with SureWord. Add your own API key to choose other models."

    static let emptySearchText = "No models match that."
    static let addKeyTitle = "Add an API key"
    static let addKeyDetail = "Unlock more models in Settings"

    // MARK: - Labels

    static func effortLabel(_ effort: String?) -> String {
        switch effort {
        case "none": "Off"
        case "minimal": "Minimal"
        case "low": "Low"
        case "medium": "Medium"
        case "high": "High"
        case "xhigh": "Extra"
        case "max": "Max"
        default: "Auto"
        }
    }

    static func speedLabel(_ speed: String?) -> String {
        speed == "fast" ? "Fast" : "Standard"
    }

    static func verbosityLabel(_ verbosity: String?) -> String {
        switch verbosity {
        case "low": "Brief"
        case "high": "Detailed"
        default: "Normal"
        }
    }

    static func modeLabel(_ mode: String?) -> String {
        mode == "pro" ? "Pro" : "Standard"
    }

    // MARK: - Selection

    /// The house block, but only when the server put the account in house
    /// mode. An older payload carries neither field and stays in the keys
    /// shape it was written for.
    static func houseMode(_ data: AIModelsResponse?) -> AIModelsResponse.HouseModel? {
        guard let data, data.access == "house" else { return nil }
        return data.house
    }

    /// The model to render as picked: the stored pick while the server still
    /// offers it, otherwise the server default. House mode always answers the
    /// house model, because the server runs that regardless of what is asked.
    static func selectModelId(stored: String?, data: AIModelsResponse?) -> String? {
        guard let data else { return nil }
        if let house = houseMode(data) { return house.modelId }
        let stillOffered = data.models.contains { $0.id == stored && $0.available }
        return stillOffered ? stored : data.defaults.modelId
    }

    /// The full entry for the picked model, so the option rows can read its
    /// capabilities. Nil when the default names a model the list lacks.
    static func selectedModel(data: AIModelsResponse?, stored: String?) -> AIModel? {
        guard let id = selectModelId(stored: stored, data: data) else { return nil }
        return data?.models.first { $0.id == id }
    }

    /// The models under one provider row, unavailable ones filtered out.
    static func models(in data: AIModelsResponse?, provider providerId: String) -> [AIModel] {
        (data?.models ?? []).filter { $0.provider == providerId && $0.available }
    }

    /// Provider rows worth drawing: unlocked, and holding at least one model.
    /// Locked providers are never shown - a row that only says "add a key" is
    /// noise - and house mode has no provider rows at all.
    static func visibleProviders(_ data: AIModelsResponse?) -> [AIProviderSummary] {
        guard let data, houseMode(data) == nil else { return [] }
        if let providers = data.providers, !providers.isEmpty {
            return providers.filter {
                $0.available && !models(in: data, provider: $0.id).isEmpty
            }
        }
        // Older payload shape: derive the rows from the flat list, from the
        // models the account can actually run.
        var seen = Set<String>()
        var derived: [AIProviderSummary] = []
        for model in data.models where model.available && !seen.contains(model.provider) {
            seen.insert(model.provider)
            derived.append(
                AIProviderSummary(
                    id: model.provider,
                    label: AIModelsAPI.providerLabels[model.provider] ?? model.provider,
                    available: true
                )
            )
        }
        return derived
    }

    /// Display name for a provider id: the server's label, else ours, else the id.
    static func providerLabel(in data: AIModelsResponse?, provider providerId: String) -> String {
        if let fromServer = data?.providers?.first(where: { $0.id == providerId })?.label {
            return fromServer
        }
        return AIModelsAPI.providerLabels[providerId] ?? providerId
    }

    /// The provider to open on arrival: the current model's, when it has a
    /// row, otherwise the first row.
    static func initialExpandedProvider(data: AIModelsResponse?, selectedId: String?) -> String? {
        let rows = visibleProviders(data)
        let selectedProvider = data?.models.first { $0.id == selectedId }?.provider
        if let selectedProvider, rows.contains(where: { $0.id == selectedProvider }) {
            return selectedProvider
        }
        return rows.first?.id
    }

    // MARK: - Search

    /// True whenever there is more than one runnable model to choose between.
    static func showsSearch(_ data: AIModelsResponse?) -> Bool {
        guard let data, houseMode(data) == nil else { return false }
        return data.models.filter(\.available).count > searchThreshold
    }

    /// Characters the compact form drops, so "gpt56" and "gpt 5.6" both find
    /// "GPT-5.6" (Android's `/[\s_./:-]/g`).
    private static func compacted(_ text: String) -> String {
        String(text.filter { !($0.isWhitespace || "_./:-".contains($0)) })
    }

    /// Flat search across every provider. An empty query answers every
    /// available model, so the caller decides whether to draw the flat list or
    /// the groups.
    ///
    /// Every token must land somewhere in the label or the namespaced id (which
    /// carries the provider, so "anthropic" or "openrouter" work too). Label
    /// hits outrank id-only hits; ties keep catalog order, so the curated heads
    /// stay on top.
    static func filterModels(_ data: AIModelsResponse?, query: String) -> [AIModel] {
        guard let data else { return [] }
        let available = data.models.filter(\.available)
        let tokens = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        guard let first = tokens.first else { return available }

        var ranked: [(index: Int, rank: Int, model: AIModel)] = []
        for (index, model) in available.enumerated() {
            let label = model.label.lowercased()
            let haystack = "\(label) \(model.id.lowercased())"
            let compact = compacted(haystack)
            let hit = tokens.allSatisfy { token in
                if haystack.contains(token) { return true }
                let compactToken = compacted(token)
                // A token of nothing but punctuation matches everything, as
                // `"".includes` does on Android.
                return compactToken.isEmpty || compact.contains(compactToken)
            }
            guard hit else { continue }
            let rank = label.hasPrefix(first) ? 0 : (label.contains(first) ? 1 : 2)
            ranked.append((index, rank, model))
        }
        return ranked
            .sorted { ($0.rank, $0.index) < ($1.rank, $1.index) }
            .map(\.model)
    }

    // MARK: - Per-model capabilities

    /// Efforts a model accepts, in canonical order. Empty means it rejects the
    /// option outright and the control must not be shown at all.
    static func efforts(for model: AIModel?) -> [String] {
        guard let model else { return [] }
        return effortOrder.filter { model.efforts.contains($0) }
    }

    /// Speed chips, or none when the model has only one speed. The default is
    /// forced back in so the row always offers a way back to Standard.
    static func speeds(for model: AIModel?) -> [String] {
        guard let model, model.speeds.contains("fast") else { return [] }
        return speedOrder.filter { model.speeds.contains($0) || $0 == defaultSpeed }
    }

    /// Length chips, Normal always among them. Deliberately stricter than
    /// Android, which draws a lone inert "Normal" chip for a model that lists
    /// only `medium`: a row with nothing to choose is not drawn here.
    static func verbosities(for model: AIModel?) -> [String] {
        guard let model, !model.verbosities.isEmpty else { return [] }
        let offered = verbosityOrder.filter {
            model.verbosities.contains($0) || $0 == defaultVerbosity
        }
        return offered.count > 1 ? offered : []
    }

    static func modes(for model: AIModel?) -> [String] {
        guard let model, model.modes.contains("pro") else { return [] }
        return modeOrder.filter { model.modes.contains($0) || $0 == defaultMode }
    }

    /// The reasoning chips including Auto, which is nil rather than a value.
    static func effortOptions(for model: AIModel?) -> [String?] {
        let offered = efforts(for: model)
        if offered.isEmpty { return [] }
        var options: [String?] = [nil]
        options.append(contentsOf: offered.map { Optional($0) })
        return options
    }

    /// The chip that reads as active for reasoning - a *display* rule, never a
    /// storage one. Picking a model must not rewrite the stored effort: the
    /// server drops one the model rejects on its own, and normalizing here
    /// would mean a detour through a non-reasoning model silently threw away a
    /// setting the user chose. The Auto sentinel reads as Auto, as nil does.
    static func activeEffort(_ stored: String?, for model: AIModel?) -> String? {
        guard let stored, stored != AskQuestionRequest.autoEffort else { return nil }
        return efforts(for: model).contains(stored) ? stored : nil
    }

    /// What the Auto chip stores. Nil would mean "never chose" and omit the key
    /// from the request, which is the server's cue to apply the account's
    /// stored default - the opposite of what tapping Auto asks for.
    static func storedEffort(_ effort: String?) -> String {
        effort ?? AskQuestionRequest.autoEffort
    }

    /// Nil (never chose) and the explicit default both read as the default
    /// chip. A stored value the current model cannot honour falls back to the
    /// default chip and is left in `SettingsStore` untouched.
    static func activeSpeed(_ stored: String?, for model: AIModel?) -> String {
        guard let stored, speeds(for: model).contains(stored) else { return defaultSpeed }
        return stored
    }

    static func activeVerbosity(_ stored: String?, for model: AIModel?) -> String {
        guard let stored, verbosities(for: model).contains(stored) else { return defaultVerbosity }
        return stored
    }

    static func activeMode(_ stored: String?, for model: AIModel?) -> String {
        guard let stored, modes(for: model).contains(stored) else { return defaultMode }
        return stored
    }

    // MARK: - Option sections

    /// Columns for a section's chip grid, so every chip is the same width and
    /// none is clipped: up to four choices share one row, five or six take two
    /// rows of three, and reasoning's seven or eight take two rows of four.
    static func optionGridColumns(_ choiceCount: Int) -> Int {
        if choiceCount <= 0 { return 1 }
        if choiceCount <= 4 { return choiceCount }
        if choiceCount <= 6 { return 3 }
        return 4
    }

    /// The chips of one section split into grid rows of `optionGridColumns`.
    static func gridRows<T>(_ options: [T]) -> [[T]] {
        let columns = optionGridColumns(options.count)
        return stride(from: 0, to: options.count, by: columns).map { start in
            Array(options[start..<min(start + columns, options.count)])
        }
    }

    /// True when the selected model offers any run option, which is what
    /// earns the sheet its Models / Options tabs.
    static func hasOptions(_ model: AIModel?) -> Bool {
        !effortOptions(for: model).isEmpty
            || !speeds(for: model).isEmpty
            || !verbosities(for: model).isEmpty
            || !modes(for: model).isEmpty
    }

    /// One chip's spoken name: "Reasoning: High".
    static func chipAccessibilityLabel(section: String, choice: String) -> String {
        "\(section): \(choice)"
    }

    // MARK: - Header copy

    /// "Your model" for a keyless account, "Choose a model" otherwise.
    static func title(house: AIModelsResponse.HouseModel?) -> String {
        house == nil ? "Choose a model" : "Your model"
    }

    /// "Using GPT-5.6 Luna · High", or nil when there is nothing to say: house
    /// mode, or before a model is resolved.
    static func summaryLine(_ summary: String) -> String? {
        summary.isEmpty ? nil : "Using \(summary)"
    }

    static func optionsIntro(for model: AIModel) -> String {
        "How \(model.label) answers. Changes apply to your next message."
    }

    /// "GPT-5.6 Luna · High · Fast · Detailed · Pro": the model plus every
    /// option that is not the default. Auto reasoning contributes nothing, nor
    /// does an explicitly stored default, nor an option the selected model
    /// does not support, so the line always describes what the next message
    /// will run with. Empty before a model is resolved.
    static func summaryLabel(
        model: AIModel?,
        effort: String?,
        speed: String?,
        verbosity: String?,
        mode: String?
    ) -> String {
        guard let model else { return "" }
        var parts = [model.label]
        if let active = activeEffort(effort, for: model) { parts.append(effortLabel(active)) }
        let speedValue = activeSpeed(speed, for: model)
        if speedValue != defaultSpeed { parts.append(speedLabel(speedValue)) }
        let verbosityValue = activeVerbosity(verbosity, for: model)
        if verbosityValue != defaultVerbosity { parts.append(verbosityLabel(verbosityValue)) }
        let modeValue = activeMode(mode, for: model)
        if modeValue != defaultMode { parts.append(modeLabel(modeValue)) }
        return parts.joined(separator: " \u{00B7} ")
    }

    static func houseNote(_ house: AIModelsResponse.HouseModel) -> String {
        let note = house.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? fallbackHouseNote : note
    }

    /// The reasoning chips an included account may choose, in canonical order:
    /// Low / Medium / High on Pro, none on Free or on an older server that
    /// sends no `efforts`. No Auto chip - the server always runs one of these.
    /// Kept in step with `ModelPickerRules.houseEfforts` on macOS.
    static func houseEfforts(_ house: AIModelsResponse.HouseModel?) -> [String] {
        guard let offered = house?.efforts, !offered.isEmpty else { return [] }
        return effortOrder.filter { offered.contains($0) }
    }

    /// The house chip that reads as active: the local pick while it is one the
    /// account may choose, else what the server says the next answer runs at.
    static func activeHouseEffort(_ stored: String?, house: AIModelsResponse.HouseModel?) -> String? {
        let offered = houseEfforts(house)
        if let stored, offered.contains(stored) { return stored }
        guard let effort = house?.effort, offered.contains(effort) else { return nil }
        return effort
    }

    // MARK: - Store adoption

    /// Fills any option the user has never chosen on *this* device with the
    /// account default the server sent, so the chips agree with a choice made
    /// on another client. Only ever fills a nil - a local pick always wins -
    /// never with an empty string, which would store a value that means
    /// nothing, and never in house mode, where the options are pinned.
    @MainActor
    static func seedDefaults(from data: AIModelsResponse, into settings: SettingsStore) {
        guard houseMode(data) == nil else { return }
        func usable(_ value: String?) -> String? {
            guard let value, !value.isEmpty else { return nil }
            return value
        }
        // Never PATCHes: these values *came from* the account, and writing them
        // back would turn the server's own default into a choice made here.
        settings.applyRemote { settings in
            if settings.chatEffort == nil, let effort = usable(data.defaults.effort) {
                settings.chatEffort = effort
            }
            if settings.chatSpeed == nil, let speed = usable(data.defaults.speed) {
                settings.chatSpeed = speed
            }
            if settings.chatVerbosity == nil, let verbosity = usable(data.defaults.verbosity) {
                settings.chatVerbosity = verbosity
            }
            if settings.chatMode == nil, let mode = usable(data.defaults.mode) {
                settings.chatMode = mode
            }
        }
    }

    /// House mode pins every pref so outgoing requests and the stored picks
    /// agree with what the server will actually run - otherwise a pick left
    /// over from a key that has since been removed keeps riding every message.
    /// The house model runs one fixed configuration, so the three run options
    /// are cleared rather than pinned.
    ///
    /// Local-only: this is the client agreeing with the server, not a choice.
    /// PATCHing it would overwrite the model this account picked while it
    /// still had a key, and lose it the moment the key comes back.
    ///
    /// A Pro account chooses its effort (`house.efforts`), so a local pick
    /// that is one of those choices survives the pin; anything else (Free, a
    /// pick from a keys-mode model, Auto) is pinned to the server's effort.
    @MainActor
    static func pinHouseMode(from data: AIModelsResponse, into settings: SettingsStore) {
        guard let house = houseMode(data) else { return }
        settings.applyRemote { settings in
            if settings.chatModelId != house.modelId { settings.chatModelId = house.modelId }
            let keepsPick = settings.chatEffort.map { houseEfforts(house).contains($0) } ?? false
            if !keepsPick, settings.chatEffort != house.effort { settings.chatEffort = house.effort }
            if settings.chatSpeed != nil { settings.chatSpeed = nil }
            if settings.chatVerbosity != nil { settings.chatVerbosity = nil }
            if settings.chatMode != nil { settings.chatMode = nil }
        }
    }

    // MARK: - Model rows

    /// The second line under a model's name: its curated tagline, else a line
    /// derived from what the server does know, else nothing.
    static func metaLine(for model: AIModel) -> String? {
        let tagline = model.tagline?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !tagline.isEmpty { return tagline }

        var parts: [String] = []
        if let context = model.contextWindow, context > 0 {
            parts.append("\(contextText(context)) context")
        }
        if let pricing = model.pricing, pricing.input.isFinite, pricing.output.isFinite {
            parts.append("\(priceText(pricing.input)) / \(priceText(pricing.output)) per M")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// 1,050,000 -> "1M", 1,500,000 -> "1.5M", 400,000 -> "400K". Millions
    /// round to the nearest **half** million, matching the other clients.
    static func contextText(_ tokens: Int) -> String {
        if tokens >= 1_000_000 {
            let millions = (Double(tokens) / 500_000).rounded() / 2
            if millions == millions.rounded() { return "\(Int(millions))M" }
            return "\(String(format: "%.1f", millions))M"
        }
        if tokens >= 1_000 {
            return "\(Int((Double(tokens) / 1_000).rounded()))K"
        }
        return "\(tokens)"
    }

    /// USD per million, whole dollars bare and everything else to two
    /// decimals: "$2", "$0.20", "$4.50", "$0.07" - Android's and web's rule.
    static func priceText(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1_000_000 {
            return "$\(Int(value))"
        }
        return String(format: "$%.2f", value)
    }

    /// The tiny pills after a model's name. Never more than three.
    static func pills(for model: AIModel) -> [String] {
        var pills: [String] = []
        if model.supportsAttachments { pills.append("Files") }
        if model.speeds.contains("fast") { pills.append("Fast") }
        if model.modes.contains("pro") { pills.append("Pro") }
        return Array(pills.prefix(3))
    }
}
