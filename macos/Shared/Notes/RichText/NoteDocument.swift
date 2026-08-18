import Foundation

/// The document model behind the note editor.
///
/// Note bodies are **HTML shared with the other two clients** — Tiptap v3 on the
/// web, TenTap (Tiptap in a webview) on Android. Whatever this client opens it
/// must be able to hand back without flattening formatting the others produced,
/// so the model is deliberately a *lossless* representation of that HTML rather
/// than the smallest one that renders:
///
/// - every element keeps its original tag name (`<strong>` vs `<b>`) and its
///   attributes, in source order, so serialising an untouched note reproduces
///   the bytes it arrived as;
/// - block containers (lists, blockquotes, `<pre>`) are held as an ordered
///   *path* per block rather than by nesting, which is what lets an
///   `NSTextView` — a flat run of paragraphs — edit them at all;
/// - container identity is an integer, so two adjacent blockquotes stay two
///   blockquotes instead of merging on the way out.
///
/// `NSAttributedString` HTML import/export was the obvious alternative and is
/// not usable here: its writer emits WebKit's CSS-laden markup, turning a
/// `<h2>` into a `<p class="p1"><span style="font: 24px …">`. That is precisely
/// the destruction this model exists to avoid.

// MARK: - Attributes

/// One HTML attribute, kept verbatim. A valueless attribute (`<input checked>`)
/// has a `nil` value.
struct HTMLAttribute: Equatable, Sendable {
    var name: String
    var value: String?

    init(_ name: String, _ value: String?) {
        self.name = name
        self.value = value
    }
}

extension Array where Element == HTMLAttribute {
    func value(of name: String) -> String? {
        first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
    }

    mutating func set(_ name: String, to value: String?) {
        if let index = firstIndex(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            if let value {
                self[index].value = value
            } else {
                remove(at: index)
            }
        } else if let value {
            append(HTMLAttribute(name, value))
        }
    }
}

// MARK: - Inline marks

/// A character-level mark. `tag` is the literal element it came from so
/// `<b>` does not silently become `<strong>` on the way back out.
struct NoteMark: Equatable, Sendable {
    enum Kind: String, Equatable, Sendable, CaseIterable {
        case bold, italic, underline, strike, code, highlight, link, other
    }

    var kind: Kind
    var tag: String
    var attributes: [HTMLAttribute] = []

    var href: String? { attributes.value(of: "href") }

    static func bold(_ tag: String = "strong") -> NoteMark { .init(kind: .bold, tag: tag) }
    static func italic(_ tag: String = "em") -> NoteMark { .init(kind: .italic, tag: tag) }
    static func underline(_ tag: String = "u") -> NoteMark { .init(kind: .underline, tag: tag) }
    static func strike(_ tag: String = "s") -> NoteMark { .init(kind: .strike, tag: tag) }
    static func code(_ tag: String = "code") -> NoteMark { .init(kind: .code, tag: tag) }
    static func highlight(_ tag: String = "mark") -> NoteMark { .init(kind: .highlight, tag: tag) }

    static func link(href: String) -> NoteMark {
        .init(kind: .link, tag: "a", attributes: [HTMLAttribute("href", href)])
    }

    /// Tags that carry a mark, keyed by the element name as written.
    static func kind(forTag tag: String) -> Kind? {
        switch tag {
        case "strong", "b": .bold
        case "em", "i": .italic
        case "u", "ins": .underline
        case "s", "del", "strike": .strike
        case "code": .code
        case "mark": .highlight
        case "a": .link
        default: nil
        }
    }
}

/// A run of text sharing one mark stack, outermost mark first.
struct NoteInline: Equatable, Sendable {
    var text: String
    var marks: [NoteMark] = []

    func has(_ kind: NoteMark.Kind) -> Bool { marks.contains { $0.kind == kind } }
}

// MARK: - Block containers

