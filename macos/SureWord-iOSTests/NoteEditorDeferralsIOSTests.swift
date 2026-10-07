import Foundation
import Testing
import UIKit
@testable import SureWord

/// The three editor deferrals the iOS port shipped with, closed: toolbar
/// undo/redo over one consistent history, hardware Tab / Shift-Tab list
/// nesting, and Dynamic Type rescaling the canvas live - plus the caret
/// insert the wikilink picker relies on.
@Suite("Note editor: undo, Tab, Dynamic Type, insert (iOS)")
@MainActor
struct NoteEditorDeferralsIOSTests {

    private func makeEditor() -> (NoteRichTextController, NoteTextView, NoteEditorTextView.Coordinator) {
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        let controller = NoteRichTextController()
        controller.textView = textView
        let coordinator = NoteEditorTextView.Coordinator(controller: controller)
        return (controller, textView, coordinator)
    }

    /// What UIKit does for one keystroke: ask the delegate, apply, report.
    private func type(
        _ text: String,
        _ textView: NoteTextView,
        _ coordinator: NoteEditorTextView.Coordinator
    ) {
        let range = textView.selectedRange
        guard coordinator.textView(textView, shouldChangeTextIn: range, replacementText: text) else { return }
        textView.insertText(text)
        coordinator.textViewDidChange(textView)
    }

    // MARK: - Insert

    @Test("insertText puts a wikilink at the caret with the caret's marks, and autosaves")
    func insertsAtCaret() {
        let (controller, textView, _) = makeEditor()
        var changes = 0
        controller.onChange = { changes += 1 }
        withExtendedLifetime(textView) {
            controller.load(html: "<p>see <strong>here</strong></p>")
            textView.selectedRange = NSRange(location: 4, length: 0)
            controller.selectionDidChange()
            controller.insertText(NoteWikilinks.format("Romans|study"))
            #expect(controller.html() == "<p>see [[Romans study]]<strong>here</strong></p>")
            #expect(textView.selectedRange == NSRange(location: 20, length: 0))
            #expect(changes == 1)

            // Undoable like any edit.
            controller.undo()
            #expect(controller.html() == "<p>see <strong>here</strong></p>")
        }
    }

