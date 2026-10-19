import SwiftUI

/// The notes library — a port of `mobile/app/(app)/notes/index.tsx`.
///
/// Same capabilities as the Android list: search, folder and tag filters, sort,
/// create, and the per-note actions Android reaches by long-press. On a Mac
/// those live in a right-click menu, which is the same gesture by another name.
struct NotesListPane: View {
    @Environment(\.theme) private var theme
    @Bindable var library: NotesLibraryModel
    /// For the sermon template's church name (`/api/church`).
    let api: APIClient

    @State private var createKind: CreateKind?
    /// "+" opens Android's "Start a note" template sheet (PRD E1).
    @State private var isTemplatePickerPresented = false
    @State private var renamingFolder: Folder?
    /// The note waiting on Android's "This cannot be undone" confirmation.
    @State private var deletingNote: Note?

    enum CreateKind: String, Identifiable {
        case folder, tag
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            searchField
            filters
            metaRow

            if let error = library.error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.danger)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.sm)
            }

            Divider().overlay(theme.border)

            if library.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                list
            }
        }
        .sheet(item: $createKind) { kind in
            CreateItemSheet(kind: kind) { name, color in
                Task {
                    if kind == .tag {
                        await library.createTag(name: name, color: color)
                    } else {
                        await library.createFolder(name: name)
                    }
                }
            }
        }
        .sheet(item: $renamingFolder) { folder in
            RenameFolderSheet(folder: folder) { name in
                Task { await library.renameFolder(id: folder.id, name: name) }
            }
        }
        .sheet(isPresented: $isTemplatePickerPresented) {
            // `createNote(template:)` selects the new note, which opens it in
            // the editor beside the list.
            NoteTemplatePickerSheet { template in
                _ = try await library.createNote(template: template) {
                    switch try await api.fetchChurch() {
                    case .unavailable: return nil
                    case .ok(let church): return church?.name
                    }
                }
            }
        }
        .confirmationDialog(
            deletingNote.map { NoteActionMenu.deletePrompt(for: $0) } ?? "",
            isPresented: Binding(get: { deletingNote != nil }, set: { if !$0 { deletingNote = nil } }),
            titleVisibility: .visible,
            presenting: deletingNote
        ) { note in
            Button("Delete Note", role: .destructive) {
                Task { await library.deleteNote(id: note.id) }
            }
        }
    }

    // MARK: Chrome

    private var header: some View {
        HStack {
            Text("Notes")
                .font(.custom(FontFamily.brand, size: 28))
                .foregroundStyle(theme.text)
            Spacer()
            Button {
                isTemplatePickerPresented = true
            } label: {
                Image(systemName: "square.and.pencil")
            }
            .buttonStyle(SubtleButtonStyle())
            .keyboardShortcut("n", modifiers: [.command, .shift])
            .help("New note (⇧⌘N)")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.md)
        .padding(.bottom, Spacing.sm)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(theme.textFaint)
            TextField("Search notes", text: $library.searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
            if !library.searchQuery.isEmpty {
                Button {
                    library.searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.textGhost)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1)
        }
        .padding(.horizontal, Spacing.lg)
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    Chip(label: "All", isActive: library.activeFolderID == nil) {
                        library.activeFolderID = nil
                    }
                    ForEach(library.folders) { folder in
                        Chip(label: folder.name, isActive: library.activeFolderID == folder.id) {
                            library.activeFolderID =
                                library.activeFolderID == folder.id ? nil : folder.id
                        }
                        .contextMenu {
                            Button("Rename Folder…") { renamingFolder = folder }
                            Button("Delete Folder", role: .destructive) {
                                Task { await library.deleteFolder(id: folder.id) }
                            }
                        }
                    }
                    Chip(label: "＋ Folder", isActive: false) { createKind = .folder }
                }
                .padding(.horizontal, Spacing.lg)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(library.tags) { tag in
                        Chip(
                            label: tag.name,
                            isActive: library.activeTagID == tag.id,
                            dotColor: Color(hexString: tag.color)
                        ) {
                            library.activeTagID = library.activeTagID == tag.id ? nil : tag.id
                        }
                        .contextMenu {
                            Button("Delete Tag", role: .destructive) {
                                Task { await library.deleteTag(id: tag.id) }
                            }
                        }
                    }
                    Chip(label: "＋ Tag", isActive: false) { createKind = .tag }
                }
                .padding(.horizontal, Spacing.lg)
            }
        }
        .padding(.top, Spacing.md)
    }

    private var metaRow: some View {
        HStack {
            Text("\(library.notes.count) \(library.notes.count == 1 ? "note" : "notes")")
            Spacer()
            Menu {
                ForEach(NoteSort.allCases) { sort in
                    Button {
                        library.sortBy = sort
                    } label: {
                        if library.sortBy == sort {
                            Label(sort.label, systemImage: "checkmark")
                        } else {
                            Text(sort.label)
                        }
                    }
                }
            } label: {
                Label(library.sortBy.label, systemImage: "arrow.up.arrow.down")
                    .font(.system(size: 11))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .font(.system(size: 11))
        .foregroundStyle(theme.textFaint)
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }

    // MARK: List

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: Spacing.sm) {
                if library.notes.isEmpty {
                    emptyState
                } else {
                    ForEach(library.notes) { note in
                        // A real Button, not an `onTapGesture`: it gets keyboard
                        // activation and an accessibility action for free, which
                        // a tap gesture on a VStack does not.
                        Button {
                            library.selectedNoteID = note.id
                        } label: {
                            NoteRow(
                                note: note,
                                tags: NoteUtils.tags(for: note, in: library.tags),
                                isSelected: library.selectedNoteID == note.id
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(note.title.isEmpty ? "Untitled Note" : note.title)
                        .contextMenu { menu(for: note) }
                    }
                }
            }
            .padding(Spacing.md)
        }
        .refreshable { await library.refresh() }
    }

    /// The shared note menu with Android's card rows: the library long press
    /// passes `NoteActionSheet` only pin, move and delete.
    private func menu(for note: Note) -> some View {
        NoteActionMenu(
            note: note,
            folders: library.folders,
            onTogglePin: { Task { await library.togglePin(id: note.id) } },
            onMoveToFolder: { folderID in Task { await library.move(id: note.id, toFolder: folderID) } },
            onDelete: { deletingNote = note }
        )
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.xs) {
            Text(library.totalNotes == 0 ? "No notes yet" : "Nothing matches")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            Text(
                library.totalNotes == 0
                    ? "Press ⇧⌘N to start your first Bible study note."  // ⌘N is New chat
                    : "Try a different search or clear your filters."
            )
            .font(.system(size: 12))
            .foregroundStyle(theme.textGhost)
            .multilineTextAlignment(.center)
        }
        .padding(.top, 60)
        .padding(.horizontal, Spacing.lg)
    }
}

