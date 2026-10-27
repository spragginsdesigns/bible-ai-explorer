import SwiftUI
import Testing
import UIKit
@testable import SureWord

@Suite("Bounded app text sizing (iOS)")
@MainActor
struct TextSizingTests {
    @Test("Repeated adjustment stays within shared stops")
    func bounds() {
        var size = TextScale.standard
        for _ in 0..<100 { size = size.stepped(-1) }
        #expect(size == .standard)
        #expect(!size.canDecrease)
        #expect(size.stepped(1) == .large)
        for _ in 0..<100 { size = size.stepped(1) }
        #expect(size == .largest)
        #expect(!size.canIncrease)
        #expect(size.stepped(-1) == .large)
        #expect(TextScale.normalize("NaN") == .standard)
        for scale in TextScale.allCases {
            for category in DynamicTypeSize.allCases {
                #expect(scale.dynamicTypeSize(over: category) == category)
            }
        }
    }

    @Test("Native editor resizes live without changing HTML, caret or undo history")
    func liveEditor() throws {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let view = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        let controller = NoteRichTextController()
        controller.textView = view
        controller.load(html: "<p>Plain <strong>bold</strong> <code>code</code></p>")
        let html = controller.html()
        let originalScale = controller.textScale
        let originalSize = try #require(storage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont).pointSize
        view.selectedRange = NSRange(location: 3, length: 2)
        var edits = 0
        controller.onChange = { edits += 1 }
        controller.appTextScale = TextScale.largest.factor
        #expect(abs(controller.textScale - originalScale * 1.3) < 0.001)
        #expect(abs(try #require(storage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont).pointSize - originalSize * 1.3) < 0.01)
        #expect(view.selectedRange == NSRange(location: 3, length: 2))
        #expect(controller.html() == html)
        #expect(edits == 0)
        #expect(!controller.canUndo)
        controller.appTextScale = 1
        #expect(abs(try #require(storage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont).pointSize - originalSize) < 0.01)
    }

    @Test("Pending bold survives changing the app text size before typing")
    func pendingBold() throws {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        layout.addTextContainer(container)
        let view = NoteTextView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), textContainer: container)
        let controller = NoteRichTextController()
        controller.textView = view
        controller.load(html: "<p>Plain</p>")
        view.selectedRange = NSRange(location: 5, length: 0)
        controller.toggle(.bold)
        controller.appTextScale = 1.3
        #expect(controller.activeMarks.contains(.bold))
        #expect(controller.html() == "<p>Plain</p>")
        view.insertText("!")
        #expect(controller.html() == "<p>Plain<strong>!</strong></p>")
    }
}
