import SwiftUI

// The wire types (`AIModel`, `AIProviderSummary`, `AIModelsResponse`) and
// `AIModelsAPI` moved to `Shared/Settings/AIProviders.swift` when the macOS
// picker landed, so both Apple shells decode one definition of the server
// contract. Same module - no import changes here.

// MARK: - Sheet

/// Model + reasoning-effort picker, a port of
/// `mobile/src/features/chat/ModelPickerSheet.tsx`: providers first, tap one to
/// see every model its API key unlocks. Providers with no key on the account
/// are locked and point at Settings. Picks persist in `SettingsStore` and ride
/// every chat request; the server stores the last pick as the account default.
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

    /// The local pick counts only while it names an available model; otherwise
    /// the account default is shown, exactly as on Android.
    private var selectedId: String? {
        if let data,
           data.models.contains(where: { $0.id == settings.chatModelId && $0.available }) {
            return settings.chatModelId
        }
        return data?.defaults.modelId
    }

    private var providers: [AIProviderSummary] {
        guard let data else { return [] }
        if let providers = data.providers, !providers.isEmpty { return providers }
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
        return order.compactMap { seen[$0] }
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
            Section {
                ForEach(providers) { provider in
                    providerSection(provider)
                }
            } footer: {
                Text("Unlock more models by adding API keys in Settings.")
            }

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
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
    }

    @ViewBuilder
    private func providerSection(_ provider: AIProviderSummary) -> some View {
        let models = (data?.models ?? []).filter { $0.provider == provider.id }
        let isExpanded = expandedProvider == provider.id

        if !models.isEmpty {
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
                        Text(
                            provider.available
                                ? "\(models.count) model\(models.count == 1 ? "" : "s")"
                                : "Add your API key in Settings"
                        )
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textFaint)
                    }
                    Spacer()
                    if !provider.available {
                        Image(systemName: "lock")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textGhost)
                    }
                }
                .contentShape(.rect)
            }
            .opacity(provider.available ? 1 : 0.55)

            if isExpanded {
                ForEach(models) { model in
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
        .disabled(!model.available)
        .opacity(model.available ? 1 : 0.55)
    }

    private func load() async {
        loadFailed = false
        do {
            let loaded = try await AIModelsAPI.load(api: api)
            data = loaded
            // Each open lands on the provider of the current model.
            let selectedProvider = loaded.models.first { $0.id == selectedId }?.provider
            expandedProvider = selectedProvider ?? providers.first?.id
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
