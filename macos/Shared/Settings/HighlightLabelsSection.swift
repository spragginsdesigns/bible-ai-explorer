import SwiftUI

/// Settings -> Highlight labels, shared by both Apple clients: what the user
/// calls each of the eight highlight colours, and what each one means to them.
/// The counterpart of `mobile/src/features/settings/HighlightLabelsSection.tsx`
/// and of the web card in `src/app/settings/page.tsx`.
///
/// Both maps are stored **whole** by `PATCH /api/preferences`, so this section
/// never writes on a keystroke the way the toggles next to it do. It keeps a
/// draft, tracks which colours the user actually touched, and hands only those
/// to `PreferencesSyncModel.saveHighlightLabels`, which re-reads the account
/// document and merges them over the fresh maps. That is what lets a label
/// named on the phone survive a save made here.
///
/// The draft is also what a hydrate must not clobber: a document arriving
/// while the user is mid-word would otherwise snatch the box back. Rows the
/// user has touched are left alone until the save that sent them lands, which
/// is the same guard the Memory toggle uses against a hydrate racing a tap.
struct HighlightLabelsSection: View {
    @Environment(\.theme) private var theme

    let settings: SettingsStore
    let preferences: PreferencesSyncModel

    /// One colour's in-progress edit. Both halves live together because a row
    /// owns both boxes and Reset clears the pair.
    private struct Draft: Equatable {
        var label = ""
        var meaning = ""
    }

    @State private var drafts: [String: Draft] = [:]
    /// Colour ids whose label or meaning the user has changed since the last
    /// successful save. Two sets, not one: a patch leaves out a map with no
    /// edits, which keeps the whole-map replacement as narrow as possible.
    @State private var dirtyLabels: Set<String> = []
    @State private var dirtyMeanings: Set<String> = []
    @State private var isSaving = false
    @State private var didSave = false
    @State private var errorText: String?

    static let description =
        "Name each colour for why you reach for it, and tell SureWord what it means to you. "
        + "Yellow might be a favourite verse, blue a promise you lean on, red a warning or the "
        + "words of Christ. The assistant reads these meanings, so a marked verse carries your "
        + "reasons into chat. A blank label uses the colour name."

    var body: some View {
        Section("Highlight labels") {
            // The hydrate hooks hang off a row inside the section rather than
            // off the section itself: a `Section` is a container the Form takes
            // apart, and behaviour attached to it is not reliably kept. The
            // church section's alert is mounted the same way.
            //
            // Both paths go through the same guard, so a document landing while
            // the section is open is treated exactly like the one it opened
            // with: only rows the user is not editing are refilled.
            hint(Self.description)
                .onAppear { hydrate() }
                .onChange(of: settings.highlightLabels) { _, _ in hydrate() }
                .onChange(of: settings.highlightMeanings) { _, _ in hydrate() }

            ForEach(HighlightColors.presets) { preset in
                row(preset)
            }

            Text(status)
                .font(.system(size: 11))
                .foregroundStyle(errorText == nil ? theme.textGhost : theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.updatesFrequently)

            HStack(spacing: Spacing.md) {
                Button("Use suggested labels") { useSuggested() }
                    .buttonStyle(SubtleButtonStyle())
                    .disabled(isSaving)
                    .accessibilityHint("Fills every colour with SureWord's starter set")

                Spacer()

                if isSaving {
                    ProgressView().controlSize(.small)
                }
                Button("Save labels") {
                    Task { await save() }
                }
                .disabled(isSaving || !isDirty)
            }
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func row(_ preset: HighlightPreset) -> some View {
        let id = preset.colorId

        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Circle()
                    .fill(Color(hex: preset.hex) ?? .clear)
                    .frame(width: 18, height: 18)
                    .overlay { Circle().strokeBorder(theme.borderStrong, lineWidth: 1) }
                    .accessibilityHidden(true)

                // The prompt, not the title, carries the hue name: in a grouped
                // Form a TextField's title becomes a leading label, which would
                // repeat the swatch beside it (same reasoning as MemoriesView).
                TextField(
                    "\(preset.name) highlight label",
                    text: labelBinding(id),
                    prompt: Text(preset.name)
                )
                .labelsHidden()
                .textFieldStyle(.roundedBorder)
                .disabled(isSaving)

                Button("Reset") { reset(id) }
                    .buttonStyle(SubtleButtonStyle())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
                    .disabled(isSaving || isRowEmpty(id))
                    .accessibilityLabel("Reset the \(preset.name) label and meaning")
            }

            TextField(
                "\(preset.name) highlight meaning",
                text: meaningBinding(id),
                prompt: Text("What this colour means to you")
            )
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .disabled(isSaving)
        }
        .padding(.vertical, 2)
    }

    // MARK: - Draft

