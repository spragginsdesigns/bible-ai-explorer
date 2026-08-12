import AppKit
import SwiftUI

/// Owns the note editor's text view and every formatting command the toolbar
/// exposes — the macOS counterpart of TenTap's `Toolbar` on Android and the
/// Tiptap `EditorToolbar` on the web, covering the same vocabulary those two
/// can produce.
///
/// Two different strategies, on purpose:
///
/// - **Inline marks** are applied by restyling the selected range in place.
///   They change no characters, so the text view's own undo stack handles them
///   and typing stays responsive.
/// - **Block structure** (headings, lists, quotes, code blocks) goes through
///   the document model and re-renders. Block changes are rare, and doing them
///   on the model is what makes "wrap these three paragraphs in one list" a
///   three-line operation instead of an attributed-string puzzle.
@MainActor
@Observable
final class NoteRichTextController {

    /// Marks covering the whole selection — drives the toolbar's pressed state.
    private(set) var activeMarks: Set<NoteMark.Kind> = []
    /// The block at the caret, for the heading/list/quote pressed states.
    private(set) var activeBlock = NoteBlock()
    /// Whether the caret's item can be nested one level deeper / lifted one
    /// level out — drives both the toolbar buttons and Tab / Shift-Tab.
    private(set) var canIndentList = false
    private(set) var canOutdentList = false

    var theme: SureWordColors = .dark {
        didSet {
            guard oldValue != theme else { return }
            restyleAll()
        }
    }

    /// Fired on every user edit; the editor model debounces it into an autosave.
    var onChange: (@MainActor () -> Void)?

    /// Attaching the view is what flushes a document that was loaded before it
    /// existed — see `pendingHTML`.
    @ObservationIgnored weak var textView: NoteTextView? {
        didSet {
            guard textView != nil, let html = pendingHTML else { return }
            pendingHTML = nil
            load(html: html)
        }
    }

    /// Suppresses `onChange` while the document is being replaced by code.
    @ObservationIgnored private var isRendering = false
    @ObservationIgnored private var ids = NoteContainerIDGenerator()
    /// HTML that arrived before the text view was attached.
    ///
    /// The editor model fetches the note in a `.task`, while the text view is
    /// created by SwiftUI's own view lifecycle — and for a note whose body is
    /// not already cached, the fetch wins. Dropping the HTML there left the
    /// editor blank on a note that had content, and the first keystroke would
    /// then autosave that blankness over it.
    @ObservationIgnored private var pendingHTML: String?

    // MARK: - Content

    func load(html: String) {
        guard textView != nil else {
            pendingHTML = html
            return
        }
        pendingHTML = nil
        let document = NoteHTMLParser.parse(html)
        ids = NoteContainerIDGenerator(after: document)
        render(document, selection: NSRange(location: 0, length: 0), registersUndo: false)
    }

    /// True once a document has actually reached the text view. The editor
    /// model checks this before saving, so a pane that never got its content
    /// cannot persist an empty document over a real note.
    var hasLoadedDocument: Bool {
        textView != nil && pendingHTML == nil
    }

    /// The HTML to persist. Serialising from the model — not from the text view
    /// — is what guarantees a note opened and closed untouched goes back byte
    /// for byte as it arrived.
    func html() -> String {
        let document = currentDocument()
        return document.isEmpty ? "" : NoteHTMLSerializer.serialize(document)
    }

    func currentDocument() -> NoteDocument {
        guard let textView, let storage = textView.textStorage else { return .empty }
        let trailing = (textView.typingAttributes[NoteAttributedText.blockKey]
            as? NoteAttributedText.BlockBox)?.block
        return NoteAttributedText.document(from: storage, trailingBlock: trailing)
    }

    // MARK: - Inline marks

