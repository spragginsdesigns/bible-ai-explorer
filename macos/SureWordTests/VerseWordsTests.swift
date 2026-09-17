import Foundation
import Testing
@testable import SureWord

/// The Words tab of the Tap-a-verse sheet. Everything pure about it: the wire
/// shapes it decodes, the display rules, and the two prompts its buttons hand
/// to chat. The rest is a round trip to `/api/verse-words` and
/// `/api/bible/strongs`.
///
/// Mirrors the same tab on web and Android, against the contract in
/// `src/lib/verse-words-contract.ts`. The source texts are the Westminster
/// Leningrad Codex (Hebrew) and the Textus Receptus (Greek).
@Suite("Verse words")
@MainActor
struct VerseWordsTests {

    // MARK: - Wire decoding

    @Test("Decodes a Hebrew study: rows, words, grammar and the study prose")
    func decodesStudy() throws {
        let json = """
        {
          "book": 21,
          "chapter": 4,
          "verse": 6,
          "reference": "Ecclesiastes 4:6",
          "language": "Hebrew",
          "textName": "Westminster Leningrad Codex",
          "kjvText": "Better is an handful with quietness",
          "words": [
            { "text": "טוֹב", "strongs": "H2896", "morph": "Aamsa", "lemma": "טוֹב",
              "translit": "towb", "gloss": "good, better",
              "grammar": { "partOfSpeech": "adjective",
                           "features": ["masculine", "singular", "absolute"],
                           "summary": "a masculine singular adjective" } },
            { "text": "נָחַת", "strongs": "H5183", "morph": "Ncfsa", "grammar": null }
          ],
          "rows": [
            { "wordIndexes": [0], "original": "טוֹב", "translit": "tov",
              "kjv": "Better", "sense": "good, pleasant." },
            { "wordIndexes": [1], "original": "נָחַת", "translit": "nachat",
              "kjv": "with quietness", "sense": "rest, settled calm." }
          ],
          "study": ["Solomon sets two pictures side by side."],
          "carry": "One hand at rest against two that cannot stop.",
          "model": "openai/gpt-5.6-terra",
          "cached": true
        }
        """
        let decoded = try JSONDecoder().decode(VerseWordStudy.self, from: Data(json.utf8))
        #expect(decoded.reference == "Ecclesiastes 4:6")
        #expect(decoded.language == "Hebrew")
        #expect(decoded.textName == "Westminster Leningrad Codex")
        #expect(decoded.rows.count == 2)
        #expect(decoded.rows[1].kjv == "with quietness")
        #expect(decoded.rows[1].wordIndexes == [1])
        #expect(decoded.words[0].grammar?.partOfSpeech == "adjective")
        #expect(decoded.words[0].grammar?.features == ["masculine", "singular", "absolute"])
        // An undecodable morphology is a null, not a missing key, and must not
        // cost the rest of the word.
        #expect(decoded.words[1].grammar == nil)
        #expect(decoded.words[1].strongs == "H5183")
        #expect(decoded.study.count == 1)
        #expect(decoded.model == "openai/gpt-5.6-terra")
        #expect(decoded.cached)
    }

    @Test("A study missing every optional field still decodes")
    func decodesSparseStudy() throws {
        let json = """
        { "rows": [{ "wordIndexes": [0], "original": "λόγος" }],
          "words": [{ "text": "λόγος" }] }
        """
        let decoded = try JSONDecoder().decode(VerseWordStudy.self, from: Data(json.utf8))
        #expect(decoded.rows.map(\.original) == ["λόγος"])
        #expect(decoded.rows[0].kjv.isEmpty)
        #expect(decoded.words[0].strongs.isEmpty)
        #expect(decoded.words[0].grammar == nil)
        #expect(decoded.study.isEmpty)
        #expect(decoded.carry.isEmpty)
        #expect(decoded.model == nil)
        #expect(!decoded.cached)
        // Absent ids are not an error: nothing on screen reads them back.
        #expect(decoded.book == 0)
    }

