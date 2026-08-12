import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/notes/utils.test.ts`.
///
/// These derivations are shared state, not local convenience: `plainText` is
/// what the list previews and what every client's search runs over, and
/// `wordCount` is stored on the row. If this client derived them differently,
/// the same note would read differently depending on where it was last saved.
@Suite("Note utils")
struct NoteUtilsTests {

    // MARK: htmlToPlainText

    @Test("Returns an empty string for empty input")
    func emptyInput() {
        #expect(NoteUtils.htmlToPlainText("") == "")
    }

    @Test("Strips tags and collapses block boundaries into newlines")
    func stripsTags() {
        #expect(
            NoteUtils.htmlToPlainText("<p>Hello <strong>world</strong></p><p>Again</p>")
                == "Hello world\nAgain"
        )
    }

    @Test("Turns blockquote closings and <br> into newlines")
    func blockClosings() {
        #expect(
            NoteUtils.htmlToPlainText(
                "<blockquote><p>John 3:16</p><p>For God so loved</p></blockquote><p>End</p>"
            ) == "John 3:16\nFor God so loved\n\nEnd"
        )
        #expect(NoteUtils.htmlToPlainText("<p>one<br>two<br/>three</p>") == "one\ntwo\nthree")
    }

    @Test("Decodes entities")
    func decodesEntities() {
        #expect(
            NoteUtils.htmlToPlainText("<p>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;&nbsp;e</p>")
                == "a <b> & \"c\" 'd' e"
        )
    }

    @Test("Drops script and style blocks entirely")
    func dropsActiveContent() {
        #expect(
            NoteUtils.htmlToPlainText("<style>p{color:red}</style><p>keep</p><script>x()</script>")
                == "keep"
        )
    }

    @Test("Collapses runs of blank lines")
    func collapsesBlankLines() {
        #expect(NoteUtils.htmlToPlainText("<p>one</p><p></p><p></p><p>two</p>") == "one\n\ntwo")
    }

    // MARK: countWords

    @Test("Counts words the way the other clients do")
    func countsWords() {
        #expect(NoteUtils.countWords("") == 0)
        #expect(NoteUtils.countWords("   ") == 0)
        #expect(NoteUtils.countWords("For God so loved the world") == 6)
        #expect(NoteUtils.countWords(" spaced \n out \t words ") == 3)
    }

    // MARK: initialHtmlFor

    @Test("Prefers htmlContent when it is not blank")
    func prefersHTMLContent() {
        #expect(NoteUtils.initialHTML(content: "{}", htmlContent: "<p>hi</p>") == "<p>hi</p>")
    }

    @Test("Treats an empty rich-text document as blank and falls back to content")
    func fallsBackToContent() {
        #expect(
            NoteUtils.initialHTML(content: "<p>legacy</p>", htmlContent: "<p></p>") == "<p>legacy</p>"
        )
    }

    @Test("Returns an empty string when content holds Tiptap JSON")
    func ignoresTiptapJSON() {
        #expect(NoteUtils.initialHTML(content: #"{"type":"doc"}"#, htmlContent: "") == "")
        #expect(NoteUtils.initialHTML(content: "[]", htmlContent: "") == "")
    }

    @Test("Returns an empty string when there is nothing to show")
    func nothingToShow() {
        #expect(NoteUtils.initialHTML(content: "", htmlContent: "") == "")
    }

    @Test("Recognises the empty documents the rich editors produce")
    func recognisesBlankHTML() {
        #expect(NoteUtils.isBlankHTML(""))
        #expect(NoteUtils.isBlankHTML("<p></p>"))
        #expect(NoteUtils.isBlankHTML("<p><br></p>"))
        #expect(!NoteUtils.isBlankHTML("<p>a</p>"))
    }

    // MARK: relativeTime

    /// The TS suite freezes the clock; here `now` is a parameter, which is the
    /// same trick without the global.
    private let now = NoteUtils.parseISO("2026-08-10T12:00:00.000Z") ?? .distantPast

    private func isoAgo(_ seconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(-seconds))
    }

    @Test("Returns an empty string for unparseable input")
    func unparseableDate() {
        #expect(NoteUtils.relativeTime("not-a-date", now: now) == "")
    }

    @Test("Reports anything under a minute as just now")
    func justNow() {
        #expect(NoteUtils.relativeTime(isoAgo(0), now: now) == "Just now")
        #expect(NoteUtils.relativeTime(isoAgo(59), now: now) == "Just now")
    }

    @Test("Reports minutes under an hour")
    func minutes() {
        #expect(NoteUtils.relativeTime(isoAgo(60), now: now) == "1m ago")
        #expect(NoteUtils.relativeTime(isoAgo(59 * 60), now: now) == "59m ago")
    }

    @Test("Reports hours under a day")
    func hours() {
        #expect(NoteUtils.relativeTime(isoAgo(60 * 60), now: now) == "1h ago")
        #expect(NoteUtils.relativeTime(isoAgo(23 * 60 * 60), now: now) == "23h ago")
    }

    @Test("Reports days under a week")
    func days() {
        #expect(NoteUtils.relativeTime(isoAgo(24 * 60 * 60), now: now) == "1d ago")
        #expect(NoteUtils.relativeTime(isoAgo(6 * 24 * 60 * 60), now: now) == "6d ago")
    }

    @Test("Falls back to a short date beyond a week")
    func beyondAWeek() {
        #expect(NoteUtils.relativeTime(isoAgo(8 * 24 * 60 * 60), now: now) == "Aug 2")
    }

    @Test("Parses ISO timestamps with and without fractional seconds")
    func parsesBothISOShapes() {
        #expect(NoteUtils.parseISO("2026-01-01T00:00:00.000Z") != nil)
        #expect(NoteUtils.parseISO("2026-01-01T00:00:00Z") != nil)
        #expect(NoteUtils.parseISO("nonsense") == nil)
    }

    // MARK: tags

    @Test("Resolves a note's tags in library order")
    func resolvesTags() {
        var note = Note(id: "n1", title: "t")
        note.tagIds = ["b", "a"]
        let tags = [
            Tag(id: "a", name: "Grace", color: "#fff"),
            Tag(id: "b", name: "Faith", color: "#000"),
            Tag(id: "c", name: "Hope", color: "#111"),
        ]
        #expect(NoteUtils.tags(for: note, in: tags).map(\.id) == ["a", "b"])
    }
}

/// The note AI panel's command table. The shared `SlashCommand` matcher is
/// already covered by `SlashCommandTests`; what matters here is that the note
/// table itself is well formed and wired to the two local actions.
@Suite("Note slash commands")
struct NoteSlashCommandTests {

    @Test("Offers exactly the three Android note commands")
    func tableMatchesAndroid() {
        #expect(SlashCommand.note.map(\.command) == ["/suggest", "/verse", "/clear"])
    }

    @Test("Local note commands declare their action")
    func localCommandsHaveActions() {
        #expect(SlashCommand.note.first { $0.command == "/suggest" }?.localAction == .suggest)
        #expect(SlashCommand.note.first { $0.command == "/clear" }?.localAction == .clearNoteChat)
    }

    @Test("/verse is sent to the model and requires a reference")
    func verseIsAnAICommand() throws {
        let verse = try #require(SlashCommand.note.first { $0.command == "/verse" })
        #expect(verse.kind == .ai)
        #expect(verse.requiresArgs)
        #expect(verse.hint != nil)
    }

    @Test("Matches against the note table, not the chat table")
    func matchesNoteTable() {
        #expect(SlashCommand.matching("/s", in: SlashCommand.note).map(\.command) == ["/suggest"])
        // `/new` and `/history` are chat-only and must not leak into the panel.
        #expect(SlashCommand.matching("/new", in: SlashCommand.note).isEmpty)
        #expect(SlashCommand.matching("/", in: SlashCommand.note).count == 3)
    }

    @Test("Parses a note command with its arguments")
    func parsesNoteCommand() throws {
        let parsed = try #require(SlashCommand.parse("/verse Romans 8:28", in: SlashCommand.note))
        #expect(parsed.command.command == "/verse")
        #expect(parsed.args == "Romans 8:28")
    }
}
