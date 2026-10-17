import Foundation
import Testing
@testable import SureWord

/// Ported case for case from `tests/verse-passages.test.mjs`, which pins the
/// web and Android `versePassages.ts`. If a case here changes, the TS suite
/// must change with it. Compiled into both the macOS and iOS test targets.
@Suite("Verse passages")
struct VersePassagesTests {
    // A minimal resolver, like the TS suite's: the real one maps book names to
    // canon order; these cases only need a stable book key.
    private static let books: [String: Int] = [
        "genesis": 1, "psalms": 19, "ps": 19, "acts": 44, "2 peter": 61, "revelation": 66,
    ]

    private static let pattern = try? NSRegularExpression(
        pattern: #"^(.*\S)\s+(\d+)(?::(\d+))?(?:\s*-\s*\d+)?(?:\s+KJV)?$"#
    )

    private static let resolve: VerseReferenceResolver = { raw in
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard let match = pattern?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              let bookRange = Range(match.range(at: 1), in: trimmed),
              let chapterRange = Range(match.range(at: 2), in: trimmed),
              let order = books[trimmed[bookRange].lowercased()],
              let chapter = Int(trimmed[chapterRange])
        else { return nil }
        let verse = Range(match.range(at: 3), in: trimmed).flatMap { Int(trimmed[$0]) }
        return Reference(order: order, chapter: chapter, verse: verse)
    }

    private func passage(_ reference: String, _ text: String) -> RetrievedVerse {
        RetrievedVerse(reference: reference, similarity: 1, text: text, translation: .kjv, source: .passage)
    }

    private func hit(_ reference: String, _ similarity: Double) -> RetrievedVerse {
        RetrievedVerse(reference: reference, similarity: similarity, text: "\(reference) text", translation: .kjv)
    }

    @Test("A getPassage range reads as one passage, not one row per verse")
    func rangeIsOnePassage() {
        let grouped = GroupedVerses(
            verses: [
                passage("Psalms 56:1", "Be merciful"), passage("Psalms 56:2", "Mine enemies"),
                passage("Psalms 56:3", "What time"), passage("Psalms 56:4", "In God"),
            ],
            resolve: Self.resolve
        )
        #expect(grouped.passages.count == 1)
        #expect(grouped.passages[0].reference == "Psalms 56:1-4")
        #expect(grouped.passages[0].firstReference == "Psalms 56:1")
        #expect(grouped.passages[0].verses.map(\.verse) == [1, 2, 3, 4])
        #expect(grouped.passages[0].plainText == "1 Be merciful 2 Mine enemies 3 What time 4 In God")
        #expect(grouped.summary == "1 passage")
    }

    @Test("Passages follow the order the answer cites them")
    func citationOrder() {
        // Production turn 2026-10-15 ("The New Heavens and Earth"): lookups ran
        // Revelation, then 2 Peter, then Genesis; the answer cites Genesis first.
        let grouped = GroupedVerses(
            verses: [
                passage("Revelation 21:1", "a"), passage("Revelation 21:2", "b"),
                passage("2 Peter 3:10", "c"), passage("2 Peter 3:11", "d"),
                passage("Genesis 1:31", "e"),
                passage("Acts 19:13", "uncited"),
            ],
            citedReferences: ["Genesis 1:31", "2 Peter 3:10-13", "Ps 99:1", "Revelation 21:2"],
            resolve: Self.resolve
        )
        #expect(grouped.passages.map(\.reference) == ["Genesis 1:31", "2 Peter 3:10-11", "Revelation 21:1-2", "Acts 19:13"])
    }

    @Test("A gap, a new chapter or a new translation starts a new passage")
    func breaks() {
        var nkjv = passage("Psalms 57:2", "d")
        nkjv.translation = .nkjv
        let grouped = GroupedVerses(
            verses: [passage("Psalms 56:1", "a"), passage("Psalms 56:3", "b"), passage("Psalms 57:1", "c"), nkjv],
            resolve: Self.resolve
        )
        #expect(grouped.passages.map(\.reference) == ["Psalms 56:1", "Psalms 56:3", "Psalms 57:1", "Psalms 57:2"])
    }

    @Test("Search hits stay separate, keep their order and lose duplicates of passages")
    func searchHits() {
        let grouped = GroupedVerses(
            verses: [hit("Acts 19:15", 0.81), hit("Acts 19:13", 0.7), passage("Acts 19:13", "x"), hit("Acts 19:15", 0.6)],
            resolve: Self.resolve
        )
        #expect(grouped.passages.map(\.reference) == ["Acts 19:13"])
        #expect(grouped.passages.map(\.similarity) == [nil])
        #expect(grouped.searchHits.map(\.reference) == ["Acts 19:15"])
        #expect(grouped.searchHits.map(\.similarity) == [0.81])
        #expect(grouped.summary == "1 passage \u{00B7} 1 search result")
    }

