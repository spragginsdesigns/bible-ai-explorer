import Testing
@testable import SureWord

/// Creating nested lists — the capability Android has through TenTap's indent
/// button and macOS was missing.
///
/// The assertions are on the **HTML**, not on the container model, because the
/// contract is that a list nested here is byte-identical to one nested on
/// Android or the web: the child `<ul>` lives *inside* the previous `<li>`, not
/// beside it. Getting that wrong still renders correctly here and quietly
/// produces a different document for the other two clients.
@Suite("List nesting")
struct NoteListNestingTests {

    /// Applies an operation to one block of a parsed document and returns the
    /// HTML it serialises to — the same path the editor takes.
    private func apply(
        _ html: String,
        at index: Int,
        _ operation: (inout [NoteBlock], Int, inout NoteContainerIDGenerator) -> Void
    ) -> String {
        var document = NoteHTMLParser.parse(html)
        var ids = NoteContainerIDGenerator(after: document)
        operation(&document.blocks, index, &ids)
        return NoteHTMLSerializer.serialize(document)
    }

    private func indent(_ html: String, at index: Int) -> String {
        apply(html, at: index) { blocks, i, ids in
            NoteRichTextController.indent(&blocks, at: i, ids: &ids)
        }
    }

    private func outdent(_ html: String, at index: Int) -> String {
        apply(html, at: index) { blocks, i, ids in
            NoteRichTextController.outdent(&blocks, at: i, ids: &ids)
        }
    }

    // MARK: - Indent

