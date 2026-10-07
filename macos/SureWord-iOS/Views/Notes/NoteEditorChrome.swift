import SwiftUI
import UIKit

/// Pieces of the note editor's chrome (PRD E2) that are not the editing
/// surface: the Markdown export and the share sheet it feeds. Kept out of
/// `NoteEditorView` so that file stays about the editor body. Note info is
/// the notes lane's `NoteInfoSheet`, opened from the same menu.

// MARK: - Markdown

enum NoteEditorMarkdown {
    /// The live document as Markdown, the way Android's
    /// `editorRef.getMarkdown(title)` reads the TenTap editor's JSON: what is
    /// on screen now, not the last autosave.
    @MainActor
    static func markdown(title: String, controller: NoteRichTextController) throws -> String {
        try NoteMarkdownExport.markdown(
            title: title,
            document: NoteTiptapDocument.json(from: controller.currentDocument())
        )
    }
}

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
