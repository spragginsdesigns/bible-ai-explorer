import Foundation
import Testing
@testable import SureWord

// Mirrors `mobile/src/features/notes/wikilinks.test.ts` and
// `mobile/src/features/notes/noteProperties.test.ts` case for case, so the
// Apple clients write, match and validate links and properties by the same
// rules as Android. (Identical copy of the macOS suite in SureWordTests/.)

private func makeNote(_ id: String, _ title: String, aliases: [String] = []) -> Note {
    Note(
        id: id,
        title: title,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        aliases: aliases
    )
}

private let notes = [
    makeNote("a", "Romans study", aliases: ["Paul to Rome"]),
    makeNote("b", "Grace alone"),
    makeNote("c", "Sermon notes"),
]

@Suite("Wikilinks")
struct NoteWikilinksTests {

    @Test("sanitizeTarget strips the characters that carry meaning inside brackets")
    func stripsReserved() {
        #expect(NoteWikilinks.sanitizeTarget("Romans [1] | notes # 3") == "Romans 1 notes 3")
    }

    @Test("sanitizeTarget collapses whitespace and trims")
    func collapsesWhitespace() {
        #expect(NoteWikilinks.sanitizeTarget("  Grace   alone  ") == "Grace alone")
        #expect(NoteWikilinks.sanitizeTarget("Grace\n\talone") == "Grace alone")
    }

    @Test("format wraps a sanitized target")
    func formatWraps() {
        #expect(NoteWikilinks.format("Romans study") == "[[Romans study]]")
        #expect(NoteWikilinks.format("Romans|study") == "[[Romans study]]")
    }

    @Test("format returns an empty string when nothing usable survives")
    func formatEmpty() {
        #expect(NoteWikilinks.format("  ") == "")
        #expect(NoteWikilinks.format("[[]]") == "")
    }

    @Test("filter excludes the note being edited")
    func filterExcludesSelf() {
        #expect(NoteWikilinks.filterNotesForLinking(notes, query: "", excludeID: "a").map(\.id) == ["b", "c"])
    }

    @Test("filter matches titles and aliases case-insensitively")
    func filterMatches() {
        #expect(NoteWikilinks.filterNotesForLinking(notes, query: "romans", excludeID: "z").map(\.id) == ["a"])
        #expect(NoteWikilinks.filterNotesForLinking(notes, query: "paul to rome", excludeID: "z").map(\.id) == ["a"])
    }

    @Test("hasExactTarget is true for an exact title or alias")
    func exactTitleOrAlias() {
        #expect(NoteWikilinks.hasExactTarget(notes, query: "grace alone", excludeID: "z"))
        #expect(NoteWikilinks.hasExactTarget(notes, query: "Paul to Rome", excludeID: "z"))
    }

    @Test("hasExactTarget is false for a title no note carries")
    func noExactTarget() {
        #expect(!NoteWikilinks.hasExactTarget(notes, query: "Ephesians", excludeID: "z"))
    }

    @Test("hasExactTarget treats a blank query as nothing to create")
    func blankQuery() {
        #expect(NoteWikilinks.hasExactTarget(notes, query: "  ", excludeID: "z"))
    }

    @Test("hasExactTarget ignores the note being edited")
    func ignoresSelf() {
        #expect(!NoteWikilinks.hasExactTarget(notes, query: "Romans study", excludeID: "a"))
    }

    @Test("outgoingLabel prefers the resolved title, falls back to what was typed")
    func outgoingLabel() {
        #expect(
            NoteWikilinks.outgoingLabel(
                NoteOutgoingLink(targetTitle: "romans study", noteId: "a", title: "Romans study")
            ) == "Romans study"
        )
        #expect(
            NoteWikilinks.outgoingLabel(NoteOutgoingLink(targetTitle: "Ephesians", noteId: nil, title: nil))
                == "Ephesians"
        )
    }

    @Test("Decodes the links route payload, unresolved targets included")
    func decodesLinks() throws {
        let json = """
            {"outgoing":[{"targetTitle":"Romans study","noteId":"a","title":"Romans study"},
                         {"targetTitle":"Ephesians","noteId":null,"title":null}],
             "backlinks":[{"noteId":"b","title":"Grace alone","snippet":"see [[Romans study]]",
                           "updatedAt":"2026-01-02T00:00:00.000Z"}]}
            """
        let links = try JSONDecoder().decode(NoteLinks.self, from: Data(json.utf8))
        #expect(links.outgoing.count == 2)
        #expect(links.outgoing[1].noteId == nil)
        #expect(links.backlinks.first?.snippet == "see [[Romans study]]")
    }
}

@Suite("Note properties")
struct NotePropertiesTests {

    @Test("type(of:) maps each stored shape back to its editor type")
    func typeOf() {
        #expect(NotePropertyEditing.type(of: .text("Paul")) == .text)
        #expect(NotePropertyEditing.type(of: .number(3)) == .number)
        #expect(NotePropertyEditing.type(of: .checkbox(true)) == .checkbox)
        #expect(NotePropertyEditing.type(of: .list(["a", "b"])) == .list)
    }

