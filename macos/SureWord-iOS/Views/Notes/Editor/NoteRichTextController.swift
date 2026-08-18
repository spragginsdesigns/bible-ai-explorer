import SwiftUI
import UIKit

/// Owns the note editor's text view and every formatting command the toolbar
/// exposes — the iOS counterpart of the macOS `NoteRichTextController`, over a
/// `UITextView` instead of an `NSTextView`. Same document model, same private
/// attribute keys, same HTML contract: the iOS port of TenTap's `Toolbar` on
/// Android, covering the same vocabulary those clients can produce.
///
/// Two different strategies, on purpose (same split as the Mac):
///
/// - **Inline marks** are applied by restyling the selected range in place.
///   They change no characters, so typing stays responsive.
/// - **Block structure** (headings, lists, quotes, code blocks) goes through
///   the document model and re-renders. Block changes are rare, and doing them
///   on the model is what makes "wrap these three paragraphs in one list" a
///   three-line operation instead of an attributed-string puzzle.
///
/// Serialising for a save reads the model back out of the text storage rather
/// than round-tripping UIKit's HTML importer — that path would rewrite every
/// tag into WebKit's CSS-laden dialect, which is precisely the destruction the
/// shared model exists to avoid.
@MainActor
@Observable
final class NoteRichTextController {

