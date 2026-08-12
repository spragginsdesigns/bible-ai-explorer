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
        // A TextKit 1 stack, built by hand rather than taken from
        // `NSTextView.scrollableTextView()` — that returns a plain `NSTextView`
        // which would have to be swapped out from under its own text container.
        //
        // TextKit 1 specifically: the gutter markers are drawn from
        // `NSLayoutManager` geometry (see `NoteTextView`), and the TextKit 2
        // equivalent produced no usable fragment frames during `draw(_:)`.
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)

        let container = NSTextContainer(
            size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        )
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        context.coordinator.storage = storage

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
        /// The text storage owns the layout manager, and the view owns only the
        /// container — so something has to hold on to the top of the stack.
        var storage: NSTextStorage?

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
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                return controller.handleReturnOutOfEmptyListItem()
            // Tab nests a list item, matching every list editor including the
            // TenTap toolbar Android drives. Both are swallowed even when there
            // is no list to nest, because the alternative is `insertTab:`
            // putting a literal tab character into HTML the web and Android
            // clients also read — a real note picked one up during testing.
            case #selector(NSResponder.insertTab(_:)):
                _ = controller.indentListIfPossible()
                return true
            case #selector(NSResponder.insertBacktab(_:)):
                _ = controller.outdentListIfPossible()
                return true
            default:
                return false
            }
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
