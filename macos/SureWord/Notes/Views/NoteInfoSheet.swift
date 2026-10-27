import SwiftUI

/// Everything about a note that is not its text, on the Mac - a port of
/// Android's `NoteInfoSheet` (`mobile/src/features/notes/components/NoteInfoSheet.tsx`)
/// and of the iOS sheet of the same name: read-only stats, the editable
/// aliases and custom properties, and both directions of its wikilink graph.
///
/// Links are fetched per open because the server recomputes them from the
/// saved text; `NoteEditorModel.loadLinks()` flushes the editor first so a
/// just-typed `[[link]]` is in the graph it shows.
struct NoteInfoSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let model: NoteEditorModel
    let folderName: String?
    /// Called with a note id to open; the sheet has already been dismissed.
    let onOpenNote: (String) -> Void

    @State private var aliasDraft = ""
    @State private var draft: PropertyDraft?
    @State private var creatingTarget: String?

    /// Add/edit form state; `originalKey` is nil while adding.
    struct PropertyDraft: Equatable {
        var originalKey: String?
        var key: String
        var type: NotePropertyType
        var value: String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Note info")
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding([.horizontal, .top], Spacing.xl)
                .padding(.bottom, Spacing.md)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    if let note = model.note {
                        statsSection(note)
                        aliasesSection(note)
                        propertiesSection(note)
                        Divider().overlay(theme.border).padding(.top, Spacing.lg)
                        linksSection
                        mentionsSection
                    }
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.lg)
            }

            Divider().overlay(theme.border)
            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Spacing.lg)
        }
        .frame(width: 420, height: 560)
        .task { await model.loadLinks() }
    }

    // MARK: Stats

    private func statsSection(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            sectionTitle("Properties")
            VStack(spacing: 7) {
                stat("Created", NoteUtils.relativeTime(note.createdAt))
                stat("Updated", NoteUtils.relativeTime(note.updatedAt))
                stat("Words", String(note.wordCount))
                stat("Folder", folderName ?? "None")
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1)
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(theme.textFaint)
            Spacer()
            Text(value)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
        }
        .appFont(.system(size: 13))
    }

    // MARK: Aliases

    private func aliasesSection(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            fieldLabel("Aliases")
            if note.aliases.isEmpty {
                hint("None. An alias lets a [[wikilink]] find this note by another name.")
            } else {
                ForEach(note.aliases, id: \.self) { alias in
                    HStack {
                        Text(alias)
                            .appFont(.system(size: 13))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                        Spacer()
                        Button {
                            removeAlias(alias)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(theme.textMuted)
                        }
                        .buttonStyle(.plain)
                        .help("Remove alias")
                        .accessibilityLabel("Remove alias \(alias)")
                    }
                }
            }

            HStack(spacing: Spacing.sm) {
                TextField("Add an alias", text: $aliasDraft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(addAlias)
                Button("Add", action: addAlias)
                    .disabled(aliasDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func addAlias() {
        guard let note = model.note else { return }
        let next = NotePropertyEditing.normalizeAliases(note.aliases + [aliasDraft])
        aliasDraft = ""
        // Android's rule: only a list that actually grew is worth a PATCH.
        guard next.count != note.aliases.count else { return }
        Task { await model.setAliases(next) }
    }

    private func removeAlias(_ alias: String) {
        guard let note = model.note else { return }
        let next = note.aliases.filter { $0 != alias }
        Task { await model.setAliases(next) }
    }

    // MARK: Custom properties

    private func propertiesSection(_ note: Note) -> some View {
        let entries = NotePropertyEditing.entries(note.properties)
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            fieldLabel("Custom properties")
            if entries.isEmpty, draft == nil {
                hint("None yet.")
            }
            ForEach(entries, id: \.key) { entry in
                propertyRow(key: entry.key, value: entry.value, in: note)
            }

            if let draft {
                draftForm(draft, in: note)
            } else {
                Button {
                    draft = PropertyDraft(originalKey: nil, key: "", type: .text, value: "")
                } label: {
                    Label("Add property", systemImage: "plus")
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.accent)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func propertyRow(key: String, value: NotePropertyValue, in note: Note) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(key)
                    .appFont(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
                    .lineLimit(1)
                Text(NotePropertyEditing.format(value))
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Button {
                draft = PropertyDraft(
                    originalKey: key,
                    key: key,
                    type: NotePropertyEditing.type(of: value),
                    value: NotePropertyEditing.input(for: value)
                )
            } label: {
                Image(systemName: "pencil")
                    .foregroundStyle(theme.textMuted)
            }
            .buttonStyle(.plain)
            .help("Edit property")
            .accessibilityLabel("Edit property \(key)")

            Button {
                let next = NotePropertyEditing.removing(note.properties, key: key)
                Task { await model.setProperties(next) }
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(theme.danger)
            }
            .buttonStyle(.plain)
            .help("Delete property")
            .accessibilityLabel("Delete property \(key)")
        }
        .padding(.vertical, Spacing.xs)
    }

    private func draftForm(_ current: PropertyDraft, in note: Note) -> some View {
        let key = NotePropertyEditing.normalizeKey(current.key)
        let value = NotePropertyEditing.parseValue(current.type, current.value)
        let isValid = !key.isEmpty
            && value != nil
            && !NotePropertyEditing.keyTaken(note.properties, key, ignoring: current.originalKey)

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            TextField("Property name", text: draftBinding(\.key))
                .textFieldStyle(.roundedBorder)

            Picker("Type", selection: draftBinding(\.type)) {
                ForEach(NotePropertyType.allCases) { type in
                    Text(type.label).tag(type)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: current.type) { _, type in
                // Checkbox has no free text, so seed it with a real value.
                if type == .checkbox, NotePropertyEditing.parseValue(.checkbox, current.value) == nil {
                    draft?.value = "true"
                }
            }

            if current.type == .checkbox {
                Picker("Value", selection: draftBinding(\.value)) {
                    Text("Yes").tag("true")
                    Text("No").tag("false")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            } else {
                TextField(current.type.placeholder, text: draftBinding(\.value))
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: Spacing.lg) {
                Button("Save") {
                    guard isValid, let value else { return }
                    let next = NotePropertyEditing.setting(
                        note.properties,
                        key: key,
                        value: value,
                        previousKey: current.originalKey
                    )
                    draft = nil
                    Task { await model.setProperties(next) }
                }
                .disabled(!isValid)

                Button("Cancel") { draft = nil }
            }
            .padding(.top, Spacing.xs)
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1)
        }
    }

    private func draftBinding<Value>(_ keyPath: WritableKeyPath<PropertyDraft, Value>) -> Binding<Value> {
        Binding(
            get: { draft?[keyPath: keyPath] ?? PropertyDraft(key: "", type: .text, value: "")[keyPath: keyPath] },
            set: { draft?[keyPath: keyPath] = $0 }
        )
    }

    // MARK: Links

    private var outgoing: [NoteOutgoingLink] { model.links?.outgoing ?? [] }
    private var backlinks: [NoteBacklink] { model.links?.backlinks ?? [] }
    private var isFirstLoad: Bool { model.isLoadingLinks && model.links == nil }

    private var linksSection: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            sectionTitle("Links (\(outgoing.count))")
            if let error = model.linksError {
                Button {
                    Task { await model.loadLinks() }
                } label: {
                    HStack {
                        Text(error)
                            .foregroundStyle(theme.danger)
                            .lineLimit(2)
                        Spacer()
                        Text("Retry")
                            .fontWeight(.semibold)
                            .foregroundStyle(theme.danger)
                    }
                    .appFont(.system(size: 12))
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.md))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            } else if isFirstLoad {
                ProgressView().controlSize(.small)
            } else if outgoing.isEmpty {
                hint("None. Type [[ a note title ]] in this note, or use the link button in the toolbar.")
            } else {
                ForEach(Array(outgoing.enumerated()), id: \.offset) { _, link in
                    outgoingRow(link)
                }
            }
        }
    }

    @ViewBuilder
    private func outgoingRow(_ link: NoteOutgoingLink) -> some View {
        let label = NoteWikilinks.outgoingLabel(link)
        if let targetID = link.noteId {
            Button {
                open(targetID)
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "arrow.right")
                        .appFont(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                    Text(label)
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 6)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(label)")
        } else {
            // Unresolved: no note holds this title yet. Dimmed, with a one-click
            // create that the server resolves the moment the note exists.
            HStack(spacing: Spacing.md) {
                Image(systemName: "questionmark.circle")
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
                Text(label)
                    .appFont(.system(size: 13))
                    .italic()
                    .foregroundStyle(theme.textGhost)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if creatingTarget == link.targetTitle {
                    ProgressView().controlSize(.small)
                } else {
                    Button("Create") { createAndOpen(link.targetTitle) }
                        .appFont(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .buttonStyle(.plain)
                        .accessibilityLabel("Create the note \(label)")
                }
            }
            .padding(.vertical, 6)
        }
    }

    private var mentionsSection: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            sectionTitle("Linked mentions (\(backlinks.count))")
            if model.linksError != nil || isFirstLoad {
                EmptyView()
            } else if backlinks.isEmpty {
                hint("No other note links here yet.")
            } else {
                ForEach(backlinks, id: \.noteId) { backlink in
                    let title = backlink.title.isEmpty ? "Untitled Note" : backlink.title
                    Button {
                        open(backlink.noteId)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .appFont(.system(size: 13))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                            Text(backlink.snippet)
                                .appFont(.system(size: 12))
                                .foregroundStyle(theme.textFaint)
                                .lineLimit(2)
                            Text(NoteUtils.relativeTime(backlink.updatedAt))
                                .appFont(.system(size: 11))
                                .foregroundStyle(theme.textGhost)
                        }
                        .padding(.vertical, Spacing.xs)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(title)")
                }
            }
        }
    }

    // MARK: Pieces

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .appFont(.system(size: 11, weight: .bold))
            .tracking(0.4)
            .foregroundStyle(theme.text)
            .padding(.top, Spacing.md)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.textFaint)
            .padding(.top, Spacing.md)
    }

    /// `Text` from a `String` value is verbatim, so `[[...]]` in the copy is
    /// never read as Markdown.
    private func hint(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 12))
            .foregroundStyle(theme.textGhost)
    }

    // MARK: Navigation

    private func open(_ noteID: String) {
        dismiss()
        onOpenNote(noteID)
    }

    private func createAndOpen(_ targetTitle: String) {
        guard creatingTarget == nil else { return }
        creatingTarget = targetTitle
        Task {
            let createdID = await model.createLinkedNote(title: targetTitle)
            creatingTarget = nil
            if let createdID { open(createdID) }
        }
    }
}
