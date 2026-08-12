import Foundation

/// Renders a `NoteDocument` back to the HTML the other clients read.
///
/// The output shape is Tiptap's `getHTML()`: no whitespace between block
/// elements, marks nested in the order they were parsed, and the canonical task
/// item markup (Tiptap regenerates the checkbox from `data-checked`, so it is
/// rebuilt here rather than carried through the model as dead markup).
enum NoteHTMLSerializer {

    static func serialize(_ document: NoteDocument) -> String {
        var output = ""
        var open: [NoteContainer] = []
        var previousWasCodeLine = false

        for block in document.blocks {
            let shared = commonPrefix(open, block.containers)

            for container in open[shared...].reversed() {
                output += close(container)
            }
            open.removeSubrange(shared...)

            for container in block.containers[shared...] {
                output += self.open(container)
                open.append(container)
            }

            if case .codeLine = block.kind {
                // Lines inside one `<pre>` are separated by real newlines, not
                // by elements.
                if previousWasCodeLine { output += "\n" }
                output += inlineHTML(block.inlines)
                previousWasCodeLine = true
                continue
            }

            previousWasCodeLine = false
            output += blockHTML(block)
        }

        for container in open.reversed() {
            output += close(container)
        }
        return output
    }

    // MARK: - Containers

    private static func commonPrefix(_ lhs: [NoteContainer], _ rhs: [NoteContainer]) -> Int {
        var index = 0
        while index < lhs.count, index < rhs.count,
              lhs[index].id == rhs[index].id, lhs[index].kind == rhs[index].kind {
            index += 1
        }
        return index
    }

    private static func open(_ container: NoteContainer) -> String {
        var output = tag(container.tag, container.attributes)
        if container.kind == .preformatted, let innerTag = container.innerTag {
            output += tag(innerTag, container.innerAttributes)
        }
        if container.isTaskItem {
            let checked = container.isChecked ? " checked=\"checked\"" : ""
            output += "<label><input type=\"checkbox\"\(checked)><span></span></label><div>"
        }
        return output
    }

    private static func close(_ container: NoteContainer) -> String {
        var output = ""
        if container.isTaskItem { output += "</div>" }
        if container.kind == .preformatted, let innerTag = container.innerTag {
            output += "</\(innerTag)>"
        }
        output += "</\(container.tag)>"
        return output
    }

    // MARK: - Blocks

    private static func blockHTML(_ block: NoteBlock) -> String {
        switch block.kind {
        case .horizontalRule:
            return tag(block.tag ?? "hr", block.attributes)

        case .heading(let level):
            let name = block.tag ?? "h\(min(max(level, 1), 6))"
            return wrap(name, block.attributes, inlineHTML(block.inlines))

        case .paragraph, .codeLine:
            return wrap(block.tag ?? "p", block.attributes, inlineHTML(block.inlines))
        }
    }

    private static func wrap(_ name: String, _ attributes: [HTMLAttribute], _ body: String) -> String {
        "\(tag(name, attributes))\(body)</\(name)>"
    }

    private static func tag(_ name: String, _ attributes: [HTMLAttribute]) -> String {
        var output = "<\(name)"
        for attribute in attributes {
            if let value = attribute.value {
                output += " \(attribute.name)=\"\(HTMLEntities.escapeAttribute(value))\""
            } else {
                output += " \(attribute.name)"
            }
        }
        return output + ">"
    }

    // MARK: - Inlines

    static func inlineHTML(_ inlines: [NoteInline]) -> String {
        var output = ""
        var open: [NoteMark] = []

        for inline in inlines {
            let shared = commonMarkPrefix(open, inline.marks)
            for mark in open[shared...].reversed() {
                output += "</\(mark.tag)>"
            }
            open.removeSubrange(shared...)
            for mark in inline.marks[shared...] {
                output += tag(mark.tag, mark.attributes)
                open.append(mark)
            }
            output += escapeBody(inline.text)
        }

        for mark in open.reversed() {
            output += "</\(mark.tag)>"
        }
        return output
    }

    private static func commonMarkPrefix(_ lhs: [NoteMark], _ rhs: [NoteMark]) -> Int {
        var index = 0
        while index < lhs.count, index < rhs.count, lhs[index] == rhs[index] {
            index += 1
        }
        return index
    }

    /// Hard breaks live in the model as U+2028; everything else is escaped as a
    /// text node.
    private static func escapeBody(_ text: String) -> String {
        text
            .components(separatedBy: "\u{2028}")
            .map(HTMLEntities.escapeText)
            .joined(separator: "<br>")
    }
}
