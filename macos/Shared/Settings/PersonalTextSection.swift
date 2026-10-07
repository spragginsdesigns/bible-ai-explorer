import SwiftUI

/// The editor behind the Settings sections where the user writes about
/// themselves in their own words: About me and My testimony. Each is one
/// string the assistant reads and nobody else sees, saved by its own button
/// against the account document.
///
/// One string, so there is nothing to merge the way the highlight labels are
/// merged: the box holds the whole value and the last save wins. The draft is
/// still guarded against a hydrate, because a document landing mid-sentence
/// would otherwise take the sentence away.
///
/// `AboutMeSection` and `TestimonySection` own the copy and the caps; this view
/// owns the behaviour, so the two cannot drift apart.
struct PersonalTextSection: View {
    /// Which account column the box edits. An enum rather than a pair of
    /// closures so the view stays free of escaping async callbacks, which
    /// strict concurrency would make every caller annotate.
    enum Field: Sendable {
        case aboutMe
        case testimony
    }

    @Environment(\.theme) private var theme

    let field: Field
    let title: String
    let description: String
    let placeholder: String
    /// The server's cap for this column. It refuses anything longer with a 400
    /// rather than cutting it, so the box stops accepting text at the same
    /// count.
    let maxLength: Int
    /// Tall enough for the expected text without the Form row jumping as it
    /// is typed.
    let minHeight: CGFloat
    let settings: SettingsStore
    let preferences: PreferencesSyncModel

    @State private var draft = ""
    @State private var isDirty = false
    @State private var isSaving = false
    @State private var didSave = false
    @State private var errorText: String?

    var body: some View {
        Section(title) {
            // Mounted on a row rather than on the Section, for the reason given
            // in `HighlightLabelsSection`.
            hint(description)
                .onAppear { hydrate() }
                .onChange(of: stored) { _, _ in hydrate() }

            editor

            HStack(spacing: Spacing.md) {
                Text(status)
                    .font(.system(size: 11))
                    .foregroundStyle(errorText == nil ? theme.textGhost : theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.updatesFrequently)

                Text("\(draft.count) / \(maxLength)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
                    .accessibilityLabel("\(draft.count) of \(maxLength) characters used")

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
            .frame(minHeight: minHeight)
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
                    Text(placeholder)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textGhost)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, Spacing.sm + 2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .disabled(isSaving)
            .accessibilityLabel(title)
    }

    /// Capped on the way in: over the cap the server answers 400 and saves
    /// nothing, so the box stops rather than letting the user write a paragraph
    /// that cannot be kept. A rejected keystroke leaves the value unchanged.
    private var binding: Binding<String> {
        Binding(
            get: { draft },
            set: { value in
                let capped = String(value.prefix(maxLength))
                guard capped != draft else { return }
                draft = capped
                isDirty = true
                didSave = false
                errorText = nil
            }
        )
    }

    /// The saved value as this device last heard it from the account.
    private var stored: String {
        switch field {
        case .aboutMe: return settings.aboutMe
        case .testimony: return settings.testimony
        }
    }

    private func hydrate() {
        guard !isDirty else { return }
        draft = stored
    }

    // MARK: - Save

    private func submit(_ text: String) async -> PreferencesSyncModel.SaveOutcome {
        switch field {
        case .aboutMe: return await preferences.saveAboutMe(text)
        case .testimony: return await preferences.saveTestimony(text)
        }
    }

    private func save() async {
        guard !isSaving, isDirty else { return }
        let submitted = draft
        isSaving = true
        errorText = nil
        let outcome = await submit(submitted)
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
