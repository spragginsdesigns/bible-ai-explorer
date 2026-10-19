import AppKit
import Foundation
import Testing
@testable import SureWord

/// `[[wikilinks]]` drawn in the Mac editor: real `NoteTextView`, real
/// controller, and the real delegate the editor uses. The links are display
/// only, so the first thing pinned is that drawing them never changes the
/// HTML an autosave writes. (The iOS suite `NoteWikilinkEditorIOSTests` makes
/// the same checks against `UITextView`.)
@Suite("Wikilinks in the editor")
@MainActor
struct NoteWikilinkEditorTests {

    private let html = "<p>See [[Romans study]] and [[Ephesians]].</p>"

    /// What `NoteEditorTextView.makeNSView` builds, with "Romans study" known.
    /// The storage tops the TextKit 1 stack and the coordinator is only held
    /// weakly by the view, so the test keeps both alive.
    private struct Editor {
        let controller: NoteRichTextController
        let textView: NoteTextView
        let storage: NSTextStorage
        let coordinator: NoteEditorTextView.Coordinator
    }

    private func makeEditor(resolving known: [String: String] = ["romans study": "a"]) -> Editor {
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(frame: NSRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        textView.applyDefaults()
        let controller = NoteRichTextController()
        controller.resolveWikilink = { known[$0.lowercased()] }
        let coordinator = NoteEditorTextView.Coordinator(controller: controller)
        textView.delegate = coordinator
        controller.textView = textView
        return Editor(controller: controller, textView: textView, storage: storage, coordinator: coordinator)
    }

    private func link(at location: Int, in editor: Editor) -> String? {
        editor.storage.attribute(NoteAttributedText.wikilinkKey, at: location, effectiveRange: nil) as? String
    }

    private func color(at location: Int, in editor: Editor) -> NSColor? {
        editor.storage.attribute(.foregroundColor, at: location, effectiveRange: nil) as? NSColor
    }

    /// A user-style deletion: AppKit's programmatic edit sequence, so the
    /// delegate (and through it the controller's pass) sees a real change.
    private func delete(_ range: NSRange, in editor: Editor) {
        guard editor.textView.shouldChangeText(in: range, replacementString: "") else { return }
        editor.storage.replaceCharacters(in: range, with: "")
        editor.textView.didChangeText()
    }

    @Test("Links are drawn on load and the saved HTML is untouched")
    func drawsWithoutChangingHTML() {
        let editor = makeEditor()
        editor.controller.load(html: html)

        // "See " is 4 characters; "[[Romans study]] and " is 21 more.
        #expect(link(at: 4, in: editor) == "a")
        #expect(link(at: 19, in: editor) == "a")
        #expect(link(at: 25, in: editor) == "")
        #expect(link(at: 0, in: editor) == nil)
        #expect(link(at: 21, in: editor) == nil)
        #expect(color(at: 4, in: editor) == NSColor(SureWordColors.dark.accent))
        #expect(color(at: 25, in: editor) == NSColor(SureWordColors.dark.textGhost))
        #expect(editor.controller.html() == html)
    }

    @Test("Breaking a link gives its characters their own styling back")
    func breakingRestoresStyling() {
        let editor = makeEditor()
        editor.controller.load(html: html)
        let bodyColor = color(at: 0, in: editor)

        // Delete the closing "]]" of the first link.
        delete(NSRange(location: 18, length: 2), in: editor)

        #expect(link(at: 4, in: editor) == nil)
        #expect(color(at: 4, in: editor) == bodyColor)
        #expect(editor.controller.html() == "<p>See [[Romans study and [[Ephesians]].</p>")
    }

    @Test("Marks inside a link survive being drawn and undrawn")
    func marksSurvive() {
        let editor = makeEditor()
        let marked = "<p><strong>[[Romans study]]</strong> rest</p>"
        editor.controller.load(html: marked)
        #expect(link(at: 0, in: editor) == "a")
        #expect(editor.controller.html() == marked)

        delete(NSRange(location: 0, length: 2), in: editor)
        #expect(link(at: 0, in: editor) == nil)
        #expect(editor.controller.html() == "<p><strong>Romans study]]</strong> rest</p>")
    }

    @Test("The picker's insert writes the link at the caret and draws it")
    func pickerInsert() {
        let editor = makeEditor()
        editor.controller.load(html: "<p>See </p>")
        editor.textView.setSelectedRange(NSRange(location: 4, length: 0))

        editor.controller.insertText(NoteWikilinks.format("Romans study"))

        #expect(editor.controller.html() == "<p>See [[Romans study]]</p>")
        #expect(link(at: 4, in: editor) == "a")
    }

    @Test("A refresh resolves a link once its note exists")
    func refreshResolves() {
        var known: [String: String] = [:]
        let editor = makeEditor()
        editor.controller.resolveWikilink = { known[$0.lowercased()] }
        editor.controller.load(html: html)
        #expect(link(at: 25, in: editor) == "")

        known["ephesians"] = "e"
        editor.controller.refreshWikilinks()
        #expect(link(at: 25, in: editor) == "e")
        #expect(editor.controller.html() == html)
    }

    @Test("Typing after a link does not carry its colour")
    func typingAttributesAreClean() {
        let editor = makeEditor()
        editor.controller.load(html: "<p>[[Romans study]]</p>")
        editor.textView.setSelectedRange(NSRange(location: 16, length: 0))
        editor.textView.typingAttributes = editor.storage.attributes(at: 15, effectiveRange: nil)
        #expect(editor.textView.typingAttributes[NoteAttributedText.wikilinkKey] != nil)

        editor.controller.refreshWikilinks()
        #expect(editor.textView.typingAttributes[NoteAttributedText.wikilinkKey] == nil)
        #expect(editor.textView.typingAttributes[NoteAttributedText.blockKey] != nil)
    }

    @Test("A click on a resolved link finds its note; beside it or past the line end does not")
    func hitTesting() throws {
        let editor = makeEditor()
        editor.controller.load(html: "<p>[[Romans study]] and [[Ephesians]]</p>")
        let layoutManager = try #require(editor.textView.layoutManager)
        let container = try #require(editor.textView.textContainer)
        layoutManager.ensureLayout(for: container)
        let origin = editor.textView.textContainerOrigin

        func centre(ofCharacter index: Int) -> NSPoint {
            let glyphs = layoutManager.glyphRange(
                forCharacterRange: NSRange(location: index, length: 1),
                actualCharacterRange: nil
            )
            let box = layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
            return NSPoint(x: box.midX + origin.x, y: box.midY + origin.y)
        }

        // "[[Romans study]]" is 0..<16, " and " 16..<21, "[[Ephesians]]" 21..<34.
        #expect(editor.textView.wikilinkNoteID(at: centre(ofCharacter: 4)) == "a")
        #expect(editor.textView.wikilinkNoteID(at: centre(ofCharacter: 18)) == nil)
        #expect(editor.textView.wikilinkNoteID(at: centre(ofCharacter: 25)) == nil)
        let line = centre(ofCharacter: 4)
        #expect(editor.textView.wikilinkNoteID(at: NSPoint(x: 316, y: line.y)) == nil)
    }
}
