import Foundation

/// Turns stored note HTML into a `NoteDocument`.
///
/// Everything the parser cannot classify is preserved rather than dropped:
/// unknown inline elements become `.other` marks carrying their tag and
/// attributes, and unknown block wrappers are transparent so their text still
/// lands in a paragraph. That bias is deliberate — this client is the third to
/// touch a shared note, and silently deleting markup another client wrote is
/// the one failure mode that cannot be undone.
struct NoteHTMLParser {

    /// Elements that start a block of their own.
    private static let blockTags: Set<String> = [
        "p", "h1", "h2", "h3", "h4", "h5", "h6",
    ]

    /// Wrappers that contribute no block and no mark; their children are parsed
    /// as if the wrapper were not there. `div` is here because Tiptap's task
    /// items wrap their content in one.
    private static let transparentTags: Set<String> = [
        "div", "section", "article", "main", "header", "footer", "aside",
        "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr",
        "td", "th", "colgroup", "col", "body", "html", "head",
    ]

    /// Elements dropped whole, children included. Tiptap regenerates the task
    /// checkbox from `data-checked`, so keeping its markup would only risk
    /// emitting a stale one.
    private static let droppedSubtreeTags: Set<String> = ["label", "script", "style", "noscript"]

    private static let droppedVoidTags: Set<String> = ["input", "img", "meta", "link", "base"]

    static func parse(_ html: String) -> NoteDocument {
        var parser = NoteHTMLParser()
        parser.run(NoteHTMLTokenizer.tokenize(html))
        return NoteDocument(blocks: parser.blocks)
    }

    // MARK: - State

    private var blocks: [NoteBlock] = []
    private var containers: [NoteContainer] = []
    private var marks: [NoteMark] = []
    private var current: NoteBlock?
    private var ids = NoteContainerIDGenerator()
    /// Depth inside a dropped subtree; every token is ignored while non-zero.
    private var skipDepth = 0
    /// Whether the list item at each depth has produced a block yet, so an
    /// empty `<li>` still renders as an (editable) empty line.
    private var listItemProducedBlock: [Bool] = []

    private var isInPreformatted: Bool {
        containers.contains { $0.kind == .preformatted }
    }

    // MARK: - Driver

    private mutating func run(_ tokens: [NoteHTMLTokenizer.Token]) {
        for token in tokens {
            switch token {
            case .text(let text):
                guard skipDepth == 0 else { continue }
                appendText(text)

            case .open(let name, let attributes, let isSelfClosing):
                if skipDepth > 0 {
                    if !isSelfClosing { skipDepth += 1 }
                    continue
                }
                openElement(name, attributes: attributes, isSelfClosing: isSelfClosing)

            case .close(let name):
                if skipDepth > 0 {
                    skipDepth -= 1
                    continue
                }
                closeElement(name)
            }
        }
        finishBlock()
    }

    // MARK: - Text

    private mutating func appendText(_ raw: String) {
        if isInPreformatted {
            appendPreformatted(raw)
            return
        }

        let collapsed = Self.collapseWhitespace(raw)
        guard !collapsed.isEmpty else { return }

        // A whitespace-only run between two blocks is layout, not content.
        if collapsed == " ", current == nil || current?.text.isEmpty == true { return }

        if current == nil { startBlock(tag: nil, attributes: []) }
        appendInline(collapsed)
    }

