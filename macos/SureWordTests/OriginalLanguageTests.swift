import Foundation
import Testing
@testable import SureWord

/// The Tap-a-verse panel's "Original language" section. Everything pure about
/// it: the two wire shapes and the four display rules. The rest is a round trip
/// to `/api/bible/original` and `/api/bible/strongs`.
///
/// Mirrors the same section on web and Android; the source texts are the
/// Westminster Leningrad Codex (Hebrew) and the Textus Receptus (Greek).
@Suite("Original language")
struct OriginalLanguageTests {

    // MARK: - Wire decoding

    @Test("Decodes a Hebrew verse, Strong's numbers and morphology included")
    func decodesHebrewVerse() throws {
        let json = """
        {
          "book": 1,
          "chapter": 1,
          "verse": 1,
          "reference": "Genesis 1:1",
          "language": "Hebrew",
          "textName": "Westminster Leningrad Codex",
          "words": [
            { "text": "בְּרֵאשִׁ֖ית", "strongs": "H7225", "morph": "Ncfsa",
              "lemma": "רֵאשִׁית", "translit": "reshith", "gloss": "In the beginning" },
            { "text": "בָּרָ֣א", "strongs": "H1254", "morph": "Vqp3ms" }
          ]
        }
        """
        let decoded = try JSONDecoder().decode(OriginalVerse.self, from: Data(json.utf8))
        #expect(decoded.reference == "Genesis 1:1")
        #expect(decoded.language == "Hebrew")
        #expect(decoded.textName == "Westminster Leningrad Codex")
        #expect(decoded.words.count == 2)
        #expect(decoded.words[0].strongs == "H7225")
        #expect(decoded.words[0].translit == "reshith")
        // Enrichment the route did not fill in costs that one line, not the row.
        #expect(decoded.words[1].lemma == nil)
        #expect(decoded.words[1].gloss == nil)
    }

    @Test("A word with nothing but its text still decodes")
    func decodesMinimalWord() throws {
        let json = """
        { "reference": "John 1:1", "language": "Greek", "textName": "Textus Receptus",
          "words": [{ "text": "λόγος" }] }
        """
        let decoded = try JSONDecoder().decode(OriginalVerse.self, from: Data(json.utf8))
        #expect(decoded.words.map(\.text) == ["λόγος"])
        #expect(decoded.words[0].strongs == nil)
        #expect(decoded.words[0].morph == nil)
        // Absent ids are not an error: nothing on screen reads them back.
        #expect(decoded.book == 0)
        #expect(decoded.chapter == 0)
    }

