import SwiftUI

/// The "Add to notes" picker: create a new note from an answer, or append it to
/// one of the user's existing notes. iOS port of
/// `macos/SureWord/Chat/Views/AddToNoteSheet.swift` — same capability, sheet
/// form factor, matching Android's bottom sheet.
struct ChatAddToNoteSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let api: APIClient
    /// The assistant answer's cleaned markdown (follow-up block already stripped).
    let markdown: String
    /// Active conversation title — the default title on the create path.
    var defaultTitle: String?
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

    private var saving: Bool { pendingKey != nil }

    private var filtered: [NoteSummary] {
        AddToNote.filter(notes, query: query)
    }

    var body: some View {
        NavigationStack {
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
                    .accessibilityLabel("Create a new note with this answer")
                }

                if let saveError {
                    Section {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Text(saveError)
                                .font(.system(size: 12))
                                .foregroundStyle(theme.danger)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Retry") { retry() }
                                .font(.system(size: 12, weight: .medium))
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
                                .font(.system(size: 12))
                                .foregroundStyle(theme.textFaint)
                                .multilineTextAlignment(.center)
                            Button("Retry") { Task { await loadNotes() } }
                                .font(.system(size: 12))
                                .foregroundStyle(theme.accent)
                        }
                        .frame(maxWidth: .infinity)
                    } else if filtered.isEmpty {
                        Text(
                            notes.isEmpty
                                ? "No notes yet — start one with “New note” above."
                                : "No notes match that search."
                        )
                        .font(.system(size: 12))
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
            .navigationTitle("Add to notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await loadNotes() }
    }

    private func noteRow(_ note: NoteSummary) -> some View {
        Button {
            save(SaveTarget(key: note.id, noteId: note.id))
        } label: {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.displayTitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                    Text(note.preview)
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textFaint)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.sm)
                if pendingKey == note.id {
                    ProgressView().controlSize(.small)
                } else {
                    Text(AddToNote.relativeTime(note.updatedAt))
                        .font(.system(size: 11))
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
            do {
                let result = try await AddToNote.append(
                    api: api,
                    markdown: markdown,
                    noteId: target.noteId,
                    defaultTitle: defaultTitle
                )
                pendingKey = nil
                onSaved(result)
                dismiss()
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