    @Test("parseValue rejects input that cannot make a valid value")
    func rejectsInvalid() {
        #expect(NotePropertyEditing.parseValue(.number, "not a number") == nil)
        #expect(NotePropertyEditing.parseValue(.number, "  ") == nil)
        #expect(NotePropertyEditing.parseValue(.text, "   ") == nil)
        #expect(NotePropertyEditing.parseValue(.list, " , , ") == nil)
        #expect(NotePropertyEditing.parseValue(.checkbox, "maybe") == nil)
    }

    @Test("parseValue parses each type")
    func parsesEach() {
        #expect(NotePropertyEditing.parseValue(.text, "  Romans  ") == .text("Romans"))
        #expect(NotePropertyEditing.parseValue(.number, " -2.5 ") == .number(-2.5))
        #expect(NotePropertyEditing.parseValue(.checkbox, "TRUE") == .checkbox(true))
        #expect(NotePropertyEditing.parseValue(.checkbox, "false") == .checkbox(false))
        #expect(NotePropertyEditing.parseValue(.list, "a, b ,, c") == .list(["a", "b", "c"]))
    }

    @Test("parseValue does not accept Infinity as a number")
    func rejectsInfinity() {
        #expect(NotePropertyEditing.parseValue(.number, "Infinity") == nil)
        #expect(NotePropertyEditing.parseValue(.number, "nan") == nil)
    }

    @Test("Values format for display and round-trip into the input")
    func rendering() {
        #expect(NotePropertyEditing.format(.checkbox(true)) == "Yes")
        #expect(NotePropertyEditing.format(.list(["a", "b"])) == "a, b")
        #expect(NotePropertyEditing.input(for: .checkbox(false)) == "false")
        #expect(NotePropertyEditing.input(for: .list(["a", "b"])) == "a, b")
        // JS prints integral numbers bare; so must we.
        #expect(NotePropertyEditing.format(.number(3)) == "3")
        #expect(NotePropertyEditing.format(.number(-2.5)) == "-2.5")
    }

    @Test("Keys normalize whitespace")
    func normalizesKey() {
        #expect(NotePropertyEditing.normalizeKey("  read   by  ") == "read by")
    }

    @Test("Key collisions are case-insensitive but skip the row being edited")
    func keyCollisions() {
        let props: NoteProperties = ["Author": .text("Paul")]
        #expect(NotePropertyEditing.keyTaken(props, "author"))
        #expect(!NotePropertyEditing.keyTaken(props, "author", ignoring: "Author"))
        #expect(!NotePropertyEditing.keyTaken(props, "  "))
        #expect(!NotePropertyEditing.keyTaken(nil, "author"))
    }

    @Test("Entries sort so rows stay put")
    func sortsEntries() {
        let entries = NotePropertyEditing.entries(["zeal": .number(1), "author": .text("Paul")])
        #expect(entries.map(\.key) == ["author", "zeal"])
        #expect(entries.map(\.value) == [.text("Paul"), .number(1)])
    }

