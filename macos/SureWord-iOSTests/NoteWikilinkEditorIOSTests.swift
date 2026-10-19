import Foundation
import Testing
import UIKit
@testable import SureWord

/// `[[wikilinks]]` drawn in the iOS editor: real `NoteTextView`, real
/// controller. The links are display only, so the first thing pinned is that
/// drawing them never changes the HTML an autosave writes. (The macOS suite
/// `NoteWikilinkEditorTests` makes the same checks against `NSTextView`.)
@Suite("Wikilinks in the editor (iOS)")
@MainActor
struct NoteWikilinkEditorIOSTests {

    private let html = "<p>See [[Romans study]] and [[Ephesians]].</p>"

    /// The `NoteEditorTextView.makeUIView` stack, with "Romans study" known.
    private func makeEditor(resolving known: [String: String] = ["romans study": "a"])
        -> (NoteRichTextController, NoteTextView)
    {
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        let textView = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        let controller = NoteRichTextController()
        controller.resolveWikilink = { known[$0.lowercased()] }
        controller.textView = textView
        return (controller, textView)
    }

    private func link(at location: Int, in textView: NoteTextView) -> String? {
        textView.textStorage.attribute(NoteAttributedText.wikilinkKey, at: location, effectiveRange: nil) as? String
    }

    private func color(at location: Int, in textView: NoteTextView) -> UIColor? {
        textView.textStorage.attribute(.foregroundColor, at: location, effectiveRange: nil) as? UIColor
    }

    @Test("Links are drawn on load and the saved HTML is untouched")
    func drawsWithoutChangingHTML() {
        let (controller, textView) = makeEditor()
        controller.load(html: html)

        // "See " is 4 characters; "[[Romans study]] and " is 21 more.
        #expect(link(at: 4, in: textView) == "a")
        #expect(link(at: 19, in: textView) == "a")
        #expect(link(at: 25, in: textView) == "")
        #expect(link(at: 0, in: textView) == nil)
        #expect(link(at: 21, in: textView) == nil)
        #expect(color(at: 4, in: textView) == UIColor(SureWordColors.dark.accent))
        #expect(color(at: 25, in: textView) == UIColor(SureWordColors.dark.textGhost))
        #expect(controller.html() == html)
    }

    @Test("Breaking a link gives its characters their own styling back")
    func breakingRestoresStyling() {
        let (controller, textView) = makeEditor()
        controller.load(html: html)
        let bodyColor = color(at: 0, in: textView)

        // Delete the closing "]]" of the first link, the way a backspace would.
        textView.textStorage.replaceCharacters(in: NSRange(location: 18, length: 2), with: "")
        controller.textDidChange()

        #expect(link(at: 4, in: textView) == nil)
        #expect(color(at: 4, in: textView) == bodyColor)
        #expect(controller.html() == "<p>See [[Romans study and [[Ephesians]].</p>")
    }

    @Test("Marks inside a link survive being drawn and undrawn")
    func marksSurvive() {
        let (controller, textView) = makeEditor()
        let marked = "<p><strong>[[Romans study]]</strong> rest</p>"
        controller.load(html: marked)
        #expect(link(at: 0, in: textView) == "a")
        #expect(controller.html() == marked)

        textView.textStorage.replaceCharacters(in: NSRange(location: 0, length: 2), with: "")
        controller.textDidChange()
        #expect(link(at: 0, in: textView) == nil)
        #expect(controller.html() == "<p><strong>Romans study]]</strong> rest</p>")
    }

    @Test("A refresh resolves a link once its note exists")
    func refreshResolves() {
        var known: [String: String] = [:]
        let (controller, textView) = makeEditor()
        controller.resolveWikilink = { known[$0.lowercased()] }
        controller.load(html: html)
        #expect(link(at: 25, in: textView) == "")

        known["ephesians"] = "e"
        controller.refreshWikilinks()
        #expect(link(at: 25, in: textView) == "e")
        #expect(controller.html() == html)
    }

    @Test("Typing after a link does not carry its colour")
    func typingAttributesAreClean() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>[[Romans study]]</p>")
        textView.selectedRange = NSRange(location: 16, length: 0)
        textView.typingAttributes = textView.textStorage.attributes(at: 15, effectiveRange: nil)
        #expect(textView.typingAttributes[NoteAttributedText.wikilinkKey] != nil)

        controller.refreshWikilinks()
        #expect(textView.typingAttributes[NoteAttributedText.wikilinkKey] == nil)
        #expect(textView.typingAttributes[NoteAttributedText.blockKey] != nil)
    }

    @Test("A tap on a resolved link finds its note; beside it or past the line end does not")
    func hitTesting() {
        let (controller, textView) = makeEditor()
        controller.load(html: "<p>[[Romans study]] and [[Ephesians]]</p>")
        let layoutManager = textView.layoutManager
        layoutManager.ensureLayout(for: textView.textContainer)

        func centre(ofCharacter index: Int) -> CGPoint {
            let glyphs = layoutManager.glyphRange(
                forCharacterRange: NSRange(location: index, length: 1),
                actualCharacterRange: nil
            )
            let box = layoutManager.boundingRect(forGlyphRange: glyphs, in: textView.textContainer)
            return CGPoint(x: box.midX + textView.textContainerInset.left, y: box.midY + textView.textContainerInset.top)
        }

        // "[[Romans study]]" is 0..<16, " and " 16..<21, "[[Ephesians]]" 21..<34.
        #expect(textView.wikilinkNoteID(at: centre(ofCharacter: 4)) == "a")
        #expect(textView.wikilinkNoteID(at: centre(ofCharacter: 18)) == nil)
        #expect(textView.wikilinkNoteID(at: centre(ofCharacter: 25)) == nil)
        let line = centre(ofCharacter: 4)
        #expect(textView.wikilinkNoteID(at: CGPoint(x: 316, y: line.y)) == nil)
    }
}
