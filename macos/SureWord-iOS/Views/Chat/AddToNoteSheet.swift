import SwiftUI

/// The "Add to notes" picker: create a new note from an answer or a verse, or
/// append it to one of the user's existing notes. iOS port of
/// `macos/SureWord/Chat/Views/AddToNoteSheet.swift` - same capability, sheet
/// form factor, matching Android's bottom sheet.
struct ChatAddToNoteSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let api: APIClient
    /// The assistant answer's cleaned markdown (follow-up block already
    /// stripped), or a verse blockquote (`VerseNoteMarkdown`).
    let markdown: String
    /// Active conversation title or verse reference - the default title on the
    /// create path.
    var defaultTitle: String?
    /// False stores pre-formatted Scripture verbatim; true (an answer) has the
    /// model compose it into a study note first, which needs AI consent.
    var compose = true
    /// Set by the reader: a save then stays on the sheet as Android's success
    /// row, which opens the note. Chat leaves it nil and closes on save.
    var onOpenNote: ((String) -> Void)?
    var onSaved: (AppendToNoteResult) -> Void

    /// Which row is in flight: the "New note" row, or a note's id.
    private static let newNoteKey = "new"

    /// Where a tap is aimed: the "New note" row (`noteId == nil`) or a note.
    private struct SaveTarget: Equatable {
        var key: String
        var noteId: String?
    }

    @State private var notes: [NoteSummary] = []
    @State private var listLoading = true
    @State private var listError: String?
    @State private var query = ""
    @State private var pendingKey: String?
    @State private var saveError: String?
    @State private var lastTarget: SaveTarget?
    @State private var saved: AppendToNoteResult?

    private var saving: Bool { pendingKey != nil }

    private var filtered: [NoteSummary] {
        AddToNote.filter(notes, query: query)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let saved, let onOpenNote {
                    savedView(saved, onOpenNote: onOpenNote)
                } else {
                    picker
                }
            }
            .navigationTitle("Add to notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saved == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await loadNotes() }
    }

    /// Android's success row: "Created" or "Added to" the note, a tap away.
    private func savedView(_ saved: AppendToNoteResult, onOpenNote: @escaping (String) -> Void) -> some View {
        List {
            Section {
                Button {
                    dismiss()
                    onOpenNote(saved.noteId)
                } label: {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "checkmark")
                            .foregroundStyle(theme.accent)
                        (Text(saved.created ? "Created " : "Added to ")
                            .foregroundStyle(theme.textSecondary)
                            + Text(saved.noteTitle)
                            .foregroundStyle(theme.accent)
                            .fontWeight(.semibold))
                            .appFont(.system(size: 14))
                            .lineLimit(2)
                        Spacer(minLength: Spacing.sm)
                        Image(systemName: "chevron.right")
                            .appFont(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.accent)
                    }
                    .contentShape(.rect)
                }
                .accessibilityLabel("Open note \(saved.noteTitle)")
                .listRowBackground(theme.accentSoft)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
    }

    private var picker: some View {
        List {
            Section {
                Button {
                    save(SaveTarget(key: Self.newNoteKey, noteId: nil))
                } label: {
                    HStack(spacing: Spacing.sm) {
                        if pendingKey == Self.newNoteKey {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "plus")
                        }
                        Text("New note")
                    }
                    .foregroundStyle(theme.accent)
                }
                .disabled(saving)
                .accessibilityLabel(compose ? "Create a new note with this answer" : "Create a new note with this verse")
            }

            if let saveError {
                Section {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(saveError)
                            .appFont(.system(size: 12))
                            .foregroundStyle(theme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Retry") { retry() }
                            .appFont(.system(size: 12, weight: .medium))
                            .foregroundStyle(theme.danger)
                            .disabled(saving)
                    }
                }
            }

            Section {
                if listLoading {
                    HStack {
                        Spacer()
                        ProgressView().controlSize(.small)
                        Spacer()
                    }
                } else if let listError {
                    VStack(spacing: Spacing.sm) {
                        Text(listError)
                            .appFont(.system(size: 12))
                            .foregroundStyle(theme.textFaint)
                            .multilineTextAlignment(.center)
                        Button("Retry") { Task { await loadNotes() } }
                            .appFont(.system(size: 12))
                            .foregroundStyle(theme.accent)
                    }
                    .frame(maxWidth: .infinity)
                } else if filtered.isEmpty {
                    Text(
                        notes.isEmpty
                            ? "No notes yet — start one with “New note” above."
                            : "No notes match that search."
                    )
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textFaint)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                } else {
                    ForEach(filtered) { note in
                        noteRow(note)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bgElevated)
        .searchable(text: $query, prompt: "Search your notes")
    }

    private func noteRow(_ note: NoteSummary) -> some View {
        Button {
            save(SaveTarget(key: note.id, noteId: note.id))
        } label: {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.displayTitle)
                        .appFont(.system(size: 13, weight: .medium))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                    Text(note.preview)
                        .appFont(.system(size: 11.5))
                        .foregroundStyle(theme.textFaint)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.sm)
                if pendingKey == note.id {
                    ProgressView().controlSize(.small)
                } else {
                    Text(AddToNote.relativeTime(note.updatedAt))
                        .appFont(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }
            }
            .contentShape(.rect)
        }
        .disabled(saving)
        .opacity(saving && pendingKey != note.id ? 0.5 : 1)
        .accessibilityLabel("Append to \(note.displayTitle)")
    }

    // MARK: Behavior

    private func loadNotes() async {
        listLoading = true
        listError = nil
        do {
            notes = try await AddToNote.notes(api: api)
        } catch {
            listError = (error as? APIError)?.message ?? "Could not load your notes."
        }
        listLoading = false
    }

    private func save(_ target: SaveTarget) {
        guard pendingKey == nil else { return }
        lastTarget = target
        pendingKey = target.key
        saveError = nil

        Task {
            // An answer is composed into a study note with the model
            // (`/api/notes/append`, compose on), so it waits on AI consent. A
            // verse is stored verbatim, with no model involved, as on Android.
            if compose {
                guard await AIConsentGate.ensure() else {
                    pendingKey = nil
                    return
                }
            }
            do {
                let result = try await AddToNote.append(
                    api: api,
                    markdown: markdown,
                    noteId: target.noteId,
                    defaultTitle: defaultTitle,
                    compose: compose
                )
                pendingKey = nil
                onSaved(result)
                if onOpenNote == nil {
                    dismiss()
                } else {
                    saved = result
                }
            } catch {
                saveError = (error as? APIError)?.message ?? "Could not save to the note."
                pendingKey = nil
            }
        }
    }

    private func retry() {
        guard let lastTarget else { return }
        save(lastTarget)
    }
}
