import SwiftUI

/// Settings → AI Providers - bring-your-own-key management, the Mac form of
/// `SureWord-iOS/Views/Settings/ProviderSettingsSection.swift` and of
/// `src/components/ProviderSettings.tsx`: list the providers, add or replace a
/// key (validated server-side before it is stored), remove one. A stored key is
/// never returned - only its last four characters, which is all this shows.
///
/// A saved key unlocks that provider's models in the chat header's model
/// picker, which refetches `GET /api/ai/models` on every open, so a change here
/// is picked up with no extra wiring.
///
/// The view owns its own `Section` so it can carry the heading, matching how
/// `ChurchSectionView` is dropped into the same form.
struct ProviderSettingsSection: View {
    @Environment(\.theme) private var theme

    /// Owned by the Settings screen rather than by this view for the same
    /// reason `memory` and `church` are: a redraw must not re-run a save.
    @Bindable var model: AIProviderSettingsModel

    /// "Add key…" exists to be typed into, so the field takes focus the moment
    /// the editor opens - otherwise every paste costs an extra click.
    @FocusState private var isKeyFieldFocused: Bool

    var body: some View {
        Section("AI Providers") {
            if model.loadFailed {
                HStack(spacing: Spacing.md) {
                    Text("Couldn't load provider settings.")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                    Spacer()
                    Button("Retry") { Task { await model.load() } }
                }
            } else if let response = model.response {
                hint(
                    "Bring your own API keys to unlock each provider's models in the chat "
                        + "model picker. Keys are validated, stored encrypted, and used only "
                        + "for your own conversations."
                )
                if response.serverCredentials {
                    Text(
                        "Your account also has access to SureWord's built-in keys; "
                            + "adding your own overrides them per provider."
                    )
                    .font(.system(size: 11))
                    .foregroundStyle(theme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(response.providers) { provider in
                    providerRow(provider)
                }
                if let error = model.error {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(spacing: Spacing.sm) {
                    ProgressView().controlSize(.small)
                    Text("Loading providers…")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                    Spacer()
                }
            }
        }
    }

    // MARK: - Provider row

    @ViewBuilder
    private func providerRow(_ provider: AIProviderStatus) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                Image(systemName: provider.connected ? "key.fill" : "key")
                    .font(.system(size: 12))
                    .foregroundStyle(provider.connected ? theme.accent : theme.textFaint)
                    .frame(width: 26, height: 26)
                    .background(provider.connected ? theme.accentSoft : theme.surface, in: .circle)
                    .overlay {
                        Circle().strokeBorder(
                            provider.connected ? theme.accentBorder : theme.border,
                            lineWidth: 1
                        )
                    }

                VStack(alignment: .leading, spacing: 1) {
                    Text(provider.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text)
                    Text(provider.statusLine)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textFaint)
                        .monospacedDigit()
                }

                Spacer()

                if model.editingProviderID != provider.id {
                    Button(provider.connected ? "Replace…" : "Add key…") {
                        model.beginEditing(provider.id)
                    }
                    .disabled(model.isPending)

                    if provider.connected {
                        Button(role: .destructive) {
                            Task { await model.remove(provider.id) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .disabled(model.isPending)
                        .help("Remove the \(provider.label) key")
                        .accessibilityLabel("Remove \(provider.label) key")
                    }
                }
            }

            if model.editingProviderID == provider.id {
                editor(provider)
            }
        }
        .padding(.vertical, 2)
    }

    /// The inline key editor: paste, validate & save, cancel, or open the
    /// provider's own key page. Secure entry with autocorrect off - it's a
    /// secret, and a "corrected" key fails validation for no visible reason.
    @ViewBuilder
    private func editor(_ provider: AIProviderStatus) -> some View {
        SecureField(
            "API key",
            text: $model.keyInput,
            prompt: Text("Paste your \(provider.label) API key")
        )
        .labelsHidden()
        .textFieldStyle(.roundedBorder)
        .autocorrectionDisabled()
        .font(.system(size: 12))
        .disabled(model.isPending)
        .focused($isKeyFieldFocused)
        // `.task` rather than `.onAppear`: the field has to be in the responder
        // chain before it can take focus, and that is a runloop hop away.
        .task { isKeyFieldFocused = true }
        .onSubmit { Task { await model.save() } }

        HStack(spacing: Spacing.md) {
            Button {
                Task { await model.save() }
            } label: {
                HStack(spacing: Spacing.xs) {
                    if model.isPending {
                        ProgressView().controlSize(.small)
                    }
                    Text("Validate & save")
                }
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(model.isPending || !Self.canSave(model.keyInput))

            Button("Cancel") { model.cancelEditing() }
                .disabled(model.isPending)

            Spacer()

            if let keyURL = provider.keyURL {
                Link(destination: keyURL) {
                    Label("Get a key", systemImage: "arrow.up.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textFaint)
                }
                .help(keyURL.absoluteString)
            }
        }
        .padding(.bottom, 2)
    }

    /// Whitespace is not a key: the Save button stays disabled for it, which
    /// mirrors the server rejecting a blank `apiKey`.
    static func canSave(_ input: String) -> Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