// MARK: - Row

private struct NoteRow: View {
    @Environment(\.theme) private var theme
    let note: Note
    let tags: [Tag]
    let isSelected: Bool

    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: Spacing.sm) {
                Text(note.title.isEmpty ? "Untitled Note" : note.title)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Spacer()
                if note.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(theme.accent)
                }
            }

            Text(note.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Empty note"
                : note.plainText)
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 5) {
                ForEach(tags.prefix(4)) { tag in
                    Circle()
                        .fill(Color(hexString: tag.color))
                        .frame(width: 7, height: 7)
                }
                if tags.count > 4 {
                    Text("+\(tags.count - 4)")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.textGhost)
                }
                Spacer()
                Text(meta)
                    .font(.system(size: 10.5))
                    .foregroundStyle(theme.textGhost)
            }
        }
        .padding(Spacing.md)
        .background(
            isSelected ? theme.surfaceStrong : (isHovering ? theme.surface : .clear),
            in: .rect(cornerRadius: Radius.md)
        )
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(
                    isSelected ? theme.accentBorder : (note.isPinned ? theme.accentBorder : theme.border),
                    lineWidth: 1
                )
        }
        .contentShape(.rect(cornerRadius: Radius.md))
        .onHover { isHovering = $0 }
    }

    private var meta: String {
        let relative = NoteUtils.relativeTime(note.updatedAt)
        return note.wordCount > 0 ? "\(relative)  ·  \(note.wordCount) words" : relative
    }
}

