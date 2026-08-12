import SwiftUI

/// The Notes pane: library on the left, editor on the right.
///
/// Android pushes `/notes` → `/notes/[id]` as two screens; a Mac window has
/// room for both at once, so the same two states sit side by side. Every
/// capability the Android screens have is reachable here — the form factor
/// changes, the feature set does not.
struct NotesSection: View {
    @Environment(\.theme) private var theme
    let api: APIClient

    @State private var library: NotesLibraryModel?

    var body: some View {
        ZStack {
            MeshBackground()
            if let library {
                content(library)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task {
            guard library == nil else { return }
            let model = NotesLibraryModel(api: NotesAPI(api: api))
            library = model
            await model.start()
        }
    }

    @ViewBuilder
    private func content(_ library: NotesLibraryModel) -> some View {
        HStack(spacing: 0) {
            NotesListPane(library: library)
                .frame(width: 320)
            Divider().overlay(theme.border)

            if let noteID = library.selectedNoteID {
                NoteEditorPane(noteID: noteID, api: api, library: library)
                    // A fresh editor per note: the model seeds its document once
                    // and owns an autosave timer, so reusing it across notes
                    // would write one note's text into another.
                    .id(noteID)
            } else {
                emptyDetail
            }
        }
    }

    private var emptyDetail: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "note.text")
                .font(.system(size: 30))
                .foregroundStyle(theme.textGhost)
            Text("Select a note")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            // ⌘N is already "New chat" in the app menu, so notes take ⇧⌘N.
            Text("Or press ⇧⌘N to start a new Bible study note.")
                .font(.system(size: 12.5))
                .foregroundStyle(theme.textGhost)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Shared helpers

extension Color {
    /// Tag colours arrive as CSS hex strings (`#f59e0b`).
    init(hexString: String, fallback: Color = .gray) {
        var text = hexString.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 {
            text = text.map { "\($0)\($0)" }.joined()
        }
        guard text.count == 6, let value = UInt32(text, radix: 16) else {
            self = fallback
            return
        }
        self.init(hex: value)
    }
}
