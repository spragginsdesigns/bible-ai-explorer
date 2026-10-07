import SwiftUI

/// Everything about a note that is not its text - a port of
/// `mobile/src/features/notes/components/NoteInfoSheet.tsx`: read-only stats,
/// the editable aliases and custom properties, and both directions of its
/// wikilink graph.
///
/// Links are fetched per open because the server recomputes them from the
/// saved text; `NoteEditorModel.loadLinks()` flushes the editor first so a
/// just-typed `[[link]]` is in the graph it shows.
struct NoteInfoSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @Bindable var model: NoteEditorModel
    let folderName: String?
    /// Called with a note id to push; the sheet has already been dismissed.
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

    private var note: Note? { model.note }

    var body: some View {
        NavigationStack {
            List {
                if let note {
                    statsSection(note)
                    aliasesSection(note)
                    propertiesSection(note)
                    linksSection
                    mentionsSection
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
            .navigationTitle("Note info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await model.loadLinks() }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Stats

    private func statsSection(_ note: Note) -> some View {
        Section("Properties") {
            stat("Created", NoteUtils.relativeTime(note.createdAt))
            stat("Updated", NoteUtils.relativeTime(note.updatedAt))
            stat("Words", String(note.wordCount))
            stat("Folder", folderName ?? "None")
        }
        .listRowBackground(theme.surface)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(value)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
        } label: {
            Text(label).foregroundStyle(theme.textFaint)
        }
        .font(.subheadline)
    }

    // MARK: Aliases

    private func aliasesSection(_ note: Note) -> some View {
        Section {
            if note.aliases.isEmpty {
                Text(verbatim: "None. An alias lets a [[wikilink]] find this note by another name.")
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
            } else {
                ForEach(note.aliases, id: \.self) { alias in
                    HStack {
                        Text(alias)
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
                        .accessibilityLabel("Remove alias \(alias)")
                    }
                }
            }

            HStack(spacing: Spacing.sm) {
                TextField("Add an alias", text: $aliasDraft)
                    .submitLabel(.done)
                    .onSubmit(addAlias)
                Button("Add", action: addAlias)
                    .fontWeight(.semibold)
                    .disabled(aliasDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } header: {
            Text("Aliases")
        }
        .listRowBackground(theme.surface)
    }

    private func addAlias() {
        guard let note else { return }
        let next = NotePropertyEditing.normalizeAliases(note.aliases + [aliasDraft])
        aliasDraft = ""
        // Android's rule: only a list that actually grew is worth a PATCH.
        guard next.count != note.aliases.count else { return }
        Task { await model.setAliases(next) }
    }

    private func removeAlias(_ alias: String) {
        guard let note else { return }
        let next = note.aliases.filter { $0 != alias }
        Task { await model.setAliases(next) }
    }

    // MARK: Custom properties

    private func propertiesSection(_ note: Note) -> some View {
        let entries = NotePropertyEditing.entries(note.properties)
        return Section {
            if entries.isEmpty, draft == nil {
                Text("None yet.")
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
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
                        .foregroundStyle(theme.accent)
                }
            }
        } header: {
            Text("Custom properties")
        }
        .listRowBackground(theme.surface)
    }

    private func propertyRow(key: String, value: NotePropertyValue, in note: Note) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 1) {
                Text(key)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.textFaint)
                    .lineLimit(1)
                Text(NotePropertyEditing.format(value))
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
            .accessibilityLabel("Edit property \(key)")

            Button {
                let next = NotePropertyEditing.removing(note.properties, key: key)
                Task { await model.setProperties(next) }
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(theme.danger)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete property \(key)")
        }
    }

    private func draftForm(_ current: PropertyDraft, in note: Note) -> some View {
        let key = NotePropertyEditing.normalizeKey(current.key)
        let value = NotePropertyEditing.parseValue(current.type, current.value)
        let isValid = !key.isEmpty
            && value != nil
            && !NotePropertyEditing.keyTaken(note.properties, key, ignoring: current.originalKey)

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            TextField("Property name", text: draftBinding(\.key))
                .textInputAutocapitalization(.never)

            Picker("Type", selection: draftBinding(\.type)) {
                ForEach(NotePropertyType.allCases) { type in
                    Text(type.label).tag(type)
                }
            }
            .pickerStyle(.segmented)
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
            } else {
                TextField(current.type.placeholder, text: draftBinding(\.value))
                    .keyboardType(current.type == .number ? .numbersAndPunctuation : .default)
            }

            HStack(spacing: Spacing.xl) {
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
                .fontWeight(.semibold)
                .disabled(!isValid)

                Button("Cancel", role: .cancel) { draft = nil }
                    .foregroundStyle(theme.textFaint)
            }
            .buttonStyle(.borderless)
            .padding(.top, Spacing.xs)
        }
        .padding(.vertical, Spacing.xs)
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
        Section {
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
                    .font(.footnote)
                }
                .listRowBackground(theme.dangerSoft)
            } else if isFirstLoad {
                ProgressView()
            } else if outgoing.isEmpty {
                Text(verbatim: "None. Type [[ a note title ]] in this note, or use the link button above the keyboard.")
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
            } else {
                ForEach(Array(outgoing.enumerated()), id: \.offset) { _, link in
                    outgoingRow(link)
                }
            }
        } header: {
            Text("Links (\(outgoing.count))")
        }
        .listRowBackground(theme.surface)
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
                        .font(.footnote)
                        .foregroundStyle(theme.textMuted)
                    Text(label)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(label)")
        } else {
            // Unresolved: no note holds this title yet. Dimmed, with a one-tap
            // create that the server resolves the moment the note exists.
            HStack(spacing: Spacing.md) {
                Image(systemName: "questionmark.circle")
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
                Text(label)
                    .italic()
                    .foregroundStyle(theme.textGhost)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if creatingTarget == link.targetTitle {
                    ProgressView()
                } else {
                    Button("Create") { createAndOpen(link.targetTitle) }
                        .font(.footnote.weight(.semibold))
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Create the note \(label)")
                }
            }
        }
    }

    private var mentionsSection: some View {
        Section {
            if model.linksError != nil || isFirstLoad {
                EmptyView()
            } else if backlinks.isEmpty {
                Text("No other note links here yet.")
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
            } else {
                ForEach(backlinks, id: \.noteId) { backlink in
                    let title = backlink.title.isEmpty ? "Untitled Note" : backlink.title
                    Button {
                        open(backlink.noteId)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                            Text(backlink.snippet)
                                .font(.footnote)
                                .foregroundStyle(theme.textFaint)
                                .lineLimit(2)
                            Text(NoteUtils.relativeTime(backlink.updatedAt))
                                .font(.caption)
                                .foregroundStyle(theme.textGhost)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(title)")
                }
            }
        } header: {
            Text("Linked mentions (\(backlinks.count))")
        }
        .listRowBackground(theme.surface)
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
