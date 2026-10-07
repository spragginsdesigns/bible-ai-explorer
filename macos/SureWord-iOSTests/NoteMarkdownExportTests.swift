import Foundation
import XCTest

@testable import SureWord

/// PRD E1/E2: the Swift ports of `noteMarkdownExport.ts` and
/// `noteTemplates.ts`, asserted equal to the TypeScript output. The fixtures
/// are produced by running the TS (`macos/scripts/generate-port-fixtures.mjs`),
/// so a change on either side without the other fails here.
final class NoteMarkdownExportTests: XCTestCase {
    private static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appending(path: "Fixtures")

    private struct MarkdownCase: Decodable {
        let name: String
        let title: String
        let document: JSONValue
        let markdown: String?
        let error: String?
    }

    func testMarkdownMatchesTheTypeScriptExporter() throws {
        let data = try Data(contentsOf: Self.fixtures.appending(path: "note-markdown.json"))
        let cases = try JSONDecoder().decode([MarkdownCase].self, from: data)
        XCTAssertGreaterThan(cases.count, 30)
        for item in cases {
            do {
                let markdown = try NoteMarkdownExport.markdown(title: item.title, document: item.document)
                XCTAssertNil(item.error, "\(item.name): TS threw \(item.error ?? ""), Swift returned \(markdown)")
                XCTAssertEqual(markdown, item.markdown, item.name)
            } catch let error as NoteMarkdownExport.ExportError {
                XCTAssertEqual(error.message, item.error, "\(item.name): Swift threw, TS returned \(item.markdown ?? "")")
            }
        }
    }

    /// The Apple editor holds HTML, not Tiptap JSON; its tree must export to
    /// what Android exports for the same note.
    func testNoteHTMLExportsLikeTheTiptapDocumentItParsesTo() throws {
        let html = "<h1>Romans 8</h1><p>There is <strong>therefore</strong> now <em>no</em> condemnation"
            + "<br>to them which are in <a href=\"https://sureword.app/x y\">Christ</a> [[Grace]] *</p>"
            + "<blockquote><p>For the law of the Spirit</p></blockquote>"
            + "<ol start=\"2\"><li><p>walk</p><ul><li><p>not after the flesh</p></li></ul></li></ol>"
            + "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><label><input type=\"checkbox\" checked></label><div><p>Pray</p></div></li></ul>"
            + "<pre><code class=\"language-swift\">let x = 1\nlet y = 2</code></pre><hr><p><span>plain</span> <mark>lit</mark> <code>a`b</code></p>"
        let document = NoteHTMLParser.parse(html)
        let markdown = try NoteMarkdownExport.markdown(
            title: "Romans 8",
            document: NoteTiptapDocument.json(from: document)
        )
        let expected = [
            "# Romans 8",
            "",
            "There is **therefore** now *no* condemnation  ",
            "to them which are in [Christ](https://sureword.app/x%20y) [[Grace]] \\*",
            "",
            "> For the law of the Spirit",
            "",
            // The TS joins an item's blocks with a blank line and indents
            // every line, the blank one included (the "nested list" fixture).
            "2. walk",
            "    ",
            "    - not after the flesh",
            "",
            "- [x] Pray",
            "",
            "```swift",
            "let x = 1",
            "let y = 2",
            "```",
            "",
            "---",
            "",
            "plain ==lit== `` a`b ``",
            "",
        ].joined(separator: "\n")
        XCTAssertEqual(markdown, expected)
    }

    // MARK: Templates

    private struct TemplateCase: Decodable {
        struct Seed: Decodable {
            let title: String
            let content: String
            let html: String
            let plainText: String
            let wordCount: Int
        }

        let id: String
        let now: String
        let churchName: String?
        let seed: Seed?
    }

    func testTemplatesMatchTheTypeScriptBuilder() throws {
        let data = try Data(contentsOf: Self.fixtures.appending(path: "note-templates.json"))
        let cases = try JSONDecoder().decode([TemplateCase].self, from: data)
        XCTAssertEqual(cases.count, 12)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        for item in cases {
            let id = try XCTUnwrap(NoteTemplates.ID(rawValue: item.id))
            let now = try XCTUnwrap(parser.date(from: item.now))
            let seed = NoteTemplates.build(id, churchName: item.churchName, now: now, calendar: utc)
            let label = "\(item.id) @ \(item.now) church=\(item.churchName ?? "nil")"
            guard let expected = item.seed else {
                XCTAssertNil(seed, label)
                continue
            }
            let actual = try XCTUnwrap(seed, label)
            XCTAssertEqual(actual.title, expected.title, label)
            XCTAssertEqual(actual.content, expected.content, label)
            XCTAssertEqual(actual.html, expected.html, label)
            XCTAssertEqual(actual.plainText, expected.plainText, label)
            XCTAssertEqual(actual.wordCount, expected.wordCount, label)
        }
    }

    func testTemplateOptionsAreAndroidsInOrder() {
        XCTAssertEqual(NoteTemplates.options.map(\.id.rawValue), ["verse-study", "sermon", "prayer", "blank"])
        XCTAssertEqual(NoteTemplates.options.map(\.label), ["Verse study", "Sermon notes", "Prayer journal", "Blank note"])
    }
}
