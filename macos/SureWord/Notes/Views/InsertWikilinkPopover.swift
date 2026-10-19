import SwiftUI

/// Note picker for inserting a `[[wikilink]]` on the Mac - a port of
/// `mobile/src/features/notes/components/InsertWikilinkSheet.tsx` and of the
/// iOS `InsertWikilinkSheet`, as a popover off the formatting bar the way the
/// web's toolbar button opens one.
///
/// Reads the cached library rather than the network so it opens instantly,
/// and offers the typed text as a target of its own: a link may point at a
/// note that does not exist yet, and the server resolves it the moment one is
/// created with that title.
struct InsertWikilinkPopover: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let currentNoteID: String
    /// Receives the bare target title; the caller formats and inserts it.
    let onSelect: (String) -> Void

    @State private var query = ""
    @State private var debouncedQuery = ""
    @FocusState private var isSearchFocused: Bool

    /// Android's debounce, so every client filters on the same rhythm.
    private static let searchDebounce: Duration = .milliseconds(300)

    private var notes: [Note] { NotesStore.shared.notes }

    private var matches: [Note] {
        NoteWikilinks.sortedByRecentlyUpdated(
            NoteWikilinks.filterNotesForLinking(notes, query: debouncedQuery, excludeID: currentNoteID)
        )
    }

    private var newTarget: String { NoteWikilinks.sanitizeTarget(debouncedQuery) }

    private var offersNewTarget: Bool {
        !newTarget.isEmpty
            && !NoteWikilinks.hasExactTarget(notes, query: debouncedQuery, excludeID: currentNoteID)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Link a note")
                .font(.system(size: 12, weight: .semibold))

            TextField("Search notes to link", text: $query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .focused($isSearchFocused)
                // Return takes the top row: the new title when one is offered,
                // otherwise the best match.
                .onSubmit {
                    if offersNewTarget {
                        select(newTarget)
                    } else if let first = matches.first {
                        select(title(of: first))
                    }
                }

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.sm) {
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
                                Spacer(minLength: 0)
                            }
                            .font(.system(size: 13))
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.accentBorder, lineWidth: 1)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Link to \(newTarget)")
                    }

                    if matches.isEmpty {
                        Text(
                            notes.count <= 1
                                ? "No other notes yet. Type a title above to link ahead of time."
                                : "No notes match that search."
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xl)
                    } else {
                        ForEach(matches) { note in
                            let title = title(of: note)
                            Button {
                                select(title)
                            } label: {
                                HStack(spacing: Spacing.md) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(title)
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(theme.textSecondary)
                                            .lineLimit(1)
                                        Text(NoteUtils.relativeTime(note.updatedAt))
                                            .font(.system(size: 11))
                                            .foregroundStyle(theme.textGhost)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "link")
                                        .font(.system(size: 11))
                                        .foregroundStyle(theme.textGhost)
                                }
                                .padding(.horizontal, Spacing.md)
                                .padding(.vertical, Spacing.sm)
                                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Link to \(title)")
                        }
                    }
                }
            }
            .frame(maxHeight: 320)
        }
        .padding(Spacing.lg)
        .frame(width: 300)
        .task(id: query) {
            // An empty query applies at once, so clearing the field never lags
            // behind the list.
            if !query.isEmpty {
                try? await Task.sleep(for: Self.searchDebounce)
                guard !Task.isCancelled else { return }
            }
            debouncedQuery = query
        }
        .onAppear { isSearchFocused = true }
    }

    private func title(of note: Note) -> String {
        note.title.isEmpty ? "Untitled Note" : note.title
    }

    private func select(_ title: String) {
        onSelect(title)
        dismiss()
    }
}
