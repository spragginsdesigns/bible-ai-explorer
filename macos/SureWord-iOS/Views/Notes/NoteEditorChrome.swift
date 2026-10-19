import SwiftUI
import UIKit

/// Pieces of the note editor's chrome (PRD E2) that are not the editing
/// surface: the share sheet the Markdown export feeds. Kept out of
/// `NoteEditorView` so that file stays about the editor body. The menu and
/// the export itself are shared with the Mac (`Shared/Notes/NoteActionMenu.swift`);
/// Note info is the notes lane's `NoteInfoSheet`, opened from the same menu.

/// `Share.share({ message })` on Android: the system share sheet with the
/// Markdown as text.
struct NoteMarkdownShareSheet: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Identifiable wrapper so the share sheet can be driven by `.sheet(item:)`.
struct NoteShareText: Identifiable {
    let id = UUID()
    let text: String
}
