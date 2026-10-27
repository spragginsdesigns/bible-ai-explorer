import AppKit
import SwiftUI
import Testing
@testable import SureWord

@Suite("Bounded app text sizing")
@MainActor
struct TextSizingTests {
    @Test("Repeated adjustment stays within the shared stops and reset returns Standard")
    func bounds() {
        var size = TextScale.standard
        #expect(!size.canDecrease)
        for _ in 0..<100 { size = size.stepped(-1) }
        #expect(size == .standard)
        #expect(size.stepped(1) == .large)
        for _ in 0..<100 { size = size.stepped(1) }
        #expect(size == .largest)
        #expect(!size.canIncrease)
        #expect(size.stepped(-1) == .large)
        #expect(size.stepped(0) == .largest)
        #expect(TextScale.normalize("130") == .standard)
    }

    @Test("App stops preserve every system accessibility category")
    func independentAccessibility() {
        for size in TextScale.allCases {
            for category in DynamicTypeSize.allCases {
                #expect(size.dynamicTypeSize(over: category) == category)
            }
        }
    }

    @Test("Every note run, including headings, code and italics, scales exactly once")
    func attributedRuns() throws {
        let document = NoteHTMLParser.parse("<h1>Heading</h1><p>Plain <strong>bold</strong> <em>italic</em> <code>code</code></p><blockquote><p>Scripture</p></blockquote><ul><li><p>List</p></li></ul>")
        let standard = NoteAttributedText.attributedString(for: document, theme: .dark)
        for scale in TextScale.allCases {
            let rendered = NoteAttributedText.attributedString(for: document, theme: .dark, scale: scale.factor)
            #expect(rendered.string == standard.string)
            standard.enumerateAttribute(.font, in: NSRange(location: 0, length: standard.length)) { value, range, _ in
                guard let original = value as? NSFont, let actual = rendered.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont else {
                    Issue.record("Missing native font in a note run")
                    return
                }
                #expect(abs(actual.pointSize - original.pointSize * scale.factor) < 0.01)
            }
            standard.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: standard.length)) { value, range, _ in
                guard let original = value as? NSParagraphStyle, let actual = rendered.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle else { return }
                #expect(abs(actual.headIndent - original.headIndent * scale.factor) < 0.01)
            }
            #expect(NoteHTMLSerializer.serialize(NoteAttributedText.document(from: rendered)) == NoteHTMLSerializer.serialize(document))
        }
    }

    @Test("Pending bold at the caret survives a display-only resize")
    func pendingBold() throws {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let view = NoteTextView(frame: NSRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        view.applyDefaults()
        let controller = NoteRichTextController()
        controller.textView = view
        controller.load(html: "<p>Plain</p>")
        view.setSelectedRange(NSRange(location: 5, length: 0))
        controller.toggle(.bold)
        controller.textScale = 1.3
        #expect(controller.activeMarks.contains(.bold))
        let font = try #require(view.typingAttributes[.font] as? NSFont)
        #expect(abs(font.pointSize - NoteAttributedText.Metrics.bodySize * 1.3) < 0.01)
        #expect(controller.html() == "<p>Plain</p>")
        view.insertText("!", replacementRange: view.selectedRange())
        #expect(controller.html() == "<p>Plain<strong>!</strong></p>")
    }
}
