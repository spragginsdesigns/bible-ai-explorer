import AppKit
import SwiftUI

/// Bridges `NoteDocument` and the `NSAttributedString` an `NSTextView` edits.
///
/// The semantic model is the source of truth and travels *in* the attributed
/// string, boxed under two private keys: `.noteBlock` per paragraph and
/// `.noteMarks` per run. Everything AppKit renders — fonts, colours, indents —
/// is derived from those, never read back out of them. That direction matters:
/// inferring "bold" from an `NSFont` trait would lose the distinction between a
/// `<strong>` and a `<b>`, and inferring a heading from a point size would lose
/// its attributes entirely.
///
/// List markers are deliberately *not* text. They are drawn in the gutter by
/// `NoteTextView`, so the character stream stays a one-to-one image of the
/// document and no edit can ever half-delete a bullet.
enum NoteAttributedText {

    // MARK: - Attribute keys

    static let blockKey = NSAttributedString.Key("swNoteBlock")
    static let marksKey = NSAttributedString.Key("swNoteMarks")

    /// Attribute values must be objects, and AppKit coalesces adjacent runs by
    /// `isEqual:` — so these boxes need real equality, not identity, or every
    /// character would start its own run.
    final class BlockBox: NSObject {
        let block: NoteBlock

        init(_ block: NoteBlock) {
            // Inlines live in the text itself; keeping a copy here would let the
            // two disagree after an edit.
            var stripped = block
            stripped.inlines = []
            self.block = stripped
        }

        override func isEqual(_ object: Any?) -> Bool {
            (object as? BlockBox)?.block == block
        }

        override var hash: Int { block.tag?.hashValue ?? 0 }
    }

    final class MarksBox: NSObject {
        let marks: [NoteMark]

        init(_ marks: [NoteMark]) { self.marks = marks }

        override func isEqual(_ object: Any?) -> Bool {
            (object as? MarksBox)?.marks == marks
        }

        override var hash: Int { marks.count }
    }

    // MARK: - Metrics

    enum Metrics {
        static let bodySize: CGFloat = 15
        /// Mirrors the editor CSS in `NoteRichEditor.tsx` (1.6em / 1.35em / 1.15em).
        static func headingSize(_ level: Int) -> CGFloat {
            switch level {
            case 1: bodySize * 1.6
            case 2: bodySize * 1.35
            case 3: bodySize * 1.15
            default: bodySize * 1.05
            }
        }
        static let listIndent: CGFloat = 26
        static let quoteIndent: CGFloat = 18
        static let paragraphSpacing: CGFloat = 9
        static let lineHeightMultiple: CGFloat = 1.35
    }

    // MARK: - Document → attributed string

    static func attributedString(for document: NoteDocument, theme: SureWordColors) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let blocks = document.blocks.isEmpty ? [NoteBlock()] : document.blocks