    @Test("Decodes a Strong's entry with and without its occurrence list")
    func decodesStrongsEntry() throws {
        let full = try JSONDecoder().decode(
            StrongsEntry.self,
            from: Data(
                """
                { "number": "H5183", "lemma": "נַחַת", "translit": "nachath",
                  "def": "a descent; quiet, rest", "kjv": "quietness, rest",
                  "occurrences": { "total": 7, "examples": [
                    { "reference": "Isaiah 30:15", "text": "In returning and rest" }
                  ] } }
                """.utf8
            )
        )
        #expect(full.number == "H5183")
        #expect(full.occurrences?.total == 7)
        #expect(full.occurrences?.examples.first?.reference == "Isaiah 30:15")

        // Asked without `examples`, the route sends no occurrence list at all.
        let sparse = try JSONDecoder().decode(
            StrongsEntry.self,
            from: Data(#"{ "number": "G3056" }"#.utf8)
        )
        #expect(sparse.number == "G3056")
        #expect(sparse.occurrences == nil)
        #expect(sparse.def == nil)
    }

    // MARK: - Strong's numbers

    @Test("An empty Strong's field is not a number to look up")
    func strongsNumberIsOptional() {
        #expect(VerseWordDetail(text: "καί", strongs: "G2532").strongsNumber == "G2532")
        // Asking the lexicon for "" would 400 for nothing, so a blank field
        // reads the same as an absent one.
        #expect(VerseWordDetail(text: "־", strongs: "").strongsNumber == nil)
        #expect(VerseWordDetail(text: "־", strongs: "   ").strongsNumber == nil)
        #expect(VerseWordDetail(text: "καί", strongs: " g2532 ").strongsNumber == "G2532")
    }

    // MARK: - Display rules

    @Test("Hebrew reads right to left; Greek does not")
    func readingDirection() {
        #expect(VerseWordsModel.isRightToLeft(language: "Hebrew"))
        #expect(VerseWordsModel.isRightToLeft(language: "hebrew"))
        #expect(!VerseWordsModel.isRightToLeft(language: "Greek"))
        // An unknown language falls to the reader's own direction rather than
        // guessing, which is the safe way to be wrong.
        #expect(!VerseWordsModel.isRightToLeft(language: ""))
    }

    @Test("The loading line names the language before the study arrives")
    func loadingLine() {
        // Malachi (39) closes the Hebrew; Matthew (40) opens the Greek.
        #expect(VerseWordsModel.isHebrew(book: 21))
        #expect(VerseWordsModel.isHebrew(book: 39))
        #expect(!VerseWordsModel.isHebrew(book: 40))
        #expect(WordStudyView.loadingLine(book: 21) == "Reading the Hebrew\u{2026}")
        #expect(WordStudyView.loadingLine(book: 43) == "Reading the Greek\u{2026}")
    }

    @Test("The footer names the edition the study is grounded in")
    func sourceName() {
        #expect(VerseWordsModel.sourceName(language: "Hebrew") == "Westminster Leningrad Codex")
        #expect(VerseWordsModel.sourceName(language: "Greek") == "Textus Receptus")
    }

    @Test("The subtitle carries whichever halves the payload has")
    func subtitle() {
        #expect(
            WordStudyView.subtitle(language: "Hebrew", textName: "Westminster Leningrad Codex")
                == "Hebrew \u{00B7} Westminster Leningrad Codex \u{00B7} in reading order"
        )
        #expect(WordStudyView.subtitle(language: "Greek", textName: nil)
            == "Greek \u{00B7} in reading order")
        // Neither half: no line, rather than a lone separator.
        #expect(WordStudyView.subtitle(language: nil, textName: nil) == nil)
        #expect(WordStudyView.subtitle(language: " ", textName: "") == nil)
    }

    @Test("The meta line carries whichever half the word has")
    func metaLine() {
        let grammar = VerseWordGrammar(
            partOfSpeech: "noun",
            features: ["feminine", "singular"],
            summary: "a feminine singular noun"
        )
        #expect(
            VerseWordsModel.metaLine(
                VerseWordDetail(text: "נָחַת", strongs: "H5183", grammar: grammar)
            ) == "H5183 \u{00B7} a feminine singular noun"
        )
        #expect(VerseWordsModel.metaLine(VerseWordDetail(text: "x", strongs: "H5183")) == "H5183")
        #expect(
            VerseWordsModel.metaLine(VerseWordDetail(text: "x", grammar: grammar))
                == "a feminine singular noun"
        )
        // Neither half: no line at all.
        #expect(VerseWordsModel.metaLine(VerseWordDetail(text: "x")) == nil)
    }

    @Test("The definition falls back through the lexicon to the word's glosses")
    func definitionText() {
        let word = VerseWordDetail(text: "נָחַת", strongs: "H5183", gloss: "quietness, rest")
        let entry = StrongsEntry(number: "H5183", def: "a descent; quiet, rest")
        #expect(
            VerseWordsModel.definitionText(entry: entry, word: word) == "a descent; quiet, rest"
        )
        // The lexicon has not answered yet, or has nothing: the word's own KJV
        // renderings still say something true.
        #expect(VerseWordsModel.definitionText(entry: nil, word: word) == "quietness, rest")
        let blank = StrongsEntry(number: "H5183", def: "   ", kjv: "quietness")
        #expect(
            VerseWordsModel.definitionText(entry: blank, word: VerseWordDetail(text: "x"))
                == "quietness"
        )
        // Nothing anywhere: no line, rather than an empty label.
        #expect(
            VerseWordsModel.definitionText(entry: nil, word: VerseWordDetail(text: "x")) == nil
        )
    }

    @Test("The headword prefers the lemma, and falls back to the word in the verse")
    func headword() {
        #expect(
            VerseWordsModel.headword(VerseWordDetail(text: "נָחַת", lemma: "נַחַת")) == "נַחַת"
        )
        #expect(VerseWordsModel.headword(VerseWordDetail(text: "נָחַת", lemma: "  ")) == "נָחַת")
        #expect(VerseWordsModel.headword(VerseWordDetail(text: "λόγος")) == "λόγος")
    }

    @Test("The transliteration prefers the row's reader spelling")
    func headTranslit() {
        let row = VerseWordRow(wordIndexes: [0], original: "נָחַת", translit: "nachat")
        let word = VerseWordDetail(text: "נָחַת", translit: "nachath")
        // "nachat" is what a reader would say; "nachath" is Strong's notation.
        #expect(VerseWordsModel.headTranslit(row: row, word: word) == "nachat")
        #expect(
            VerseWordsModel.headTranslit(
                row: VerseWordRow(wordIndexes: [0], original: "x"),
                word: word
            ) == "nachath"
        )
        #expect(VerseWordsModel.headTranslit(row: nil, word: nil) == nil)
    }

    // MARK: - Prompts

    @Test("Ask about this word names the word three ways")
    func askPrompt() {
        #expect(
            VerseWordsModel.askPrompt(
                language: "Hebrew",
                lemma: "נָחַת",
                translit: "nachat",
                number: "H5183"
            ) == "What does the Hebrew word נָחַת (nachat, H5183) carry in this verse?"
        )
        // No transliteration: the parenthetical keeps the number rather than
        // trailing an empty comma.
        #expect(
            VerseWordsModel.askPrompt(
                language: "Greek",
                lemma: "ἀγάπη",
                translit: "  ",
                number: "G26"
            ) == "What does the Greek word ἀγάπη (G26) carry in this verse?"
        )
    }

    @Test("Every verse asks for the word everywhere, not here")
    func everyVersePrompt() {
        #expect(
            VerseWordsModel.everyVersePrompt(
                language: "Hebrew",
                lemma: "נָחַת",
                number: "H5183"
            ) == "Show me every verse where the Hebrew word נָחַת (H5183) appears."
        )
    }

    // MARK: - Model

    @Test("An unconfigured model fails rather than crashing")
    func unconfiguredFails() async {
        VerseWordsModel.clearCache()
        let model = VerseWordsModel()
        await model.load(book: 21, chapter: 4, verse: 6)
        // No API client, so nothing was sent and the tab says so.
        #expect(model.status == .failed)
        #expect(model.study == nil)
        #expect(model.rows.isEmpty)
        #expect(model.message == VerseWordsModel.buildFailureMessage)
        // Opening a row that does not exist is a no-op, not a trap.
        model.toggle(row: 0)
        #expect(model.openRow == nil)
        #expect(model.entry(inRow: 0) == nil)
        #expect(!model.isEntryLoading(inRow: 0))
    }

    @Test("A failed fetch is retryable and says so")
    func failedFetchIsRetryable() async {
        // A client pointed at a port nothing answers on: the request fails
        // fast, and the tab offers a retry rather than an empty panel.
        VerseWordsModel.clearCache()
        let model = VerseWordsModel()
        model.configure(
            api: APIClient(
                baseURL: URL(string: "http://127.0.0.1:9")!,
                token: { _ in nil },
                onAuthFailure: {}
            ),
            modelId: nil
        )
        await model.load(book: 40, chapter: 1, verse: 1)
        #expect(model.status == .failed)
        #expect(model.study == nil)
        #expect(model.message == VerseWordsModel.buildFailureMessage)
        // The target survives the failure, which is what makes Retry possible.
        #expect(model.target == VerseWordsModel.Target(book: 40, chapter: 1, verse: 1))
    }
}