    func toggle(_ kind: NoteMark.Kind) {
        guard let textView, let storage = textView.textStorage else { return }
        let selection = textView.selectedRange()

        guard selection.length > 0 else {
            toggleTypingMark(kind)
            return
        }

        let shouldRemove = marksCoverSelection(kind, in: storage, range: selection)
        guard textView.shouldChangeText(in: selection, replacementString: nil) else { return }

        storage.beginEditing()
        storage.enumerateAttribute(NoteAttributedText.marksKey, in: selection) { value, subrange, _ in
            var marks = (value as? NoteAttributedText.MarksBox)?.marks ?? []
            if shouldRemove {
                marks.removeAll { $0.kind == kind }
            } else if !marks.contains(where: { $0.kind == kind }) {
                marks.append(Self.defaultMark(kind))
            }
            let block = self.block(in: storage, at: subrange.location) ?? NoteBlock()
            storage.setAttributes(
                NoteAttributedText.runAttributes(block: block, marks: marks, theme: theme),
                range: subrange
            )
        }
        storage.endEditing()
        textView.didChangeText()
        refreshState()
        notifyChange()
    }

    /// A link needs a value, so it is set rather than toggled. Passing `nil`
    /// removes it.
    func setLink(_ href: String?) {
        guard let textView, let storage = textView.textStorage else { return }
        let selection = textView.selectedRange()
        guard selection.length > 0 else { return }
        guard textView.shouldChangeText(in: selection, replacementString: nil) else { return }

        storage.beginEditing()
        storage.enumerateAttribute(NoteAttributedText.marksKey, in: selection) { value, subrange, _ in
            var marks = (value as? NoteAttributedText.MarksBox)?.marks ?? []
            marks.removeAll { $0.kind == .link }
            if let href, !href.isEmpty {
                marks.append(.link(href: href))
            }
            let block = self.block(in: storage, at: subrange.location) ?? NoteBlock()
            storage.setAttributes(
                NoteAttributedText.runAttributes(block: block, marks: marks, theme: theme),
                range: subrange
            )
        }
        storage.endEditing()
        textView.didChangeText()
        refreshState()
        notifyChange()
    }

    private func toggleTypingMark(_ kind: NoteMark.Kind) {
        guard let textView else { return }
        var marks = (textView.typingAttributes[NoteAttributedText.marksKey]
            as? NoteAttributedText.MarksBox)?.marks ?? []
        if marks.contains(where: { $0.kind == kind }) {
            marks.removeAll { $0.kind == kind }
        } else {
            marks.append(Self.defaultMark(kind))
        }
        let block = (textView.typingAttributes[NoteAttributedText.blockKey]
            as? NoteAttributedText.BlockBox)?.block ?? NoteBlock()
        textView.typingAttributes = NoteAttributedText.runAttributes(
            block: block,
            marks: marks,
            theme: theme
        )
        refreshState()
    }

    private static func defaultMark(_ kind: NoteMark.Kind) -> NoteMark {
        switch kind {
        case .bold: .bold()
        case .italic: .italic()
        case .underline: .underline()
        case .strike: .strike()
        case .code: .code()
        case .highlight: .highlight()
        case .link: .link(href: "")
        case .other: NoteMark(kind: .other, tag: "span")
        }
    }

    private func marksCoverSelection(
        _ kind: NoteMark.Kind,
        in storage: NSTextStorage,
        range: NSRange
    ) -> Bool {
        var covered = true
        storage.enumerateAttribute(NoteAttributedText.marksKey, in: range) { value, _, stop in
            let marks = (value as? NoteAttributedText.MarksBox)?.marks ?? []
            if !marks.contains(where: { $0.kind == kind }) {
                covered = false
                stop.pointee = true
            }
        }
        return covered
    }

    // MARK: - Block structure

    func setBlockKind(_ kind: NoteBlock.Kind) {
        mutateBlocks { blocks, range in
            for index in range {
                let isSame = blocks[index].kind == kind
                blocks[index].kind = isSame ? .paragraph : kind
                switch blocks[index].kind {
                case .heading(let level): blocks[index].tag = "h\(level)"
                case .paragraph: blocks[index].tag = "p"
                default: break
                }
            }
        }
    }

