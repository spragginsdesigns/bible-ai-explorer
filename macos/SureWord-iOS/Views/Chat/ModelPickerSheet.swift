import SwiftUI

// The wire types (`AIModel`, `AIProviderSummary`, `AIModelsResponse`) and
// `AIModelsAPI` live in `Shared/Settings/AIProviders.swift`, so both Apple
// shells decode one definition of the server contract. The pure rules live in
// `ModelPickerSheet+Rules.swift`.

// MARK: - Sheet

/// Model + run-options picker, a port of
/// `mobile/src/features/chat/ModelPickerSheet.tsx` (Android is the source of
/// truth).
///
/// Two shapes, decided by the server's `access` field. **House** (no keys on
/// the account): "Your model", the one model, its note, and the way into the
/// AI settings - nothing to choose. **Keys**: "Choose a model" over a summary
/// of what the next message runs with, then two panes. MODELS holds the
/// search (whenever there is more than one model) and the provider groups -
/// a lone provider is a plain header, several fold. OPTIONS holds the run
/// options the selected model actually offers (REASONING, SPEED, LENGTH,
/// MODE) as equal-cell chip grids; the tabs only exist when there is at least
/// one section, and every open lands on MODELS.
///
/// Picks persist in `SettingsStore` and ride every chat request; the server
/// stores the last pick as the account default.
struct ModelPickerSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let api: APIClient
    @Bindable var settings: SettingsStore

    enum Pane: Hashable { case models, options }

    @State private var data: AIModelsResponse?
    @State private var loadFailed = false
    @State private var expandedProvider: String?
    @State private var query = ""
    @State private var pane: Pane = .models

    // MARK: Derived state

    private var house: AIModelsResponse.HouseModel? { Self.houseMode(data) }

    private var selectedId: String? {
        Self.selectModelId(stored: settings.chatModelId, data: data)
    }

    private var selectedModel: AIModel? {
        Self.selectedModel(data: data, stored: settings.chatModelId)
    }

    private var providers: [AIProviderSummary] { Self.visibleProviders(data) }

    private var showsSearch: Bool { Self.showsSearch(data) }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool { showsSearch && !trimmedQuery.isEmpty }

    private var searchResults: [AIModel] {
        isSearching ? Self.filterModels(data, query: trimmedQuery) : []
    }

    /// Options exist only in keys mode, and only for a model that offers one.
    private var hasOptions: Bool { house == nil && Self.hasOptions(selectedModel) }

    /// A model with nothing to tune has no OPTIONS pane; never show an empty one.
    private var visiblePane: Pane { hasOptions ? pane : .models }

    private var summary: String {
        guard house == nil else { return "" }
        return Self.summaryLabel(
            model: selectedModel,
            effort: settings.chatEffort,
            speed: settings.chatSpeed,
            verbosity: settings.chatVerbosity,
            mode: settings.chatMode
        )
    }

    // MARK: Body

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
                } else if let house {
                    houseList(house)
                } else {
                    keysBody
                }
            }
            .background(theme.bgElevated)
            .navigationTitle(Self.title(house: house))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { header }
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
        .onAppear {
            settings.sync?.isAlertOwnedBySheet = true
            // Each open lands on MODELS with a clean search.
            pane = .models
            query = ""
        }
        .onDisappear { settings.sync?.isAlertOwnedBySheet = false }
    }

    /// The title, with "Using …" under it once there is a model to summarise.
    private var header: some View {
        VStack(spacing: 1) {
            Text(Self.title(house: house))
                .font(.headline)
                .foregroundStyle(theme.text)
            if let line = Self.summaryLine(summary) {
                Text(line)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: House

    private func houseList(_ house: AIModelsResponse.HouseModel) -> some View {
        let efforts = Self.houseEfforts(house)
        return List {
            Section {
                houseRow(house)
            } footer: {
                Text(Self.houseNote(house))
            }
            // Pro chooses how hard the included model thinks; Free has no
            // choice, so the section is not drawn.
            if !efforts.isEmpty {
                optionSection(
                    title: "REASONING",
                    name: "Reasoning",
                    note: nil,
                    options: efforts.map { Optional($0) },
                    active: Self.activeHouseEffort(settings.chatEffort, house: house),
                    label: Self.effortLabel
                ) { effort in
                    // Written through like a keys-mode pick, so the account
                    // default follows and every device agrees.
                    if let effort { settings.chatEffort = effort }
                }
            }
            Section {
                addKeyRow
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
    }

    /// What a keyless account sees: the one model it has, said plainly. No
    /// disclosure chevrons; the only choice (Pro's reasoning) sits below it.
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
        .accessibilityLabel("\(house.label), selected model")
        .accessibilityAddTraits(.isSelected)
    }

    // MARK: Keys

    private var keysBody: some View {
        VStack(spacing: 0) {
            if hasOptions {
                Picker("Pane", selection: $pane) {
                    Text("Models").tag(Pane.models)
                    Text("Options").tag(Pane.options)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.sm)
            }
            switch visiblePane {
            case .models: modelsList
            case .options: optionsList
            }
        }
    }

    private var modelsList: some View {
        List {
            if isSearching {
                // A match under a collapsed provider would be invisible, so
                // searching flattens the list and names each row's provider.
                Section {
                    if searchResults.isEmpty {
                        Text(Self.emptySearchText)
                            .font(.system(size: 13.5))
                            .foregroundStyle(theme.textFaint)
                            .frame(maxWidth: .infinity, alignment: .center)
                    } else {
                        ForEach(searchResults) { model in
                            modelRow(model, showsProvider: true)
                        }
                    }
                }
            } else {
                ForEach(providers) { provider in
                    providerSection(provider)
                }
                Section {
                    addKeyRow
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
        .modifier(SearchIfNeeded(enabled: showsSearch, query: $query) {
            // The keyboard's Search key takes the top hit, so typing "sol"
            // and tapping it is the whole interaction.
            if let first = searchResults.first { pick(first) }
        })
    }

    /// One provider group. A lone provider needs no accordion: its header is a
    /// label and every model is on screen. Several fold, since one key can
    /// list hundreds of models.
    @ViewBuilder
    private func providerSection(_ provider: AIProviderSummary) -> some View {
        let rows = Self.models(in: data, provider: provider.id)
        let foldable = providers.count > 1
        let isExpanded = !foldable || expandedProvider == provider.id
        let count = "\(rows.count) model\(rows.count == 1 ? "" : "s")"

        Section {
            if foldable {
                Button {
                    withAnimation(.snappy) {
                        expandedProvider = expandedProvider == provider.id ? nil : provider.id
                    }
                } label: {
                    providerHeader(provider.label, count: count, chevron: isExpanded ? "chevron.up" : "chevron.down")
                }
                .accessibilityLabel("\(provider.label), \(count)")
                .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            }
            if isExpanded {
                ForEach(rows) { model in
                    modelRow(model)
                }
            }
        } header: {
            if !foldable {
                providerHeader(provider.label, count: count, chevron: nil)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    private func providerHeader(_ label: String, count: String, chevron: String?) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(label.uppercased())
                .font(.system(size: 11.5, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(theme.textFaint)
            Text(count)
                .font(.system(size: 11.5))
                .foregroundStyle(theme.textGhost)
                .textCase(nil)
            Spacer()
            if let chevron {
                Image(systemName: chevron)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
            }
        }
        .contentShape(.rect)
    }

    /// The way to more models, in both modes: straight to the AI provider
    /// settings, since the Settings hub would leave the user one tap short.
    /// A push, not a sheet: this sheet owns its own `NavigationStack`.
    private var addKeyRow: some View {
        NavigationLink {
            Form { ProviderSettingsSection() }
                .navigationTitle("AI Provider")
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "key")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.addKeyTitle)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                    Text(Self.addKeyDetail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textFaint)
                }
            }
        }
        .accessibilityLabel("Add an API key in Settings")
    }

    /// One model. The label with up to three capability pills, then the
    /// curated tagline or the hard numbers the server sent.
    ///
    /// `showsProvider` is the flat search shape: with no group header above
    /// the row, the provider has to be named on it.
    private func modelRow(_ model: AIModel, showsProvider: Bool = false) -> some View {
        let active = model.id == selectedId
        let meta = Self.metaLine(for: model)
        let pills = Self.pills(for: model)
        let providerName = showsProvider ? Self.providerLabel(in: data, provider: model.provider) : nil
        return Button {
            pick(model)
        } label: {
            HStack(alignment: .center, spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: Spacing.xs) {
                        if let providerName {
                            Text(providerName)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textFaint)
                        }
                        Text(model.label)
                            .font(.system(size: 13.5, weight: active ? .bold : .semibold))
                            .foregroundStyle(active ? theme.accent : theme.text)
                            .lineLimit(1)
                    }
                    if let meta {
                        Text(meta)
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textFaint)
                            .lineLimit(1)
                    }
                    if !pills.isEmpty {
                        HStack(spacing: Spacing.xs) {
                            ForEach(pills, id: \.self) { pill in
                                Text(pill)
                                    .font(.system(size: 10.5, weight: .semibold))
                                    .foregroundStyle(theme.textMuted)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                            }
                        }
                    }
                }
                Spacer(minLength: Spacing.xs)
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.accent)
                    .opacity(active ? 1 : 0)
            }
            .contentShape(.rect)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            ([providerName, model.label] + pills + [meta]).compactMap { $0 }.joined(separator: ", ")
        )
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : [.isButton])
    }

    private func pick(_ model: AIModel) {
        settings.chatModelId = model.id
        dismiss()
    }

    // MARK: Options

    private var optionsList: some View {
        let model = selectedModel
        let effortOptions = Self.effortOptions(for: model)
        let speeds = Self.speeds(for: model)
        let verbosities = Self.verbosities(for: model)
        let modes = Self.modes(for: model)

        return List {
            if let model {
                Text(Self.optionsIntro(for: model))
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textFaint)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: Spacing.xs, bottom: 0, trailing: Spacing.xs))
            }
            if !effortOptions.isEmpty {
                optionSection(
                    title: "REASONING",
                    name: "Reasoning",
                    note: nil,
                    options: effortOptions,
                    active: Self.activeEffort(settings.chatEffort, for: model),
                    label: Self.effortLabel
                ) { effort in
                    // Auto stores a sentinel, not nil: nil would read as "never
                    // chose" and let the account default apply instead.
                    settings.chatEffort = Self.storedEffort(effort)
                }
            }
            if !speeds.isEmpty {
                optionSection(
                    title: "SPEED",
                    name: "Speed",
                    note: model?.fastModeNote,
                    options: speeds.map { Optional($0) },
                    active: Self.activeSpeed(settings.chatSpeed, for: model),
                    label: Self.speedLabel
                ) { speed in
                    // Verbatim, Standard included: nil means "never chose".
                    settings.chatSpeed = speed
                }
            }
            if !verbosities.isEmpty {
                optionSection(
                    title: "LENGTH",
                    name: "Length",
                    note: nil,
                    options: verbosities.map { Optional($0) },
                    active: Self.activeVerbosity(settings.chatVerbosity, for: model),
                    label: Self.verbosityLabel
                ) { verbosity in
                    settings.chatVerbosity = verbosity
                }
            }
            if !modes.isEmpty {
                optionSection(
                    title: "MODE",
                    name: "Mode",
                    note: Self.proModeNote,
                    options: modes.map { Optional($0) },
                    active: Self.activeMode(settings.chatMode, for: model),
                    label: Self.modeLabel
                ) { mode in
                    settings.chatMode = mode
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
    }

    /// One run-option section: the title with the current pick beside it, then
    /// every chip in a grid of equal cells (`optionGridColumns`), then the
    /// caveat, if any.
    private func optionSection(
        title: String,
        name: String,
        note: String?,
        options: [String?],
        active: String?,
        label: @escaping (String?) -> String,
        pick: @escaping (String?) -> Void
    ) -> some View {
        let columns = Self.optionGridColumns(options.count)
        let rows = Self.gridRows(options)
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
                                .accessibilityLabel(
                                    Self.chipAccessibilityLabel(section: name, choice: label(option))
                                )
                                .accessibilityAddTraits(isActive ? [.isSelected] : [])
                        }
                        ForEach(Array(0..<max(columns - row.count, 0)), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity, minHeight: 42)
                        }
                    }
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .padding(.vertical, Spacing.xs)
        } header: {
            HStack(spacing: Spacing.sm) {
                Text(title)
                    .font(.system(size: 11.5, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(theme.textFaint)
                Spacer()
                Text(label(active))
                    .font(.system(size: 11.5, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .lineLimit(1)
            }
            .textCase(nil)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        } footer: {
            if let note, !note.isEmpty { Text(note) }
        }
    }

    // MARK: Loading

    private func load() async {
        loadFailed = false
        do {
            let loaded = try await AIModelsAPI.load(api: api)
            data = loaded
            // House mode pins the local picks to what the server will run;
            // keys mode adopts account defaults this device never chose.
            Self.pinHouseMode(from: loaded, into: settings)
            Self.seedDefaults(from: loaded, into: settings)
            // Each open lands on the provider of the current model, when it
            // has a row, else the first row.
            expandedProvider = Self.initialExpandedProvider(
                data: loaded,
                selectedId: Self.selectModelId(stored: settings.chatModelId, data: loaded)
            )
        } catch {
            loadFailed = true
        }
    }
}

/// `.searchable`, but only once there is more than one model to search. A
/// modifier rather than an `if` around the whole `List`: swapping the list for
/// a different view type would cost its scroll position and row identity.
private struct SearchIfNeeded: ViewModifier {
    let enabled: Bool
    @Binding var query: String
    let onSubmit: () -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .searchable(text: $query, prompt: "Search models")
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(of: .search, onSubmit)
        } else {
            content
        }
    }
}

/// The segmented-chip look from Android's option cards.
private struct EffortChipStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    let active: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .bold))
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            .foregroundStyle(active ? theme.accent : theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(
                configuration.isPressed
                    ? theme.surfacePressed
                    : (active ? theme.accentSoft : theme.surface),
                in: .rect(cornerRadius: Radius.md)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(active ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
            }
    }
}