    /// Capped on the way in rather than on the way out: the server refuses an
    /// over-length entry with a 400, and a box that silently keeps typing past
    /// the limit would make the whole save fail on a character the user cannot
    /// see. A rejected keystroke leaves the binding's value unchanged, which is
    /// what puts the text field back.
    private func labelBinding(_ id: String) -> Binding<String> {
        Binding(
            get: { drafts[id]?.label ?? "" },
            set: { value in
                var draft = drafts[id] ?? Draft()
                let capped = String(value.prefix(HighlightColors.maxLabelLength))
                guard draft.label != capped else { return }
                draft.label = capped
                drafts[id] = draft
                dirtyLabels.insert(id)
                touched()
            }
        )
    }

    private func meaningBinding(_ id: String) -> Binding<String> {
        Binding(
            get: { drafts[id]?.meaning ?? "" },
            set: { value in
                var draft = drafts[id] ?? Draft()
                let capped = String(value.prefix(HighlightColors.maxMeaningLength))
                guard draft.meaning != capped else { return }
                draft.meaning = capped
                drafts[id] = draft
                dirtyMeanings.insert(id)
                touched()
            }
        )
    }

    /// Fill every row the user is not currently editing from the cache. Called
    /// on appear and on every document that lands, so another client's change
    /// shows up here without closing the screen.
    private func hydrate() {
        for preset in HighlightColors.presets {
            let id = preset.colorId
            var draft = drafts[id] ?? Draft()
            if !dirtyLabels.contains(id) { draft.label = settings.highlightLabels[id] ?? "" }
            if !dirtyMeanings.contains(id) { draft.meaning = settings.highlightMeanings[id] ?? "" }
            drafts[id] = draft
        }
    }

    /// Clears the whole row, label and meaning: the colour goes back to its hue
    /// name and stops telling the assistant anything. It is an edit like any
    /// other, so it still has to be saved.
    private func reset(_ id: String) {
        guard !isRowEmpty(id) else { return }
        var draft = drafts[id] ?? Draft()
        if !draft.label.isEmpty {
            draft.label = ""
            dirtyLabels.insert(id)
        }
        if !draft.meaning.isEmpty {
            draft.meaning = ""
            dirtyMeanings.insert(id)
        }
        drafts[id] = draft
        touched()
    }

    /// Fills the draft with SureWord's starter set. Deliberately only the
    /// draft: the user still reads it and presses Save, and can undo the whole
    /// thing by leaving the screen.
    private func useSuggested() {
        for preset in HighlightColors.labelPresets {
            var draft = drafts[preset.id] ?? Draft()
            if draft.label != preset.label {
                draft.label = preset.label
                dirtyLabels.insert(preset.id)
            }
            if draft.meaning != preset.meaning {
                draft.meaning = preset.meaning
                dirtyMeanings.insert(preset.id)
            }
            drafts[preset.id] = draft
        }
        touched()
    }

    private func isRowEmpty(_ id: String) -> Bool {
        let draft = drafts[id] ?? Draft()
        return draft.label.isEmpty && draft.meaning.isEmpty
    }

    private var isDirty: Bool { !dirtyLabels.isEmpty || !dirtyMeanings.isEmpty }

    /// Any edit retires the last result: "Saved" beside a changed box is a lie,
    /// and an error the user has already acted on is noise.
    private func touched() {
        didSave = false
        errorText = nil
    }

    // MARK: - Save

    private func save() async {
        guard !isSaving, isDirty else { return }
        let labelEdits = edits(dirtyLabels, \Draft.label)
        let meaningEdits = edits(dirtyMeanings, \Draft.meaning)

        isSaving = true
        errorText = nil
        let outcome = await preferences.saveHighlightLabels(
            labels: labelEdits,
            meanings: meaningEdits
        )
        isSaving = false

        switch outcome {
        case .saved:
            // A row stops being dirty only where the box still holds what was
            // sent. A keystroke during the round trip is a newer edit than the
            // save, and has to survive it.
            dirtyLabels = dirtyLabels.filter { labelEdits[$0] != drafts[$0]?.label }
            dirtyMeanings = dirtyMeanings.filter { meaningEdits[$0] != drafts[$0]?.meaning }
            didSave = true
            // The echoed document is already in the store by now, so this pulls
            // the server's trimmed text into every row that is no longer dirty.
            hydrate()
        case .failed(let message):
            errorText = message
        }
    }

    /// The touched rows as the save wants them: colour id to text, where an
    /// empty string clears that colour.
    private func edits(_ ids: Set<String>, _ field: KeyPath<Draft, String>) -> [String: String] {
        var touchedRows: [String: String] = [:]
        for id in ids {
            touchedRows[id] = (drafts[id] ?? Draft())[keyPath: field]
        }
        return touchedRows
    }

    // MARK: - Status

    private var status: String {
        if let errorText { return errorText }
        if isSaving { return "Saving to your account\u{2026}" }
        if isDirty { return "Unsaved changes" }
        if didSave { return "Saved to your account" }
        if !preferences.hasLoadedDocument { return "Loading your labels\u{2026}" }
        return "\(HighlightColors.maxLabelLength) characters for a label, "
            + "\(HighlightColors.maxMeaningLength) for a meaning"
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
