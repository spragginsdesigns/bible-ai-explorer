import SwiftUI

/// Note picker for inserting a `[[wikilink]]` - a port of
/// `mobile/src/features/notes/components/InsertWikilinkSheet.tsx`.
///
/// Reads the cached library rather than the network so the sheet opens
/// instantly, and offers the typed text as a target of its own: a link may
/// point at a note that does not exist yet, and the server resolves it the
/// moment one is created with that title.
struct InsertWikilinkSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let currentNoteID: String
    /// Receives the bare target title; the caller formats and inserts it.
    let onSelect: (String) -> Void

    @State private var query = ""
    @State private var debouncedQuery = ""
    @FocusState private var isSearchFocused: Bool

    /// Android's debounce, so both phones filter on the same rhythm.
    private static let searchDebounce: Duration = .milliseconds(300)

    private var notes: [Note] { NotesStore.shared.notes }

    private var matches: [Note] {
        NoteWikilinks.filterNotesForLinking(notes, query: debouncedQuery, excludeID: currentNoteID)
            .sorted {
                (NoteUtils.parseISO($0.updatedAt) ?? .distantPast)
                    > (NoteUtils.parseISO($1.updatedAt) ?? .distantPast)
            }
    }

    private var newTarget: String { NoteWikilinks.sanitizeTarget(debouncedQuery) }

    private var offersNewTarget: Bool {
        !newTarget.isEmpty
            && !NoteWikilinks.hasExactTarget(notes, query: debouncedQuery, excludeID: currentNoteID)
    }

    var body: some View {
        NavigationStack {
            List {
                if offersNewTarget {
                    Button {
                        select(newTarget)
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: "plus")
                                .foregroundStyle(theme.accent)
                            Text("Link to: \(Text(newTarget).foregroundStyle(theme.accent).fontWeight(.semibold))")
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                        }
                        .padding(.vertical, Spacing.xs)
                    }
                    .accessibilityLabel("Link to \(newTarget)")
                    .listRowBackground(theme.accentSoft)
                }

                if matches.isEmpty {
                    Text(
                        notes.count <= 1
                            ? "No other notes yet. Type a title above to link ahead of time."
                            : "No notes match that search."
                    )
                    .font(.footnote)
                    .foregroundStyle(theme.textFaint)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, Spacing.xl)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(matches) { note in
                        let title = note.title.isEmpty ? "Untitled Note" : note.title
                        Button {
                            select(title)
                        } label: {
                            HStack(spacing: Spacing.md) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(title)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(theme.textSecondary)
                                        .lineLimit(1)
                                    Text(NoteUtils.relativeTime(note.updatedAt))
                                        .font(.caption)
                                        .foregroundStyle(theme.textGhost)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "link")
                                    .font(.footnote)
                                    .foregroundStyle(theme.textGhost)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Link to \(title)")
                        .listRowBackground(theme.surface)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search notes to link"
            )
            .searchFocused($isSearchFocused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .navigationTitle("Link a note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task(id: query) {
                // An empty query applies at once, so clearing the field never
                // lags behind the list.
                if !query.isEmpty {
                    try? await Task.sleep(for: Self.searchDebounce)
                    guard !Task.isCancelled else { return }
                }
                debouncedQuery = query
            }
            .onAppear { isSearchFocused = true }
        }
        .presentationDetents([.fraction(0.7), .large])
        .presentationDragIndicator(.visible)
    }

    private func select(_ title: String) {
        onSelect(title)
        dismiss()
    }
}
