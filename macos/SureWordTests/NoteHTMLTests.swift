import Testing
@testable import SureWord

/// Round-trip fidelity for note HTML.
///
/// Note bodies are shared with Tiptap v3 on the web and TenTap on Android, so
/// the contract this suite pins is: **HTML another client wrote must survive
/// being opened and saved here.** The fixtures are the markup those two editors
/// actually emit — Tiptap's `getHTML()` shapes, and the `marked` output the
/// backend writes through `markdownToNoteHtml` when the AI appends to a note.
///
/// Where output differs from input it is only ever *normalisation to Tiptap's
/// own canonical form* — the same rewrite the web client performs on its next
/// save — and each case is asserted explicitly rather than waved through.
@Suite("Note HTML round-trip")
struct NoteHTMLTests {

    private func roundTrip(_ html: String) -> String {
        NoteHTMLSerializer.serialize(NoteHTMLParser.parse(html))
    }

    // MARK: - Exact round trips (Tiptap-canonical input)

    @Test("Preserves a full Tiptap document byte for byte")
    func preservesTiptapDocument() {
        let html = """
            <h1>Justification by Faith</h1><p>Paul writes that <strong>the just</strong> \
            shall live by <em>faith</em>, and that this is <u>not of works</u>.</p>\
            <blockquote><p>For therein is the righteousness of God revealed.</p></blockquote>\
            <ul><li><p>Romans 1:17</p></li><li><p>Galatians 3:11</p></li></ul>\
            <ol><li><p>Hear</p></li><li><p>Believe</p></li></ol>\
            <p>See <a href="https://sureword.app">SureWord</a> and <code>Romans 5:1</code>.</p>\
            <hr><p><s>Struck</s> and <mark>highlighted</mark>.</p>
            """
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves a Tiptap task list, checkbox markup included")
    func preservesTaskList() {
        let html = """
            <ul data-type="taskList">\
            <li data-checked="true" data-type="taskItem">\
            <label><input type="checkbox" checked="checked"><span></span></label>\
            <div><p>Read Romans 8</p></div></li>\
            <li data-checked="false" data-type="taskItem">\
            <label><input type="checkbox"><span></span></label>\
            <div><p>Memorise Psalm 23</p></div></li>\
            </ul>
            """
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves nested lists")
    func preservesNestedLists() {
        let html = """
            <ul><li><p>Old Testament</p><ul><li><p>Genesis</p></li></ul></li></ul>
            """
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves text alignment set by the web TextAlign extension")
    func preservesTextAlign() {
        let html = #"<h2 style="text-align: center">Selah</h2><p style="text-align: right">— David</p>"#
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves a code block and its language class")
    func preservesCodeBlock() {
        let html = "<pre><code class=\"language-text\">line one\nline two</code></pre>"
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves hard breaks inside a paragraph")
    func preservesHardBreaks() {
        #expect(roundTrip("<p>one<br>two<br>three</p>") == "<p>one<br>two<br>three</p>")
    }

    /// `<b>`/`<i>` come from pasted or AI-authored markup. Rewriting them to
    /// `<strong>`/`<em>` would be a silent edit to someone else's document.
    @Test("Keeps the original tag for a mark rather than normalising it")
    func keepsOriginalMarkTags() {
        let html = "<p><b>bold</b> and <i>italic</i></p>"
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves every attribute on a link")
    func preservesLinkAttributes() {
        let html = """
            <p><a target="_blank" rel="noopener noreferrer nofollow" \
            class="text-amber-400 underline" href="https://sureword.app">SureWord</a></p>
            """
        #expect(roundTrip(html) == html)
    }

    @Test("Keeps two adjacent lists apart instead of welding them together")
    func keepsAdjacentListsApart() {
        let html = "<ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>"
        #expect(roundTrip(html) == html)
    }

    @Test("Keeps two adjacent blockquotes apart")
    func keepsAdjacentQuotesApart() {
        let html = "<blockquote><p>a</p></blockquote><blockquote><p>b</p></blockquote>"
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves an empty document the way Tiptap writes it")
    func preservesEmptyDocument() {
        #expect(roundTrip("<p></p>") == "<p></p>")
    }

    @Test("Preserves a blockquote wrapping a list")
    func preservesQuotedList() {
        let html = "<blockquote><ul><li><p>quoted item</p></li></ul></blockquote>"
        #expect(roundTrip(html) == html)
    }

    @Test("Preserves nested marks in their original nesting order")
    func preservesNestedMarks() {
        let html = "<p><strong>bold <em>and italic</em></strong> tail</p>"
        #expect(roundTrip(html) == html)
    }

    // MARK: - Normalisations, asserted rather than assumed

    /// `marked` (the backend's markdown converter) indents its output and puts
    /// bare text in `<li>`. Tiptap parses both and re-emits the canonical form,
    /// which is what this produces.
    @Test("Normalises backend markdown output to Tiptap's canonical shape")
    func normalisesMarkedOutput() {
        let html = """
            <h2>Grace</h2>
            <p>By grace are ye saved through faith.</p>
            <ul>
            <li>Ephesians 2:8</li>
            <li>Titus 3:5</li>
            </ul>
            """
        #expect(
            roundTrip(html) == "<h2>Grace</h2><p>By grace are ye saved through faith.</p>"
                + "<ul><li><p>Ephesians 2:8</p></li><li><p>Titus 3:5</p></li></ul>"
        )
    }

    /// Entities decode on the way in and re-encode only where a browser's
    /// `innerHTML` would — `&`, `<`, `>` and the non-breaking space.
    @Test("Round-trips entities the way innerHTML does")
    func normalisesEntities() {
        let html = "<p>Grace &amp; peace &mdash; &quot;hello&quot;&nbsp;world</p>"
        #expect(roundTrip(html) == "<p>Grace &amp; peace — \"hello\"&nbsp;world</p>")
    }

    @Test("Drops whitespace between block elements")
    func dropsInterBlockWhitespace() {
        #expect(roundTrip("<p>one</p>\n  <p>two</p>") == "<p>one</p><p>two</p>")
    }

    @Test("Collapses runs of whitespace inside a paragraph")
    func collapsesInnerWhitespace() {
        #expect(roundTrip("<p>one    two\n\tthree</p>") == "<p>one two three</p>")
    }

    // MARK: - Idempotency

    /// The real guarantee: whatever the first save rewrites, no later save
    /// rewrites again. Without this a note could drift a little on every open.
    @Test(
        "Serialising is idempotent",
        arguments: [
            "<h1>Title</h1><p>Body</p>",
            "<ul><li>bare</li></ul>",
            "<p>Grace &amp; peace &mdash; done</p>",
            "<h2>Grace</h2>\n<p>Indented</p>\n<ul>\n<li>item</li>\n</ul>",
            "<blockquote><p>quote</p></blockquote><p>after</p>",
            "<pre><code>a\nb\n</code></pre>",
            "<p>text<br>break</p><hr><p>end</p>",
            #"<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li></ul>"#,
        ]
    )
    func serialisingIsIdempotent(html: String) {
        let once = roundTrip(html)
        #expect(roundTrip(once) == once)
    }

    // MARK: - Robustness

    @Test("Survives unclosed tags without losing text")
    func survivesUnclosedTags() {
        let text = NoteHTMLParser.parse("<p>first<p>second").plainText
        #expect(text.contains("first"))
        #expect(text.contains("second"))
    }

    @Test("Treats a stray less-than as text rather than eating the document")
    func survivesStrayAngleBracket() {
        #expect(roundTrip("<p>5 < 7 is true</p>") == "<p>5 &lt; 7 is true</p>")
    }

    @Test("Drops scripts and styles entirely")
    func dropsActiveContent() {
        let html = "<p>keep</p><script>alert(1)</script><style>p{color:red}</style>"
        #expect(roundTrip(html) == "<p>keep</p>")
    }

    @Test("Keeps an unknown inline element instead of discarding it")
    func keepsUnknownInlineElements() {
        let html = #"<p><span class="verse-ref">John 3:16</span></p>"#
        #expect(roundTrip(html) == html)
    }

    @Test("Reads an empty list item as an editable empty line")
    func emptyListItemSurvives() {
        let document = NoteHTMLParser.parse("<ul><li></li></ul>")
        #expect(document.blocks.count == 1)
        #expect(document.blocks[0].listItemContainer != nil)
    }

    // MARK: - Model shape

    @Test("Parses headings, marks and containers into the expected model")
    func parsesIntoModel() throws {
        let document = NoteHTMLParser.parse(
            "<h2>Faith</h2><blockquote><p>Now <strong>faith</strong> is</p></blockquote>"
        )
        #expect(document.blocks.count == 2)
        #expect(document.blocks[0].headingLevel == 2)
        #expect(document.blocks[0].text == "Faith")
        #expect(document.blocks[1].isInBlockquote)
        #expect(document.blocks[1].inlines.count == 3)
        #expect(document.blocks[1].inlines[1].has(.bold))
    }

    @Test("Reads text-align out of the style attribute")
    func readsAlignment() {
        let document = NoteHTMLParser.parse(#"<p style="text-align: center">x</p>"#)
        #expect(document.blocks[0].alignment == .center)
    }

    @Test("Writes text-align back into the style attribute")
    func writesAlignment() {
        var block = NoteBlock()
        block.tag = "p"
        block.alignment = .right
        #expect(block.attributes.value(of: "style") == "text-align: right")
        block.alignment = .natural
        #expect(block.attributes.value(of: "style") == nil)
    }

    @Test("Numbers ordered lists and marks task state")
    func computesListMarkers() {
        let document = NoteHTMLParser.parse(
            "<ol><li><p>one</p></li><li><p>two</p></li></ol>"
                + #"<ul data-type="taskList"><li data-checked="true" data-type="taskItem">"#
                + "<div><p>done</p></div></li></ul>"
        )
        let markers = NoteAttributedText.listMarkers(for: document)
        #expect(markers[0] == "1.")
        #expect(markers[1] == "2.")
        #expect(markers[2] == "☑")
    }
}

/// The other half of the loop: the model has to survive the trip through the
/// `NSAttributedString` the text view actually edits, or formatting would be
/// lost between opening a note and saving it even with no edit at all.
@Suite("Note attributed-string round-trip")
@MainActor
struct NoteAttributedTextTests {

    private func roundTrip(_ html: String) -> String {
        let document = NoteHTMLParser.parse(html)
        let attributed = NoteAttributedText.attributedString(for: document, theme: .dark)
        return NoteHTMLSerializer.serialize(NoteAttributedText.document(from: attributed))
    }

    @Test(
        "Survives the attributed-string round trip",
        arguments: [
            "<h1>Title</h1><p>Body with <strong>bold</strong> and <em>italic</em>.</p>",
            "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
            "<ol><li><p>first</p></li></ol>",
            "<blockquote><p>quoted</p></blockquote><p>after</p>",
            "<pre><code>a\nb</code></pre>",
            "<p>hard<br>break</p>",
            #"<p><a href="https://sureword.app">link</a></p>"#,
            "<p><mark>highlighted</mark> and <code>code</code></p>",
            #"<p style="text-align: center">centred</p>"#,
            #"<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>"#,
            "<p>a</p><hr><p>b</p>",
            "<ul><li><p>Old</p><ul><li><p>New</p></li></ul></li></ul>",
        ]
    )
    func survivesAttributedRoundTrip(html: String) {
        #expect(roundTrip(html) == html)
    }

    @Test("Paragraph offsets line up with the text the view holds")
    func paragraphOffsetsMatchStorage() {
        let document = NoteHTMLParser.parse("<p>one</p><p>two</p><p>three</p>")
        let attributed = NoteAttributedText.attributedString(for: document, theme: .dark)
        let starts = NoteRichTextController.paragraphStarts(of: document)

        #expect(starts == [0, 4, 8])
        #expect(attributed.string == "one\ntwo\nthree")
    }

    @Test("A horizontal rule occupies exactly one character")
    func horizontalRuleOccupiesOneCharacter() {
        let document = NoteHTMLParser.parse("<p>a</p><hr><p>b</p>")
        let attributed = NoteAttributedText.attributedString(for: document, theme: .dark)
        #expect(attributed.string.count == 5)
        #expect(NoteRichTextController.paragraphStarts(of: document) == [0, 2, 4])
    }
}
