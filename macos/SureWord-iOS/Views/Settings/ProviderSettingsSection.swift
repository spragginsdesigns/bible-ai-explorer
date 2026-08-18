import SwiftUI

/// Settings → AI Provider — bring-your-own-key management, ported from
/// `mobile/src/features/settings/ProviderSettingsSection.tsx`: list providers,
/// add or replace a key (validated server-side before storage), remove one.
/// Keys are only ever shown as their last four characters afterwards.
///
/// A saved key unlocks that provider's models in the chat model picker
/// (Lane 3's `ModelPickerSheet`, which refetches `GET /api/ai/models` on each
/// open, so a key change here is picked up without any extra wiring).
struct ProviderSettingsSection: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Owned here, following the Settings screen's `MemoriesModel` pattern:
    /// the view holds the model and configures it with the session's API
    /// client once Settings appears.
    @State private var model = AIProviderSettingsModel()

    var body: some View {
        Section("AI Provider") {
            if model.loadFailed {
                HStack {
                    Text("Couldn't load provider settings.")
                        .font(.footnote)
                        .foregroundStyle(theme.textFaint)
                    Spacer()
                    Button("Retry") { Task { await model.load() } }
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(theme.accent)
                }
            } else if let response = model.response {
                hint(
                    "Bring your own API keys to unlock each provider's models in the chat "
                        + "model picker. Keys are validated, stored encrypted, and used only "
                        + "for your own conversations."
                )
                if response.serverCredentials {
                    Text("Your account also has access to SureWord's built-in keys; adding your own overrides them per provider.")
                        .font(.footnote)
                        .foregroundStyle(theme.accent)
                }
                ForEach(response.providers) { provider in
                    providerRow(provider)
                }
                if let error = model.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(theme.danger)
                }
            } else {
                HStack(spacing: Spacing.sm) {
                    ProgressView().controlSize(.small)
                    Text("Loading providers…")
                        .font(.footnote)
                        .foregroundStyle(theme.textFaint)
                }
            }
        }
        .task {
            model.configure(app.api)
            await model.load()
        }
    }

    // MARK: - Provider row

    @ViewBuilder
    private func providerRow(_ provider: AIProviderStatus) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "key")
                    .font(.subheadline)
                    .foregroundStyle(theme.accent)
                    .frame(width: 32, height: 32)
                    .background(theme.accentSoft, in: .circle)
                    .overlay {
                        Circle().strokeBorder(theme.accentBorder, lineWidth: 1)
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.text)
                    Text(provider.statusLine)
                        .font(.caption)
                        .foregroundStyle(theme.textFaint)
                }

                Spacer()

                if model.editingProviderID != provider.id {
                    Button(provider.connected ? "Replace" : "Add key") {
                        model.beginEditing(provider.id)
                    }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(theme.textSecondary)
                    .disabled(model.isPending)

                    if provider.connected {
                        Button(role: .destructive) {
                            Task { await model.remove(provider.id) }
                        } label: {
                            Image(systemName: "trash")
                                .font(.subheadline)
                        }
                        .foregroundStyle(theme.textFaint)
                        .disabled(model.isPending)
                        .accessibilityLabel("Remove \(provider.label) key")
                    }
                }
            }

            if model.editingProviderID == provider.id {
                editor(provider)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    /// The inline key editor: paste, validate & save, cancel, or open the
    /// provider's key page. Secure entry, no autocorrect — it's a secret.
    @ViewBuilder
    private func editor(_ provider: AIProviderStatus) -> some View {
        SecureField("Paste your \(provider.label) API key", text: $model.keyInput)
            .textFieldStyle(.plain)
            .font(.footnote)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(Spacing.sm)
            .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.sm)
                    .strokeBorder(theme.borderStrong, lineWidth: 1)
            }
            .disabled(model.isPending)

        HStack(spacing: Spacing.md) {
            Button {
                Task { await model.save() }
            } label: {
                HStack(spacing: Spacing.xs) {
                    if model.isPending {
                        ProgressView().controlSize(.mini)
                    }
                    Text("Validate & save")
                }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(model.isPending || model.keyInput.trimmingCharacters(in: .whitespaces).isEmpty)

            Button("Cancel") { model.cancelEditing() }
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.textMuted)
                .disabled(model.isPending)

            Spacer()

            if let keyURL = provider.keyURL {
                Link(destination: keyURL) {
                    Label("Get a key", systemImage: "arrow.up.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.textFaint)
                }
            }
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(theme.textFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
