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
@Suite("Verse words", .serialized)
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
        #expect(full.occurrences?.totalScope == nil)
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

    @Test("Occurrence counts identify their edition and tolerate legacy or future scopes")
    func occurrenceScopeAndActionLabel() throws {
        let cases: [(String, String?, String)] = [
            (#"{"total":1,"totalScope":"original-edition-verses","examples":[]}"#,
             "original-edition-verses", "Original verse · 1"),
            (#"{"total":7,"totalScope":"original-edition-verses","examples":[]}"#,
             "original-edition-verses", "Original verses · 7"),
            (#"{"total":0,"totalScope":"original-edition-verses","examples":[]}"#,
             "original-edition-verses", "Original verses · 0"),
            (#"{"total":7,"examples":[]}"#, nil, "Find occurrences"),
            (#"{"total":7,"totalScope":null,"examples":[]}"#, nil, "Find occurrences"),
            (#"{"total":7,"totalScope":"future-scope","examples":[]}"#,
             "future-scope", "Find occurrences"),
        ]
        for (json, scope, label) in cases {
            let occurrences = try JSONDecoder().decode(StrongsOccurrences.self, from: Data(json.utf8))
            #expect(occurrences.totalScope == scope)
            #expect(VerseWordsModel.occurrenceActionLabel(occurrences) == label)
        }
        #expect(VerseWordsModel.occurrenceActionLabel(nil) == "Find occurrences")
        // Existing native callers can still construct an unscoped response.
        let legacy = StrongsOccurrences(total: 7, examples: [
            StrongsOccurrence(reference: "Isaiah 30:15", text: "In returning and rest"),
        ])
        #expect(legacy.totalScope == nil)
        #expect(legacy.examples.first?.reference == "Isaiah 30:15")
        #expect(VerseWordsModel.occurrenceActionLabel(legacy) == "Find occurrences")
    }

    @Test("Strong's requests version their HTTP cache identity and preserve example parameters")
    func versionedStrongsRequest() async throws {
        let fixture = makeConcordanceFixture()
        defer { fixture.close() }
        let entry = try await VerseWordsAPI.strongs(
            api: fixture.api, number: "G2316", examples: 2, exclude: "43:1:1"
        )
        let request = try #require(fixture.server.requests.first)
        let url = try #require(request.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(url.path == "/api/bible/strongs")
        #expect(request.httpMethod == "GET")
        #expect(query.first(where: { $0.name == "alignment" })?.value == "fragments-v1")
        #expect(query.first(where: { $0.name == "number" })?.value == "G2316")
        #expect(query.first(where: { $0.name == "examples" })?.value == "2")
        #expect(query.first(where: { $0.name == "exclude" })?.value == "43:1:1")
        #expect(entry.occurrences?.totalScope == "original-edition-verses")
        #expect(VerseWordsModel.occurrenceActionLabel(entry.occurrences) == "Original verses · 7")

        _ = try await VerseWordsAPI.strongs(api: fixture.api, number: "G3056", exclude: nil)
        let noExcludeURL = try #require(fixture.server.requests.last?.url)
        let noExcludeQuery = URLComponents(url: noExcludeURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(noExcludeQuery.first(where: { $0.name == "alignment" })?.value == "fragments-v1")
        #expect(!noExcludeQuery.contains(where: { $0.name == "exclude" }))
    }

    @Test("Concordance cache reuses a number and verse across models without mixing other targets")
    func concordanceCacheReuseAndIsolation() async throws {
        VerseWordsModel.clearCache()
        defer { VerseWordsModel.clearCache() }
        let fixture = makeConcordanceFixture()
        defer { fixture.close() }
        let first = VerseWordsModel()
        first.configure(api: fixture.api, modelId: nil)
        await first.load(book: 43, chapter: 1, verse: 1)
        #expect(first.status == .ready)
        first.toggle(row: 0)
        let firstEntry = try await waitForEntry(first, row: 0)
        #expect(firstEntry.occurrences?.examples.first?.reference == "Genesis 1:1")
        #expect(first.definitions.keys.contains("fragments-v1|G2316@43:1:1"))
        #expect(!first.definitions.keys.contains("G2316@43:1:1"))
        first.closeRow()
        first.toggle(row: 0)
        #expect(first.entry(inRow: 0) == firstEntry)
        #expect(fixture.server.strongsRequests.count == 1)

        let reopened = VerseWordsModel()
        reopened.configure(api: fixture.api, modelId: nil)
        await reopened.load(book: 43, chapter: 1, verse: 1)
        reopened.toggle(row: 0)
        // A second view uses the process cache synchronously, without a request.
        #expect(reopened.entry(inRow: 0) == firstEntry)
        #expect(fixture.server.strongsRequests.count == 1)

        await reopened.load(book: 43, chapter: 1, verse: 2)
        reopened.toggle(row: 0)
        let otherVerse = try await waitForEntry(reopened, row: 0)
        #expect(otherVerse.occurrences?.examples.first?.reference == "Genesis 1:2")
        #expect(fixture.server.strongsRequests.count == 2)
        // A different Strong's number on the same verse must not borrow a definition.
        reopened.toggle(row: 1)
        let otherNumber = try await waitForEntry(reopened, row: 1)
        #expect(otherNumber.number == "G3056")
        #expect(otherNumber.def == "definition G3056")
        #expect(fixture.server.strongsRequests.count == 3)
        for request in fixture.server.strongsRequests {
            let url = try #require(request.url)
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            #expect(query.first(where: { $0.name == "alignment" })?.value == "fragments-v1")
        }
    }

    private func waitForEntry(_ model: VerseWordsModel, row: Int) async throws -> StrongsEntry {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        while model.entry(inRow: row) == nil, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        return try #require(model.entry(inRow: row))
    }

    private func makeConcordanceFixture() -> VerseWordsConcordanceFixture {
        let server = VerseWordsConcordanceServer()
        VerseWordsConcordanceURLProtocol.register(server)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VerseWordsConcordanceURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = APIClient(baseURL: URL(string: "https://\(server.host)")!, token: { _ in "local-fixture" },
                            onAuthFailure: {}, session: session)
        return VerseWordsConcordanceFixture(server: server, session: session, api: api)
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

private struct VerseWordsConcordanceFixture {
    let server: VerseWordsConcordanceServer
    let session: URLSession
    let api: APIClient

    func close() {
        session.invalidateAndCancel()
        VerseWordsConcordanceURLProtocol.unregister(server)
    }
}

/// Isolated, in-process responses exercise the real APIClient and model cache.
/// No fixture is registered globally with URLSession and no request uses DNS.
private final class VerseWordsConcordanceServer: @unchecked Sendable {
    let host = "versewords-\(UUID().uuidString.lowercased()).invalid"
    private let lock = NSLock()
    private var captured: [URLRequest] = []

    var requests: [URLRequest] { lock.withLock { captured } }
    var strongsRequests: [URLRequest] {
        requests.filter { $0.url?.path == "/api/bible/strongs" }
    }

    func response(for request: URLRequest) throws -> Data {
        lock.withLock { captured.append(request) }
        guard let url = request.url else { throw URLError(.badURL) }
        if url.path == "/api/verse-words" {
            return Data(#"{"words":[{"text":"θεός","strongs":"G2316"},{"text":"λόγος","strongs":"G3056"}],"rows":[{"wordIndexes":[0],"original":"θεός","kjv":"God"},{"wordIndexes":[1],"original":"λόγος","kjv":"Word"}]}"#.utf8)
        }
        guard url.path == "/api/bible/strongs" else { throw URLError(.unsupportedURL) }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let number = query.first(where: { $0.name == "number" })?.value ?? ""
        let excluded = query.first(where: { $0.name == "exclude" })?.value
        let reference = excluded == "43:1:2" ? "Genesis 1:2" : "Genesis 1:1"
        return try JSONSerialization.data(withJSONObject: [
            "number": number, "def": "definition \(number)",
            "occurrences": ["total": 7, "totalScope": "original-edition-verses",
                            "examples": [["reference": reference, "text": "Fixture KJV text"]]],
        ])
    }
}

private final class VerseWordsConcordanceURLProtocol: URLProtocol, @unchecked Sendable {
    private static let registryLock = NSLock()
    nonisolated(unsafe) private static var servers: [String: VerseWordsConcordanceServer] = [:]

    static func register(_ server: VerseWordsConcordanceServer) {
        registryLock.withLock { servers[server.host] = server }
    }

    static func unregister(_ server: VerseWordsConcordanceServer) {
        _ = registryLock.withLock { servers.removeValue(forKey: server.host) }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        // This protocol belongs only to the fixture's private session. Claim
        // every request and reject unregistered hosts instead of falling
        // through to a real transport when a URL contract regresses.
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let host = request.url?.host,
              let server = Self.registryLock.withLock({ Self.servers[host] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        do {
            let body = try server.response(for: request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