        for (index, block) in blocks.enumerated() {
            let blockAttributes = attributes(for: block, theme: theme)

            if block.kind == .horizontalRule {
                result.append(
                    NSAttributedString(string: "\u{00A0}", attributes: blockAttributes)
                )
            } else {
                for inline in block.inlines {
                    var attributes = blockAttributes
                    apply(marks: inline.marks, to: &attributes, block: block, theme: theme)
                    attributes[marksKey] = MarksBox(inline.marks)
                    result.append(NSAttributedString(string: inline.text, attributes: attributes))
                }
            }

            if index < blocks.count - 1 {
                result.append(NSAttributedString(string: "\n", attributes: blockAttributes))
            }
        }
        return result
    }

    // MARK: - Attributed string → document

    /// `trailingBlock` supplies the block for a final, empty paragraph — it has
    /// no characters to carry an attribute, so the caller passes the text view's
    /// typing attributes. Without it, pressing Return at the end of a list would
    /// drop you out of the list on the next save.
    static func document(
        from attributed: NSAttributedString,
        trailingBlock: NoteBlock? = nil
    ) -> NoteDocument {
        let text = attributed.string as NSString
        var blocks: [NoteBlock] = []
        var start = 0

        while start <= text.length {
            let newline = text.range(
                of: "\n",
                options: [],
                range: NSRange(location: start, length: text.length - start)
            )
            let end = newline.location == NSNotFound ? text.length : newline.location
            let paragraph = NSRange(location: start, length: end - start)

            var block = self.block(in: attributed, at: paragraph) ?? trailingBlock ?? NoteBlock()
            if block.kind == .horizontalRule {
                block.inlines = []
            } else {
                block.inlines = inlines(in: attributed, range: paragraph)
            }
            blocks.append(block)

            if newline.location == NSNotFound { break }
            start = end + 1
        }

        return NoteDocument(blocks: blocks)
    }

    private static func block(in attributed: NSAttributedString, at range: NSRange) -> NoteBlock? {
        if range.length > 0 {
            return (attributed.attribute(blockKey, at: range.location, effectiveRange: nil) as? BlockBox)?
                .block
        }
        // An empty paragraph in the middle of the document still owns its
        // terminating newline, which carries the attribute.
        if range.location < attributed.length {
            return (attributed.attribute(blockKey, at: range.location, effectiveRange: nil) as? BlockBox)?
                .block
        }
        return nil
    }

    private static func inlines(in attributed: NSAttributedString, range: NSRange) -> [NoteInline] {
        guard range.length > 0 else { return [] }
        var inlines: [NoteInline] = []

        attributed.enumerateAttribute(marksKey, in: range) { value, subrange, _ in
            let marks = (value as? MarksBox)?.marks ?? []
            let text = (attributed.string as NSString).substring(with: subrange)
            guard !text.isEmpty else { return }
            if var last = inlines.last, last.marks == marks {
                last.text += text
                inlines[inlines.count - 1] = last
            } else {
                inlines.append(NoteInline(text: text, marks: marks))
            }
        }
        return inlines
    }

    // MARK: - Styling

    static func attributes(for block: NoteBlock, theme: SureWordColors) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [
            blockKey: BlockBox(block),
            .foregroundColor: NSColor(theme.text),
            .paragraphStyle: paragraphStyle(for: block),
        ]

        switch block.kind {
        case .heading(let level):
            attributes[.font] = NSFont.systemFont(
                ofSize: Metrics.headingSize(level),
                weight: .bold
            )
        case .codeLine:
            attributes[.font] = NSFont.monospacedSystemFont(ofSize: Metrics.bodySize - 1, weight: .regular)
            attributes[.foregroundColor] = NSColor(theme.textSecondary)
        case .horizontalRule:
            attributes[.font] = NSFont.systemFont(ofSize: Metrics.bodySize)
            attributes[.foregroundColor] = NSColor(theme.borderStrong)
        case .paragraph:
            if block.isInBlockquote {
                // Quoted Scripture is set in Cormorant Garamond on every client;
                // fall back to the system serif if the font failed to load.
                attributes[.font] = NSFont(name: FontFamily.verse, size: Metrics.bodySize + 2)
                    ?? NSFont.systemFont(ofSize: Metrics.bodySize + 1)
                attributes[.foregroundColor] = NSColor(theme.textSecondary)
            } else {
                attributes[.font] = NSFont.systemFont(ofSize: Metrics.bodySize)
            }
        }
        return attributes
    }

    static func paragraphStyle(for block: NoteBlock) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        let indent =
            CGFloat(block.listDepth) * Metrics.listIndent
            + CGFloat(block.containers.filter { $0.kind == .blockquote }.count) * Metrics.quoteIndent
        style.firstLineHeadIndent = indent
        style.headIndent = indent
        style.paragraphSpacing = Metrics.paragraphSpacing
        style.lineHeightMultiple = Metrics.lineHeightMultiple

        switch block.alignment {
        case .natural: style.alignment = .natural
        case .left: style.alignment = .left
        case .center: style.alignment = .center
        case .right: style.alignment = .right
        case .justify: style.alignment = .justified
        }

        if case .codeLine = block.kind {
            style.paragraphSpacing = 0
            style.lineHeightMultiple = 1.2
        }
        return style
    }

    /// Full attribute set for one run — the block's styling with the run's marks
    /// layered on. The editing commands use this to restyle a range in place,
    /// which is what keeps inline formatting out of the rebuild-the-world path
    /// (and therefore out of the undo stack's way).
    static func runAttributes(
        block: NoteBlock,
        marks: [NoteMark],
        theme: SureWordColors
    ) -> [NSAttributedString.Key: Any] {
        var attributes = self.attributes(for: block, theme: theme)
        apply(marks: marks, to: &attributes, block: block, theme: theme)
        attributes[marksKey] = MarksBox(marks)
        return attributes
    }

    private static func apply(
        marks: [NoteMark],
        to attributes: inout [NSAttributedString.Key: Any],
        block: NoteBlock,
        theme: SureWordColors
    ) {
        var traits: NSFontDescriptor.SymbolicTraits = []
        var isCode = false

        for mark in marks {
            switch mark.kind {
            case .bold: traits.insert(.bold)
            case .italic: traits.insert(.italic)
            case .underline:
                attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
            case .strike:
                attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            case .code:
                isCode = true
                attributes[.backgroundColor] = NSColor(theme.surfaceStrong)
            case .highlight:
                attributes[.backgroundColor] = NSColor(theme.accent.opacity(0.25))
            case .link:
                attributes[.foregroundColor] = NSColor(theme.accent)
                attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                if let href = mark.href, let url = URL(string: href) {
                    attributes[.link] = url
                }
            case .other:
                break
            }
        }

        let base = (attributes[.font] as? NSFont) ?? NSFont.systemFont(ofSize: Metrics.bodySize)
        if isCode {
            attributes[.font] = NSFont.monospacedSystemFont(
                ofSize: base.pointSize - 1,
                weight: traits.contains(.bold) ? .semibold : .regular
            )
        } else if !traits.isEmpty {
            attributes[.font] = font(base, adding: traits)
        }
    }

    private static func font(_ base: NSFont, adding traits: NSFontDescriptor.SymbolicTraits) -> NSFont {
        let descriptor = base.fontDescriptor.withSymbolicTraits(
            base.fontDescriptor.symbolicTraits.union(traits)
        )
        return NSFont(descriptor: descriptor, size: base.pointSize) ?? base
    }

    // MARK: - List markers

    /// The marker string drawn in the gutter for each block, keyed by block
    /// index. Ordered lists are numbered per container, so removing an item
    /// renumbers the rest for free.
    static func listMarkers(for document: NoteDocument) -> [Int: String] {
        var markers: [Int: String] = [:]
        var counters: [Int: Int] = [:]

        for (index, block) in document.blocks.enumerated() {
            guard let item = block.listItemContainer, let list = block.listContainer else { continue }
            // Only the first block of a multi-paragraph item gets a marker.
            let isFirstBlockOfItem = index == 0 || document.blocks[index - 1].listItemContainer?.id != item.id
            guard isFirstBlockOfItem else { continue }

            switch list.kind {
            case .orderedList:
                let start = Int(list.attributes.value(of: "start") ?? "") ?? 1
                let next = (counters[list.id] ?? start - 1) + 1
                counters[list.id] = next
                markers[index] = "\(next)."
            case .taskList:
                markers[index] = item.isChecked ? "☑" : "☐"
            default:
                markers[index] = "•"
            }
        }
        return markers
    }
}
