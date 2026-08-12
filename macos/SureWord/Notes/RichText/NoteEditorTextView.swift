import AppKit
import SwiftUI

/// SwiftUI wrapper around `NoteTextView`.
///
/// The controller — not this struct — owns the document. SwiftUI would
/// otherwise want to re-push the text on every body evaluation and fight the
/// user's caret, so `updateNSView` only forwards the theme; content changes go
/// through `NoteRichTextController.load(html:)`.
struct NoteEditorTextView: NSViewRepresentable {
    @Environment(\.theme) private var theme

    let controller: NoteRichTextController

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    func makeNSView(context: Context) -> NSScrollView {
        // The TextKit 2 stack is built by hand rather than taken from
        // `NSTextView.scrollableTextView()`, which hands back a plain
        // `NSTextView` that would then have to be swapped out from under its own
        // text container. `NSTextLayoutManager` holds its content manager
        // weakly, so the coordinator keeps the strong reference.
        let contentStorage = NSTextContentStorage()
        let layoutManager = NSTextLayoutManager()
        contentStorage.addTextLayoutManager(layoutManager)

        let container = NSTextContainer(
            size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        )
        layoutManager.textContainer = container
        context.coordinator.contentStorage = contentStorage

        let textView = NoteTextView(frame: .zero, textContainer: container)
        textView.applyDefaults()
        textView.delegate = context.coordinator
        textView.theme = theme
        textView.onToggleTask = { [controller] offset in
            controller.toggleTask(atParagraphOffset: offset)
        }

        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView

        controller.textView = textView
        controller.theme = theme
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NoteTextView else { return }
        if controller.textView !== textView { controller.textView = textView }
        if controller.theme != theme { controller.theme = theme }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        private let controller: NoteRichTextController
        /// Retained here because nothing else in the TextKit 2 stack owns it.
        var contentStorage: NSTextContentStorage?

        init(controller: NoteRichTextController) {
            self.controller = controller
        }

        func textDidChange(_ notification: Notification) {
            controller.textDidChange()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            controller.selectionDidChange()
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            if selector == #selector(NSResponder.insertNewline(_:)) {
                return controller.handleReturnOutOfEmptyListItem()
            }
            return false
        }
    }
}

/// Comparing palettes by three tokens is enough to tell the dark and light
/// tables apart, which is the only distinction the editor needs — it re-renders
/// when the user switches appearance and at no other time.
extension SureWordColors: Equatable {
    static func == (lhs: SureWordColors, rhs: SureWordColors) -> Bool {
        lhs.bg == rhs.bg && lhs.text == rhs.text && lhs.accent == rhs.accent
    }
}
