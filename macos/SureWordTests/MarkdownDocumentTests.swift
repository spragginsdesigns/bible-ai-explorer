import Testing
@testable import SureWord

/// Pins the block grammar `MarkdownBody` renders. The reference behaviour is
/// markdown-it inside `react-native-markdown-display` on Android
/// (`mobile/src/features/chat/MarkdownBody.tsx`) — these cases mirror the
/// shapes the model actually emits in answers.
@Suite("MarkdownDocument")
struct MarkdownDocumentTests {

    // MARK: Paragraphs

    @Test("Blank lines split paragraphs; hard breaks survive inside one")
    func paragraphs() {
        let blocks = MarkdownDocument.parse("First line\nsecond line\n\nNext paragraph")
        #expect(blocks == [
            .paragraph("First line\nsecond line"),
            .paragraph("Next paragraph"),
        ])
    }

    // MARK: Blockquotes — the Scripture treatment

    @Test("Consecutive quote lines form one blockquote, blank quote lines split paragraphs")
    func blockquoteGrouping() {
        let text = """
        Jesus was born in **Bethlehem**.

        > “Joseph also went up from Galilee…”
        >
        > —Luke 2:4 NKJV

        There Mary gave birth.
        """
        let blocks = MarkdownDocument.parse(text)
        #expect(blocks == [
            .paragraph("Jesus was born in **Bethlehem**."),
            .blockquote(paragraphs: ["“Joseph also went up from Galilee…”", "—Luke 2:4 NKJV"]),
            .paragraph("There Mary gave birth."),
        ])
    }

    @Test("Quote marker without a space still counts")
    func blockquoteNoSpace() {
        #expect(MarkdownDocument.parse(">In the beginning") == [
            .blockquote(paragraphs: ["In the beginning"])
        ])
    }

    @Test("Multi-line quote keeps hard breaks inside a quote paragraph")
    func blockquoteHardBreaks() {
        let blocks = MarkdownDocument.parse("> line one\n> line two")
        #expect(blocks == [.blockquote(paragraphs: ["line one\nline two"])])
    }

    // MARK: Headings

    @Test("ATX headings 1–6 parse; deeper stays a paragraph")
    func headings() {
        #expect(MarkdownDocument.parse("## The Nativity") == [.heading(level: 2, text: "The Nativity")])
        #expect(MarkdownDocument.parse("###### Small") == [.heading(level: 6, text: "Small")])
        #expect(MarkdownDocument.parse("####### Not a heading") == [.paragraph("####### Not a heading")])
        #expect(MarkdownDocument.parse("#NoSpace") == [.paragraph("#NoSpace")])
    }

    @Test("Trailing closing hashes are stripped")
    func headingClosingHashes() {
        #expect(MarkdownDocument.parse("## Title ##") == [.heading(level: 2, text: "Title")])
    }

    // MARK: Lists

    @Test("Bullet list with -, *, +")
    func bulletList() {
        let blocks = MarkdownDocument.parse("- Faith\n* Hope\n+ Charity")
        #expect(blocks == [
            .list(ordered: false, start: 1, items: [
                MarkdownListItem(text: "Faith"),
                MarkdownListItem(text: "Hope"),
                MarkdownListItem(text: "Charity"),
            ])
        ])
    }

    @Test("Ordered list keeps its start number")
    func orderedList() {
        let blocks = MarkdownDocument.parse("3. Third\n4. Fourth")
        #expect(blocks == [
            .list(ordered: true, start: 3, items: [
                MarkdownListItem(text: "Third"),
                MarkdownListItem(text: "Fourth"),
            ])
        ])
    }

    @Test("Indented bullets nest under the previous item")
    func nestedList() {
        let blocks = MarkdownDocument.parse("- Gospels\n  - Matthew\n  - Mark\n- Epistles")
        #expect(blocks == [
            .list(ordered: false, start: 1, items: [
                MarkdownListItem(text: "Gospels", children: [
                    MarkdownListItem(text: "Matthew"),
                    MarkdownListItem(text: "Mark"),
                ]),
                MarkdownListItem(text: "Epistles"),
            ])
        ])
    }

    // MARK: Code

    @Test("Fenced code keeps its lines verbatim and its language tag")
    func fencedCode() {
        let blocks = MarkdownDocument.parse("```swift\nlet x = 1\n\nlet y = 2\n```")
        #expect(blocks == [.codeBlock(language: "swift", code: "let x = 1\n\nlet y = 2")])
    }

    @Test("Unclosed fence runs to the end without crashing")
    func unclosedFence() {
        #expect(MarkdownDocument.parse("```\ncode") == [.codeBlock(language: nil, code: "code")])
    }

    // MARK: Rules

    @Test("---, ***, ___ are rules, not list items")
    func rules() {
        #expect(MarkdownDocument.parse("---") == [.rule])
        #expect(MarkdownDocument.parse("***") == [.rule])
        #expect(MarkdownDocument.parse("_ _ _") == [.rule])
        #expect(MarkdownDocument.parse("--") == [.paragraph("--")])
    }

    // MARK: Tables

    @Test("Pipe table parses header, separator and rows")
    func table() {
        let text = """
        | Person | Role |
        |---|:---:|
        | Mary | Mother |
        | Joseph | Father |
        """
        let blocks = MarkdownDocument.parse(text)
        #expect(blocks == [
            .table(header: ["Person", "Role"], rows: [["Mary", "Mother"], ["Joseph", "Father"]])
        ])
    }

    @Test("A lone pipe line without a separator stays a paragraph")
    func pipeWithoutSeparator() {
        #expect(MarkdownDocument.parse("| just text |") == [.paragraph("| just text |")])
    }

    // MARK: Whole answers

    @Test("A typical answer mixes every block type in order")
    func typicalAnswer() {
        let text = """
        Jesus was born in **Bethlehem of Judea**, the city of David.

        > “Joseph also went up from Galilee…”
        >
        > —Luke 2:4 NKJV

        Key points:

        - Fulfilled Micah 5:2
        - The city of David

        See also Matthew 2.
        """
        let blocks = MarkdownDocument.parse(text)
        #expect(blocks.count == 5)
        #expect(blocks[1] == .blockquote(paragraphs: ["“Joseph also went up from Galilee…”", "—Luke 2:4 NKJV"]))
        #expect(blocks[3] == .list(ordered: false, start: 1, items: [
            MarkdownListItem(text: "Fulfilled Micah 5:2"),
            MarkdownListItem(text: "The city of David"),
        ]))
    }

    @Test("Empty and whitespace-only input yields no blocks")
    func emptyInput() {
        #expect(MarkdownDocument.parse("").isEmpty)
        #expect(MarkdownDocument.parse("  \n\n  ").isEmpty)
    }
}
