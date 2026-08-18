import SwiftUI
import UIKit

/// SwiftUI wrapper around the iOS `NoteTextView` — the counterpart of the
/// macOS `NoteEditorTextView`.
///
/// The controller — not this struct — owns the document. SwiftUI would
/// otherwise want to re-push the text on every body evaluation and fight the
/// user's caret, so `updateUIView` only forwards the theme; content changes go
/// through `NoteRichTextController.load(html:)`.
struct NoteEditorTextView: UIViewRepresentable {
    @Environment(\.theme) private var theme

    let controller: NoteRichTextController

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    func makeUIView(context: Context) -> NoteTextView {
        // A TextKit 1 stack, built by hand — the gutter markers are drawn from
        // `NSLayoutManager` geometry, and the TextKit 2 equivalent produced no
        // usable fragment frames during `draw(_:)` on the Mac side (see
        // `NoteTextView`); the default TextKit 2 stack has the same problem.
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)

        let container = NSTextContainer(
            size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        )
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)

        let textView = NoteTextView(frame: .zero, textContainer: container)
        textView.backgroundColor = .clear
        textView.isEditable = true
        textView.isSelectable = true
        textView.alwaysBounceVertical = true
        textView.textContainerInset = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)
        // A note is prose, not source: keep substitutions off so what the user
        // typed is what gets stored.
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.smartInsertDeleteType = .no
        textView.autocapitalizationType = .sentences
        textView.spellCheckingType = .yes
        textView.keyboardDismissMode = .interactive
        textView.delegate = context.coordinator
        textView.theme = theme
        textView.onToggleTask = { [controller] offset in
            controller.toggleTask(atParagraphOffset: offset)
        }

        controller.textView = textView
        controller.theme = theme
        return textView
    }

    func updateUIView(_ textView: NoteTextView, context: Context) {
        if controller.textView !== textView { controller.textView = textView }
        if controller.theme != theme { controller.theme = theme }
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        private let controller: NoteRichTextController

        init(controller: NoteRichTextController) {
            self.controller = controller
        }

        func textViewDidChange(_ textView: UITextView) {
            controller.textDidChange()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            controller.selectionDidChange()
        }

        func textView(
            _ textView: UITextView,
            shouldChangeTextIn range: NSRange,
            replacementText text: String
        ) -> Bool {
            // Return on an empty list item leaves the list instead of adding a
            // blank bullet — the only way out of a list from the keyboard.
            if text == "\n", controller.handleReturnOutOfEmptyListItem() {
                return false
            }
            return true
        }

        /// A link's `.link` attribute would otherwise open Safari in place of
        /// moving the caret; taps should edit, not navigate.
        func textView(
            _ textView: UITextView,
            shouldInteractWith url: URL,
            in characterRange: NSRange,
            interaction: UITextItemInteraction
        ) -> Bool {
            false
        }
    }
}

/// Comparing palettes by three tokens is enough to tell the dark and light
/// tables apart, which is the only distinction the editor needs — it re-renders
/// when the user switches appearance and at no other time. (Same conformance
/// the macOS target declares in its own `NoteEditorTextView`.)
extension SureWordColors: Equatable {
    static func == (lhs: SureWordColors, rhs: SureWordColors) -> Bool {
        lhs.bg == rhs.bg && lhs.text == rhs.text && lhs.accent == rhs.accent
    }
}
