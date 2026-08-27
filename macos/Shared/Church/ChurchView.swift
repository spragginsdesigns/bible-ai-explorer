import SwiftUI

/// Settings -> My church, shared by the macOS and iOS Settings forms and by
/// `mobile/src/features/church/ChurchSection.tsx` in behaviour: search Google
/// Places for a church, save it, then see its logo, address, contact details
/// and mission statement.
///
/// The whole `Section` - heading included - disappears when the server answers
/// `status: "unavailable"`. A bare "My church" header above nothing would be
/// worse than the feature being absent, which is why this view owns the
/// section rather than being dropped inside one the settings screen supplies.
///
/// Both platforms show it inline. Unlike Memories there is no manage screen to
/// push or present: the picker and the saved card are small enough to live in
/// the form on a phone as well as on a Mac.
struct ChurchSectionView: View {
    @Environment(\.theme) private var theme

    @Bindable var model: ChurchModel

    @State private var isConfirmingRemove = false
    @State private var isMissionExpanded = false

    static let description =
        "Pick your home church so SureWord knows the congregation you belong to. "
        + "Its mission statement is read from the church's public website."

    var body: some View {
        if model.state != .unavailable {
            Section("My church") {
                hint(Self.description)
                    .churchErrorAlert(model)
                content
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            HStack {
                ProgressView().controlSize(.small)
                Spacer()
            }
        case .failed:
            HStack(spacing: Spacing.md) {
                Text("Couldn't load your church.")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
                Spacer()
                Button("Retry") { Task { await model.load() } }
            }
        case .ready:
            if model.isPicking {
                picker
            } else if let church = model.church {
                savedCard(church)
            }
        case .unavailable:
            EmptyView()
        }
    }

    // MARK: - Picker

    @ViewBuilder
    private var picker: some View {
        HStack(spacing: Spacing.sm) {
            // The prompt, not the title, carries the wording: in a grouped Form
            // a TextField's title becomes a leading label, which here would
            // just repeat the section header (same reasoning as MemoriesView).
            TextField(
                "Search for your church",
                text: $model.query,
                prompt: Text("Search by name or city")
            )
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .disabled(model.isSaving)
            .onChange(of: model.query) { _, value in
                if value.count > ChurchRules.maxQueryLength {
                    model.query = String(value.prefix(ChurchRules.maxQueryLength))
                    return
                }
                model.queryChanged()
            }

            if model.isSearchPending {
                ProgressView().controlSize(.small)
            } else if !model.query.isEmpty {
                Button {
                    model.clearQuery()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel("Clear search")
            }
        }

        if model.isSaving {
            HStack(spacing: Spacing.sm) {
                ProgressView().controlSize(.small)
                Text("Looking up your church and reading its website\u{2026}")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.accent)
                Spacer(minLength: 0)
            }
        }

        // Save and remove failures raise an alert (the convention for one-shot
        // actions); only the per-keystroke search reports inline.
        if let searchError = model.searchError {
            Text(searchError)
                .font(.system(size: 12))
                .foregroundStyle(theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        ForEach(model.results) { result in
            Button {
                Task { await model.pick(result.placeId) }
            } label: {
                resultRow(result)
            }
            .buttonStyle(SubtleButtonStyle())
            .disabled(model.isSaving)
            .opacity(model.isSaving && model.savingPlaceId != result.placeId ? 0.4 : 1)
            .accessibilityLabel("Choose \(result.name)")
        }

        if model.showsKeepTypingHint {
            hint("Keep typing, at least \(ChurchRules.minQueryLength) letters.")
        } else if model.showsNoResultsHint {
            hint("No churches found. Try the city as well as the name.")
        }

        if model.canCancelPicking {
            HStack {
                Button("Cancel") { model.cancelChange() }
                    .disabled(model.isSaving)
                Spacer()
            }
        }
    }

    private func resultRow(_ result: ChurchSearchResult) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "building.2")
                .font(.system(size: 13))
                .foregroundStyle(theme.accent)
                .frame(width: 28, height: 28)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.full))
                .overlay {
                    Circle().strokeBorder(theme.accentBorder, lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(result.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(2)
                Text(result.address)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if model.savingPlaceId == result.placeId {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
            }
        }
        .multilineTextAlignment(.leading)
    }

    // MARK: - Saved church

    @ViewBuilder
    private func savedCard(_ profile: ChurchProfile) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            photo(profile)
            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text(profile.address)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let phone = profile.phone, let url = ChurchRules.telURL(for: phone) {
            linkRow(
                icon: "phone",
                label: phone,
                url: url,
                accessibilityLabel: "Call \(profile.name)",
                external: false
            )
        }
        if let website = profile.website, let url = URL(string: website) {
            linkRow(
                icon: "globe",
                label: ChurchRules.hostname(of: website) ?? website,
                url: url,
                accessibilityLabel: "Open \(profile.name)'s website",
                external: true
            )
        }
        if let maps = profile.mapsUrl, let url = URL(string: maps) {
            linkRow(
                icon: "map",
                label: "Open in Google Maps",
                url: url,
                accessibilityLabel: "Open in Google Maps",
                external: true
            )
        }

        if let mission = profile.mission, !mission.isEmpty {
            missionBlock(mission, source: profile.missionSource)
        }
        if let about = profile.about, !about.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                blockLabel("ABOUT")
                Text(about)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        actions(profile)
    }

