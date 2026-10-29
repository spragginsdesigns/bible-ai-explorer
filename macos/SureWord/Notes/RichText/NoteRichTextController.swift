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

    var textScale: CGFloat = 1 {
        didSet {
            guard textScale != oldValue else { return }
            textView?.textScale = textScale
            restyleAll()
        }
    }

    var theme: SureWordColors = .dark {
        didSet {
            guard oldValue != theme else { return }
            restyleAll()
        }
    }

    /// Fired on every user edit; the editor model debounces it into an autosave.
    var onChange: (@MainActor () -> Void)?
    /// Set synchronously before AI preflight yields; native/custom edits share this gate.
    var allowsUserEditing = true {
        didSet { applyEditingPermission() }
    }
    /// Presentation permission is independent of the model's AI readiness gate.
    @ObservationIgnored var isEditingSurfaceEnabled = true {
        didSet { applyEditingPermission() }
    }

    /// The note a `[[wikilink]]` target opens, or nil while none carries that
    /// name. The editor model points it at the notes library.
    @ObservationIgnored var resolveWikilink: (@MainActor (String) -> String?)?
    /// Opens the note behind a resolved `[[wikilink]]` the user clicked. The
    /// editor view sets it, since opening a note is navigation.
    @ObservationIgnored var onOpenWikilink: (@MainActor (String) -> Void)?

    /// Attaching the view is what flushes a document that was loaded before it
    /// existed — see `pendingHTML`.
    @ObservationIgnored weak var textView: NoteTextView? {
        didSet {
            applyEditingPermission()
            guard textView != nil, let html = pendingHTML else { return }
            pendingHTML = nil
            load(html: html)
        }
    }

    private func applyEditingPermission() {
        guard let textView else { return }
        textView.isEditable = allowsUserEditing && isEditingSurfaceEnabled
        if !textView.isEditable, let window = textView.window, window.firstResponder === textView {
            window.makeFirstResponder(nil)
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
        textView?.clearEditingUndo()
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

    // MARK: - Text insertion

    /// Insert plain text at the caret (replacing any selection) the way typing
    /// does: with the caret's typing attributes and through `NSTextView`'s own
    /// change path, so it lands on the undo stack and autosaves. The iOS
    /// controller's `insertText` and Android's wikilink insert do the same.
    func insertText(_ text: String) {
        guard allowsUserEditing else { return }
        guard let textView, !text.isEmpty else { return }
        // The picker that called this held focus; typing carries on after it.
        textView.window?.makeFirstResponder(textView)
        textView.insertText(text, replacementRange: textView.selectedRange())
    }

    // MARK: - Inline marks

    func toggle(_ kind: NoteMark.Kind) {
        guard allowsUserEditing else { return }
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
                NoteAttributedText.runAttributes(block: block, marks: marks, theme: theme, scale: textScale),
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
        guard allowsUserEditing else { return }
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
                NoteAttributedText.runAttributes(block: block, marks: marks, theme: theme, scale: textScale),
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
            theme: theme,
            scale: textScale
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return false }
        guard canIndentList else { return false }
        indentList()
        return true
    }

    func outdentListIfPossible() -> Bool {
        guard allowsUserEditing else { return false }
        guard canOutdentList else { return false }
        outdentList()
        return true
    }

    func toggleBlockquote() {
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
        mutateBlocks { blocks, range in
            for index in range { blocks[index].alignment = alignment }
        }
    }

    func insertHorizontalRule() {
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return }
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
        guard allowsUserEditing else { return false }
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
        let attributed = NoteAttributedText.attributedString(for: document, theme: theme, scale: textScale)

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
        // NSTextView may retain its old typing font across a storage swap.
        // Refresh display attributes without registering an edit or undo step.
        if attributed.length > 0 {
            textView.typingAttributes = attributed.attributes(at: min(location, attributed.length - 1), effectiveRange: nil)
        } else {
            textView.typingAttributes = NoteAttributedText.runAttributes(block: NoteBlock(), marks: [], theme: theme, scale: textScale)
        }

        updateDecorations(for: document)
        refreshState(document: document)
    }

    /// Re-derive display attributes after an appearance change without touching
    /// the document.
    private func restyleAll() {
        guard let textView else { return }
        // Pending marks at an empty caret are not in the document yet. A
        // display-only rescale must retain them without adding an edit.
        let typing = textView.typingAttributes
        let block = (typing[NoteAttributedText.blockKey] as? NoteAttributedText.BlockBox)?.block
        let marks = (typing[NoteAttributedText.marksKey] as? NoteAttributedText.MarksBox)?.marks ?? []
        render(
            currentDocument(),
            selection: textView.selectedRange(),
            registersUndo: false
        )
        if let block {
            textView.typingAttributes = NoteAttributedText.runAttributes(block: block, marks: marks, theme: theme, scale: textScale)
            refreshState()
        }
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
                    CGFloat(block.listDepth) * NoteAttributedText.Metrics.listIndent * textScale
            }
            let quotes = block.containers.filter { $0.kind == .blockquote }.count
            if quotes > 0 { decorations.quoteDepth[offset] = quotes }
            if block.kind == .horizontalRule { decorations.rules.insert(offset) }
        }
        textView.decorations = decorations
        textView.theme = theme
        styleWikilinks()
    }

    // MARK: - Wikilinks

    /// Redraw the `[[wikilinks]]` after the notes they point at changed (one
    /// was created, renamed or given an alias). Display only: no autosave, no
    /// undo step.
    func refreshWikilinks() {
        styleWikilinks()
    }

    /// Runs after every render and keystroke, from `updateDecorations`. Skipped
    /// while an input method is composing, so restyling never disturbs the
    /// marked text; the commit that ends it is a change and runs it again.
    private func styleWikilinks() {
        guard let textView, let storage = textView.textStorage, !textView.hasMarkedText() else { return }
        let links = NoteWikilinks.matches(in: storage.string).map {
            NoteAttributedText.DrawnWikilink(range: $0.range, noteID: resolveWikilink?($0.target) ?? "")
        }
        NoteAttributedText.styleWikilinks(links, in: storage, theme: theme, scale: textScale)
        // Typing right after a link would otherwise carry its colour onto the
        // next character until the following pass.
        if textView.typingAttributes[NoteAttributedText.wikilinkKey] != nil,
           let plain = NoteAttributedText.withoutWikilink(textView.typingAttributes, theme: theme, scale: textScale) {
            textView.typingAttributes = plain
        }
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

    /// All of the nesting and offset logic is pure and lives in the shared
    /// `NoteListEditing`, because the thing that has to be right about it is
    /// the *HTML it produces* — `<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>`,
    /// with the nested list inside the previous item, exactly as Tiptap and
    /// TenTap write it. These forwarders keep the call sites (and the test
    /// suite) on this controller while the iOS controller shares the same
    /// implementation, so an indent produces byte-identical markup on all three
    /// clients.

    nonisolated static func makeList(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        NoteListEditing.makeList(kind: kind, ids: &ids)
    }

    nonisolated static func makeListItem(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        NoteListEditing.makeListItem(kind: kind, ids: &ids)
    }

    nonisolated static func containerPrefix(
        _ containers: [NoteContainer],
        upToListDepth depth: Int
    ) -> [NoteContainer] {
        NoteListEditing.containerPrefix(containers, upToListDepth: depth)
    }

    nonisolated static func listContainer(
        _ containers: [NoteContainer],
        atDepth depth: Int
    ) -> NoteContainer? {
        NoteListEditing.listContainer(containers, atDepth: depth)
    }

    nonisolated static func canIndent(_ blocks: [NoteBlock], at index: Int) -> Bool {
        NoteListEditing.canIndent(blocks, at: index)
    }

    nonisolated static func indent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        NoteListEditing.indent(&blocks, at: index, ids: &ids)
    }

    nonisolated static func outdent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        NoteListEditing.outdent(&blocks, at: index, ids: &ids)
    }

    /// Character offset each block starts at, in UTF-16 units — the unit
    /// `NSRange` and `NSTextStorage` count in.
    nonisolated static func paragraphStarts(of document: NoteDocument) -> [Int] {
        NoteListEditing.paragraphStarts(of: document)
    }

    nonisolated static func blockIndex(
        containing location: Int,
        in starts: [Int],
        document: NoteDocument
    ) -> Int? {
        NoteListEditing.blockIndex(containing: location, in: starts, document: document)
    }
}
