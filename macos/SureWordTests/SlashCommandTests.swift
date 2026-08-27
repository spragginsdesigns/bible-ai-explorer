import Testing
@testable import SureWord

/// Ported from `mobile/src/features/chat/slashCommands.test.ts`.
@Suite("Slash commands")
struct SlashCommandTests {

    // MARK: matching

    @Test("Returns every command for a bare slash")
    func bareSlashMatchesAll() {
        #expect(SlashCommand.matching("/").count == SlashCommand.chat.count)
    }

    @Test("Prefix-matches command names")
    func prefixMatchesNames() {
        #expect(SlashCommand.matching("/no").map(\.command) == ["/note"])
    }

    @Test("Matches aliases")
    func matchesAliases() {
        #expect(SlashCommand.matching("/ad").map(\.command) == ["/note"])
    }

    @Test("Is case-insensitive on the typed token")
    func caseInsensitive() {
        #expect(SlashCommand.matching("/VE").map(\.command) == ["/verse"])
    }

    @Test("Stops suggesting once the first token is complete")
    func stopsAfterFirstToken() {
        #expect(SlashCommand.matching("/verse John").isEmpty)
    }

    @Test("Returns nothing for non-slash input")
    func ignoresPlainText() {
        #expect(SlashCommand.matching("hello").isEmpty)
        #expect(SlashCommand.matching("").isEmpty)
    }

    // MARK: parsing

    @Test("Parses a command and its arguments")
    func parsesCommandAndArgs() throws {
        let parsed = try #require(SlashCommand.parse("/verse John 3:16-18"))
        #expect(parsed.command.command == "/verse")
        #expect(parsed.args == "John 3:16-18")
    }

    @Test("Parses aliases")
    func parsesAliases() throws {
        let parsed = try #require(SlashCommand.parse("/add this please"))
        #expect(parsed.command.command == "/note")
    }

    @Test("Returns nothing for unknown commands and plain text")
    func rejectsUnknown() {
        #expect(SlashCommand.parse("/bogus") == nil)
        #expect(SlashCommand.parse("just a question") == nil)
    }

    @Test("Trims trailing argument whitespace")
    func trimsArgs() throws {
        let parsed = try #require(SlashCommand.parse("/search grace   "))
        #expect(parsed.args == "grace")
    }

    @Test("Parses /who with its subject")
    func parsesWho() throws {
        let parsed = try #require(SlashCommand.parse("/who Melchizedek"))
        #expect(parsed.command.command == "/who")
        #expect(parsed.command.requiresArgs)
        #expect(parsed.args == "Melchizedek")
    }

    /// `/plan` shows the day's portion and nothing else — starting or changing a
    /// plan is a deliberate act, never a side effect of asking what to read.
    @Test("Parses /plan, which takes no arguments")
    func parsesPlan() throws {
        let parsed = try #require(SlashCommand.parse("/plan"))
        #expect(parsed.command.kind == .ai)
        #expect(!parsed.command.requiresArgs)
        #expect(parsed.command.hint == nil)
        #expect(parsed.args.isEmpty)
    }

    // MARK: table invariants

    /// The palette is the same on every client. If a command is added on
    /// Android, this is the test that notices it is missing here.
    @Test("Carries the same commands as the Android palette")
    func matchesAndroidPalette() {
        #expect(
            SlashCommand.chat.map(\.command) == [
                "/note", "/verse", "/search", "/web", "/who", "/cross", "/plan", "/memory",
                "/new", "/clear", "/history",
            ]
        )
    }

    @Test("Describes /who and /plan the way the Android palette does")
    func matchesAndroidDescriptions() throws {
        let who = try #require(SlashCommand.chat.first { $0.command == "/who" })
        #expect(who.hint == "<name or place>")
        #expect(who.description == "Who or where is this? Look it up in Scripture")

        let plan = try #require(SlashCommand.chat.first { $0.command == "/plan" })
        #expect(plan.description == "Today's reading in your reading plan")
    }

    @Test("Commands that require arguments declare a hint")
    func requiresArgsHasHint() {
        for command in SlashCommand.chat where command.requiresArgs {
            #expect(command.hint != nil, "\(command.command) is missing its hint")
        }
    }

    @Test("No duplicate commands or aliases in the palette")
    func noDuplicates() {
        var tokens = Set<String>()
        for command in SlashCommand.chat {
            for token in [command.command] + command.aliases {
                #expect(!tokens.contains(token), "duplicate token \(token)")
                tokens.insert(token)
            }
        }
    }

    /// Local commands are executed by the app, so each must name the action to
    /// run — a `.local` command with no action would silently do nothing.
    @Test("Every local command declares an action")
    func localCommandsHaveActions() {
        for command in SlashCommand.chat where command.kind == .local {
            #expect(command.localAction != nil, "\(command.command) has no local action")
        }
    }
}

/// Ported from `mobile/src/features/chat/verseActions.test.ts`.
@Suite("Verse attachments")
struct VerseAttachmentTests {
    private let attachment = VerseAttachment(
        reference: "John 3:16",
        text: "For God so loved the world…",
        translation: .kjv
    )

    @Test("Formats reference and text as a quotation")
    func formatsQuotation() {
        #expect(
            VerseAttachment.formatForSharing(
                reference: "John 3:16",
                text: "For God so loved the world…"
            ) == "John 3:16 — \"For God so loved the world…\" (KJV)"
        )
    }

    @Test("Handles a missing verse text")
    func handlesMissingText() {
        #expect(
            VerseAttachment.formatForSharing(reference: "Psalm 23:1", text: nil)
                == "Psalm 23:1 (KJV)"
        )
    }

    @Test("Puts the formatted passage before the user's own question")
    func passageBeforeQuestion() {
        #expect(
            VerseAttachment.compose("what does this mean?", attachment: attachment)
                == "John 3:16 — \"For God so loved the world…\" (KJV)\n\nwhat does this mean?"
        )
    }

    @Test("Sends just the passage when the question is empty")
    func passageAlone() {
        let expected = "John 3:16 — \"For God so loved the world…\" (KJV)"
        #expect(VerseAttachment.compose("", attachment: attachment) == expected)
        #expect(VerseAttachment.compose("   ", attachment: attachment) == expected)
    }

    @Test("Labels the passage with the attached translation")
    func labelsTranslation() {
        var nkjv = attachment
        nkjv.translation = .nkjv
        #expect(
            VerseAttachment.compose("where else does this occur?", attachment: nkjv)
                == "John 3:16 — \"For God so loved the world…\" (NKJV)\n\nwhere else does this occur?"
        )
    }

    @Test("Passes the trimmed question through when there is no attachment")
    func noAttachment() {
        #expect(VerseAttachment.compose("  plain question  ", attachment: nil) == "plain question")
    }

    @Test("Serializes Daily Cross origin without duplicating verse text")
    func dailyCrossOriginMetadata() throws {
        let origin = VerseAttachmentOrigin(
            surface: "daily-cross",
            verseOfDayId: "vod_123",
            reference: "John 3:16",
            action: "go-deeper"
        )
        let metadata = JSONValue.object(["origin": origin.json])
        let encodedOrigin = try #require(metadata["origin"])

        #expect(encodedOrigin["surface"]?.stringValue == "daily-cross")
        #expect(encodedOrigin["verseOfDayId"]?.stringValue == "vod_123")
        #expect(encodedOrigin["reference"]?.stringValue == "John 3:16")
        #expect(encodedOrigin["action"]?.stringValue == "go-deeper")
        #expect(encodedOrigin["text"] == nil)
    }
}