    @Test("Decodes a Strong's entry, and one the lexicon only half fills in")
    func decodesStrongsEntry() throws {
        let full = try JSONDecoder().decode(
            StrongsEntry.self,
            from: Data(
                """
                { "number": "H430", "lemma": "אֱלֹהִים", "translit": "elohim",
                  "def": "gods in the ordinary sense; the supreme God",
                  "kjv": "God, god, judge, GOD" }
                """.utf8
            )
        )
        #expect(full.number == "H430")
        #expect(full.kjv == "God, god, judge, GOD")

        let sparse = try JSONDecoder().decode(
            StrongsEntry.self,
            from: Data(#"{ "number": "G3056" }"#.utf8)
        )
        #expect(sparse.number == "G3056")
        #expect(sparse.def == nil)
        #expect(sparse.lemma == nil)
    }

    // MARK: - Strong's numbers

    @Test("An empty Strong's field is not a number to look up")
    func strongsNumberIsOptional() {
        #expect(OriginalWord(text: "καί", strongs: "G2532").strongsNumber == "G2532")
        // Asking the lexicon for "" would 404 for nothing, so a blank field
        // reads the same as an absent one.
        #expect(OriginalWord(text: "־", strongs: "").strongsNumber == nil)
        #expect(OriginalWord(text: "־", strongs: "   ").strongsNumber == nil)
        #expect(OriginalWord(text: "־").strongsNumber == nil)
        #expect(OriginalWord(text: "καί", strongs: " G2532 ").strongsNumber == "G2532")
    }

    // MARK: - Display rules

    @Test("Cantillation marks are stripped, vowel points are kept")
    func stripsCantillation() {
        // Genesis 1:1's first word, with its tipcha (U+0596) and the vowel
        // points that make it readable. The accents are chant notation and
        // crowd the consonants at chip size; the points are how the word is
        // pronounced, and lose it if dropped.
        let pointed = "\u{05D1}\u{05B0}\u{05BC}\u{05E8}\u{05B5}\u{05D0}\u{05E9}\u{05C1}\u{05B4}\u{05D9}\u{0596}\u{05EA}"
        let stripped = OriginalLanguageModel.stripCantillation(pointed)
        let scalars = stripped.unicodeScalars.map(\.value)
        #expect(!scalars.contains(0x0596))
        #expect(scalars.contains(0x05B0))
        #expect(scalars.contains(0x05B5))
        // Every consonant survives.
        let consonants = scalars.filter { (0x05D0...0x05EA).contains($0) }
        #expect(consonants.count == 6)

        // Greek has no marks in that block and must come back untouched.
        #expect(OriginalLanguageModel.stripCantillation("λόγος") == "λόγος")
        #expect(OriginalLanguageModel.stripCantillation("") == "")
    }

    @Test("Hebrew reads right to left; Greek does not")
    func readingDirection() {
        #expect(OriginalLanguageModel.isRightToLeft(language: "Hebrew"))
        #expect(OriginalLanguageModel.isRightToLeft(language: "hebrew"))
        #expect(!OriginalLanguageModel.isRightToLeft(language: "Greek"))
        // An unknown language falls to the reader's own direction rather than
        // guessing, which is the safe way to be wrong.
        #expect(!OriginalLanguageModel.isRightToLeft(language: ""))
        #expect(!OriginalLanguageModel.isRightToLeft(language: "Aramaic"))
    }

    @Test("The meta line carries whichever half the payload has")
    func metaLine() {
        #expect(
            OriginalLanguageView.metaLine(OriginalWord(text: "x", strongs: "H430", morph: "Ncmpa"))
                == "H430 \u{00B7} Ncmpa"
        )
        #expect(OriginalLanguageView.metaLine(OriginalWord(text: "x", strongs: "H430")) == "H430")
        #expect(OriginalLanguageView.metaLine(OriginalWord(text: "x", morph: "Ncmpa")) == "Ncmpa")
        // Neither half: no line, rather than a lone separator.
        #expect(OriginalLanguageView.metaLine(OriginalWord(text: "x")) == nil)
        #expect(OriginalLanguageView.metaLine(OriginalWord(text: "x", strongs: " ", morph: " ")) == nil)
    }

    @Test("The definition line waits, shows, or stays away")
    func definitionLine() {
        let entry = StrongsEntry(number: "H430", lemma: nil, translit: nil, def: "the supreme God", kjv: nil)
        #expect(OriginalLanguageView.definitionText(entry, isLoading: false) == "the supreme God")
        #expect(OriginalLanguageView.definitionText(nil, isLoading: true) == "\u{2026}")
        // A word the lexicon has nothing for must not sit under a placeholder
        // that can never resolve.
        #expect(OriginalLanguageView.definitionText(nil, isLoading: false) == nil)
        let blank = StrongsEntry(number: "H430", lemma: nil, translit: nil, def: "   ", kjv: nil)
        #expect(OriginalLanguageView.definitionText(blank, isLoading: false) == nil)
    }

    // MARK: - Model

    @MainActor
    @Test("An unconfigured model is inert rather than crashing")
    func unconfiguredIsInert() async {
        OriginalLanguageModel.clearCache()
        let model = OriginalLanguageModel()
        await model.load(book: 1, chapter: 1, verse: 1)
        // No API client, so nothing was sent and the section draws nothing.
        #expect(model.status == .unavailable)
        #expect(model.verse == nil)
        #expect(model.words.isEmpty)
        // Selecting a word that does not exist is a no-op, not a trap.
        model.select(word: 0)
        #expect(model.selectedIndex == nil)
        #expect(model.selectedWord == nil)
        #expect(!model.isDefinitionLoading)
    }

    @MainActor
    @Test("A failed fetch leaves the section absent, never an error row")
    func failedFetchIsSilent() async {
        // A client pointed at a port nothing answers on: the request fails
        // fast, and the section simply does not draw.
        OriginalLanguageModel.clearCache()
        let model = OriginalLanguageModel()
        model.configure(
            APIClient(
                baseURL: URL(string: "http://127.0.0.1:9")!,
                token: { _ in nil },
                onAuthFailure: {}
            )
        )
        await model.load(book: 40, chapter: 1, verse: 1)
        #expect(model.status == .unavailable)
        #expect(model.verse == nil)
    }
}