    @Test("insertText replaces a selection")
    func insertReplacesSelection() {
        let (controller, textView, _) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>Romans study</p>")
            textView.selectedRange = NSRange(location: 0, length: 12)
            controller.insertText("[[Romans study]]")
            #expect(controller.html() == "<p>[[Romans study]]</p>")
        }
    }

    // MARK: - Undo / redo

    @Test("Undo and redo cover typing and structural edits on one history")
    func undoRedoMixed() {
        let (controller, textView, coordinator) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>Faith</p>")
            #expect(!controller.canUndo)

            textView.selectedRange = NSRange(location: 5, length: 0)
            controller.selectionDidChange()
            type("!", textView, coordinator)
            type("!", textView, coordinator)
            #expect(controller.html() == "<p>Faith!!</p>")
            #expect(controller.canUndo)

            controller.setBlockKind(.heading(level: 1))
            #expect(controller.html() == "<h1>Faith!!</h1>")

            controller.toggleList(.bulletList)
            #expect(controller.html() == "<ul><li><h1>Faith!!</h1></li></ul>")

            controller.undo()
            #expect(controller.html() == "<h1>Faith!!</h1>")
            controller.undo()
            #expect(controller.html() == "<p>Faith!!</p>")
            // The two keystrokes were one burst: one undo removes both.
            controller.undo()
            #expect(controller.html() == "<p>Faith</p>")
            #expect(!controller.canUndo)
            #expect(controller.canRedo)

            controller.redo()
            controller.redo()
            #expect(controller.html() == "<h1>Faith!!</h1>")

            // A fresh edit drops the redo branch.
            controller.setAlignment(.center)
            #expect(!controller.canRedo)
        }
    }

    @Test("A caret move starts a new typing entry")
    func caretMoveBreaksBurst() {
        let (controller, textView, coordinator) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>ab</p>")
            textView.selectedRange = NSRange(location: 2, length: 0)
            controller.selectionDidChange()
            type("c", textView, coordinator)
            textView.selectedRange = NSRange(location: 0, length: 0)
            controller.selectionDidChange()
            type("x", textView, coordinator)
            #expect(controller.html() == "<p>xabc</p>")
            controller.undo()
            #expect(controller.html() == "<p>abc</p>")
            controller.undo()
            #expect(controller.html() == "<p>ab</p>")
        }
    }

    @Test("Undo restores an inline mark, and every undo autosaves")
    func undoInlineMark() {
        let (controller, textView, _) = makeEditor()
        var changes = 0
        withExtendedLifetime(textView) {
            controller.load(html: "<p>by grace alone</p>")
            controller.onChange = { changes += 1 }
            textView.selectedRange = NSRange(location: 3, length: 5)
            controller.toggle(.bold)
            #expect(controller.html() == "<p>by <strong>grace</strong> alone</p>")
            controller.undo()
            #expect(controller.html() == "<p>by grace alone</p>")
            #expect(changes == 2)
        }
    }

    @Test("A command that changes nothing leaves no undo step; loading clears history")
    func noOpAndLoad() {
        let (controller, textView, _) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>plain</p>")
            controller.outdentList()
            #expect(!controller.canUndo)
            controller.setBlockKind(.heading(level: 2))
            #expect(controller.canUndo)
            controller.load(html: "<p>fresh</p>")
            #expect(!controller.canUndo)
            #expect(!controller.canRedo)
        }
    }

    @Test("The text view's undo manager - Cmd-Z, swipe, shake - drives the same history")
    func systemUndoManagerRoutes() {
        let (controller, textView, _) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>Faith</p>")
            #expect(textView.undoManager === textView.noteUndoManager)
            #expect(textView.undoManager?.canUndo == false)

            controller.setBlockKind(.heading(level: 1))
            #expect(textView.undoManager?.canUndo == true)
            textView.undoManager?.undo()
            #expect(controller.html() == "<p>Faith</p>")
            #expect(textView.undoManager?.canRedo == true)

            textView.redoFromKeyboard()
            #expect(controller.html() == "<h1>Faith</h1>")
            textView.undoFromKeyboard()
            #expect(controller.html() == "<p>Faith</p>")
        }
    }

    // MARK: - Hardware Tab

    @Test("Tab and Shift-Tab are priority key commands that nest and lift list items")
    func hardwareTab() {
        let (controller, textView, _) = makeEditor()
        withExtendedLifetime(textView) {
            let commands = textView.keyCommands ?? []
            let tab = commands.first { $0.input == "\t" && $0.modifierFlags.isEmpty }
            let backtab = commands.first { $0.input == "\t" && $0.modifierFlags == .shift }
            #expect(tab?.wantsPriorityOverSystemBehavior == true)
            #expect(backtab?.wantsPriorityOverSystemBehavior == true)
            #expect(tab?.action == #selector(NoteTextView.indentFromKeyboard))
            #expect(backtab?.action == #selector(NoteTextView.outdentFromKeyboard))

            controller.load(html: "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
            textView.selectedRange = NSRange(location: 2, length: 0)
            controller.selectionDidChange()

            textView.indentFromKeyboard()
            #expect(controller.html() == "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>")
            textView.outdentFromKeyboard()
            #expect(controller.html() == "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
        }
    }

    @Test("A Tab that reaches text input never writes a literal tab")
    func tabNeverInserted() {
        let (controller, textView, coordinator) = makeEditor()
        withExtendedLifetime(textView) {
            controller.load(html: "<p>plain</p>")
            textView.selectedRange = NSRange(location: 5, length: 0)
            controller.selectionDidChange()
            let allowed = coordinator.textView(
                textView,
                shouldChangeTextIn: textView.selectedRange,
                replacementText: "\t"
            )
            #expect(!allowed)
            #expect(controller.html() == "<p>plain</p>")

            // Inside a list it nests instead.
            controller.load(html: "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
            textView.selectedRange = NSRange(location: 2, length: 0)
            controller.selectionDidChange()
            _ = coordinator.textView(textView, shouldChangeTextIn: textView.selectedRange, replacementText: "\t")
            #expect(controller.html() == "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>")
        }
    }

    // MARK: - Dynamic Type

    private func bodyFontSize(_ textView: NoteTextView, at location: Int = 0) -> CGFloat? {
        (textView.textStorage.attribute(.font, at: location, effectiveRange: nil) as? UIFont)?.pointSize
    }

    @Test("A content size change rescales the canvas live, without saving or an undo step")
    func dynamicTypeRescales() {
        let (controller, textView, _) = makeEditor()
        var changes = 0
        withExtendedLifetime(textView) {
            controller.load(html: "<h1>Title</h1><p>Body</p>")
            controller.onChange = { changes += 1 }
            #expect(bodyFontSize(textView, at: 6) == NoteAttributedText.Metrics.bodySize)

            textView.traitOverrides.preferredContentSizeCategory = .accessibilityExtraLarge
            // Trait changes are delivered on the next trait update; the app
            // gets that from layout, the test asks for it.
            textView.updateTraitsIfNeeded()
            controller.contentSizeCategoryDidChange()

            let expected = NoteAttributedText.Metrics.textScale(
                for: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraLarge)
            )
            #expect(expected > 1.5)
            #expect(abs(controller.textScale - expected) < 0.001)
            #expect(textView.textScale == controller.textScale)
            let body = bodyFontSize(textView, at: 6) ?? 0
            #expect(abs(body - NoteAttributedText.Metrics.bodySize * expected) < 0.01)
            let heading = bodyFontSize(textView, at: 0) ?? 0
            #expect(abs(heading - NoteAttributedText.Metrics.headingSize(1, scale: expected)) < 0.01)

            // A restyle, not an edit: same HTML, no autosave, nothing to undo.
            #expect(controller.html() == "<h1>Title</h1><p>Body</p>")
            #expect(changes == 0)
            #expect(!controller.canUndo)

            // New text typed afterwards uses the new size too.
            textView.selectedRange = NSRange(location: 10, length: 0)
            controller.selectionDidChange()
            let typing = (textView.typingAttributes[.font] as? UIFont)?.pointSize ?? 0
            #expect(abs(typing - NoteAttributedText.Metrics.bodySize * expected) < 0.01)
        }
    }

    @Test("The text view reports content size changes to the controller")
    func traitRegistration() {
        let (controller, textView, _) = makeEditor()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        window.addSubview(textView)
        window.makeKeyAndVisible()
        withExtendedLifetime(window) {
            controller.load(html: "<p>Body</p>")
            textView.traitOverrides.preferredContentSizeCategory = .extraExtraExtraLarge
            textView.updateTraitsIfNeeded()
            window.layoutIfNeeded()
            #expect(controller.textScale > 1)
        }
    }
}
