import SwiftUI

/// Settings -> About me, shared by both Apple clients: a paragraph the user
/// writes about themselves that rides every conversation. The counterpart of
/// the Android card in `mobile/app/(app)/settings.tsx` and of the web card in
/// `src/app/settings/page.tsx`.
///
/// Sits under Memory on purpose, and is the opposite half of it: Memory is what
/// SureWord works out on its own, this is what the user says outright. The
/// server reads both into the same turn.
///
/// One string, so there is nothing to merge the way the highlight labels are
/// merged: the box holds the whole value and the last save wins. The draft is
/// still guarded against a hydrate, because a document landing mid-sentence
/// would otherwise take the sentence away.
struct AboutMeSection: View {
    @Environment(\.theme) private var theme

    let settings: SettingsStore
    let preferences: PreferencesSyncModel

    @State private var draft = ""
    @State private var isDirty = false
    @State private var isSaving = false
    @State private var didSave = false
    @State private var errorText: String?

    /// `MAX_ABOUT_ME_LENGTH` in `src/lib/preferences-contract.ts`. The server
    /// refuses anything longer with a 400 rather than cutting it, so the box
    /// stops accepting text at the same count.
    static let maxLength = 1000

    /// Tall enough for a paragraph without the Form row jumping as it is typed.
    private static let minHeight: CGFloat = 120

    static let description =
        "Tell SureWord about yourself in your own words: where you are in your walk with the "
        + "Lord, your church background, what you are studying, what you want from this app. "
        + "The assistant reads this on every conversation. Leave it blank and it learns only "
        + "from what you say in chat."

    static let placeholder = "Where you are in your walk, your church, what you are studying"

    var body: some View {
        Section("About me") {
            // Mounted on a row rather than on the Section, for the reason given
            // in `HighlightLabelsSection`.
            hint(Self.description)
                .onAppear { hydrate() }
                .onChange(of: settings.aboutMe) { _, _ in hydrate() }

            editor

            HStack(spacing: Spacing.md) {
                Text(status)
                    .font(.system(size: 11))
                    .foregroundStyle(errorText == nil ? theme.textGhost : theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.updatesFrequently)

                Text("\(draft.count) / \(Self.maxLength)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
                    .accessibilityLabel("\(draft.count) of \(Self.maxLength) characters used")

                if isSaving {
                    ProgressView().controlSize(.small)
                }
                Button("Save") {
                    Task { await save() }
                }
                .disabled(isSaving || !isDirty)
            }
        }
    }

    // MARK: - Editor

    private var editor: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.md)

        return TextEditor(text: binding)
            .font(.system(size: 13))
            .frame(minHeight: Self.minHeight)
            // The editor paints its own opaque ground, which reads as a light
            // patch on the dark shell; the Form row supplies the surface here.
            .scrollContentBackground(.hidden)
            .padding(Spacing.xs)
            .background(theme.bgElevated, in: shape)
            .overlay { shape.strokeBorder(theme.borderStrong, lineWidth: 1) }
            // A TextEditor has no prompt of its own, so the placeholder is drawn
            // behind it and must not eat the tap that starts the editing.
            .overlay(alignment: .topLeading) {
                if draft.isEmpty {
                    Text(Self.placeholder)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textGhost)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, Spacing.sm + 2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .disabled(isSaving)
            .accessibilityLabel("About me")
    }

    /// Capped on the way in: over the cap the server answers 400 and saves
    /// nothing, so the box stops rather than letting the user write a paragraph
    /// that cannot be kept. A rejected keystroke leaves the value unchanged.
    private var binding: Binding<String> {
        Binding(
            get: { draft },
            set: { value in
                let capped = String(value.prefix(Self.maxLength))
                guard capped != draft else { return }
                draft = capped
                isDirty = true
                didSave = false
                errorText = nil
            }
        )
    }

    private func hydrate() {
        guard !isDirty else { return }
        draft = settings.aboutMe
    }

    // MARK: - Save

    private func save() async {
        guard !isSaving, isDirty else { return }
        let submitted = draft
        isSaving = true
        errorText = nil
        let outcome = await preferences.saveAboutMe(submitted)
        isSaving = false

        switch outcome {
        case .saved:
            // Still dirty when the box moved on during the round trip: that
            // text is newer than the save and has not been sent yet.
            if draft == submitted {
                isDirty = false
                // The echoed document is in the store by now, so this picks up
                // the server's trimmed text rather than the raw draft.
                hydrate()
            }
            didSave = true
        case .failed(let message):
            errorText = message
        }
    }

    // MARK: - Status

    private var status: String {
        if let errorText { return errorText }
        if isSaving { return "Saving to your account\u{2026}" }
        if isDirty { return "Unsaved changes" }
        if didSave { return "Saved to your account" }
        if !preferences.hasLoadedDocument { return "Loading what you wrote\u{2026}" }
        return ""
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
