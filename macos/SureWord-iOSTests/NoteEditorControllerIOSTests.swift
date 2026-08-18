import Foundation
import Testing
import UIKit
@testable import SureWord

/// The iOS editing surface end to end: real `NoteTextView`, real controller,
/// HTML in and HTML out.
///
/// This is the lane's core guarantee — the parser/serializer suites prove the
/// shared model is lossless, but they never touch the text view. These do:
/// they pin that loading a note into the `UITextView` stack and serialising
/// it back (which is what every autosave does) neither clobbers markup the
/// editor has no UI for, nor drifts on an untouched document.
@Suite("Note editor controller (iOS)")
@MainActor
struct NoteEditorControllerIOSTests {

    /// Builds the same TextKit 1 stack `NoteEditorTextView.makeUIView` builds.
    private func makeEditor() -> (NoteRichTextController, NoteTextView) {
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(
            size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude)
        )
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)

        let textView = NoteTextView(
            frame: CGRect(x: 0, y: 0, width: 320, height: 480),
            textContainer: container
        )
        let controller = NoteRichTextController()
        controller.textView = textView
        return (controller, textView)
    }

    // MARK: - Round trip through the live text view

    @Test(
        "HTML survives load and serialize through the UITextView",
        arguments: [
            "<h1>Title</h1><p>Body with <strong>bold</strong> and <em>italic</em>.</p>",
            "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
            "<ol><li><p>first</p></li></ol>",
            "<blockquote><p>quoted</p></blockquote><p>after</p>",
            "<pre><code class=\"language-text\">a\nb</code></pre>",
            #"<p><a href="https://sureword.app">link</a></p>"#,
            "<p><mark>highlighted</mark> and <code>code</code></p>",
            #"<p style="text-align: center">centred</p>"#,
            #"<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>"#,
            "<p>a</p><hr><p>b</p>",
            "<ul><li><p>Old</p><ul><li><p>New</p></li></ul></li></ul>",
            // Markup the editor cannot produce must still survive a save.
            #"<p><span class="verse-ref">John 3:16</span></p>"#,
        ]
    )
    func roundTripsThroughTextView(html: String) {
        // `textView` must stay bound: the controller holds it weakly, so
        // discarding it (as `let (controller, _)` would) deallocates the view
        // and `load` parks the document as pending instead of rendering it.
        let (controller, textView) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: html)
            #expect(controller.hasLoadedDocument)
            #expect(controller.html() == html)
        }
    }

    @Test("HTML loaded before the view attaches is held, not dropped")
    func pendingHTMLWaitsForTheView() {
        let controller = NoteRichTextController()
        controller.load(html: "<p>early</p>")
        // No text view yet: the document is pending and must not read as loaded.
        #expect(!controller.hasLoadedDocument)

        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(
            size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude)
        )
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(
            frame: CGRect(x: 0, y: 0, width: 320, height: 480),
            textContainer: container
        )
        controller.textView = textView

        #expect(controller.hasLoadedDocument)
        #expect(controller.html() == "<p>early</p>")
    }

    // MARK: - Formatting commands

    @Test("Toggling bold over a selection writes <strong>")
    func toggleBoldOnSelection() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>by grace alone</p>")

        textView.selectedRange = NSRange(location: 3, length: 5)
        controller.toggle(.bold)

        #expect(controller.html() == "<p>by <strong>grace</strong> alone</p>")
        #expect(controller.activeMarks.contains(.bold))

        // Toggling again over the same range removes the mark.
        textView.selectedRange = NSRange(location: 3, length: 5)
        controller.toggle(.bold)
        #expect(controller.html() == "<p>by grace alone</p>")
    }

    @Test("Toggling italic at the caret sets typing attributes")
    func toggleItalicAtCaret() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>word</p>")

        textView.selectedRange = NSRange(location: 4, length: 0)
        controller.toggle(.italic)
        #expect(controller.activeMarks.contains(.italic))

        // What the user types next carries the mark.
        textView.insertText("!")
        #expect(controller.html() == "<p>word<em>!</em></p>")
    }

    @Test("Heading command rewrites the block tag")
    func headingBlock() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>Faith</p>")

        textView.selectedRange = NSRange(location: 0, length: 0)
        controller.setBlockKind(.heading(level: 2))
        #expect(controller.html() == "<h2>Faith</h2>")
        #expect(controller.activeBlock.headingLevel == 2)

        // Same command again toggles back to a paragraph.
        controller.setBlockKind(.heading(level: 2))
        #expect(controller.html() == "<p>Faith</p>")
    }

    @Test("Bullet list wraps the selected paragraphs in one list")
    func bulletListWrapsSelection() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>a</p><p>b</p>")

        textView.selectedRange = NSRange(location: 0, length: 3)
        controller.toggleList(.bulletList)
        #expect(controller.html() == "<ul><li><p>a</p></li><li><p>b</p></li></ul>")

        // And toggles back off.
        controller.toggleList(.bulletList)
        #expect(controller.html() == "<p>a</p><p>b</p>")
    }

    @Test("Blockquote wraps and unwraps the caret's block")
    func blockquoteToggles() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>quoted</p>")

        textView.selectedRange = NSRange(location: 0, length: 0)
        controller.toggleBlockquote()
        #expect(controller.html() == "<blockquote><p>quoted</p></blockquote>")
        #expect(controller.activeBlock.isInBlockquote)

        controller.toggleBlockquote()
        #expect(controller.html() == "<p>quoted</p>")
    }

    @Test("Indent and outdent move the caret's list item")
    func indentThroughController() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<ul><li><p>a</p></li><li><p>b</p></li></ul>")

        // Caret on the second item. There is no delegate attached in the test
        // harness, so the selection change is reported by hand — in the app the
        // coordinator's `textViewDidChangeSelection` makes this call.
        textView.selectedRange = NSRange(location: 2, length: 0)
        controller.selectionDidChange()
        #expect(controller.canIndentList)
        controller.indentList()
        #expect(controller.html() == "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>")

        controller.outdentList()
        #expect(controller.html() == "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
    }

    @Test("Return on an empty list item leaves the list")
    func returnLeavesEmptyListItem() {
        // A lone `<li></li>` parses to a document with no characters at all,
        // and an empty storage has nothing to carry the list-item attribute —
        // the real-world case is a trailing item the user just emptied, which
        // still owns its paragraph break. That is what this models.
        let (controller, textView) = makeEditor()
        controller.load(html: "<ul><li><p>a</p></li><li></li></ul>")

        // Caret in the empty second item. No delegate is attached in the test
        // harness, so report the selection change by hand — in the app the
        // coordinator's `textViewDidChangeSelection` makes this call, and the
        // controller's typing-attribute restore is what reattaches the empty
        // item's block context to the caret.
        textView.selectedRange = NSRange(location: 2, length: 0)
        controller.selectionDidChange()
        #expect(controller.handleReturnOutOfEmptyListItem())
        #expect(controller.currentDocument().blocks[1].listItemContainer == nil)
    }

    /// The restore in `selectionDidChange` exists for this: UITextView strips
    /// the private mark keys when it recomputes typing attributes on a caret
    /// move, and without the restore this keystroke would render bold but
    /// serialise without the `<strong>`.
    @Test("Typing after moving the caret into bold text keeps the mark")
    func typingInBoldKeepsMark() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>by <strong>grace</strong> alone</p>")

        // Caret at the end of the bold run ("grace" spans 3..<8).
        textView.selectedRange = NSRange(location: 8, length: 0)
        controller.selectionDidChange()
        textView.insertText("!")

        #expect(controller.html() == "<p>by <strong>grace!</strong> alone</p>")
    }

    @Test("Edits fire onChange so the editor model can schedule its autosave")
    func editsNotify() {
        let (controller, textView) = makeEditor()
        var fired = 0
        controller.onChange = { fired += 1 }
        controller.load(html: "<p>by grace alone</p>")
        #expect(fired == 0)

        textView.selectedRange = NSRange(location: 3, length: 5)
        controller.toggle(.bold)
        #expect(fired == 1)
    }
}
