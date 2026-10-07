import Foundation

/// A `NoteDocument` as the Tiptap JSON tree Android's editor hands
/// `noteDocumentToMarkdown` (`editor.getJSON()`), so `NoteMarkdownExport`
/// can stay a straight port of the TS exporter.
///
/// The mapping follows Tiptap's own HTML parse of the same markup:
/// container paths fold back into nested nodes (`blockquote`, the three list
/// kinds, `listItem` / `taskItem` with `checked`, `codeBlock` with its
/// `language-*` class), a `<br>` (held as U+2028 in a run) becomes a
/// `hardBreak`, and marks map one to one. An element Tiptap has no mark for
/// (`.other`: a bare `<span>`, `<sup>`) is dropped to its text, which is what
/// Tiptap's schema does with it on Android.
enum NoteTiptapDocument {
    static func json(from document: NoteDocument) -> JSONValue {
        .object(["type": .string("doc"), "content": .array(nodes(document.blocks[...], depth: 0))])
    }

    private static func nodes(_ blocks: ArraySlice<NoteBlock>, depth: Int) -> [JSONValue] {
        var result: [JSONValue] = []
        var index = blocks.startIndex
        while index < blocks.endIndex {
            let block = blocks[index]
            guard block.containers.count > depth else {
                result.append(leaf(block))
                index += 1
                continue
            }
            let container = block.containers[depth]
            var end = index
            while end < blocks.endIndex,
                  blocks[end].containers.count > depth,
                  blocks[end].containers[depth].id == container.id {
                end += 1
            }
            result.append(node(for: container, blocks: blocks[index..<end], depth: depth + 1))
            index = end
        }
        return result
    }

    private static func node(for container: NoteContainer, blocks: ArraySlice<NoteBlock>, depth: Int) -> JSONValue {
        let children = JSONValue.array(nodes(blocks, depth: depth))
        switch container.kind {
        case .blockquote:
            return .object(["type": .string("blockquote"), "content": children])
        case .bulletList:
            return .object(["type": .string("bulletList"), "content": children])
        case .orderedList:
            let start = container.attributes.value(of: "start").flatMap(Double.init) ?? 1
            return .object(["type": .string("orderedList"), "attrs": .object(["start": .number(start)]), "content": children])
        case .taskList:
            return .object(["type": .string("taskList"), "content": children])
        case .listItem:
            if container.isTaskItem {
                return .object([
                    "type": .string("taskItem"),
                    "attrs": .object(["checked": .bool(container.isChecked)]),
                    "content": children,
                ])
            }
            return .object(["type": .string("listItem"), "content": children])
        case .preformatted:
            let text = blocks.map(\.text).joined(separator: "\n")
            let language = (container.innerAttributes.value(of: "class") ?? container.attributes.value(of: "class"))?
                .split(separator: " ")
                .first { $0.hasPrefix("language-") }
                .map { JSONValue.string(String($0.dropFirst("language-".count))) } ?? .null
            return .object([
                "type": .string("codeBlock"),
                "attrs": .object(["language": language]),
                "content": .array(text.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(text)])]),
            ])
        }
    }

    private static func leaf(_ block: NoteBlock) -> JSONValue {
        switch block.kind {
        case .horizontalRule:
            return .object(["type": .string("horizontalRule")])
        case .heading(let level):
            return .object([
                "type": .string("heading"),
                "attrs": .object(["level": .number(Double(level))]),
                "content": .array(inlines(block.inlines)),
            ])
        case .paragraph, .codeLine:
            return .object(["type": .string("paragraph"), "content": .array(inlines(block.inlines))])
        }
    }

    private static func inlines(_ runs: [NoteInline]) -> [JSONValue] {
        var result: [JSONValue] = []
        for run in runs {
            let marks = run.marks.compactMap(mark)
            let pieces = run.text.components(separatedBy: "\u{2028}")
            for (index, piece) in pieces.enumerated() {
                if index > 0 { result.append(.object(["type": .string("hardBreak")])) }
                guard !piece.isEmpty else { continue }
                var text: [String: JSONValue] = ["type": .string("text"), "text": .string(piece)]
                if !marks.isEmpty { text["marks"] = .array(marks) }
                result.append(.object(text))
            }
        }
        return result
    }

    private static func mark(_ mark: NoteMark) -> JSONValue? {
        switch mark.kind {
        case .bold: .object(["type": .string("bold")])
        case .italic: .object(["type": .string("italic")])
        case .underline: .object(["type": .string("underline")])
        case .strike: .object(["type": .string("strike")])
        case .code: .object(["type": .string("code")])
        case .highlight: .object(["type": .string("highlight")])
        case .link: .object(["type": .string("link"), "attrs": .object(["href": mark.href.map(JSONValue.string) ?? .null])])
        case .other: nil
        }
    }
}