    func toggleList(_ kind: NoteContainer.Kind) {
        mutateBlocks { [self] blocks, range in
            let alreadyList = range.allSatisfy { blocks[$0].listContainer?.kind == kind }

            if alreadyList {
                for index in range {
                    blocks[index].containers.removeAll { $0.isList || $0.kind == .listItem }
                }
                return
            }

            // Replace any existing list membership, then wrap the whole
            // selection in one list so consecutive paragraphs become siblings.
            let list = Self.makeList(kind: kind, ids: &ids)

            for index in range {
                blocks[index].containers.removeAll { $0.isList || $0.kind == .listItem }
                blocks[index].containers.append(list)
                blocks[index].containers.append(Self.makeListItem(kind: kind, ids: &ids))
                if blocks[index].tag == nil { blocks[index].tag = "p" }
                if case .codeLine = blocks[index].kind { blocks[index].kind = .paragraph }
            }
        }
    }

    // MARK: - List nesting

    /// Nest the selected items one level deeper, the way TenTap's indent button
    /// does on Android. Also bound to Tab.
    func indentList() {
        var generator = ids
        mutateBlocks { blocks, range in
            // Front to back, so the second of two selected siblings nests into
            // the list the first one just created.
            for index in range {
                Self.indent(&blocks, at: index, ids: &generator)
            }
        }
        ids = generator
    }

    /// Lift the selected items one level out; at depth 1 they leave the list
    /// entirely and become paragraphs.
    func outdentList() {
        var generator = ids
        mutateBlocks { blocks, range in
            // Back to front: lifting an item must not change the depth its
            // still-unprocessed siblings are measured against.
            for index in range.reversed() {
                Self.outdent(&blocks, at: index, ids: &generator)
            }
        }
        ids = generator
    }

    /// Tab and Shift-Tab only take over while the caret is in a list — anywhere
    /// else they keep their normal meaning.
    func indentListIfPossible() -> Bool {
        guard canIndentList else { return false }
        indentList()
        return true
    }

    func outdentListIfPossible() -> Bool {
        guard canOutdentList else { return false }
        outdentList()
        return true
    }

    func toggleBlockquote() {
        mutateBlocks { [self] blocks, range in
            let quoted = range.allSatisfy { blocks[$0].isInBlockquote }
            if quoted {
                for index in range {
                    if let last = blocks[index].containers.lastIndex(where: { $0.kind == .blockquote }) {
                        blocks[index].containers.remove(at: last)
                    }
                }
                return
            }
            // Outermost, so a quoted list stays a list inside the quote.
            let quoteID = ids.take()
            let container = NoteContainer(kind: .blockquote, id: quoteID, tag: "blockquote")
            for index in range {
                blocks[index].containers.insert(container, at: 0)
                if blocks[index].tag == nil { blocks[index].tag = "p" }
            }
        }
    }

    func toggleCodeBlock() {
        mutateBlocks { [self] blocks, range in
            let isCode = range.allSatisfy { blocks[$0].isInPreformatted }
            if isCode {
                for index in range {
                    blocks[index].containers.removeAll { $0.kind == .preformatted }
                    blocks[index].kind = .paragraph
                    blocks[index].tag = "p"
                    // Code carries no inline marks; nothing to unwind.
                }
                return
            }
            var container = NoteContainer(kind: .preformatted, id: ids.take(), tag: "pre")
            container.innerTag = "code"
            for index in range {
                blocks[index].containers.removeAll { $0.isList || $0.kind == .listItem }
                blocks[index].containers.append(container)
                blocks[index].kind = .codeLine
                blocks[index].tag = nil
                blocks[index].inlines = blocks[index].inlines.map {
                    NoteInline(text: $0.text, marks: [])
                }
            }
        }
    }

    func setAlignment(_ alignment: NoteAlignment) {
        mutateBlocks { blocks, range in
            for index in range { blocks[index].alignment = alignment }
        }
    }

    func insertHorizontalRule() {
        mutateBlocks { blocks, range in
            var rule = NoteBlock()
            rule.kind = .horizontalRule
            rule.tag = "hr"
            rule.containers = blocks[range.upperBound - 1].containers.filter { $0.kind == .blockquote }
            blocks.insert(rule, at: range.upperBound)
            // Always leave somewhere to keep typing.
            if range.upperBound + 1 >= blocks.count {
                var paragraph = NoteBlock()
                paragraph.tag = "p"
                blocks.append(paragraph)
            }
        }
    }