    @ViewBuilder
    private func photo(_ profile: ChurchProfile) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.md)
        Group {
            if let photoUrl = profile.photoUrl, let url = URL(string: photoUrl) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        photoFallback
                    }
                }
            } else {
                photoFallback
            }
        }
        .frame(width: 64, height: 64)
        .clipShape(shape)
        .overlay { shape.strokeBorder(theme.borderStrong, lineWidth: 1) }
        .accessibilityHidden(true)
    }

    private var photoFallback: some View {
        ZStack {
            theme.surface
            Image(systemName: "building.2")
                .font(.system(size: 24))
                .foregroundStyle(theme.accent)
        }
    }

    @ViewBuilder
    private func missionBlock(_ mission: String, source: String?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            blockLabel("MISSION")
            Text(mission)
                .font(.system(size: 12))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(isMissionExpanded ? nil : ChurchRules.missionClampLines)

            // SwiftUI cannot report the laid-out line count the way React
            // Native's onTextLayout does, so the toggle uses the same
            // length heuristic the web client uses.
            if ChurchRules.missionIsLong(mission) {
                Button(isMissionExpanded ? "Show less" : "Show more") {
                    isMissionExpanded.toggle()
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.accent)
            }

            if let source, let host = ChurchRules.hostname(of: source), let url = URL(string: source) {
                Link("From \(host)", destination: url)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textFaint)
                    .accessibilityLabel(
                        "Open the source of this mission statement on \(host)"
                    )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actions(_ profile: ChurchProfile) -> some View {
        HStack(spacing: Spacing.md) {
            Button("Change church") { model.startChange() }
                .disabled(model.isRemoving)
            if model.isRemoving {
                ProgressView().controlSize(.small)
            } else {
                Button("Remove", role: .destructive) { isConfirmingRemove = true }
            }
            Spacer()
        }
        .confirmationDialog(
            "Remove your church?",
            isPresented: $isConfirmingRemove,
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                Task { await model.remove() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("SureWord will forget \(profile.name).")
        }
    }

    // MARK: - Pieces

    private func linkRow(
        icon: String,
        label: String,
        url: URL,
        accessibilityLabel: String,
        external: Bool
    ) -> some View {
        Link(destination: url) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textFaint)
                    .frame(width: 16)
                Text(label)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(1)
                if external {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.textGhost)
                }
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private func blockLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .kerning(0.8)
            .foregroundStyle(theme.textGhost)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// Save and remove failures surface the same way on both platforms. It
    /// hangs off a row inside the section rather than the whole Settings form,
    /// so it cannot collide with the memory alert already mounted there.
    @MainActor
    func churchErrorAlert(_ model: ChurchModel) -> some View {
        alert(
            model.errorAlert?.title ?? "",
            isPresented: Binding(
                get: { model.errorAlert != nil },
                set: { if !$0 { model.errorAlert = nil } }
            ),
            presenting: model.errorAlert
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
    }
}
