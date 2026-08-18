import Testing
@testable import SureWord

/// List nesting on iOS — the same assertions the macOS `NoteListNestingTests`
/// suite makes, run against the iOS controller's static API (which forwards to
/// the shared `NoteListEditing`, so the two platforms cannot drift).
///
/// The assertions are on the **HTML**, not on the container model, because the
/// contract is that a list nested here is byte-identical to one nested on
/// Android or the web: the child `<ul>` lives *inside* the previous `<li>`.
@Suite("List nesting (iOS)")
struct NoteListNestingIOSTests {

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

    @Test("Indenting the second item nests it inside the first, as Tiptap writes it")
    func indentProducesAndroidNesting() {
        let flat = "<ul><li><p>Old Testament</p></li><li><p>Genesis</p></li></ul>"
        #expect(
            indent(flat, at: 1)
                == "<ul><li><p>Old Testament</p><ul><li><p>Genesis</p></li></ul></li></ul>"
        )
    }

    @Test("Ordered lists nest as ordered lists")
    func indentKeepsOrderedKind() {
        #expect(
            indent("<ol><li><p>one</p></li><li><p>two</p></li></ol>", at: 1)
                == "<ol><li><p>one</p><ol><li><p>two</p></li></ol></li></ol>"
        )
    }

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

    @Test("The first item of a list cannot be indented")
    func firstItemCannotIndent() {
        let flat = "<ul><li><p>a</p></li><li><p>b</p></li></ul>"
        let blocks = NoteHTMLParser.parse(flat).blocks
        #expect(!NoteRichTextController.canIndent(blocks, at: 0))
        #expect(NoteRichTextController.canIndent(blocks, at: 1))
        #expect(indent(flat, at: 0) == flat)
    }

    @Test("Indenting does not merge two adjacent lists")
    func adjacentListsDoNotMerge() {
        let html = "<ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>"
        let blocks = NoteHTMLParser.parse(html).blocks
        #expect(!NoteRichTextController.canIndent(blocks, at: 1))
        #expect(indent(html, at: 1) == html)
    }

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

    @Test("Outdenting inside a blockquote keeps the quote")
    func outdentKeepsEnclosingBlockquote() {
        let html = "<blockquote><ul><li><p>a</p></li></ul></blockquote>"
        #expect(outdent(html, at: 0) == "<blockquote><p>a</p></blockquote>")
    }
}