    /// The exact shape `preservesNestedLists` round-trips, now produced from a
    /// flat list by an indent.
    @Test("Indenting the second item nests it inside the first, as Tiptap writes it")
    func indentProducesAndroidNesting() {
        let flat = "<ul><li><p>Old Testament</p></li><li><p>Genesis</p></li></ul>"
        #expect(
            indent(flat, at: 1)
                == "<ul><li><p>Old Testament</p><ul><li><p>Genesis</p></li></ul></li></ul>"
        )
    }

    @Test("Nested output round-trips through the parser unchanged")
    func nestedOutputRoundTrips() {
        let nested = indent("<ul><li><p>a</p></li><li><p>b</p></li></ul>", at: 1)
        #expect(NoteHTMLSerializer.serialize(NoteHTMLParser.parse(nested)) == nested)
    }

    @Test("Ordered lists nest as ordered lists")
    func indentKeepsOrderedKind() {
        #expect(
            indent("<ol><li><p>one</p></li><li><p>two</p></li></ol>", at: 1)
                == "<ol><li><p>one</p><ol><li><p>two</p></li></ol></li></ol>"
        )
    }

    /// The nested list needs `data-type="taskList"` and the new item needs
    /// `data-checked`, or Tiptap parses it back as a plain bullet list.
    @Test("Task lists nest with their data attributes intact")
    func indentKeepsTaskAttributes() {
        let flat = """
            <ul data-type="taskList">\
            <li data-checked="false" data-type="taskItem"><div><p>a</p></div></li>\
            <li data-checked="false" data-type="taskItem"><div><p>b</p></div></li>\
            </ul>
            """
        let nested = indent(flat, at: 1)
        #expect(nested.contains(#"<ul data-type="taskList"><li data-checked="false" data-type="taskItem">"#))
        // The nested list opens inside the first item, before its closing tags.
        #expect(nested.hasSuffix("</div></li></ul></div></li></ul>"))
        #expect(NoteHTMLSerializer.serialize(NoteHTMLParser.parse(nested)) == nested)
    }

    @Test("A third item joins the list the second one is already in")
    func thirdItemJoinsExistingNestedList() {
        let flat = "<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>"
        var document = NoteHTMLParser.parse(flat)
        var ids = NoteContainerIDGenerator(after: document)
        NoteRichTextController.indent(&document.blocks, at: 1, ids: &ids)
        NoteRichTextController.indent(&document.blocks, at: 2, ids: &ids)

        #expect(
            NoteHTMLSerializer.serialize(document)
                == "<ul><li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li></ul>"
        )
    }

    @Test("Indenting twice reaches a third level")
    func indentsToThirdLevel() {
        let flat = "<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>"
        var document = NoteHTMLParser.parse(flat)
        var ids = NoteContainerIDGenerator(after: document)
        NoteRichTextController.indent(&document.blocks, at: 1, ids: &ids)
        NoteRichTextController.indent(&document.blocks, at: 2, ids: &ids)
        NoteRichTextController.indent(&document.blocks, at: 2, ids: &ids)

        let html = NoteHTMLSerializer.serialize(document)
        #expect(
            html == "<ul><li><p>a</p><ul><li><p>b</p><ul><li><p>c</p></li></ul></li></ul></li></ul>"
        )
        #expect(NoteHTMLSerializer.serialize(NoteHTMLParser.parse(html)) == html)
    }

    // MARK: - Guards

    @Test("The first item of a list cannot be indented")
    func firstItemCannotIndent() {
        let flat = "<ul><li><p>a</p></li><li><p>b</p></li></ul>"
        let blocks = NoteHTMLParser.parse(flat).blocks
        #expect(!NoteRichTextController.canIndent(blocks, at: 0))
        #expect(NoteRichTextController.canIndent(blocks, at: 1))
        #expect(indent(flat, at: 0) == flat)
    }

    /// Two lists that happen to sit next to each other are two lists. Indenting
    /// the second one's first item must not weld them into one.
    @Test("Indenting does not merge two adjacent lists")
    func adjacentListsDoNotMerge() {
        let html = "<ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>"
        let blocks = NoteHTMLParser.parse(html).blocks
        #expect(!NoteRichTextController.canIndent(blocks, at: 1))
        #expect(indent(html, at: 1) == html)
    }

    @Test("A paragraph outside any list cannot be indented or outdented")
    func plainParagraphIsUnaffected() {
        let html = "<p>plain</p>"
        let blocks = NoteHTMLParser.parse(html).blocks
        #expect(!NoteRichTextController.canIndent(blocks, at: 0))
        #expect(blocks[0].listDepth == 0)
        #expect(outdent(html, at: 0) == html)
    }

    // MARK: - Outdent

    @Test("Outdenting a nested item makes it a sibling of its parent")
    func outdentLiftsOneLevel() {
        let nested = "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>"
        #expect(outdent(nested, at: 1) == "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
    }

    @Test("Indent then outdent returns the original document")
    func indentThenOutdentIsIdentity() {
        let flat = "<ul><li><p>a</p></li><li><p>b</p></li></ul>"
        #expect(outdent(indent(flat, at: 1), at: 1) == flat)
    }

    @Test("Outdenting at depth one leaves the list entirely")
    func outdentAtDepthOneLeavesTheList() {
        #expect(
            outdent("<ul><li><p>a</p></li><li><p>b</p></li></ul>", at: 1)
                == "<ul><li><p>a</p></li></ul><p>b</p>"
        )
    }

    /// A quoted list lifts out of the list but stays in the quote — dropping the
    /// blockquote would be an edit the user never asked for.
    @Test("Outdenting inside a blockquote keeps the quote")
    func outdentKeepsEnclosingBlockquote() {
        let html = "<blockquote><ul><li><p>a</p></li></ul></blockquote>"
        #expect(outdent(html, at: 0) == "<blockquote><p>a</p></blockquote>")
    }

    @Test("Outdenting a third-level item lands at the second level")
    func outdentFromThirdLevel() {
        let html = "<ul><li><p>a</p><ul><li><p>b</p><ul><li><p>c</p></li></ul></li></ul></li></ul>"
        #expect(
            outdent(html, at: 2)
                == "<ul><li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li></ul>"
        )
    }

    // MARK: - Path helpers

    @Test("Container prefix stops at the item owning the requested list depth")
    func containerPrefixStopsAtDepth() {
        let blocks = NoteHTMLParser.parse(
            "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>"
        ).blocks
        let deep = blocks[1].containers
        #expect(deep.count == 4)

        let atOne = NoteRichTextController.containerPrefix(deep, upToListDepth: 1)
        #expect(atOne.count == 2)
        #expect(atOne.last?.kind == .listItem)

        // Depth 0 drops list membership but keeps everything else.
        #expect(NoteRichTextController.containerPrefix(deep, upToListDepth: 0).isEmpty)
    }

    @Test("Depth 0 prefix keeps non-list containers")
    func depthZeroKeepsBlockquote() {
        let blocks = NoteHTMLParser.parse(
            "<blockquote><ul><li><p>a</p></li></ul></blockquote>"
        ).blocks
        let kept = NoteRichTextController.containerPrefix(blocks[0].containers, upToListDepth: 0)
        #expect(kept.map(\.kind) == [.blockquote])
    }
}