// MARK: - Chip

struct Chip: View {
    @Environment(\.theme) private var theme
    let label: String
    let isActive: Bool
    var dotColor: Color?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let dotColor {
                    Circle().fill(dotColor).frame(width: 6, height: 6)
                }
                Text(label)
            }
            .font(.system(size: 11.5))
            .foregroundStyle(isActive ? theme.accent : theme.textMuted)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 5)
            .background(isActive ? theme.accentSoft : theme.surface, in: .capsule)
            .overlay {
                Capsule().strokeBorder(isActive ? theme.accentBorder : theme.border, lineWidth: 1)
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Sheets

/// "Start a note" - Android's `CreateItemSheet` in its note mode (PRD E1), the
/// Mac form of the iOS picker: the four templates with their descriptions, one
/// click creates the note. While the create runs every row is disabled; a
/// failure keeps the sheet open with Android's message, since the note may or
/// may not exist.
struct NoteTemplatePickerSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    /// Creates the note; the sheet dismisses itself when this returns.
    var onPick: (NoteTemplates.ID) async throws -> Void

    @State private var isBusy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Start a note")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.danger)
            }
            if isBusy {
                Text("Creating your note...")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
            }

            ForEach(NoteTemplates.options) { option in
                Button {
                    pick(option.id)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(option.label)
                            .font(.system(size: 13.5, weight: .semibold))
                            .foregroundStyle(theme.text)
                        Text(option.description)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textMuted)
                    }
                    .padding(Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1)
                    }
                    .contentShape(.rect(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(isBusy)
                .accessibilityLabel(option.label)
                .accessibilityHint(option.description)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(isBusy)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 380)
        .interactiveDismissDisabled(isBusy)
    }

    private func pick(_ id: NoteTemplates.ID) {
        guard !isBusy else { return }
        isBusy = true
        error = nil
        Task {
            do {
                try await onPick(id)
                isBusy = false
                dismiss()
            } catch {
                isBusy = false
                self.error = "Could not finish creating the note. Check your notes before trying again."
            }
        }
    }
}

/// Create sheet shared by folders (name only) and tags (name + swatch), matching
/// `mobile/src/features/notes/components/CreateItemSheet.tsx`.
struct CreateItemSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let kind: NotesListPane.CreateKind
    var onSubmit: (String, String) -> Void

    @State private var name = ""
    @State private var color = TagPalette.colors[0]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(kind == .folder ? "New folder" : "New tag")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            TextField(kind == .folder ? "Folder name" : "Tag name", text: $name)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)

            if kind == .tag {
                HStack(spacing: Spacing.md) {
                    ForEach(TagPalette.colors, id: \.self) { preset in
                        Button {
                            color = preset
                        } label: {
                            Circle()
                                .fill(Color(hexString: preset))
                                .frame(width: 26, height: 26)
                                .overlay {
                                    Circle().strokeBorder(
                                        color == preset ? theme.text : .clear,
                                        lineWidth: 2
                                    )
                                }
                        }
                        .buttonStyle(.plain)
                        .help(preset)
                    }
                }
            }

            Text(
                kind == .folder
                    ? "Folders group your studies; filter by them from the list."
                    : "Tags show as coloured dots on each note."
            )
            .font(.system(size: 11.5))
            .foregroundStyle(theme.textGhost)

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button(kind == .folder ? "Create Folder" : "Create Tag", action: submit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 380)
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed, color)
        dismiss()
    }
}

/// Renaming a folder has no Android equivalent yet — `PATCH /api/folders/{id}`
/// existed on the shared backend with no client using it, and web may be a
/// superset but must never be a subset, so it is exposed here too.
struct RenameFolderSheet: View {
    @Environment(\.dismiss) private var dismiss
    let folder: Folder
    var onSubmit: (String) -> Void

    @State private var name: String

    init(folder: Folder, onSubmit: @escaping (String) -> Void) {
        self.folder = folder
        self.onSubmit = onSubmit
        _name = State(initialValue: folder.name)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Rename folder").font(.system(size: 15, weight: .semibold))
            TextField("Folder name", text: $name)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Rename", action: submit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 340)
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
        dismiss()
    }
}
