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
    /// Canonical order of the reasoning chips. The server's `efforts` array is
    /// filtered *through* this rather than rendered directly, so a value we
    /// don't understand can never draw a chip that sends garbage upstream.
    static let effortOrder = ["low", "medium", "high"]

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
    static func activeEffort(_ stored: String?, for model: AIModel?) -> String? {
        guard let stored else { return nil }
        return efforts(for: model).contains(stored) ? stored : nil
    }

    static func effortLabel(_ effort: String?) -> String {
        switch effort {
        case "low": "Low"
        case "medium": "Medium"
        case "high": "High"
        default: "Auto"
        }
    }

    /// Caption on the toolbar button - the model's own label, or a neutral word
    /// while the list is still loading or the default names nothing we know.
    static func buttonLabel(in data: AIModelsResponse?, stored: String?) -> String {
        if let model = selectedModel(in: data, stored: stored) { return model.label }
        // House mode names its model even if the flat list disagrees with the
        // block, which is the one place the label is guaranteed.
        if let house = house(in: data) { return house.label }
        return "Model"
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
    static let maxListHeight: CGFloat = 300

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
            height += CGFloat(rows.count) * modelRowHeight
        }
        return min(height, maxListHeight)
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
                    providerList(data)
                    if ModelPickerRules.supportsEffort(in: data, stored: settings.chatModelId) {
                        Divider().overlay(theme.border)
                        reasoning
                    }
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
        .frame(width: 320)
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
            Text("Choose a model")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textSecondary)
            Spacer()
            if models.isLoading {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
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

    private func modelRow(_ model: AIModel) -> some View {
        let active = model.id == selectedID
        return Button {
            // Only the model id. The stored effort is left exactly as it was -
            // see `ModelPickerRules.activeEffort`.
            settings.chatModelId = model.id
            isPresented = false
        } label: {
            HStack(spacing: Spacing.sm) {
                Text(model.label)
                    .font(.system(size: 12.5, weight: active ? .bold : .regular))
                    .foregroundStyle(active ? theme.accent : theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.accent)
                }
            }
            .padding(.leading, Spacing.lg)
        }
        .buttonStyle(PickerRowStyle())
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .help(model.id)
    }

    // MARK: Reasoning

    private var reasoning: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("REASONING")
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(theme.textGhost)

            HStack(spacing: Spacing.xs) {
                effortChip(nil)
                ForEach(ModelPickerRules.efforts(for: selected), id: \.self) { effort in
                    effortChip(effort)
                }
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
    }

    private func effortChip(_ effort: String?) -> some View {
        // Display only: a stored effort the current model can't honour reads as
        // Auto here, and stays in `SettingsStore` untouched.
        let active = ModelPickerRules.activeEffort(settings.chatEffort, for: selected) == effort
        return Button(ModelPickerRules.effortLabel(effort)) {
            settings.chatEffort = effort
        }
        .buttonStyle(EffortChipStyle(active: active))
        .accessibilityAddTraits(active ? [.isSelected] : [])
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