    /// Flip a task item's checkbox. `offset` is the character offset of the
    /// paragraph the user clicked, which is what `NoteTextView` hands back.
    func toggleTask(atParagraphOffset offset: Int) {
        var document = currentDocument()
        let starts = Self.paragraphStarts(of: document)
        guard let index = starts.firstIndex(of: offset),
              let item = document.blocks[index].listItemContainer,
              item.isTaskItem
        else { return }

        let checked = !item.isChecked
        for blockIndex in document.blocks.indices {
            guard
                let position = document.blocks[blockIndex].containers
                    .lastIndex(where: { $0.kind == .listItem && $0.id == item.id })
            else { continue }
            document.blocks[blockIndex].containers[position].isChecked = checked
        }

        render(
            document,
            selection: textView?.selectedRange() ?? NSRange(location: 0, length: 0),
            registersUndo: true
        )
        notifyChange()
    }

    /// Return on an empty list item leaves the list, the way every list editor
    /// behaves — without it there is no way out of a list from the keyboard.
    /// Returns true when it handled the key.
    func handleReturnOutOfEmptyListItem() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0 else { return false }

        let document = currentDocument()
        let starts = Self.paragraphStarts(of: document)
        guard let index = Self.blockIndex(containing: selection.location, in: starts, document: document),
              document.blocks[index].listItemContainer != nil,
              document.blocks[index].isEmpty
        else { return false }

