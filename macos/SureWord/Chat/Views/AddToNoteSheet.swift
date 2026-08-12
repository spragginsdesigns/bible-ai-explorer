import SwiftUI

/// The "Add to notes" picker: create a new note from an answer, or append it to
/// one of the user's existing notes. Port of
/// `mobile/src/features/chat/AddToNoteSheet.tsx` (a bottom sheet there, a sheet
/// here — same capability, Mac form factor).
struct AddToNoteSheet: View {
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

    /// Where a click is aimed: the "New note" row (`noteId == nil`) or a note.
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
        VStack(alignment: .leading, spacing: Spacing.md) {
            header
            newNoteButton
            searchField
            if let saveError { errorBar(saveError) }
            list
        }
        .padding(Spacing.lg)
        .frame(width: 420, height: 480)
        .background(theme.bgElevated)
        .task { await loadNotes() }
    }

    // MARK: Pieces

    private var header: some View {
        HStack {
            Label("Add to notes", systemImage: "square.and.pencil")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.accent)
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
            }
            .buttonStyle(SubtleButtonStyle())
            .accessibilityLabel("Close")
        }
    }

    private var newNoteButton: some View {
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
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AccentButtonStyle())
        .disabled(saving)
        .accessibilityLabel("Create a new note with this answer")
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(theme.textGhost)
            TextField("Search your notes", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(theme.text)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1)
        }
    }

    private func errorBar(_ message: String) -> some View {
        HStack(spacing: Spacing.md) {
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button("Retry") { retry() }
                .buttonStyle(SubtleButtonStyle())
                .foregroundStyle(theme.danger)
                .font(.system(size: 12, weight: .medium))
                .disabled(saving)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.dangerBorder, lineWidth: 1)
        }
    }

    @ViewBuilder
    private var list: some View {
        if listLoading {
            centered { ProgressView().controlSize(.small) }
        } else if let listError {
            centered {
                VStack(spacing: Spacing.sm) {
                    Text(listError)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await loadNotes() } }
                        .buttonStyle(SubtleButtonStyle())
                        .font(.system(size: 12))
                        .foregroundStyle(theme.accent)
                }
            }
        } else if filtered.isEmpty {
            centered {
                Text(
                    notes.isEmpty
                        ? "No notes yet — start one with “New note” above."
                        : "No notes match that search."
                )
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
                .multilineTextAlignment(.center)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: Spacing.xs) {
                    ForEach(filtered) { note in
                        noteRow(note)
                    }
                }
            }
        }
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
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(SubtleButtonStyle())
        .disabled(saving)
        .opacity(saving && pendingKey != note.id ? 0.5 : 1)
        .accessibilityLabel("Append to \(note.displayTitle)")
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().frame(maxWidth: .infinity, maxHeight: .infinity)
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
