import SwiftUI
import UIKit

/// The notes library — a port of `mobile/app/(app)/notes/index.tsx` to the iOS
/// idioms: `.searchable`, swipe actions, context menus, `.refreshable`.
///
/// Same capabilities as the Android list: search, folder and tag filters, sort,
/// create, pin, move and delete. Everything renders out of the shared
/// `NotesStore`, so the cached snapshot is on screen instantly and every fetch
/// is a silent revalidation behind it.
struct NotesLibraryView: View {
    @Environment(\.theme) private var theme
    @Bindable var library: NotesLibraryModel
    /// Hands a note id back to the tab root, which pushes the editor.
    var onOpenNote: (String) -> Void

    @State private var createKind: CreateKind?
    @State private var renamingFolder: Folder?
    @State private var renameText = ""
    @State private var isCreatingNote = false
    /// Drives the pin haptic; the trigger value itself carries no meaning.
    @State private var pinHapticTick = 0

    enum CreateKind: String, Identifiable {
        case folder, tag
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            filters

            if let error = library.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
            }

            if library.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                list
            }
        }
        .searchable(text: $library.searchQuery, prompt: "Search notes")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                sortMenu
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    createNote()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .disabled(isCreatingNote)
                .accessibilityLabel("New note")
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
        .alert("Rename Folder", isPresented: renamingFolderBinding) {
            TextField("Folder name", text: $renameText)
            Button("Rename") {
                guard let folder = renamingFolder else { return }
                let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task { await library.renameFolder(id: folder.id, name: name) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sensoryFeedback(.impact(weight: .light), trigger: pinHapticTick)
    }

    private var renamingFolderBinding: Binding<Bool> {
        Binding(
            get: { renamingFolder != nil },
            set: { if !$0 { renamingFolder = nil } }
        )
    }

    // MARK: Filters

    private var filters: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    chip("All", isActive: library.activeFolderID == nil) {
                        library.activeFolderID = nil
                    }
                    ForEach(library.folders) { folder in
                        chip(folder.name, isActive: library.activeFolderID == folder.id) {
                            library.activeFolderID =
                                library.activeFolderID == folder.id ? nil : folder.id
                        }
                        .contextMenu {
                            Button("Rename Folder") {
                                renameText = folder.name
                                renamingFolder = folder
                            }
                            Button("Delete Folder", role: .destructive) {
                                Task { await library.deleteFolder(id: folder.id) }
                            }
                        }
                    }
                    chip("New Folder", systemImage: "plus", isActive: false) {
                        createKind = .folder
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(library.tags) { tag in
                        chip(
                            tag.name,
                            isActive: library.activeTagID == tag.id,
                            dotColor: TagColor.color(tag.color)
                        ) {
                            library.activeTagID = library.activeTagID == tag.id ? nil : tag.id
                        }
                        .contextMenu {
                            Button("Delete Tag", role: .destructive) {
                                Task { await library.deleteTag(id: tag.id) }
                            }
                        }
                    }
                    chip("New Tag", systemImage: "plus", isActive: false) {
                        createKind = .tag
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }
        }
        .padding(.vertical, Spacing.sm)
    }

    private func chip(
        _ label: String,
        systemImage: String? = nil,
        isActive: Bool,
        dotColor: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let dotColor {
                    Circle().fill(dotColor).frame(width: 6, height: 6)
                }
                if let systemImage {
                    Image(systemName: systemImage).font(.caption2)
                }
                Text(label)
            }
            .font(.subheadline)
            .foregroundStyle(isActive ? theme.accent : theme.textMuted)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 6)
            .background(isActive ? theme.accentSoft : theme.surface, in: .capsule)
            .overlay {
                Capsule().strokeBorder(isActive ? theme.accentBorder : theme.border, lineWidth: 1)
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    private var sortMenu: some View {
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
            Image(systemName: "arrow.up.arrow.down")
                .foregroundStyle(theme.textMuted)
        }
        .accessibilityLabel("Sort notes, currently by \(library.sortBy.label)")
    }

    // MARK: List

    private var list: some View {
        List {
            if library.notes.isEmpty {
                emptyState
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(library.notes) { note in
                    Button {
                        onOpenNote(note.id)
                    } label: {
                        NoteRow(
                            note: note,
                            tags: NoteUtils.tags(for: note, in: library.tags)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(note.title.isEmpty ? "Untitled Note" : note.title)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .swipeActions(edge: .leading) {
                        Button {
                            pinHapticTick += 1
                            Task { await library.togglePin(id: note.id) }
                        } label: {
                            Label(note.isPinned ? "Unpin" : "Pin", systemImage: note.isPinned ? "pin.slash" : "pin")
                        }
                        .tint(Color(hex: 0xFBBF24))
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await library.deleteNote(id: note.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu { menu(for: note) }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await library.refresh() }
    }

    @ViewBuilder
    private func menu(for note: Note) -> some View {
        Button(note.isPinned ? "Unpin Note" : "Pin Note") {
            pinHapticTick += 1
            Task { await library.togglePin(id: note.id) }
        }
        Menu("Move to Folder") {
            Button("No Folder") { Task { await library.move(id: note.id, toFolder: nil) } }
            ForEach(library.folders) { folder in
                Button(folder.name) { Task { await library.move(id: note.id, toFolder: folder.id) } }
            }
        }
        Divider()
        Button("Delete Note", role: .destructive) {
            Task { await library.deleteNote(id: note.id) }
        }
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.xs) {
            Text(library.totalNotes == 0 ? "No notes yet" : "Nothing matches")
                .font(.headline)
                .foregroundStyle(theme.textMuted)
            Text(
                library.totalNotes == 0
                    ? "Tap the compose button to start your first Bible study note."
                    : "Try a different search or clear your filters."
            )
            .font(.subheadline)
            .foregroundStyle(theme.textGhost)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
        .padding(.horizontal, Spacing.lg)
    }

    private func createNote() {
        guard !isCreatingNote else { return }
        isCreatingNote = true
        Task {
            if let note = await library.createNote() {
                onOpenNote(note.id)
            }
            isCreatingNote = false
        }
    }
}

// MARK: - Row

/// One note in the list. Text styles (not point sizes) so the row follows
/// Dynamic Type.
private struct NoteRow: View {
    @Environment(\.theme) private var theme
    let note: Note
    let tags: [Tag]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: Spacing.sm) {
                Text(note.title.isEmpty ? "Untitled Note" : note.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Spacer()
                if note.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(theme.accent)
                }
            }

            Text(note.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Empty note"
                : note.plainText)
                .font(.subheadline)
                .foregroundStyle(theme.textFaint)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 5) {
                ForEach(tags.prefix(4)) { tag in
                    Circle()
                        .fill(TagColor.color(tag.color))
                        .frame(width: 7, height: 7)
                }
                if tags.count > 4 {
                    Text("+\(tags.count - 4)")
                        .font(.caption2)
                        .foregroundStyle(theme.textGhost)
                }
                Spacer()
                Text(meta)
                    .font(.caption)
                    .foregroundStyle(theme.textGhost)
            }
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(note.isPinned ? theme.accentBorder : theme.border, lineWidth: 1)
        }
        .contentShape(.rect(cornerRadius: Radius.md))
    }

    private var meta: String {
        let relative = NoteUtils.relativeTime(note.updatedAt)
        return note.wordCount > 0 ? "\(relative)  ·  \(note.wordCount) words" : relative
    }
}

// MARK: - Create sheet

/// Create sheet shared by folders (name only) and tags (name + swatch), matching
/// `mobile/src/features/notes/components/CreateItemSheet.tsx`.
private struct CreateItemSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let kind: NotesLibraryView.CreateKind
    var onSubmit: (String, String) -> Void

    @State private var name = ""
    @State private var color = TagPalette.colors[0]
    @FocusState private var isNameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(kind == .folder ? "Folder name" : "Tag name", text: $name)
                        .focused($isNameFocused)
                        .onSubmit(submit)
                }

                if kind == .tag {
                    Section("Color") {
                        HStack(spacing: Spacing.md) {
                            ForEach(TagPalette.colors, id: \.self) { preset in
                                Button {
                                    color = preset
                                } label: {
                                    Circle()
                                        .fill(TagColor.color(preset))
                                        .frame(width: 26, height: 26)
                                        .overlay {
                                            Circle().strokeBorder(
                                                color == preset ? theme.text : .clear,
                                                lineWidth: 2
                                            )
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Tag color \(preset)")
                            }
                        }
                    }
                }

                Section {
                    Text(
                        kind == .folder
                            ? "Folders group your studies; filter by them from the list."
                            : "Tags show as coloured dots on each note."
                    )
                    .font(.footnote)
                    .foregroundStyle(theme.textGhost)
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.bg)
            .navigationTitle(kind == .folder ? "New Folder" : "New Tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: submit)
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { isNameFocused = true }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed, color)
        dismiss()
    }
}

// MARK: - Tag colours

/// Tag colours arrive as CSS hex strings (`#f59e0b`). Namespaced instead of a
/// `Color` extension so a same-named helper from another lane cannot collide
/// with it in the shared module.
enum TagColor {
    static func color(_ hexString: String, fallback: Color = .gray) -> Color {
        var text = hexString.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 {
            text = text.map { "\($0)\($0)" }.joined()
        }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return fallback }
        return Color(hex: value)
    }
}
