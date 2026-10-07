import XCTest

@testable import SureWord

/// Learn practice modes: a port of `mobile/src/features/learn/practice.test.ts`
/// case for case, plus fixtures captured from the TS module itself
/// (`src/components/learn/practice.ts` under Node) so the seeded shuffle and
/// the recall-mode alternation are pinned to the other clients bit for bit.
final class LearnPracticeTests: XCTestCase {
    static let john316 = LearnContractTests.verse
    static let opening = "For God so loved the world"

    private func playRound(_ round: OrderRound) -> [OrderTap] {
        var placed: [Int] = []
        var taps: [OrderTap] = []
        while placed.count < round.answer.count {
            let want = round.answer[placed.count]
            let choice = round.choices.indices.first { round.choices[$0] == want && !placed.contains($0) }!
            let tap = LearnPractice.tapOrderWord(round, placed: placed, choice: choice)
            taps.append(tap)
            placed = tap.placed
        }
        return taps
    }

    func testCollapsesEveryWordToItsFirstLetterKeepingPunctuationAndHyphens() {
        XCTAssertEqual(
            LearnPractice.firstLetterWords(Self.john316).map(\.clue).joined(separator: " "),
            "F G s l t w, t h g h o b S, t w b i h s n p, b h e l."
        )
        XCTAssertEqual(
            LearnPractice.firstLetterWords("\"Well-beloved, my dearly-loved friend’s hope!\"").map(\.clue),
            ["\"W-b,", "m", "d-l", "f", "h!\""]
        )
        XCTAssertEqual(
            LearnPractice.firstLetterWords(Self.opening).map(\.text),
            Self.opening.split(separator: " ").map(String.init)
        )
    }

    func testOffersExactlyTheVersesWordsShuffled() {
        let round = LearnPractice.orderRound(Self.opening, seed: 7)
        XCTAssertEqual(round.answer, Self.opening.split(separator: " ").map(String.init))
        XCTAssertEqual(round.choices.sorted(), round.answer.sorted())
        XCTAssertFalse(round.partial)
        XCTAssertNotEqual(round.choices, round.answer)
    }

    /// Captured from the TS generator: every client deals the same tiles.
    func testShuffleMatchesTheTypeScriptGeneratorBitForBit() {
        let expected: [Int: [String]] = [
            0: ["loved", "so", "the", "world", "God", "For"],
            1: ["God", "world", "the", "loved", "so", "For"],
            2: ["For", "the", "loved", "so", "world", "God"],
            3: ["God", "loved", "the", "world", "so", "For"],
            7: ["loved", "world", "God", "so", "the", "For"],
        ]
        for (seed, choices) in expected {
            XCTAssertEqual(LearnPractice.orderRound(Self.opening, seed: seed).choices, choices, "seed \(seed)")
        }
        XCTAssertEqual(
            LearnPractice.orderRound(Self.john316, seed: 0).choices,
            ["that", "only", "loved", "Son,", "world,", "begotten", "he", "gave", "his", "the", "God", "so", "For"]
        )
        XCTAssertEqual(
            LearnPractice.orderRound(Self.john316, seed: 1).choices,
            ["everlasting", "life.", "whosoever", "in", "perish,", "not", "him", "believeth", "but", "have", "should", "that"]
        )
    }

    func testPracticesALongVerseAPartAtATimeWithinTheCap() {
        let first = LearnPractice.orderRound(Self.john316, seed: 0)
        let second = LearnPractice.orderRound(Self.john316, seed: 1)
        XCTAssertTrue(first.partial)
        XCTAssertEqual(first.start, 0)
        XCTAssertLessThanOrEqual(first.answer.count, LearnPractice.orderWordCap)
        XCTAssertLessThanOrEqual(second.answer.count, LearnPractice.orderWordCap)
        XCTAssertEqual(second.start, first.answer.count)
        XCTAssertEqual(first.answer + second.answer, Self.john316.split(separator: " ").map(String.init))
        XCTAssertEqual(second.choices.sorted(), second.answer.sorted())

        let long = (0..<60).map { "word\($0)" }.joined(separator: " ")
        for seed in 0...3 {
            XCTAssertLessThanOrEqual(LearnPractice.orderRound(long, seed: seed).answer.count, LearnPractice.orderWordCap)
        }
    }

