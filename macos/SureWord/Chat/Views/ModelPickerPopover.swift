import SwiftUI

// MARK: - Rules

/// The selection rules behind the model picker, kept as pure functions so they
/// can be pinned by tests rather than re-derived inside the view.
///
/// Ported from `src/components/ModelPicker.tsx` and
/// `mobile/src/features/chat/ModelPickerSheet.tsx`; the iOS sheet
/// (`SureWord-iOS/Views/Chat/ModelPickerSheet.swift`) expresses the same rules
/// inline. If one changes, change all of them.
enum ModelPickerRules {
    /// Canonical order of the reasoning chips, lowest to highest. The server's
    /// `efforts` array is filtered *through* this rather than rendered
    /// directly, so a value we don't understand can never draw a chip that
    /// sends garbage upstream.
    static let effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]

    /// The other three option vocabularies, same filtering rule.
    static let speedOrder = ["standard", "fast"]
    static let verbosityOrder = ["low", "medium", "high"]
    static let modeOrder = ["standard", "pro"]

    /// The value each of those three runs at when nothing is stored. Unlike
    /// reasoning they have no Auto chip: the default *is* a chip, and picking
    /// it stores `"standard"` / `"medium"` / `"standard"` **verbatim**.
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

    /// Chips per row. The full effort vocabulary is seven values plus Auto, and
    /// eight chips across the popover leaves no room for a word like
    /// "Minimal", so the row wraps instead of shrinking.
    static let chipsPerRow = 4

    /// Above this many reachable models the list gets a search field. Below it
    /// the provider groups are quicker than typing.
    static let searchThreshold = 8

    /// Copy under the house model when the server sends no `note` of its own.
    static let fallbackHouseNote =
        "Included with SureWord. Add your own API key to choose other models."

    /// The house block, and only when the server actually said `access:
    /// "house"`. An older payload has neither field and stays in keys mode,
    /// which is the shape it was written for.
    static func house(in data: AIModelsResponse?) -> AIModelsResponse.HouseModel? {
        guard let data, data.access == "house" else { return nil }
        return data.house
    }

    static func isHouse(_ data: AIModelsResponse?) -> Bool {
        house(in: data) != nil
    }

    static func houseNote(_ house: AIModelsResponse.HouseModel) -> String {
        let note = house.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? fallbackHouseNote : note
    }

    /// The id the picker shows as active. A locally stored pick only counts
    /// while it names a model the account can actually reach - a key removed in
    /// Settings must not leave the picker claiming a model that would fail - so
    /// anything else falls back to the account default.
    ///
    /// House mode overrides the stored id outright: there is exactly one model
    /// the account can reach, and a pick left over from a key it no longer has
    /// must not read as active next to it.
    static func selectedModelID(in data: AIModelsResponse?, stored: String?) -> String? {
        guard let data else { return nil }
        if let house = house(in: data) { return house.modelId }
        if let stored, data.models.contains(where: { $0.id == stored && $0.available }) {
            return stored
        }
        return data.defaults.modelId
    }

    static func selectedModel(in data: AIModelsResponse?, stored: String?) -> AIModel? {
        guard let data, let id = selectedModelID(in: data, stored: stored) else { return nil }
        return data.models.first { $0.id == id }
    }

    /// Provider rows, newest payload first. Older servers omit `providers`, so
    /// the rows are derived from the flat model list in first-seen order.
    ///
    /// **Only providers the account can actually use are returned.** A locked
    /// row is an "Add your API key" advert wearing a provider's name: it is not
    /// a choice, it cannot be acted on from the picker, and it made a keyless
    /// account's picker read as mostly broken. Settings is where keys are
    /// added, and the footer is the one pointer to it.
    static func providers(in data: AIModelsResponse) -> [AIProviderSummary] {
        if isHouse(data) { return [] }
        if let providers = data.providers, !providers.isEmpty {
            return providers.filter(\.available)
        }
        var seen: [String: AIProviderSummary] = [:]
        var order: [String] = []
        for model in data.models where seen[model.provider] == nil {
            seen[model.provider] = AIProviderSummary(
                id: model.provider,
                label: AIModelsAPI.providerLabels[model.provider] ?? model.provider,
                available: model.available
            )
            order.append(model.provider)
        }
        return order.compactMap { seen[$0] }.filter(\.available)
    }

    /// Models under a provider, unavailable ones dropped for the same reason
    /// their providers are.
    static func models(ofProvider providerID: String, in data: AIModelsResponse) -> [AIModel] {
        data.models.filter { $0.provider == providerID && $0.available }
    }

    /// Efforts a model accepts, in canonical order. Empty means the model
    /// rejects the option outright (OpenAI's non-reasoning models, Anthropic's
    /// Haiku), and the reasoning control must not be shown at all.
    static func efforts(for model: AIModel?) -> [String] {
        guard let model else { return [] }
        return effortOrder.filter { model.efforts.contains($0) }
    }

    static func supportsEffort(_ model: AIModel?) -> Bool {
        !efforts(for: model).isEmpty
    }

    /// Efforts to offer for the current selection. House mode pins the effort
    /// server-side, so the control is not shown at all - an inert chip row is
    /// worse than none.
    static func efforts(in data: AIModelsResponse?, stored: String?) -> [String] {
        if isHouse(data) { return [] }
        return efforts(for: selectedModel(in: data, stored: stored))
    }

    static func supportsEffort(in data: AIModelsResponse?, stored: String?) -> Bool {
        !efforts(in: data, stored: stored).isEmpty
    }

    /// The chip that reads as active for `model` - a *display* rule, never a
    /// storage one.
    ///
    /// Picking a model must not rewrite the stored effort. Web doesn't
    /// (`pickModel` in `src/components/ModelPicker.tsx` touches the model id
    /// only) and the server strips an effort the model rejects on its own
    /// (`resolveModel` in `src/lib/ai/provider.ts`: `definition.efforts
    /// .includes(preferredEffort) ? preferredEffort : null`). Normalizing on
    /// pick would mean a two-second detour through a non-reasoning model
    /// silently and permanently threw away a setting the user chose.
    /// So the preference survives, and only stops *showing* while the current
    /// model couldn't honour it - which reads as Auto.
    /// The Auto sentinel is a stored *choice*, not an effort value, so it reads
    /// as Auto here exactly as nil does. Checked explicitly rather than left to
    /// "`auto` is never in a model's `efforts`" - that is true of today's
    /// server, and is not a property this rule should depend on.
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

    // MARK: Speed / length / mode

    /// Speed chips for a model, or none at all when it has only one speed - a
    /// row whose every chip does the same thing is worse than no row.
    ///
    /// The default is forced back in even if the server omitted it, so the row
    /// always offers a way back to Standard.
    static func speeds(for model: AIModel?) -> [String] {
        guard let model, model.speeds.contains("fast") else { return [] }
        return speedOrder.filter { model.speeds.contains($0) || $0 == defaultSpeed }
    }

    /// Length chips. A model with no `verbosities` rejects the option outright;
    /// one offering only the default has nothing to choose between.
    static func verbosities(for model: AIModel?) -> [String] {
        guard let model, !model.verbosities.isEmpty else { return [] }
        let offered = verbosityOrder.filter {
            model.verbosities.contains($0) || $0 == defaultVerbosity
        }
        return offered.count > 1 ? offered : []
    }

    /// Mode chips, only for a model that actually offers Pro.
    static func modes(for model: AIModel?) -> [String] {
        guard let model, model.modes.contains("pro") else { return [] }
        return modeOrder.filter { model.modes.contains($0) || $0 == defaultMode }
    }

    static func speeds(in data: AIModelsResponse?, stored: String?) -> [String] {
        if isHouse(data) { return [] }
        return speeds(for: selectedModel(in: data, stored: stored))
    }

    static func verbosities(in data: AIModelsResponse?, stored: String?) -> [String] {
        if isHouse(data) { return [] }
        return verbosities(for: selectedModel(in: data, stored: stored))
    }

    static func modes(in data: AIModelsResponse?, stored: String?) -> [String] {
        if isHouse(data) { return [] }
        return modes(for: selectedModel(in: data, stored: stored))
    }

    /// Which chip reads as active. Display only, exactly like `activeEffort`:
    /// a stored value the current model cannot honour falls back to the default
    /// chip and is left in `SettingsStore` untouched.
    ///
    /// Nil (never chose) and the explicit default both read as the default
    /// chip, which is what makes storing the default verbatim invisible here.
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

    // MARK: Seeding

    /// Fills any option the user has never chosen on *this* device with the
    /// account default the server sent, so the chips agree with a choice made
    /// on another client instead of all reading Auto/Standard while the server
    /// quietly runs something else.
    ///
    /// Only ever fills a nil - a local pick always wins - and never in house
    /// mode, where the options are pinned server-side and there is no user
    /// default to honour. Seeding is idempotent: the second call finds every
    /// field non-nil and does nothing.
    @MainActor
    static func seedDefaults(from data: AIModelsResponse, into settings: SettingsStore) {
        guard !isHouse(data) else { return }
        if settings.chatEffort == nil, let effort = data.defaults.effort {
            settings.chatEffort = effort
        }
        if settings.chatSpeed == nil, let speed = data.defaults.speed {
            settings.chatSpeed = speed
        }
        if settings.chatVerbosity == nil, let verbosity = data.defaults.verbosity {
            settings.chatVerbosity = verbosity
        }
        if settings.chatMode == nil, let mode = data.defaults.mode {
            settings.chatMode = mode
        }
    }

    // MARK: Labels

    /// Caption on the toolbar button - the model's own label, or a neutral word
    /// while the list is still loading or the default names nothing we know.
    static func buttonLabel(in data: AIModelsResponse?, stored: String?) -> String {
        if let model = selectedModel(in: data, stored: stored) { return model.label }
        // House mode names its model even if the flat list disagrees with the
        // block, which is the one place the label is guaranteed.
        if let house = house(in: data) { return house.label }
        return "Model"
    }

    /// The model plus every option that is not at its default, e.g.
    /// `GPT-5.6 Luna \u{00B7} High \u{00B7} Fast \u{00B7} Detailed`.
    ///
    /// Reasoning on Auto contributes nothing - Auto is the absence of a choice,
    /// and spelling it out would make every default read as a setting. House
    /// mode has no options at all, so it is always just the model.
    static func summaryLabel(
        in data: AIModelsResponse?,
        stored: String?,
        effort: String?,
        speed: String?,
        verbosity: String?,
        mode: String?
    ) -> String {
        let name = buttonLabel(in: data, stored: stored)
        if isHouse(data) { return name }
        let model = selectedModel(in: data, stored: stored)

        var parts = [name]
        if let effort = activeEffort(effort, for: model) {
            parts.append(effortLabel(effort))
        }
        let speedValue = activeSpeed(speed, for: model)
        if speedValue != defaultSpeed { parts.append(speedLabel(speedValue)) }
        let verbosityValue = activeVerbosity(verbosity, for: model)
        if verbosityValue != defaultVerbosity { parts.append(verbosityLabel(verbosityValue)) }
        let modeValue = activeMode(mode, for: model)
        if modeValue != defaultMode { parts.append(modeLabel(modeValue)) }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// The second line under a model's name: its curated tagline, else a line
    /// derived from what the server does know about it, else nothing. A blank
    /// line under the name reads as a layout bug, so nil is returned rather
    /// than an empty string.
    static func metaLine(for model: AIModel) -> String? {
        let tagline = model.tagline?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !tagline.isEmpty { return tagline }

        var parts: [String] = []
        if let context = model.contextWindow, context > 0 {
            parts.append("\(contextText(context)) context")
        }
        if let pricing = model.pricing {
            parts.append("\(priceText(pricing.input)) / \(priceText(pricing.output)) per M")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    /// 1,050,000 -> "1M", 1,500,000 -> "1.5M", 400,000 -> "400K".
    ///
    /// Millions round to the nearest **half** million, matching the other
    /// clients: whole-million rounding turned a genuine 1.5M into "2M", and
    /// full precision ("1.05M") is noise in a line whose job is a rough sense
    /// of scale. Thousands stay whole - nobody needs "128.5K".
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

    /// USD per million: "$2", "$0.20", "$4.50", "$0.0715". Whole dollars lose
    /// the decimals; anything else keeps at least two and at most four, so a
    /// cheap OpenRouter model does not round away to "$0.00".
    static func priceText(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1_000_000 {
            return "$\(Int(value))"
        }
        var text = String(format: "%.4f", value)
        while text.hasSuffix("0"),
              let dot = text.firstIndex(of: "."),
              text.distance(from: dot, to: text.endIndex) > 3 {
            text.removeLast()
        }
        return "$\(text)"
    }

    /// The tiny pills after a model's name. Capabilities only, never more than
    /// three - the row is a list item, not a spec sheet.
    static func pills(for model: AIModel) -> [String] {
        var pills: [String] = []
        if model.supportsAttachments { pills.append("Files") }
        if model.speeds.contains("fast") { pills.append("Fast") }
        if model.modes.contains("pro") { pills.append("Pro") }
        return pills
    }

    // MARK: Search

    /// A search field only earns its space once the groups stop being faster
    /// than typing. House mode never gets one - there is one model.
    static func showsSearch(in data: AIModelsResponse?) -> Bool {
        guard let data, !isHouse(data) else { return false }
        return data.models.filter(\.available).count > searchThreshold
    }

    static func isSearching(_ query: String) -> Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Flat results across every provider, matched on label or id. Unavailable
    /// models stay hidden here for the same reason they are hidden in the
    /// groups: the picker must not offer a model that would fail.
    static func searchResults(in data: AIModelsResponse?, query: String) -> [AIModel] {
        guard let data, isSearching(query) else { return [] }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return data.models.filter { model in
            model.available
                && (model.label.lowercased().contains(needle)
                    || model.id.lowercased().contains(needle))
        }
    }

    static func providerLabel(for model: AIModel) -> String {
        AIModelsAPI.providerLabels[model.provider] ?? model.provider
    }

    /// Chips wrapped into rows of `chipsPerRow`. Nil is a real option here -
    /// it is the Auto chip - so the rows carry optionals rather than strings.
    static func chipRows(
        _ options: [String?],
        perRow: Int = ModelPickerRules.chipsPerRow
    ) -> [[String?]] {
        guard perRow > 0, !options.isEmpty else { return [] }
        return stride(from: 0, to: options.count, by: perRow).map { start in
            Array(options[start..<min(start + perRow, options.count)])
        }
    }

    /// The provider section open when the popover appears: the one holding the
    /// current model, else the first row.
    ///
    /// Only ever a provider that has a row. The account default can name a
    /// model whose provider was filtered out (a stale default left behind by a
    /// removed key), and expanding a section that is not drawn opens nothing
    /// while making every other section look collapsed on purpose.
    static func initialExpandedProvider(in data: AIModelsResponse, stored: String?) -> String? {
        let rows = providers(in: data)
        if let model = selectedModel(in: data, stored: stored),
           rows.contains(where: { $0.id == model.provider }) {
            return model.provider
        }
        return rows.first?.id
    }

    /// Subtitle under a provider name. Every row the picker draws is unlocked
    /// now, so this only ever counts models - the "Add your API key" line it
    /// used to carry has no row left to sit on.
    static func providerSubtitle(modelCount: Int) -> String {
        "\(modelCount) model\(modelCount == 1 ? "" : "s")"
    }

    // MARK: Geometry

    static let providerRowHeight: CGFloat = 42
    static let modelRowHeight: CGFloat = 30
    /// The second line a model row grows by when it has a tagline or derived
    /// meta to show.
    static let modelRowMetaHeight: CGFloat = 14
    static let maxListHeight: CGFloat = 300

    static func rowHeight(for model: AIModel) -> CGFloat {
        metaLine(for: model) == nil ? modelRowHeight : modelRowHeight + modelRowMetaHeight
    }

    /// Height for the scrolling half of the popover.
    ///
    /// A `ScrollView` inside a popover is proposed *its own ideal* height, and
    /// a lazy stack's ideal is far smaller than its content - the list came out
    /// at roughly half its cap, showing three of forty-one models. Measuring the
    /// rows here and handing back a definite height fixes that, and still
    /// shrinks to fit when a provider is collapsed and there is little to show.
    static func listHeight(in data: AIModelsResponse, expandedProvider: String?) -> CGFloat {
        var height: CGFloat = 2 * Spacing.xs
        for provider in providers(in: data) {
            let rows = models(ofProvider: provider.id, in: data)
            guard !rows.isEmpty else { continue }
            height += providerRowHeight
            guard provider.id == expandedProvider else { continue }
            height += rows.reduce(CGFloat.zero) { $0 + rowHeight(for: $1) }
        }
        return min(height, maxListHeight)
    }

    /// Height for the flat search results, measured the same way and capped the
    /// same way. An empty result set still reserves one row for the "no
    /// matches" line, so the popover does not collapse mid-keystroke.
    static func searchListHeight(_ results: [AIModel]) -> CGFloat {
        let padding = 2 * Spacing.xs
        if results.isEmpty { return padding + modelRowHeight }
        let rows = results.reduce(CGFloat.zero) { $0 + rowHeight(for: $1) }
        return min(padding + rows, maxListHeight)
    }
}

// MARK: - Model

/// Holds `GET /api/ai/models` for the chat header. Owned by `ChatView` rather
/// than by the popover so the toolbar button can show the current model's name
/// while the popover is closed; the popover reloads on every open, which is how
/// a key added in Settings shows up without any extra wiring.
@MainActor
@Observable
final class ModelPickerModel {
    private(set) var data: AIModelsResponse?
    private(set) var loadFailed = false
    private(set) var isLoading = false

    private var api: APIClient?
    private var inFlight: Task<Void, Never>?

    func configure(_ api: APIClient) {
        self.api = api
    }

    /// Fetches the list, coalescing concurrent callers.
    ///
    /// A second caller *joins* the running load rather than returning early:
    /// the popover opens while `ChatView`'s own load is often still in flight,
    /// and returning immediately left it awaiting nothing, with no list to
    /// expand a provider from.
    ///
    /// The work runs in an unstructured task on purpose. Closing the popover
    /// cancels its `.task`, and a structured fetch would die with it - which
    /// both wasted the round trip and, worse, surfaced the cancellation as a
    /// "Couldn't load the model list." failure on the next open.
    func load() async {
        if let inFlight {
            await inFlight.value
            return
        }
        guard let api else { return }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            isLoading = true
            defer { isLoading = false }
            do {
                data = try await AIModelsAPI.load(api: api)
                loadFailed = false
            } catch {
                // The picker is an enhancement: chat still works on the account
                // default, so a failure only costs the list, never the composer.
                // A cancelled request is not a failure - nobody asked for an
                // answer any more, and claiming one failed would replace a
                // perfectly good spinner with a Retry button.
                loadFailed = data == nil && !Self.isCancellation(error)
            }
        }
        inFlight = task
        await task.value
        inFlight = nil
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        return false
    }
}

// MARK: - Popover

/// Model + reasoning-effort picker for the chat header - the Mac form of the
/// iOS `ModelPickerSheet` and of the web `ModelPicker` dropdown.
///
/// Two shapes, decided by the server's `access` field. **House** (no keys on
/// the account): one model, its effort pinned server-side, a one-line note,
/// and a link into Settings. **Keys**: providers first, click one to see every
/// model it unlocks - and only providers the account can actually reach, since
/// a locked row is an advert, not a choice.
///
/// The pick persists in `SettingsStore` and rides every `/api/ask-question`
/// request, and the server records it as the account default.
struct ModelPickerPopover: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    let models: ModelPickerModel
    let settings: SettingsStore
    @Binding var isPresented: Bool

    @State private var expandedProvider: String?
    /// Empty until the account has enough models to be worth searching; see
    /// `ModelPickerRules.showsSearch`.
    @State private var query = ""

    private var selectedID: String? {
        ModelPickerRules.selectedModelID(in: models.data, stored: settings.chatModelId)
    }

    private var selected: AIModel? {
        ModelPickerRules.selectedModel(in: models.data, stored: settings.chatModelId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            if let data = models.data {
                Divider().overlay(theme.border)
                if let house = ModelPickerRules.house(in: data) {
                    houseSection(house)
                } else {
                    if ModelPickerRules.showsSearch(in: data) {
                        searchField
                        Divider().overlay(theme.border)
                    }
                    modelList(data)
                    optionSections(data)
                }
                Divider().overlay(theme.border)
                settingsLink(isHouse: ModelPickerRules.isHouse(data))
            } else if models.loadFailed, !models.isLoading {
                // A load in flight outranks a past failure: a stale
                // `loadFailed` must never draw Retry over a running request.
                Divider().overlay(theme.border)
                failure
            } else {
                Divider().overlay(theme.border)
                loadingRow
            }
        }
        .frame(width: 360)
        .background(theme.bgElevated)
        .task {
            // Expand from whatever is already cached *before* awaiting, so the
            // popover is never drawn collapsed and then snapped open a frame
            // later at a different height.
            expandInitialProvider()
            // Every open refetches, so a key added in Settings unlocks its
            // provider here without a relaunch. When `ChatView`'s own load is
            // still running this joins it, so the list that arrives still gets
            // its section opened.
            await models.load()
            expandInitialProvider()
            // A default set on another client becomes this device's chip
            // selection, but only where nothing has been chosen here.
            if let data = models.data {
                ModelPickerRules.seedDefaults(from: data, into: settings)
            }
        }
    }

    /// Opens the section holding the current model, once there is a list to
    /// read it from. Never reopens a section the user has since collapsed.
    private func expandInitialProvider() {
        guard expandedProvider == nil, let data = models.data else { return }
        expandedProvider = ModelPickerRules.initialExpandedProvider(
            in: data,
            stored: settings.chatModelId
        )
    }

    private var loadingRow: some View {
        HStack {
            ProgressView().controlSize(.small)
            Text("Loading models…")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
            Spacer()
        }
        .padding(Spacing.md)
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
            Text(headerTitle)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: Spacing.xs)
            if models.isLoading {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .help(headerTitle)
    }

    /// The model and every option that is not at its default, so what will
    /// actually run is readable without opening a section. Falls back to the
    /// invitation while there is no list to summarise.
    private var headerTitle: String {
        guard models.data != nil else { return "Choose a model" }
        return ModelPickerRules.summaryLabel(
            in: models.data,
            stored: settings.chatModelId,
            effort: settings.chatEffort,
            speed: settings.chatSpeed,
            verbosity: settings.chatVerbosity,
            mode: settings.chatMode
        )
    }

    // MARK: Search

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(theme.textGhost)
            TextField("Search models", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .foregroundStyle(theme.textSecondary)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
    }

    // MARK: House mode

    /// What a keyless account sees: the one model it has, said plainly. No
    /// list, no chevrons, no reasoning chips - nothing here is a choice, and
    /// dressing it up as one only implies choices that are missing.
    private func houseSection(_ house: AIModelsResponse.HouseModel) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(house.label)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .lineLimit(1)
                Spacer(minLength: Spacing.xs)
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(theme.accent)
            }
            Text(ModelPickerRules.houseNote(house))
                .font(.system(size: 11))
                .foregroundStyle(theme.textFaint)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isSelected)
    }

    // MARK: Providers

    /// Groups while the search box is empty, one flat list while it is not:
    /// a match under a collapsed provider would otherwise be invisible.
    @ViewBuilder
    private func modelList(_ data: AIModelsResponse) -> some View {
        if ModelPickerRules.isSearching(query) {
            searchResults(ModelPickerRules.searchResults(in: data, query: query))
        } else {
            providerList(data)
        }
    }

    private func searchResults(_ results: [AIModel]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if results.isEmpty {
                    Text("No models match.")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textFaint)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm)
                } else {
                    ForEach(results) { model in
                        modelRow(model, showsProvider: true)
                    }
                }
            }
            .padding(.vertical, Spacing.xs)
        }
        .frame(height: ModelPickerRules.searchListHeight(results))
    }

    private func providerList(_ data: AIModelsResponse) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(ModelPickerRules.providers(in: data)) { provider in
                        let providerModels = ModelPickerRules.models(ofProvider: provider.id, in: data)
                        if !providerModels.isEmpty {
                            providerRow(provider, count: providerModels.count)
                            if expandedProvider == provider.id {
                                ForEach(providerModels) { model in
                                    modelRow(model).id(model.id)
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, Spacing.xs)
            }
            .frame(height: ModelPickerRules.listHeight(in: data, expandedProvider: expandedProvider))
            // A provider can list forty models; opening on the current one
            // rather than at the top saves hunting for the checkmark.
            .onChange(of: expandedProvider) { _, provider in
                guard let selectedID, selected?.provider == provider else { return }
                proxy.scrollTo(selectedID, anchor: .center)
            }
        }
    }

    private func providerRow(_ provider: AIProviderSummary, count: Int) -> some View {
        let isExpanded = expandedProvider == provider.id
        return Button {
            withAnimation(.snappy(duration: 0.16)) {
                expandedProvider = isExpanded ? nil : provider.id
            }
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
                    .frame(width: 12)
                VStack(alignment: .leading, spacing: 1) {
                    Text(provider.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                    Text(ModelPickerRules.providerSubtitle(modelCount: count))
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }
                Spacer()
            }
        }
        .buttonStyle(PickerRowStyle())
        .accessibilityLabel(provider.label)
    }

    /// One model. Two lines when the server gave us something to say about it -
    /// a tagline, or a context/price line derived from what it did send - plus
    /// up to three capability pills after the name.
    ///
    /// `showsProvider` is the flat search shape: with no group header above the
    /// row, the provider has to be named on it.
    private func modelRow(_ model: AIModel, showsProvider: Bool = false) -> some View {
        let active = model.id == selectedID
        let meta = ModelPickerRules.metaLine(for: model)
        let pills = ModelPickerRules.pills(for: model)
        return Button {
            // Only the model id. The stored options are left exactly as they
            // were - see `ModelPickerRules.activeEffort`.
            settings.chatModelId = model.id
            isPresented = false
        } label: {
            HStack(alignment: .top, spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: Spacing.xs) {
                        if showsProvider {
                            Text(ModelPickerRules.providerLabel(for: model))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textGhost)
                        }
                        Text(model.label)
                            .font(.system(size: 12.5, weight: active ? .bold : .regular))
                            .foregroundStyle(active ? theme.accent : theme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        ForEach(pills, id: \.self) { pill in
                            Text(pill)
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(theme.textGhost)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                        }
                    }
                    if let meta {
                        Text(meta)
                            .font(.system(size: 10))
                            .foregroundStyle(theme.textGhost)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: Spacing.xs)
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.accent)
                }
            }
            .padding(.leading, showsProvider ? 0 : Spacing.lg)
        }
        .buttonStyle(PickerRowStyle())
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .help(model.id)
    }

    // MARK: Options

    /// REASONING / SPEED / LENGTH / MODE, each drawn only when the selected
    /// model offers more than one value for it. House mode reaches none of
    /// this: the rules return empty lists for it.
    @ViewBuilder
    private func optionSections(_ data: AIModelsResponse) -> some View {
        let efforts = ModelPickerRules.efforts(in: data, stored: settings.chatModelId)
        let speeds = ModelPickerRules.speeds(in: data, stored: settings.chatModelId)
        let verbosities = ModelPickerRules.verbosities(in: data, stored: settings.chatModelId)
        let modes = ModelPickerRules.modes(in: data, stored: settings.chatModelId)

        if !efforts.isEmpty || !speeds.isEmpty || !verbosities.isEmpty || !modes.isEmpty {
            Divider().overlay(theme.border)
            VStack(alignment: .leading, spacing: Spacing.md) {
                if !efforts.isEmpty { reasoningSection(efforts) }
                if !speeds.isEmpty { speedSection(speeds) }
                if !verbosities.isEmpty { lengthSection(verbosities) }
                if !modes.isEmpty { modeSection(modes) }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
        }
    }

    private func reasoningSection(_ efforts: [String]) -> some View {
        // Auto first: it is the absence of an override, not the lowest one.
        var options: [String?] = [nil]
        options.append(contentsOf: efforts.map { Optional($0) })
        // Display only: a stored effort the current model can't honour reads as
        // Auto here, and stays in `SettingsStore` untouched.
        let active = ModelPickerRules.activeEffort(settings.chatEffort, for: selected)
        return optionSection("REASONING", note: nil) {
            chipRows(options, active: active, label: ModelPickerRules.effortLabel) { effort in
                // Auto stores a sentinel, not nil: nil would read as "never
                // chose" and let the account default apply instead.
                settings.chatEffort = ModelPickerRules.storedEffort(effort)
            }
        }
    }

    private func speedSection(_ speeds: [String]) -> some View {
        let options: [String?] = speeds.map { Optional($0) }
        let active: String? = ModelPickerRules.activeSpeed(settings.chatSpeed, for: selected)
        return optionSection("SPEED", note: selected?.fastModeNote) {
            // Verbatim, Standard included: nil means "never chose", and the
            // server would read it as "apply the stored account default".
            chipRows(options, active: active, label: ModelPickerRules.speedLabel) { speed in
                settings.chatSpeed = speed
            }
        }
    }

    private func lengthSection(_ verbosities: [String]) -> some View {
        let options: [String?] = verbosities.map { Optional($0) }
        let active: String? = ModelPickerRules.activeVerbosity(
            settings.chatVerbosity,
            for: selected
        )
        return optionSection("LENGTH", note: nil) {
            chipRows(options, active: active, label: ModelPickerRules.verbosityLabel) { verbosity in
                settings.chatVerbosity = verbosity
            }
        }
    }

    private func modeSection(_ modes: [String]) -> some View {
        let options: [String?] = modes.map { Optional($0) }
        let active: String? = ModelPickerRules.activeMode(settings.chatMode, for: selected)
        return optionSection("MODE", note: ModelPickerRules.proModeNote) {
            chipRows(options, active: active, label: ModelPickerRules.modeLabel) { mode in
                settings.chatMode = mode
            }
        }
    }

    private func optionSection<Chips: View>(
        _ title: String,
        note: String?,
        @ViewBuilder chips: () -> Chips
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(theme.textGhost)
            chips()
            if let note, !note.isEmpty {
                Text(note)
                    .font(.system(size: 10))
                    .foregroundStyle(theme.textGhost)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    /// The chip row itself, wrapped at `chipsPerRow`. The short last row is
    /// padded with clear spacers so its chips keep a full row's width rather
    /// than stretching to fill.
    private func chipRows(
        _ options: [String?],
        active: String?,
        label: @escaping (String?) -> String,
        pick: @escaping (String?) -> Void
    ) -> some View {
        let rows = ModelPickerRules.chipRows(options)
        return VStack(spacing: Spacing.xs) {
            // Indexed rather than over the values: the options are `String?`,
            // and nil (the Auto chip) is not `Hashable`-identifiable on its own.
            ForEach(rows.indices, id: \.self) { rowIndex in
                let row = rows[rowIndex]
                HStack(spacing: Spacing.xs) {
                    ForEach(row.indices, id: \.self) { index in
                        let option = row[index]
                        let isActive = option == active
                        Button(label(option)) { pick(option) }
                            .buttonStyle(EffortChipStyle(active: isActive))
                            .accessibilityAddTraits(isActive ? [.isSelected] : [])
                    }
                    ForEach(
                        Array(0..<max(ModelPickerRules.chipsPerRow - row.count, 0)),
                        id: \.self
                    ) { _ in
                        Color.clear.frame(maxWidth: .infinity, minHeight: 24)
                    }
                }
            }
        }
    }

    // MARK: Footer

    /// The one pointer at Settings. In house mode it is the whole call to
    /// action, so it names the act ("Add an API key") rather than describing a
    /// benefit.
    private func settingsLink(isHouse: Bool) -> some View {
        Button {
            openProviderSettings()
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(
                    isHouse
                        ? "Add an API key to unlock more models"
                        : "Unlock more models with your own API keys"
                )
                    .font(.system(size: 11))
                    .foregroundStyle(isHouse ? theme.accent : theme.textFaint)
                    // The popover is narrower than this line's ideal width;
                    // without wrapping the tail is clipped at the popover edge.
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: Spacing.xs)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
            }
        }
        .buttonStyle(PickerRowStyle())
        .padding(.vertical, Spacing.xs)
    }

    private var failure: some View {
        HStack(spacing: Spacing.sm) {
            Text("Couldn't load the model list.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
            Spacer()
            Button("Retry") { Task { await models.load() } }
        }
        .padding(Spacing.md)
    }

    private func openProviderSettings() {
        isPresented = false
        app.isSettingsPresented = true
    }
}

// MARK: - Styles

/// Full-width menu row: quiet until hovered, like an AppKit menu item.
private struct PickerRowStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                configuration.isPressed
                    ? theme.surfacePressed
                    : (isHovering && isEnabled ? theme.surface : .clear)
            )
            .contentShape(.rect)
            .onHover { isHovering = $0 }
    }
}

/// The segmented reasoning chip, matching the Android/iOS row.
private struct EffortChipStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(active ? theme.accent : theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: 24)
            .background(
                configuration.isPressed
                    ? theme.surfacePressed
                    : (active ? theme.accentSoft : theme.surface),
                in: .rect(cornerRadius: Radius.sm)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.sm)
                    .strokeBorder(active ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
            }
            .contentShape(.rect)
    }
}