    private mutating func appendPreformatted(_ raw: String) {
        let lines = raw.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            if index > 0 {
                finishBlock()
            }
            if current == nil {
                var block = NoteBlock()
                block.kind = .codeLine
                block.containers = containers
                current = block
            }
            if !line.isEmpty { appendInline(line) }
        }
    }

    private mutating func appendInline(_ text: String) {
        guard var block = current else { return }
        if var last = block.inlines.last, last.marks == marks {
            last.text += text
            block.inlines[block.inlines.count - 1] = last
        } else {
            block.inlines.append(NoteInline(text: text, marks: marks))
        }
        current = block
    }

    /// HTML collapses runs of space, tab, CR and LF to a single space. A
    /// non-breaking space is not whitespace and must survive — it is how the
    /// other clients hold a deliberate blank.
    private static func collapseWhitespace(_ text: String) -> String {
        var result = ""
        var pendingSpace = false
        for character in text {
            if character == " " || character == "\t" || character == "\n" || character == "\r" {
                pendingSpace = true
                continue
            }
            if pendingSpace {
                result.append(" ")
                pendingSpace = false
            }
            result.append(character)
        }
        if pendingSpace { result.append(" ") }
        return result
    }

    // MARK: - Elements

    private mutating func openElement(_ name: String, attributes: [HTMLAttribute], isSelfClosing: Bool) {
        if Self.droppedVoidTags.contains(name) { return }
        if Self.droppedSubtreeTags.contains(name) {
            if !isSelfClosing { skipDepth = 1 }
            return
        }

        switch name {
        case "br":
            // A hard break inside a paragraph. U+2028 is what AppKit itself uses
            // for a line break that does not start a new paragraph, so the same
            // character serves the editor and the serialiser.
            if current == nil { startBlock(tag: nil, attributes: []) }
            appendInline("\u{2028}")

        case "hr":
            finishBlock()
            var block = NoteBlock()
            block.kind = .horizontalRule
            block.tag = "hr"
            block.attributes = attributes
            block.containers = containers
            blocks.append(block)
            markListItemProduced()

        case "blockquote":
            finishBlock()
            pushContainer(.blockquote, tag: name, attributes: attributes)

        case "ul":
            finishBlock()
            let isTaskList = attributes.value(of: "data-type") == "taskList"
            pushContainer(isTaskList ? .taskList : .bulletList, tag: name, attributes: attributes)

        case "ol":
            finishBlock()
            pushContainer(.orderedList, tag: name, attributes: attributes)

        case "li":
            finishBlock()
            pushContainer(.listItem, tag: name, attributes: attributes)
            listItemProducedBlock.append(false)

        case "pre":
            finishBlock()
            pushContainer(.preformatted, tag: name, attributes: attributes)

        case "code" where isInPreformatted && current == nil:
            // The `<code>` a `<pre>` wraps its lines in, not an inline mark.
            if let index = containers.lastIndex(where: { $0.kind == .preformatted }) {
                containers[index].innerTag = "code"
                containers[index].innerAttributes = attributes
            }

        default:
            if Self.blockTags.contains(name) {
                finishBlock()
                startBlock(tag: name, attributes: attributes)
                return
            }
            if Self.transparentTags.contains(name) { return }

            let kind = NoteMark.kind(forTag: name) ?? .other
            let mark = NoteMark(kind: kind, tag: name, attributes: attributes)
            if isSelfClosing { return }
            marks.append(mark)
        }
    }

    private mutating func closeElement(_ name: String) {
        switch name {
        case "blockquote", "ul", "ol", "li", "pre":
            finishBlock()
            if name == "li", listItemProducedBlock.last == false {
                // An `<li>` with nothing in it still occupies a line.
                startBlock(tag: nil, attributes: [])
                finishBlock()
            }
            if name == "li", !listItemProducedBlock.isEmpty { listItemProducedBlock.removeLast() }
            popContainer(matching: name)

        case "code" where isInPreformatted:
            break

        case "br", "hr":
            break

        default:
            if Self.blockTags.contains(name) {
                finishBlock()
                return
            }
            if Self.transparentTags.contains(name) { return }
            if Self.droppedVoidTags.contains(name) { return }
            popMark(tag: name)
        }
    }

    // MARK: - Blocks & containers

    private mutating func startBlock(tag: String?, attributes: [HTMLAttribute]) {
        var block = NoteBlock()
        block.tag = tag
        block.attributes = attributes
        block.containers = containers
        if let tag, tag.count == 2, tag.hasPrefix("h"), let level = Int(tag.dropFirst()) {
            block.kind = .heading(level: level)
        }
        current = block
    }

    private mutating func finishBlock() {
        guard var block = current else { return }
        current = nil
        if !block.isInPreformatted { trimEdges(of: &block) }
        blocks.append(block)
        markListItemProduced()
    }

    private mutating func markListItemProduced() {
        if !listItemProducedBlock.isEmpty {
            listItemProducedBlock[listItemProducedBlock.count - 1] = true
        }
    }

    /// Leading and trailing collapsed spaces are inter-element layout, not text.
    private func trimEdges(of block: inout NoteBlock) {
        while let first = block.inlines.first {
            var trimmed = first
            while trimmed.text.hasPrefix(" ") { trimmed.text.removeFirst() }
            if trimmed.text.isEmpty, block.inlines.count > 1 {
                block.inlines.removeFirst()
                continue
            }
            block.inlines[0] = trimmed
            break
        }
        while let last = block.inlines.last {
            var trimmed = last
            while trimmed.text.hasSuffix(" ") { trimmed.text.removeLast() }
            if trimmed.text.isEmpty, block.inlines.count > 1 {
                block.inlines.removeLast()
                continue
            }
            block.inlines[block.inlines.count - 1] = trimmed
            break
        }
        if block.inlines.count == 1, block.inlines[0].text.isEmpty, block.inlines[0].marks.isEmpty {
            block.inlines = []
        }
    }

    private mutating func pushContainer(
        _ kind: NoteContainer.Kind,
        tag: String,
        attributes: [HTMLAttribute]
    ) {
        containers.append(
            NoteContainer(kind: kind, id: ids.take(), tag: tag, attributes: attributes)
        )
    }

    private mutating func popContainer(matching tag: String) {
        if let index = containers.lastIndex(where: { $0.tag == tag }) {
            containers.removeSubrange(index...)
        } else if !containers.isEmpty {
            containers.removeLast()
        }
    }

    private mutating func popMark(tag: String) {
        if let index = marks.lastIndex(where: { $0.tag == tag }) {
            marks.remove(at: index)
        }
    }
}