    @Test("A rename drops the old key")
    func renameDropsOldKey() {
        #expect(
            NotePropertyEditing.setting(["author": .text("Paul")], key: "writer", value: .text("Paul"), previousKey: "author")
                == ["writer": .text("Paul")]
        )
    }

    @Test("Adding leaves the original untouched; removing drops a key")
    func addAndRemove() {
        let props: NoteProperties = ["author": .text("Paul")]
        #expect(
            NotePropertyEditing.setting(props, key: "book", value: .text("Romans"))
                == ["author": .text("Paul"), "book": .text("Romans")]
        )
        #expect(props == ["author": .text("Paul")])
        #expect(
            NotePropertyEditing.removing(["author": .text("Paul"), "book": .text("Romans")], key: "author")
                == ["book": .text("Romans")]
        )
    }

    @Test("normalizeAliases trims, drops blanks, keeps the first spelling of a duplicate")
    func normalizesAliases() {
        #expect(
            NotePropertyEditing.normalizeAliases([" Paul to Rome ", "", "paul to rome", "Romans"])
                == ["Paul to Rome", "Romans"]
        )
    }

    // MARK: Wire shapes

    @Test("PATCH sends aliases and properties only when set, in the server's shapes")
    func patchEncoding() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        func encode(_ patch: NotePatch) throws -> String {
            String(decoding: try encoder.encode(patch), as: UTF8.self)
        }
        #expect(try encode(.aliases(["Paul to Rome"])) == #"{"aliases":["Paul to Rome"]}"#)
        #expect(
            try encode(.properties([
                "book": .text("Romans"),
                "chapter": .number(8),
                "done": .checkbox(true),
                "themes": .list(["grace", "faith"]),
            ]))
                == #"{"properties":{"book":"Romans","chapter":8,"done":true,"themes":["grace","faith"]}}"#
        )
        #expect(try encode(.title("x")) == #"{"title":"x"}"#)
    }

    @Test("A full row decodes aliases and properties; an odd property is dropped, not fatal")
    func decodesRow() throws {
        let json = """
            {"id":"n1","title":"Romans","plainText":"","folderId":null,"isPinned":false,
             "wordCount":0,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
             "aliases":["Paul to Rome"],
             "properties":{"book":"Romans","chapter":8,"done":false,"themes":["grace"],"odd":{"x":1}}}
            """
        let note = Note(api: try JSONDecoder().decode(NoteAPIResponse.self, from: Data(json.utf8)))
        #expect(note.aliases == ["Paul to Rome"])
        #expect(note.properties == [
            "book": .text("Romans"),
            "chapter": .number(8),
            "done": .checkbox(false),
            "themes": .list(["grace"]),
        ])
    }

    @Test("A row from an older server, with neither field, still decodes")
    func decodesLegacyRow() throws {
        let json = """
            {"id":"n1","title":"Romans","plainText":"","folderId":null,"isPinned":false,
             "wordCount":0,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
             "properties":null}
            """
        let note = Note(api: try JSONDecoder().decode(NoteAPIResponse.self, from: Data(json.utf8)))
        #expect(note.aliases.isEmpty)
        #expect(note.properties == nil)
    }

    @Test("A cache written before aliases/properties existed still loads")
    func decodesLegacyCache() throws {
        // Exactly what the old synthesized encoder wrote: no aliases, no properties.
        let json = """
            {"id":"n1","content":"<p>a</p>","htmlContent":"<p>a</p>","title":"Romans","plainText":"a",
             "tagIds":["t1"],"createdAt":"c","updatedAt":"u","isPinned":true,"wordCount":1,"hasBody":true}
            """
        let note = try JSONDecoder().decode(Note.self, from: Data(json.utf8))
        #expect(note.title == "Romans")
        #expect(note.hasBody)
        #expect(note.aliases.isEmpty)
        #expect(note.properties == nil)

        // And the new fields survive a cache round trip.
        var updated = note
        updated.aliases = ["Paul"]
        updated.properties = ["done": .checkbox(true)]
        let decoded = try JSONDecoder().decode(Note.self, from: try JSONEncoder().encode(updated))
        #expect(decoded == updated)
    }
}

@Suite("Note edit history")
struct NoteEditHistoryTests {
    private let start = ContinuousClock.now

    @Test("Edits undo and redo in order, and a new edit drops the redo branch")
    func undoRedo() {
        var history = NoteEditHistory<String>()
        history.recordEdit(before: "a")
        history.recordEdit(before: "ab")
        let r1 = history.undo(current: "abc")
        #expect(r1 == "ab")
        let r2 = history.undo(current: "ab")
        #expect(r2 == "a")
        let r3 = history.undo(current: "a")
        #expect(r3 == nil)
        let r4 = history.redo(current: "a")
        #expect(r4 == "ab")
        history.recordEdit(before: "ab")
        #expect(!history.canRedo)
    }

    @Test("Typing coalesces into one entry until a pause, a newline, or a caret move")
    func coalescing() {
        var history = NoteEditHistory<String>()
        let r5 = history.recordTyping(before: "", replacement: "a", at: start)
        #expect(r5)
        let r6 = history.recordTyping(before: "a", replacement: "b", at: start + .milliseconds(200))
        #expect(!r6)
        // Pause: new entry.
        let r7 = history.recordTyping(before: "ab", replacement: "c", at: start + .seconds(3))
        #expect(r7)
        // Newline closes the burst after itself.
        let r8 = history.recordTyping(before: "abc", replacement: "\n", at: start + .seconds(3))
        #expect(!r8)
        let r9 = history.recordTyping(before: "abc\n", replacement: "d", at: start + .seconds(3))
        #expect(r9)
        // Caret move.
        history.endTypingBurst()
        let r10 = history.recordTyping(before: "abc\nd", replacement: "e", at: start + .seconds(3))
        #expect(r10)
        #expect(history.undoStack == ["", "ab", "abc\n", "abc\nd"])
    }

    @Test("A structural edit closes the typing burst")
    func structuralBreaksTyping() {
        var history = NoteEditHistory<String>()
        history.recordTyping(before: "", replacement: "a", at: start)
        history.recordEdit(before: "a")
        let r11 = history.recordTyping(before: "A", replacement: "b", at: start)
        #expect(r11)
        #expect(history.undoStack == ["", "a", "A"])
    }

    @Test("The stack is capped, dropping the oldest entries; reset clears everything")
    func capAndReset() {
        var history = NoteEditHistory<Int>(limit: 3)
        for value in 0..<5 { history.recordEdit(before: value) }
        #expect(history.undoStack == [2, 3, 4])
        _ = history.undo(current: 5)
        history.reset()
        #expect(!history.canUndo)
        #expect(!history.canRedo)
    }
}