        var updated = document
        updated.blocks[index].containers.removeAll { $0.isList || $0.kind == .listItem }
        render(updated, selection: selection, registersUndo: true)
        notifyChange()
        return true
    }

    // MARK: - Editing plumbing

    private func mutateBlocks(_ transform: (inout [NoteBlock], Range<Int>) -> Void) {
        guard let textView else { return }
        let selection = textView.selectedRange()
        var document = currentDocument()
        guard !document.blocks.isEmpty else { return }

        let starts = Self.paragraphStarts(of: document)
        let lower = Self.blockIndex(containing: selection.location, in: starts, document: document) ?? 0
        let upper = Self.blockIndex(
            containing: selection.location + selection.length,
            in: starts,
            document: document
        ) ?? lower

        transform(&document.blocks, lower..<(max(upper, lower) + 1))
        render(document, selection: selection, registersUndo: true)
        notifyChange()
    }

    private func render(_ document: NoteDocument, selection: NSRange, registersUndo: Bool) {
        guard let textView, let storage = textView.textStorage else { return }
        let attributed = NoteAttributedText.attributedString(for: document, theme: theme)

        isRendering = true
        defer { isRendering = false }

        let full = NSRange(location: 0, length: storage.length)
        if registersUndo, !textView.shouldChangeText(in: full, replacementString: nil) { return }

        storage.beginEditing()
        storage.setAttributedString(attributed)
        storage.endEditing()
        if registersUndo { textView.didChangeText() }

        let location = min(selection.location, attributed.length)
        let length = min(selection.length, attributed.length - location)
        textView.setSelectedRange(NSRange(location: location, length: length))

        updateDecorations(for: document)
        refreshState(document: document)
    }

    /// Re-derive display attributes after an appearance change without touching
    /// the document.
    private func restyleAll() {
        guard textView != nil else { return }
        render(
            currentDocument(),
            selection: textView?.selectedRange() ?? NSRange(location: 0, length: 0),
            registersUndo: false
        )
    }

    /// Called by the coordinator after the user types.
    func textDidChange() {
        guard !isRendering else { return }
        let document = currentDocument()
        updateDecorations(for: document)
        // Hand the document over rather than letting `refreshState` extract a
        // second one — this runs on every keystroke.
        refreshState(document: document)
        notifyChange()
    }

    func selectionDidChange() {
        guard !isRendering else { return }
        refreshState()
    }

    private func notifyChange() {
        guard !isRendering else { return }
        onChange?()
    }

    private func updateDecorations(for document: NoteDocument) {
        guard let textView else { return }
        let starts = Self.paragraphStarts(of: document)
        let markers = NoteAttributedText.listMarkers(for: document)

        var decorations = NoteTextView.Decorations()
        for (index, block) in document.blocks.enumerated() {
            let offset = starts[index]
            if let marker = markers[index] {
                decorations.markers[offset] = marker
                decorations.listIndent[offset] =
                    CGFloat(block.listDepth) * NoteAttributedText.Metrics.listIndent
            }
            let quotes = block.containers.filter { $0.kind == .blockquote }.count
            if quotes > 0 { decorations.quoteDepth[offset] = quotes }
            if block.kind == .horizontalRule { decorations.rules.insert(offset) }
        }
        textView.decorations = decorations
        textView.theme = theme
    }

    private func refreshState(document: NoteDocument? = nil) {
        guard let textView, let storage = textView.textStorage else { return }
        let selection = textView.selectedRange()

        if selection.length > 0 {
            var kinds: Set<NoteMark.Kind> = Set(NoteMark.Kind.allCases)
            storage.enumerateAttribute(NoteAttributedText.marksKey, in: selection) { value, _, _ in
                let marks = (value as? NoteAttributedText.MarksBox)?.marks ?? []
                kinds.formIntersection(Set(marks.map(\.kind)))
            }
            activeMarks = kinds
        } else {
            let marks = (textView.typingAttributes[NoteAttributedText.marksKey]
                as? NoteAttributedText.MarksBox)?.marks
                ?? (selection.location > 0
                    ? (storage.attribute(
                        NoteAttributedText.marksKey,
                        at: selection.location - 1,
                        effectiveRange: nil
                    ) as? NoteAttributedText.MarksBox)?.marks
                    : nil)
                ?? []
            activeMarks = Set(marks.map(\.kind))
        }

        activeBlock = block(in: storage, at: min(selection.location, max(storage.length - 1, 0)))
            ?? (textView.typingAttributes[NoteAttributedText.blockKey]
                as? NoteAttributedText.BlockBox)?.block
            ?? NoteBlock()

        let current = document ?? currentDocument()
        let starts = Self.paragraphStarts(of: current)
        if let index = Self.blockIndex(containing: selection.location, in: starts, document: current),
           current.blocks.indices.contains(index) {
            canIndentList = Self.canIndent(current.blocks, at: index)
            canOutdentList = current.blocks[index].listDepth >= 1
        } else {
            canIndentList = false
            canOutdentList = false
        }
    }

    private func block(in storage: NSTextStorage, at location: Int) -> NoteBlock? {
        guard storage.length > 0, location >= 0, location < storage.length else { return nil }
        return (storage.attribute(NoteAttributedText.blockKey, at: location, effectiveRange: nil)
            as? NoteAttributedText.BlockBox)?.block
    }

    // MARK: - Nesting mechanics

    /// All of the nesting logic is pure and lives off the main actor, because
    /// the thing that has to be right about it is the *HTML it produces* —
    /// `<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>`, with the nested
    /// list inside the previous item, exactly as Tiptap and TenTap write it.
    /// Keeping it out of the view layer is what lets the tests assert that
    /// directly instead of through an `NSTextView`.

    nonisolated static func makeList(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        var attributes: [HTMLAttribute] = []
        if kind == .taskList { attributes.append(HTMLAttribute("data-type", "taskList")) }
        return NoteContainer(
            kind: kind,
            id: ids.take(),
            tag: kind == .orderedList ? "ol" : "ul",
            attributes: attributes
        )
    }

    nonisolated static func makeListItem(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        var attributes: [HTMLAttribute] = []
        if kind == .taskList {
            attributes = [
                HTMLAttribute("data-checked", "false"),
                HTMLAttribute("data-type", "taskItem"),
            ]
        }
        return NoteContainer(kind: .listItem, id: ids.take(), tag: "li", attributes: attributes)
    }

    /// The container path down to and including the list item that belongs to
    /// the `depth`-th list. Depth 0 means "outside every list", which keeps an
    /// enclosing blockquote while dropping the list membership.
    nonisolated static func containerPrefix(
        _ containers: [NoteContainer],
        upToListDepth depth: Int
    ) -> [NoteContainer] {
        guard depth > 0 else {
            return containers.filter { !$0.isList && $0.kind != .listItem }
        }
        var result: [NoteContainer] = []
        var lists = 0
        for container in containers {
            result.append(container)
            if container.isList { lists += 1 }
            if lists == depth, container.kind == .listItem { return result }
        }
        return result
    }

    nonisolated static func listContainer(
        _ containers: [NoteContainer],
        atDepth depth: Int
    ) -> NoteContainer? {
        var lists = 0
        for container in containers where container.isList {
            lists += 1
            if lists == depth { return container }
        }
        return nil
    }

    /// The first item of a list has nothing to nest under, and two adjacent
    /// lists must never be merged by an indent — both are why this checks the
    /// previous block shares the *same* list, not merely the same depth.
    nonisolated static func canIndent(_ blocks: [NoteBlock], at index: Int) -> Bool {
        guard index > 0, blocks.indices.contains(index) else { return false }
        let depth = blocks[index].listDepth
        guard depth >= 1 else { return false }

        let previous = blocks[index - 1]
        guard previous.listDepth >= depth else { return false }
        guard
            let here = listContainer(blocks[index].containers, atDepth: depth),
            let there = listContainer(previous.containers, atDepth: depth),
            here.id == there.id
        else { return false }
        return true
    }

    nonisolated static func indent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        guard canIndent(blocks, at: index) else { return }
        let depth = blocks[index].listDepth
        let previous = blocks[index - 1]
        let kind = blocks[index].listContainer?.kind ?? .bulletList

        var path: [NoteContainer]
        if previous.listDepth > depth {
            // The previous item already contains a deeper list — join it as a
            // sibling rather than opening a second one beside it.
            path = containerPrefix(previous.containers, upToListDepth: depth + 1)
            if path.last?.kind == .listItem { path.removeLast() }
            let joined = listContainer(path, atDepth: depth + 1)?.kind ?? kind
            path.append(makeListItem(kind: joined, ids: &ids))
        } else {
            // Same depth: open a new list inside the previous item.
            path = containerPrefix(previous.containers, upToListDepth: depth)
            path.append(makeList(kind: kind, ids: &ids))
            path.append(makeListItem(kind: kind, ids: &ids))
        }
        blocks[index].containers = path
    }

    nonisolated static func outdent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        guard blocks.indices.contains(index) else { return }
        let depth = blocks[index].listDepth
        guard depth >= 1 else { return }

        if depth == 1 {
            blocks[index].containers = containerPrefix(blocks[index].containers, upToListDepth: 0)
            if blocks[index].tag == nil { blocks[index].tag = "p" }
            return
        }

        // Becomes a sibling of the item it was nested inside.
        var path = containerPrefix(blocks[index].containers, upToListDepth: depth - 1)
        if path.last?.kind == .listItem { path.removeLast() }
        let parent = listContainer(path, atDepth: depth - 1)?.kind ?? .bulletList
        path.append(makeListItem(kind: parent, ids: &ids))
        blocks[index].containers = path
    }

    // MARK: - Offsets

    /// Character offset each block starts at, in UTF-16 units — the unit
    /// `NSRange` and `NSTextStorage` count in.
    static func paragraphStarts(of document: NoteDocument) -> [Int] {
        var starts: [Int] = []
        var offset = 0
        for block in document.blocks {
            starts.append(offset)
            let length = block.kind == .horizontalRule ? 1 : (block.text as NSString).length
            offset += length + 1
        }
        return starts
    }

    static func blockIndex(containing location: Int, in starts: [Int], document: NoteDocument) -> Int? {
        guard !starts.isEmpty else { return nil }
        var result = 0
        for (index, start) in starts.enumerated() where start <= location {
            result = index
        }
        return result
    }
}