    /// Marks covering the whole selection — drives the toolbar's pressed state.
    private(set) var activeMarks: Set<NoteMark.Kind> = []
    /// The block at the caret, for the heading/list/quote pressed states.
    private(set) var activeBlock = NoteBlock()
    /// Whether the caret's item can be nested one level deeper / lifted one
    /// level out — drives the toolbar buttons.
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
        render(document, selection: NSRange(location: 0, length: 0))
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
        guard let textView else { return .empty }
        let trailing = (textView.typingAttributes[NoteAttributedText.blockKey]
            as? NoteAttributedText.BlockBox)?.block
        return NoteAttributedText.document(from: textView.textStorage, trailingBlock: trailing)
    }

    // MARK: - Inline marks

    func toggle(_ kind: NoteMark.Kind) {
        guard let textView else { return }
        let storage = textView.textStorage
        let selection = textView.selectedRange

        guard selection.length > 0 else {
            toggleTypingMark(kind)
            return
        }

        let shouldRemove = marksCoverSelection(kind, in: storage, range: selection)

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
        refreshState()
        notifyChange()
    }

    /// A link needs a value, so it is set rather than toggled. Passing `nil`
    /// removes it.
    func setLink(_ href: String?) {
        guard let textView else { return }
        let storage = textView.textStorage
        let selection = textView.selectedRange
        guard selection.length > 0 else { return }

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
    /// does on Android.
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
    /// paragraph the user tapped, which is what `NoteTextView` hands back.
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

        render(document, selection: textView?.selectedRange ?? NSRange(location: 0, length: 0))
        notifyChange()
    }

    /// Return on an empty list item leaves the list, the way every list editor
    /// behaves — without it there is no way out of a list from the keyboard.
    /// Returns true when it handled the key (the delegate must reject the
    /// insertion, since the re-render already replaced the document).
    func handleReturnOutOfEmptyListItem() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange
        guard selection.length == 0 else { return false }

        let document = currentDocument()
        let starts = Self.paragraphStarts(of: document)
        guard let index = Self.blockIndex(containing: selection.location, in: starts, document: document),
              document.blocks[index].listItemContainer != nil,
              document.blocks[index].isEmpty
        else { return false }

        var updated = document
        updated.blocks[index].containers.removeAll { $0.isList || $0.kind == .listItem }
        render(updated, selection: selection)
        notifyChange()
        return true
    }

    // MARK: - Editing plumbing

    private func mutateBlocks(_ transform: (inout [NoteBlock], Range<Int>) -> Void) {
        guard let textView else { return }
        let selection = textView.selectedRange
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
        render(document, selection: selection)
        notifyChange()
    }

    /// Replaces the whole text storage with the re-rendered document.
    ///
    /// Unlike the macOS original this does not consult the delegate or register
    /// with the undo manager: these are programmatic structural edits, and
    /// UIKit's typing undo does not track storage replacement anyway.
    private func render(_ document: NoteDocument, selection: NSRange) {
        guard let textView else { return }
        let storage = textView.textStorage
        let attributed = NoteAttributedText.attributedString(for: document, theme: theme)

        isRendering = true
        defer { isRendering = false }

        storage.beginEditing()
        storage.setAttributedString(attributed)
        storage.endEditing()

        let location = min(selection.location, attributed.length)
        let length = min(selection.length, attributed.length - location)
        textView.selectedRange = NSRange(location: location, length: length)

        // UITextView recomputes its typing attributes after the storage swap
        // and strips the private block/mark keys when it does — and for an
        // empty trailing paragraph there is no character to recompute them
        // from at all. Pin them from the document instead: the caret's block,
        // marks cleared (a fresh paragraph does not inherit marks, matching
        // the Mac, whose separator newlines carry no marks either).
        let starts = Self.paragraphStarts(of: document)
        if let index = Self.blockIndex(containing: location, in: starts, document: document),
           document.blocks.indices.contains(index) {
            textView.typingAttributes = NoteAttributedText.attributes(
                for: document.blocks[index],
                theme: theme
            )
        }

        updateDecorations(for: document)
        refreshState(document: document)
    }

    /// Re-derive display attributes after an appearance change without touching
    /// the document.
    private func restyleAll() {
        guard textView != nil else { return }
        render(
            currentDocument(),
            selection: textView?.selectedRange ?? NSRange(location: 0, length: 0)
        )
    }

    /// Called by the coordinator after the user types.
    func textDidChange() {
        guard !isRendering else { return }
        restoreTypingAttributes()
        let document = currentDocument()
        updateDecorations(for: document)
        // Hand the document over rather than letting `refreshState` extract a
        // second one — this runs on every keystroke.
        refreshState(document: document)
        notifyChange()
    }

    func selectionDidChange() {
        guard !isRendering else { return }
        restoreTypingAttributes()
        refreshState()
    }

    /// UITextView recomputes its typing attributes from the character before
    /// the caret on selection changes and strips the private block/mark keys
    /// when it does. Left alone, typing inside bold text would *render* bold
    /// (the UIFont trait survives) but serialise without the `<strong>`.
    /// Restoring the neighbour's full attribute set keeps the semantic model
    /// attached to the caret.
    ///
    /// Two deliberate exceptions:
    /// - **Empty paragraphs keep a pinned context.** Their block was pinned by
    ///   `render` (their only storage character, the terminating newline,
    ///   belongs to the *previous* block, so a naive restore would resurrect
    ///   the structure of a list the user just left), and keeping it also
    ///   preserves a mark the user explicitly toggled at the caret. If UIKit
    ///   stripped the keys anyway, the neighbour restore still runs — that is
    ///   what NSTextView's typing attributes produce on the Mac in the same
    ///   spot.
    /// - A neighbour without our keys (foreign paste, for instance) never
    ///   clobbers a pinned context.
    private func restoreTypingAttributes() {
        guard let textView else { return }
        let storage = textView.textStorage
        guard textView.selectedRange.length == 0, storage.length > 0 else { return }

        let caret = min(textView.selectedRange.location, storage.length)
        let paragraph = (storage.string as NSString).paragraphRange(
            for: NSRange(location: caret, length: 0)
        )
        // An empty paragraph is just its terminating newline (or nothing, at
        // the very end), and that newline belongs to the *previous* block —
        // so when the caret's context was pinned by `render` (or a mark was
        // explicitly toggled), keep it rather than resurrecting the structure
        // of a list the user just left. If UIKit stripped the keys anyway,
        // fall through to the neighbour, which is what NSTextView's typing
        // attributes produce on the Mac in the same spot.
        if paragraph.length <= 1,
           textView.typingAttributes[NoteAttributedText.blockKey] != nil {
            return
        }

        let probe = caret > 0 ? caret - 1 : 0
        guard probe < storage.length else { return }
        let attributes = storage.attributes(at: probe, effectiveRange: nil)
        guard attributes[NoteAttributedText.blockKey] != nil else { return }
        textView.typingAttributes = attributes
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
        guard let textView else { return }
        let storage = textView.textStorage
        let selection = textView.selectedRange

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

    // MARK: - Shared editing primitives

    /// The pure operations live in `NoteListEditing` (Shared/) so the macOS and
    /// iOS controllers produce byte-identical HTML; these forwarders keep call
    /// sites and tests on the controller, mirroring the macOS API.
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