/// An element that wraps blocks: a list, a list item, a blockquote, a `<pre>`.
/// The `id` distinguishes two sibling containers of the same kind, which is what
/// keeps adjacent lists and quotes from being welded together on serialisation.
struct NoteContainer: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case blockquote
        case bulletList
        case orderedList
        case taskList
        case listItem
        case preformatted
    }

    var kind: Kind
    var id: Int
    var tag: String
    var attributes: [HTMLAttribute] = []
    /// `<pre>` wraps its lines in a `<code>`; that element's tag and attributes
    /// (`class="language-swift"`) live here so they survive the round trip.
    var innerTag: String?
    var innerAttributes: [HTMLAttribute] = []

    /// Task items carry their state in `data-checked`.
    var isChecked: Bool {
        get { attributes.value(of: "data-checked") == "true" }
        set { attributes.set("data-checked", to: newValue ? "true" : "false") }
    }

    var isTaskItem: Bool {
        kind == .listItem && attributes.value(of: "data-checked") != nil
    }

    var isList: Bool {
        kind == .bulletList || kind == .orderedList || kind == .taskList
    }
}

// MARK: - Blocks

struct NoteBlock: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case paragraph
        case heading(level: Int)
        /// One line inside a `<pre><code>`; the enclosing `.preformatted`
        /// container is what makes them a block.
        case codeLine
        case horizontalRule
    }

    var kind: Kind = .paragraph
    /// Outermost container first.
    var containers: [NoteContainer] = []
    var inlines: [NoteInline] = []
    /// Attributes of the block element itself (`<p style="text-align: center">`).
    var attributes: [HTMLAttribute] = []
    /// The literal tag; `nil` means the block was implicit (bare text with no
    /// wrapping element) and should serialise as a `<p>`.
    var tag: String?

    var text: String { inlines.map(\.text).joined() }

    var isEmpty: Bool { text.isEmpty }

    /// `text-align`, parsed out of the inline style attribute.
    var alignment: NoteAlignment {
        get {
            guard let style = attributes.value(of: "style") else { return .natural }
            guard let match = style.range(of: "text-align:", options: .caseInsensitive) else {
                return .natural
            }
            let rest = style[match.upperBound...]
                .prefix { $0 != ";" }
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            return NoteAlignment(rawValue: rest) ?? .natural
        }
        set {
            var style = attributes.value(of: "style") ?? ""
            // Drop any existing declaration, then re-add unless it is the default.
            style = style
                .split(separator: ";")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.lowercased().hasPrefix("text-align") }
                .joined(separator: "; ")
            if newValue != .natural {
                style = style.isEmpty
                    ? "text-align: \(newValue.rawValue)"
                    : "\(style); text-align: \(newValue.rawValue)"
            }
            attributes.set("style", to: style.isEmpty ? nil : style)
        }
    }

    var headingLevel: Int? {
        if case .heading(let level) = kind { return level }
        return nil
    }
}

enum NoteAlignment: String, Equatable, Sendable, CaseIterable {
    case natural
    case left
    case center
    case right
    case justify
}

// MARK: - Document

struct NoteDocument: Equatable, Sendable {
    var blocks: [NoteBlock] = []

    static let empty = NoteDocument(blocks: [])

    var isEmpty: Bool {
        blocks.allSatisfy { $0.isEmpty && $0.kind != .horizontalRule }
    }

    /// The plain text the other clients derive with `htmlToPlainText`. Kept as a
    /// convenience for previews; saves still go through `NoteUtils` on the
    /// serialised HTML so all three clients store the same string.
    var plainText: String {
        blocks.map(\.text).joined(separator: "\n")
    }
}

// MARK: - Container helpers

extension NoteBlock {
    /// Innermost list container, if this block sits in a list.
    var listContainer: NoteContainer? {
        containers.last { $0.isList }
    }

    var listItemContainer: NoteContainer? {
        containers.last { $0.kind == .listItem }
    }

    var isInPreformatted: Bool {
        containers.contains { $0.kind == .preformatted }
    }

    var isInBlockquote: Bool {
        containers.contains { $0.kind == .blockquote }
    }

    /// One-based nesting depth of the innermost list, 0 when not in a list.
    var listDepth: Int {
        containers.filter(\.isList).count
    }
}

/// Hands out the container ids the parser and the editor commands both need.
/// A single global counter is enough — ids only have to be unique within one
/// document, and they are never persisted.
struct NoteContainerIDGenerator {
    private var next: Int

    init(startingAt first: Int = 1) {
        next = first
    }

    /// Continue past everything a parsed document already used, so a list the
    /// user creates never collides with — and therefore never merges into — one
    /// that came out of the HTML.
    init(after document: NoteDocument) {
        let highest = document.blocks
            .flatMap(\.containers)
            .map(\.id)
            .max() ?? 0
        next = highest + 1
    }

    mutating func take() -> Int {
        defer { next += 1 }
        return next
    }
}
