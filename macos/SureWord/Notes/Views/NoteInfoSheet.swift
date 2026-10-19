import SwiftUI

/// Note info on the Mac, from the note menu - the read-only stats of Android's
/// `NoteInfoSheet` (`mobile/src/features/notes/components/NoteInfoSheet.tsx`)
/// and of the iOS sheet of the same name: created, updated, words and folder.
/// Aliases, custom properties and the wikilink graph are not on the Mac yet
/// (`docs/PARITY.md`); they belong in this sheet when they come.
struct NoteInfoSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    let model: NoteEditorModel
    let folderName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Note info")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            if let note = model.note {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Properties")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textFaint)
                    stat("Created", NoteUtils.relativeTime(note.createdAt))
                    stat("Updated", NoteUtils.relativeTime(note.updatedAt))
                    stat("Words", String(note.wordCount))
                    stat("Folder", folderName ?? "None")
                }
            }

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(Spacing.xl)
        .frame(width: 340)
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
        .font(.system(size: 13))
    }
}
