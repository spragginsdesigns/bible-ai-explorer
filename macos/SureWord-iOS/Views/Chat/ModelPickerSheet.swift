import SwiftUI

// The wire types (`AIModel`, `AIProviderSummary`, `AIModelsResponse`) and
// `AIModelsAPI` moved to `Shared/Settings/AIProviders.swift` when the macOS
// picker landed, so both Apple shells decode one definition of the server
// contract. Same module - no import changes here.

// MARK: - Sheet

/// Model + reasoning-effort picker, a port of
/// `mobile/src/features/chat/ModelPickerSheet.tsx`.
///
/// Two shapes, decided by the server's `access` field. **House** (no keys on
/// the account): one model, its effort pinned server-side, a one-line note,
/// and a push into Settings. **Keys**: providers first, tap one to see every
/// model it unlocks - and only providers the account can actually reach, since
/// a locked row is an advert the user cannot act on from here.
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

    /// Android's effort row: Auto means "no override".
    private static let effortOptions: [(id: String?, label: String)] = [
        (nil, "Auto"),
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

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

    /// Models under a provider, unavailable ones dropped for the same reason
    /// their providers are.
    private func models(of provider: AIProviderSummary) -> [AIModel] {
        (data?.models ?? []).filter { $0.provider == provider.id && $0.available }
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
            .navigationTitle("Choose a model")
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
            } else {
                Section {
                    ForEach(providers) { provider in
                        providerSection(provider)
                    }
                    settingsLink("Add another API key")
                } footer: {
                    Text("Each key you add unlocks that provider's models here.")
                }

                // House mode pins the effort server-side, so an inert chip row
                // would only imply a choice the account does not have.
                Section("Reasoning") {
                    HStack(spacing: Spacing.sm) {
                        ForEach(Self.effortOptions, id: \.label) { option in
                            let active = settings.chatEffort == option.id
                                || (settings.chatEffort == nil && option.id == nil)
                            Button(option.label) {
                                settings.chatEffort = option.id
                            }
                            .buttonStyle(EffortChipStyle(active: active))
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .padding(.vertical, Spacing.xs)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
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

    private func modelRow(_ model: AIModel) -> some View {
        let active = model.id == selectedId
        return Button {
            settings.chatModelId = model.id
            dismiss()
        } label: {
            HStack {
                Text(model.label)
                    .font(.system(size: 13.5, weight: active ? .bold : .semibold))
                    .foregroundStyle(active ? theme.accent : theme.textSecondary)
                    .lineLimit(1)
                Spacer()
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            .padding(.leading, Spacing.xl)
            .contentShape(.rect)
        }
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    private func load() async {
        loadFailed = false
        do {
            let loaded = try await AIModelsAPI.load(api: api)
            data = loaded
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
