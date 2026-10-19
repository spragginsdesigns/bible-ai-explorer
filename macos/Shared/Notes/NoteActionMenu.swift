import SwiftUI

/// The one menu for a note - a port of Android's `NoteActionSheet`, shared by
/// the editor's More button and the library card's long press (right click on
/// the Mac) on both Apple apps.
///
/// Rows appear only when the caller supplies their handler, as on Android, so
/// the card menu stays Pin, Move to folder and Delete while the editor gets the
/// full set, in Android's order. Delete only asks: the caller owns the
/// "This cannot be undone" confirmation, because a menu cannot host one.
struct NoteActionMenu: View {
    let note: Note
    let folders: [Folder]
    var onTogglePin: () -> Void
    var onMoveToFolder: (String?) -> Void
    var onDelete: () -> Void
    var onOpenTags: (() -> Void)?
    var onOpenInfo: (() -> Void)?
    var onCopyMarkdown: (() -> Void)?
    var onShareMarkdown: (() -> Void)?

    var body: some View {
        Button(action: onTogglePin) {
            Label(note.isPinned ? "Unpin note" : "Pin note", systemImage: note.isPinned ? "pin.slash" : "pin")
        }

        if let onOpenTags {
            Button(action: onOpenTags) {
                Label(note.tagIds.isEmpty ? "Tags" : "Tags (\(note.tagIds.count))", systemImage: "tag")
            }
        }

        if let onOpenInfo {
            Button(action: onOpenInfo) {
                Label("Note info", systemImage: "info.circle")
            }
        }

        if let onCopyMarkdown {
            Button(action: onCopyMarkdown) {
                Label("Copy as Markdown", systemImage: "doc.on.doc")
            }
        }

        if let onShareMarkdown {
            Button(action: onShareMarkdown) {
                Label("Share as Markdown", systemImage: "square.and.arrow.up")
            }
        }

        Menu {
            Button {
                onMoveToFolder(nil)
            } label: {
                Label("No folder", systemImage: note.folderId == nil ? "checkmark" : "folder.badge.minus")
            }
            ForEach(folders) { folder in
                Button {
                    onMoveToFolder(folder.id)
                } label: {
                    Label(folder.name, systemImage: note.folderId == folder.id ? "checkmark" : "folder")
                }
            }
        } label: {
            Label("Move to folder", systemImage: "folder")
        }

        Divider()

        Button(role: .destructive, action: onDelete) {
            Label("Delete note", systemImage: "trash")
        }
    }

    /// Android's confirmation line, word for word.
    static func deletePrompt(for note: Note) -> String {
        "Delete \u{201C}\(note.title.isEmpty ? "Untitled Note" : note.title)\u{201D}? This cannot be undone."
    }
}

// MARK: - Markdown

enum NoteEditorMarkdown {
    /// The live document as Markdown, the way Android's
    /// `editorRef.getMarkdown(title)` reads the TenTap editor's JSON: what is
    /// on screen now, not the last autosave. Each target's
    /// `NoteRichTextController` exposes the same `currentDocument()`.
    @MainActor
    static func markdown(title: String, controller: NoteRichTextController) throws -> String {
        try NoteMarkdownExport.markdown(
            title: title,
            document: NoteTiptapDocument.json(from: controller.currentDocument())
        )
    }
}