    @Test("A repeated lookup does not duplicate verses")
    func repeatedLookup() {
        let grouped = GroupedVerses(
            verses: [passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b"), passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b")],
            resolve: Self.resolve
        )
        #expect(grouped.passages.count == 1)
        #expect(grouped.passages[0].verses.map(\.verse) == [1, 2])
    }

    @Test("An unparseable reference still shows on its own")
    func unparseable() {
        let grouped = GroupedVerses(
            verses: [RetrievedVerse(reference: "Psalm of David", similarity: 0.5, text: "t")],
            resolve: Self.resolve
        )
        #expect(grouped.searchHits.count == 1)
        #expect(grouped.searchHits.first?.reference == "Psalm of David")
        #expect(grouped.searchHits.first?.plainText == "t")
    }

    @Test("A tapped reference finds its passage, including abbreviations and ranges")
    func findPassage() {
        let grouped = GroupedVerses(
            verses: [passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b"), passage("Psalms 56:3", "c"), hit("Acts 19:15", 0.8)],
            resolve: Self.resolve
        )
        #expect(grouped.passage(for: "Ps 56:3", resolve: Self.resolve)?.reference == "Psalms 56:1-3")
        #expect(grouped.passage(for: "Psalms 56:2-3", resolve: Self.resolve)?.reference == "Psalms 56:1-3")
        #expect(grouped.passage(for: "Acts 19:15", resolve: Self.resolve)?.kind == .search)
        #expect(grouped.passage(for: "Psalms 56:9", resolve: Self.resolve) == nil)
        #expect(grouped.passage(for: "Genesis 1:1", resolve: Self.resolve) == nil)
    }

    @Test("Word-match hits carry no score, scored hits keep theirs")
    func exactHitsUnscored() {
        var exact = hit("Acts 19:13", 1)
        exact.source = .exact
        let grouped = GroupedVerses(verses: [exact, hit("Acts 19:15", 0.72)], resolve: Self.resolve)
        #expect(grouped.searchHits.map(\.reference) == ["Acts 19:13", "Acts 19:15"])
        #expect(grouped.searchHits.map(\.similarity) == [nil, 0.72])
    }

    @Test("A cited range matches a passage that holds any verse of it")
    func citedRange() {
        let grouped = GroupedVerses(
            verses: [passage("Acts 19:13", "a"), passage("2 Peter 3:10", "b"), passage("2 Peter 3:11", "c")],
            citedReferences: ["2 Peter 3:5-13"],
            resolve: Self.resolve
        )
        #expect(grouped.passages.map(\.reference) == ["2 Peter 3:10-11", "Acts 19:13"])
        #expect(grouped.passage(for: "2 Peter 3:5-13 KJV", resolve: Self.resolve)?.reference == "2 Peter 3:10-11")
        #expect(grouped.passage(for: "2 Peter 3:5-9", resolve: Self.resolve) == nil)
    }

    // MARK: Apple-only: the real resolver and the citation scan

    @Test("The real resolver strips translation tags, ranges and abbreviation periods")
    func realResolver() {
        #expect(VersePassages.resolveCitation("John 3:16 KJV") == Reference(order: 43, chapter: 3, verse: 16))
        #expect(VersePassages.resolveCitation("John 3:16-4:2") == Reference(order: 43, chapter: 3, verse: 16))
        #expect(VersePassages.resolveCitation("Gen.1:1") == Reference(order: 1, chapter: 1, verse: 1))
        #expect(VersePassages.resolveCitation("1Jn 5:1") == Reference(order: 62, chapter: 5, verse: 1))
        #expect(VersePassages.resolveCitation("John 99:16") == nil)
    }

    @Test("Citations are read from the answer in order, skipping noise")
    func citedReferences() {
        let text = "In Genesis 1:31 God saw it was good; see **2 Peter 3:10\u{2013}13** and Rev. 21:2. Not xJohn 3:16 or version 3:16."
        #expect(VersePassages.citedReferences(in: text) == ["Genesis 1:31", "2 Peter 3:10\u{2013}13", "Rev. 21:2"])
    }

    @Test("A message orders its passages by the answer text")
    func messageGrouping() {
        let message = ChatViewMessage(
            id: "a",
            role: .assistant,
            content: "Start with Genesis 1:31, then Revelation 21:1.",
            retrievedVerses: [passage("Revelation 21:1", "a"), passage("Genesis 1:31", "b")]
        )
        #expect(message.groupedVerses.passages.map(\.reference) == ["Genesis 1:31", "Revelation 21:1"])
    }

    @Test("getPassage rows are passages, word-match rows exact, and only searchScripture feeds the average")
    func sourceTagging() {
        let verse: JSONValue = .object(["reference": .string("Psalm 23:1"), "similarity": .number(1)])
        let message = UIMessage(
            id: "m",
            role: .assistant,
            parts: [
                .tool(ToolPart(toolCallId: "c1", toolName: "getPassage", state: .outputAvailable, output: .object(["verses": .array([verse])]))),
                .tool(ToolPart(toolCallId: "c2", toolName: "findVerses", state: .outputAvailable, output: .object(["verses": .array([verse])]))),
                .tool(ToolPart(toolCallId: "c3", toolName: "searchOriginalLanguage", state: .outputAvailable, output: .object(["verses": .array([verse])]))),
            ]
        )
        let view = ChatViewMessage(message: message, isStreaming: false)
        #expect(view.retrievedVerses.map(\.source) == [.passage, .exact, .exact])
        // No scored row, so no average and no match-strength badge.
        #expect(view.averageSimilarity == nil)

        let scored: JSONValue = .object(["reference": .string("Psalm 23:2"), "similarity": .number(0.7)])
        let mixed = UIMessage(
            id: "m2",
            role: .assistant,
            parts: [
                .tool(ToolPart(toolCallId: "c1", toolName: "findVerses", state: .outputAvailable, output: .object(["verses": .array([verse])]))),
                .tool(ToolPart(toolCallId: "c2", toolName: "searchScripture", state: .outputAvailable, output: .object(["verses": .array([scored])]))),
            ]
        )
        let mixedView = ChatViewMessage(message: mixed, isStreaming: false)
        #expect(mixedView.retrievedVerses.map(\.source) == [.exact, nil])
        #expect(mixedView.averageSimilarity == 0.7)
    }
}
