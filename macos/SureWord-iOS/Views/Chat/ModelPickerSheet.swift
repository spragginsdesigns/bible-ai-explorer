import SwiftUI

// The wire types (`AIModel`, `AIProviderSummary`, `AIModelsResponse`) and
// `AIModelsAPI` moved to `Shared/Settings/AIProviders.swift` when the macOS
// picker landed, so both Apple shells decode one definition of the server
// contract. Same module - no import changes here.

// MARK: - Sheet

/// Model + run-options picker, a port of
/// `mobile/src/features/chat/ModelPickerSheet.tsx`.
///
/// Two shapes, decided by the server's `access` field. **House** (no keys on
/// the account): one model, its effort pinned server-side, a one-line note,
/// and a push into Settings. **Keys**: providers first, tap one to see every
/// model it unlocks - and only providers the account can actually reach, since
/// a locked row is an advert the user cannot act on from here - then Reasoning,
/// Speed, Length and Mode chip rows, each drawn only when the chosen model
/// offers more than one value for it.
///
/// The macOS `ModelPickerPopover` holds the same rules as pure functions in
/// `ModelPickerRules`; that type lives in the macOS target, so this shell
/// restates them inline. **If one changes, change both** (and the web and
/// Android pickers with them).
///
/// Picks persist in `SettingsStore` and ride every chat request; the server
/// stores the last pick as the account default.
struct ModelPickerSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let api: APIClient
    @Bindable var settings: SettingsStore

    @State private var data: AIModelsResponse?
    @State private var loadFailed = false
    @State private var expandedProvider: String?
    /// Only offered once the account has more models than the groups can make
    /// quick; see `showsSearch`.
    @State private var query = ""

    // MARK: - Rules (mirrors macOS `ModelPickerRules`)

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

    /// Above this many reachable models the list gets a search field.
    static let searchThreshold = 8

    /// Chips per row. The full effort vocabulary is seven values plus Auto, and
    /// eight chips across a phone leaves no room for a word like "Minimal", so
    /// the row wraps instead of shrinking.
    static let chipsPerRow = 4

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
    /// Built here rather than inline so the view body stays a plain sequence of
    /// expressions - a result builder has nowhere to put a mutating statement.
    static func effortOptions(for model: AIModel?) -> [String?] {
        // Not named `efforts`: a local by that name would shadow the static
        // function on its own right-hand side.
        let offered = efforts(for: model)
        if offered.isEmpty { return [] }
        var options: [String?] = [nil]
        options.append(contentsOf: offered.map { Optional($0) })
        return options
    }

    /// The chip that reads as active for reasoning - a *display* rule, never a
    /// storage one. Picking a model must not rewrite the stored effort: the
    /// server drops one the model rejects on its own, and normalizing here
    /// would mean a two-second detour through a non-reasoning model silently
    /// threw away a setting the user chose.
    /// The Auto sentinel is a stored *choice*, not an effort value, so it reads
    /// as Auto here exactly as nil does.
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

    /// Fills any option the user has never chosen on *this* device with the
    /// account default the server sent, so the chips agree with a choice made
    /// on another client. Only ever fills a nil - a local pick always wins -
    /// and never in house mode, where the options are pinned server-side.
    @MainActor
    static func seedDefaults(from data: AIModelsResponse, into settings: SettingsStore) {
        // `access: "house"` *with* a block to render is the only shape that
        // pins its options server-side; anything else is keys mode.
        let isHouse = data.access == "house" && data.house != nil
        guard !isHouse else { return }
        // Never PATCHes: these values *came from* the account, and writing them
        // back would turn the server's own default into a choice made here.
        settings.applyRemote { settings in
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
    }

    /// Nil (never chose) and the explicit default both read as the default
    /// chip, which is what makes storing the default verbatim invisible here.
    /// A stored value the current model cannot honour falls back to the default
    /// chip and is left in `SettingsStore` untouched.
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

    /// The second line under a model's name: its curated tagline, else a line
    /// derived from what the server does know, else nothing.
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

    /// 1,050,000 -> "1M", 1,500,000 -> "1.5M", 400,000 -> "400K". Millions
    /// round to the nearest **half** million, matching the other clients:
    /// whole-million rounding turned a genuine 1.5M into "2M".
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

    /// USD per million: "$2", "$0.20", "$4.50", "$0.0715".
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

    /// The tiny pills after a model's name. Never more than three.
    static func pills(for model: AIModel) -> [String] {
        var pills: [String] = []
        if model.supportsAttachments { pills.append("Files") }
        if model.speeds.contains("fast") { pills.append("Fast") }
        if model.modes.contains("pro") { pills.append("Pro") }
        return pills
    }

    static func providerLabel(for model: AIModel) -> String {
        AIModelsAPI.providerLabels[model.provider] ?? model.provider
    }

    /// The house block, and only when the server actually said so. An older
    /// payload carries neither field and stays in the keys shape it was
    /// written for.
    private var house: AIModelsResponse.HouseModel? {
        guard let data, data.access == "house" else { return nil }
        return data.house
    }

    /// The local pick counts only while it names an available model; otherwise
    /// the account default is shown, exactly as on Android. House mode
    /// overrides it outright - there is one model, and a pick left over from a
    /// key the account no longer has must not read as active beside it.
    private var selectedId: String? {
        if let house { return house.modelId }
        if let data,
           data.models.contains(where: { $0.id == settings.chatModelId && $0.available }) {
            return settings.chatModelId
        }
        return data?.defaults.modelId
    }

    /// Only providers the account can actually use. A locked row cannot be
    /// acted on from a sheet, so it is an "Add your API key" advert wearing a
    /// provider's name; Settings is where keys go, and the footer says so.
    private var providers: [AIProviderSummary] {
        guard let data, house == nil else { return [] }
        if let providers = data.providers, !providers.isEmpty {
            return providers.filter(\.available)
        }
        // Older payload shape: derive the provider rows from the flat list.
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

    private var selectedModel: AIModel? {
        guard let data, let selectedId else { return nil }
        return data.models.first { $0.id == selectedId }
    }

    /// Models under a provider, unavailable ones dropped for the same reason
    /// their providers are.
    private func models(of provider: AIProviderSummary) -> [AIModel] {
        (data?.models ?? []).filter { $0.provider == provider.id && $0.available }
    }

    // MARK: Search

    private var showsSearch: Bool {
        guard let data, house == nil else { return false }
        return data.models.filter(\.available).count > Self.searchThreshold
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Flat results across every provider, matched on label or id. Unavailable
    /// models stay hidden here for the same reason they are hidden in the
    /// groups: the sheet must not offer a model that would fail.
    private var searchResults: [AIModel] {
        guard let data, isSearching else { return [] }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return data.models.filter { model in
            model.available
                && (model.label.lowercased().contains(needle)
                    || model.id.lowercased().contains(needle))
        }
    }

    // MARK: Summary

    /// The model plus every option that is not at its default, e.g.
    /// `GPT-5.6 Luna \u{00B7} High \u{00B7} Fast \u{00B7} Detailed`. Reasoning
    /// on Auto contributes nothing, and house mode has no options at all.
    private var summaryLabel: String {
        let name = selectedModel?.label ?? house?.label ?? "Choose a model"
        if house != nil { return name }
        let model = selectedModel

        var parts = [name]
        if let effort = Self.activeEffort(settings.chatEffort, for: model) {
            parts.append(Self.effortLabel(effort))
        }
        let speedValue = Self.activeSpeed(settings.chatSpeed, for: model)
        if speedValue != Self.defaultSpeed { parts.append(Self.speedLabel(speedValue)) }
        let verbosityValue = Self.activeVerbosity(settings.chatVerbosity, for: model)
        if verbosityValue != Self.defaultVerbosity {
            parts.append(Self.verbosityLabel(verbosityValue))
        }
        let modeValue = Self.activeMode(settings.chatMode, for: model)
        if modeValue != Self.defaultMode { parts.append(Self.modeLabel(modeValue)) }
        return parts.joined(separator: " \u{00B7} ")
    }

    var body: some View {
        NavigationStack {
            Group {
                if loadFailed {
                    ContentUnavailableView {
                        Label("Couldn't load the model list.", systemImage: "exclamationmark.triangle")
                    } actions: {
                        Button("Retry") { Task { await load() } }
                    }
                } else if data == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    list
                }
            }
            .background(theme.bgElevated)
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
        // Every chip in here PATCHes, and an alert attached to the shell
        // underneath a presented sheet never appears - so this sheet presents
        // its own, and tells the shell to stand down while it is up.
        .preferencesErrorAlert(settings.sync)
        .onAppear { settings.sync?.isAlertOwnedBySheet = true }
        .onDisappear { settings.sync?.isAlertOwnedBySheet = false }
    }

    /// The model and its non-default options once there is a list to summarise,
    /// so what will actually run is readable without opening a section.
    private var navigationTitle: String {
        data == nil ? "Choose a model" : summaryLabel
    }

    private var list: some View {
        List {
            if let house {
                Section {
                    houseRow(house)
                    settingsLink("Add an API key")
                } footer: {
                    Text(Self.houseNote(house))
                }
            } else if isSearching {
                // A match under a collapsed provider would be invisible, so
                // searching flattens the list and names each row's provider.
                Section {
                    if searchResults.isEmpty {
                        Text("No models match.")
                            .font(.system(size: 13.5))
                            .foregroundStyle(theme.textFaint)
                    } else {
                        ForEach(searchResults) { model in
                            modelRow(model, showsProvider: true)
                        }
                    }
                }
                optionSections
            } else {
                Section {
                    ForEach(providers) { provider in
                        providerSection(provider)
                    }
                    settingsLink("Add another API key")
                } footer: {
                    Text("Each key you add unlocks that provider's models here.")
                }
                optionSections
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
        .modifier(SearchIfNeeded(enabled: showsSearch, query: $query))
    }

    // MARK: Options

    /// REASONING / SPEED / LENGTH / MODE, each drawn only when the selected
    /// model offers more than one value for it. House mode reaches none of
    /// this: it pins its options server-side, and an inert chip row would only
    /// imply a choice the account does not have.
    @ViewBuilder
    private var optionSections: some View {
        let effortOptions = Self.effortOptions(for: selectedModel)
        let speeds = Self.speeds(for: selectedModel)
        let verbosities = Self.verbosities(for: selectedModel)
        let modes = Self.modes(for: selectedModel)

        if !effortOptions.isEmpty {
            optionSection(
                "Reasoning",
                note: nil,
                options: effortOptions,
                active: Self.activeEffort(settings.chatEffort, for: selectedModel),
                label: Self.effortLabel
            ) { effort in
                // Auto stores a sentinel, not nil: nil would read as "never
                // chose" and let the account default apply instead.
                settings.chatEffort = Self.storedEffort(effort)
            }
        }
        if !speeds.isEmpty {
            optionSection(
                "Speed",
                note: selectedModel?.fastModeNote,
                options: speeds.map { Optional($0) },
                active: Self.activeSpeed(settings.chatSpeed, for: selectedModel),
                label: Self.speedLabel
            ) { speed in
                // Verbatim, Standard included: nil means "never chose", and the
                // server would read it as "apply the stored account default".
                settings.chatSpeed = speed
            }
        }
        if !verbosities.isEmpty {
            optionSection(
                "Length",
                note: nil,
                options: verbosities.map { Optional($0) },
                active: Self.activeVerbosity(settings.chatVerbosity, for: selectedModel),
                label: Self.verbosityLabel
            ) { verbosity in
                settings.chatVerbosity = verbosity
            }
        }
        if !modes.isEmpty {
            optionSection(
                "Mode",
                note: Self.proModeNote,
                options: modes.map { Optional($0) },
                active: Self.activeMode(settings.chatMode, for: selectedModel),
                label: Self.modeLabel
            ) { mode in
                settings.chatMode = mode
            }
        }
    }

    /// One titled chip row. Chips wrap at four per line: the full effort
    /// vocabulary is seven values plus Auto, and eight across a phone leaves no
    /// room for a word like "Minimal".
    private func optionSection(
        _ title: String,
        note: String?,
        options: [String?],
        active: String?,
        label: @escaping (String?) -> String,
        pick: @escaping (String?) -> Void
    ) -> some View {
        let rows = stride(from: 0, to: options.count, by: Self.chipsPerRow).map { start in
            Array(options[start..<min(start + Self.chipsPerRow, options.count)])
        }
        return Section {
            VStack(spacing: Spacing.sm) {
                // Indexed rather than over the values: the options are
                // `String?`, and nil (the Auto chip) is not identifiable alone.
                ForEach(rows.indices, id: \.self) { rowIndex in
                    let row = rows[rowIndex]
                    HStack(spacing: Spacing.sm) {
                        ForEach(row.indices, id: \.self) { index in
                            let option = row[index]
                            let isActive = option == active
                            Button(label(option)) { pick(option) }
                                .buttonStyle(EffortChipStyle(active: isActive))
                                .accessibilityAddTraits(isActive ? [.isSelected] : [])
                        }
                        ForEach(
                            Array(0..<max(Self.chipsPerRow - row.count, 0)),
                            id: \.self
                        ) { _ in
                            Color.clear.frame(maxWidth: .infinity, minHeight: 40)
                        }
                    }
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .padding(.vertical, Spacing.xs)
        } header: {
            Text(title)
        } footer: {
            if let note, !note.isEmpty { Text(note) }
        }
    }

    /// Copy under the house model when the server sends no `note` of its own.
    /// Kept in step with `ModelPickerRules.fallbackHouseNote` on macOS.
    static let fallbackHouseNote =
        "Included with SureWord. Add your own API key to choose other models."

    static func houseNote(_ house: AIModelsResponse.HouseModel) -> String {
        let note = house.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? fallbackHouseNote : note
    }

    /// What a keyless account sees: the one model it has, said plainly. No
    /// disclosure chevrons and no effort chips - nothing here is a choice, and
    /// dressing it up as one only implies choices that are missing.
    private func houseRow(_ house: AIModelsResponse.HouseModel) -> some View {
        HStack {
            Text(house.label)
                .font(.system(size: 14.5, weight: .bold))
                .foregroundStyle(theme.accent)
                .lineLimit(1)
            Spacer()
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isSelected)
    }

    /// The way into Settings. A push, not a sheet: this sheet owns its own
    /// `NavigationStack`, and the app's only other route to Settings is the
    /// gear `NavigationLink` on each tab root, which a sheet cannot reach.
    private func settingsLink(_ title: String) -> some View {
        NavigationLink {
            SettingsView()
        } label: {
            Label(title, systemImage: "key")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(theme.accent)
        }
    }

    @ViewBuilder
    private func providerSection(_ provider: AIProviderSummary) -> some View {
        let rows = models(of: provider)
        let isExpanded = expandedProvider == provider.id

        if !rows.isEmpty {
            Button {
                withAnimation(.snappy) {
                    expandedProvider = isExpanded ? nil : provider.id
                }
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(provider.label)
                            .font(.system(size: 14.5, weight: .semibold))
                            .foregroundStyle(theme.textSecondary)
                        Text("\(rows.count) model\(rows.count == 1 ? "" : "s")")
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textFaint)
                    }
                    Spacer()
                }
                .contentShape(.rect)
            }

            if isExpanded {
                ForEach(rows) { model in
                    modelRow(model)
                }
            }
        }
    }

    /// One model. Two lines when the server gave us something to say about it -
    /// a tagline, or a context/price line derived from what it did send - plus
    /// up to three capability pills after the name.
    ///
    /// `showsProvider` is the flat search shape: with no group header above the
    /// row, the provider has to be named on it.
    private func modelRow(_ model: AIModel, showsProvider: Bool = false) -> some View {
        let active = model.id == selectedId
        let meta = Self.metaLine(for: model)
        let pills = Self.pills(for: model)
        return Button {
            settings.chatModelId = model.id
            dismiss()
        } label: {
            HStack(alignment: .top, spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: Spacing.xs) {
                        if showsProvider {
                            Text(Self.providerLabel(for: model))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textFaint)
                        }
                        Text(model.label)
                            .font(.system(size: 13.5, weight: active ? .bold : .semibold))
                            .foregroundStyle(active ? theme.accent : theme.textSecondary)
                            .lineLimit(1)
                        ForEach(pills, id: \.self) { pill in
                            Text(pill)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textFaint)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                        }
                    }
                    if let meta {
                        Text(meta)
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textFaint)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: Spacing.xs)
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            .padding(.leading, showsProvider ? 0 : Spacing.xl)
            .contentShape(.rect)
        }
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    private func load() async {
        loadFailed = false
        do {
            let loaded = try await AIModelsAPI.load(api: api)
            data = loaded
            // A default set on another client becomes this device's chip
            // selection, but only where nothing has been chosen here.
            Self.seedDefaults(from: loaded, into: settings)
            // Each open lands on the provider of the current model - but only
            // one that has a row. The account default can name a model whose
            // provider was filtered out (a stale default left by a removed
            // key), and expanding a section that is not drawn opens nothing.
            let rows = providers
            let selectedProvider = loaded.models.first { $0.id == selectedId }?.provider
            expandedProvider =
                rows.contains { $0.id == selectedProvider } ? selectedProvider : rows.first?.id
        } catch {
            loadFailed = true
        }
    }
}

/// `.searchable`, but only once there are enough models for it to earn the
/// space. A modifier rather than an `if` around the whole `List`: swapping the
/// list for a different view type would cost its scroll position and its row
/// identity every time the count crossed the threshold.
private struct SearchIfNeeded: ViewModifier {
    let enabled: Bool
    @Binding var query: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $query, prompt: "Search models")
        } else {
            content
        }
    }
}

/// The segmented-chip look from Android's reasoning row.
private struct EffortChipStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .bold))
            .foregroundStyle(active ? theme.accent : theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(
                configuration.isPressed
                    ? theme.surfacePressed
                    : (active ? theme.accentSoft : theme.surface),
                in: .rect(cornerRadius: Radius.lg)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(active ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
            }
    }
}