    func testAcceptsTheNextWordAndRefusesAnyOtherWithoutEndingTheRound() {
        let round = LearnPractice.orderRound(Self.opening, seed: 3)
        let taps = playRound(round)
        XCTAssertTrue(taps.allSatisfy(\.correct))
        XCTAssertTrue(taps.last!.done)
        XCTAssertEqual(taps.last!.placed.map { round.choices[$0] }, Self.opening.split(separator: " ").map(String.init))

        let opened = LearnPractice.tapOrderWord(round, placed: [], choice: round.choices.firstIndex(of: "For")!)
        XCTAssertTrue(opened.correct)
        let wrong = LearnPractice.tapOrderWord(round, placed: opened.placed, choice: round.choices.firstIndex(of: "world")!)
        XCTAssertFalse(wrong.correct)
        XCTAssertEqual(wrong.placed, opened.placed)
        XCTAssertFalse(wrong.done)
        XCTAssertEqual(wrong.expected.map { round.choices[$0] }, "God")

        let repeated = LearnPractice.tapOrderWord(round, placed: opened.placed, choice: opened.placed[0])
        XCTAssertFalse(repeated.correct)
        XCTAssertEqual(repeated.placed, opened.placed)
    }

    func testScoresTypedWordsPastCapitalsPunctuationAndHyphens() {
        let exact = LearnPractice.scoreTypedVerse(Self.john316, typed: Self.john316)
        XCTAssertTrue(exact.perfect)
        XCTAssertFalse(exact.empty)
        XCTAssertTrue(exact.words.allSatisfy { $0.result == .match })

        for typed in [
            Self.john316.uppercased(),
            Self.john316.lowercased(),
            Self.john316.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: ".", with: ""),
            "\(Self.john316)\n",
        ] {
            XCTAssertTrue(LearnPractice.scoreTypedVerse(Self.john316, typed: typed).perfect, typed)
        }
        // A translation's own spelling still has to be typed.
        XCTAssertFalse(LearnPractice.scoreTypedVerse(
            Self.john316,
            typed: Self.john316.replacingOccurrences(of: "believeth", with: "believes")
        ).perfect)
        XCTAssertTrue(LearnPractice.scoreTypedVerse("his well-beloved son", typed: "his well beloved son").perfect)
        XCTAssertFalse(LearnPractice.scoreTypedVerse("", typed: "anything").perfect)
        XCTAssertTrue(LearnPractice.scoreTypedVerse(Self.john316, typed: "   ").empty)
    }

    func testNamesTheMissingAndTheExtraWordsWhereTheyBelong() {
        let score = LearnPractice.scoreTypedVerse(Self.opening, typed: "For so loved the whole world indeed")
        XCTAssertEqual(score.words.map { "\($0.result.rawValue):\($0.expected ?? $0.typed ?? "")" }, [
            "match:For",
            "missed:God",
            "match:so",
            "match:loved",
            "match:the",
            "extra:whole",
            "match:world",
            "extra:indeed",
        ])
        XCTAssertFalse(score.perfect)
        XCTAssertEqual(score.words.filter { $0.result == .match }.count, 5)

        let missingTail = LearnPractice.scoreTypedVerse(Self.opening, typed: "For God so")
        XCTAssertEqual(missingTail.words.filter { $0.result == .missed }.compactMap(\.expected), ["loved", "the", "world"])
    }

    func testPicksTheModeFromHowWellTheVerseIsKnown() {
        XCTAssertEqual(LearnPractice.defaultMode(id: "card-1", revision: 2, stage: 0), .blanks)
        XCTAssertEqual(LearnPractice.defaultMode(id: "card-1", revision: 2, stage: 1), .blanks)
        XCTAssertEqual(LearnPractice.defaultMode(id: "card-1", revision: 2, stage: 3), .typed)
        // Captured from the TS module: the recall modes alternate per revision.
        let expected: [LearnMode] = [.letters, .order, .letters, .order, .letters, .order]
        for (revision, mode) in expected.enumerated() {
            XCTAssertEqual(LearnPractice.defaultMode(id: "card-1", revision: revision, stage: 2), mode)
        }
        XCTAssertEqual(LearnPractice.defaultMode(id: "cmabc123xyz", revision: 0, stage: 2), .order)
        XCTAssertEqual(LearnPractice.defaultMode(id: "cmabc123xyz", revision: 1, stage: 2), .letters)
        XCTAssertEqual(LearnPractice.modes, [.blanks, .letters, .order, .typed])
        XCTAssertTrue(LearnPractice.modes.allSatisfy { !$0.label.isEmpty })
    }

    func testChangesNothingAboutTheCardWhenTheReaderSwitchesModes() {
        let opened = LearnPractice.resolveMode(id: "card-1", revision: 2, stage: 0, previous: nil)
        XCTAssertEqual(opened, LearnModeSelection(cardId: "card-1", revision: 2, mode: .blanks, chosen: false))

        let chosen = LearnPractice.chooseMode(id: "card-1", revision: 2, mode: .typed)
        XCTAssertEqual(chosen, LearnModeSelection(cardId: "card-1", revision: 2, mode: .typed, chosen: true))
        XCTAssertEqual(LearnPractice.resolveMode(id: "card-1", revision: 2, stage: 0, previous: chosen).mode, .typed)
        // A review moves the card on, and the next stage brings its own default.
        XCTAssertEqual(LearnPractice.resolveMode(id: "card-1", revision: 3, stage: 1, previous: chosen).mode, .blanks)
        XCTAssertEqual(LearnPractice.resolveMode(id: "card-2", revision: 2, stage: 0, previous: chosen).mode, .blanks)
        let unchosen = LearnModeSelection(cardId: "card-1", revision: 2, mode: .typed, chosen: false)
        XCTAssertEqual(LearnPractice.resolveMode(id: "card-1", revision: 2, stage: 0, previous: unchosen).mode, .blanks)
    }

    func testNamesTheJobInOneSentenceAndKeepsTheLaddersWordingForBlanks() {
        XCTAssertEqual(LearnPractice.hint(.blanks, stage: 0), "Read the verse, then continue.")
        XCTAssertEqual(LearnPractice.hint(.blanks, stage: 3), "Say the verse from its reference. Tap a blank for help.")
        XCTAssertEqual(LearnPractice.hint(.blanks, stage: 2), "Recall the missing words. Tap a blank for help, then continue.")
        for mode in [LearnMode.letters, .order, .typed] {
            XCTAssertEqual(LearnPractice.hint(mode, stage: 0), LearnPractice.hint(mode, stage: 3))
            XCTAssertFalse(LearnPractice.hint(mode, stage: 2).isEmpty)
        }
    }

    // MARK: - Suggestions (`suggestions.test.ts`)

    private static let suggestionRows: [JSONValue] = [
        .object([
            "book": .number(45), "chapter": .number(8), "verse": .number(28),
            "reference": .string("Romans 8:28"), "text": .string("And we know that all things work together for good"),
            "reason": .string("You read Romans 8 on Tuesday."), "weight": .number(61), "source": .string("reading"),
        ]),
        .object([
            "book": .number(23), "chapter": .number(53), "verse": .number(5),
            "reference": .string("Isaiah 53:5"), "text": .string("But he was wounded for our transgressions"),
            "reason": .string("You highlighted this verse."), "weight": .number(48), "source": .string("highlight"),
        ]),
        .object([
            "book": .number(43), "chapter": .number(3), "verse": .number(16),
            "reference": .string("John 3:16"), "text": .string("For God so loved the world"),
            "reason": .string("You asked about John 3 in chat."), "weight": .number(74), "source": .string("chat"),
        ]),
    ]

    private func replacing(_ row: JSONValue, _ key: String, _ value: JSONValue) -> JSONValue {
        guard case .object(var fields) = row else { return row }
        fields[key] = value
        return .object(fields)
    }

    func testSuggestionsParseTheContractAndDropOnlyBrokenRows() {
        let rows = LearnSuggestions.parse(.object(["suggestions": .array(Self.suggestionRows)]))
        XCTAssertEqual(rows.map(\.reference), ["Romans 8:28", "Isaiah 53:5", "John 3:16"])
        XCTAssertEqual(rows.first?.source, "reading")

        for body: JSONValue? in [nil, .null, .object([:]), .object(["suggestions": .null]), .string("404 page")] {
            XCTAssertEqual(LearnSuggestions.parse(body), [])
        }

        let isaiah = Self.suggestionRows[1]
        let mixed = LearnSuggestions.parse(.object(["suggestions": .array([
            Self.suggestionRows[0],
            replacing(isaiah, "reason", .string("   ")),
            replacing(isaiah, "book", .number(67)),
            replacing(isaiah, "source", .string("vibes")),
            replacing(isaiah, "source", .string("suggestion")),
            replacing(isaiah, "weight", .string("many")),
            Self.suggestionRows[2],
            Self.suggestionRows[2],
        ])]))
        XCTAssertEqual(mixed.map(\.reference), ["Romans 8:28", "John 3:16"])
    }

    func testSuggestionsLeadOnlyWhenNothingIsDue() {
        let rows = LearnSuggestions.parse(.object(["suggestions": .array(Self.suggestionRows)]))
        let lead = LearnSuggestions.view(suggestions: rows, dismissed: [], added: [], hasCard: false)
        XCTAssertTrue(lead.lead)
        XCTAssertEqual(lead.heading, LearnSuggestions.lead)
        XCTAssertFalse(lead.showEmptyText)

        let beside = LearnSuggestions.view(suggestions: rows, dismissed: [], added: [], hasCard: true)
        XCTAssertFalse(beside.lead)
        XCTAssertEqual(beside.heading, "Suggested for you")

        let gone = LearnSuggestions.view(
            suggestions: rows,
            dismissed: [rows[0].id],
            added: [rows[1].id, rows[2].id],
            hasCard: false
        )
        XCTAssertEqual(gone.rows, [])
        XCTAssertTrue(gone.showEmptyText)
        XCTAssertEqual(LearnSuggestions.addedConfirmation("John 3:16"), "Added John 3:16 to Learn.")
    }
}
