import Foundation
import Testing

@testable import SureWord

/// The bundled BSB, the KJV speech sidecar and the editorial headings, read
/// through the same paths the reader uses (PRD C5). Expectations are the
/// publisher data Android ships, pinned at known verses.
@Suite("Bundled Bible text and reader formatting")
struct BibleTextTests {
    @Test("all 66 BSB books load with every chapter")
    func bsbCoverage() async throws {
        var verses = 0
        for book in Bible.books {
            for chapter in 1...book.chapters {
                verses += try await BSBLibrary.shared.chapter(order: book.order, chapter: chapter).count
            }
        }
        #expect(verses == 31_102)
    }

    @Test("John 3:16 is BSB text marked as the words of Jesus")
    func bsbJohn316() async throws {
        let john3 = try await BSBLibrary.shared.chapter(order: 43, chapter: 3)
        #expect(john3.count == 36)
        let verse = john3[15]
        #expect(verse.number == 16)
        #expect(verse.text.hasPrefix("For God so loved the world that He gave His one and only Son"))
        #expect(verse.segments.allSatisfy { $0.jesusSpeech })
        let chapter = try await BibleTranslations.chapter(.bsb, order: 43, chapter: 3)
        #expect(chapter[15] == verse.text)
    }

    @Test("omitted verses keep their number and say so; poetry keeps its line breaks")
    func omittedAndPoetry() async throws {
        let matthew17 = try await BSBLibrary.shared.chapter(order: 40, chapter: 17)
        #expect(matthew17[20].number == 21)
        #expect(matthew17[20].omitted)
        #expect(matthew17[20].text.isEmpty)
        let psalm23 = try await BSBLibrary.shared.chapter(order: 19, chapter: 23)
        #expect(psalm23[0].text == "A Psalm of David.\nThe LORD is my shepherd;\nI shall not want.")
    }

    @Test("an out-of-canon reference is the reader's load error")
    func invalidReference() async {
        await #expect(throws: BibleError.self) {
            _ = try await BibleTranslations.chapter(.bsb, order: 43, chapter: 22)
        }
    }

    @Test("KJV speech spans split exactly at the sidecar's UTF-16 offsets")
    func kjvRedLetters() async throws {
        let markup = try await KJVLibrary.shared.chapter(order: 40, chapter: 3)[14]
        let segments = await ReaderAnnotations.shared.segments(markup, translation: .kjv, order: 40, chapter: 3, verse: 15)
        #expect(segments.map(\.text) == [
            "And Jesus answering said unto him, ",
            "Suffer it to be so now: for thus it becometh us to fulfil all righteousness.",
            " Then he suffered him.",
        ])
        #expect(segments.map(\.jesusSpeech) == [false, true, false])
        // NKJV never borrows KJV offsets.
        let nkjv = await ReaderAnnotations.shared.segments(markup, translation: .nkjv, order: 40, chapter: 3, verse: 15)
        #expect(nkjv.allSatisfy { !$0.jesusSpeech })
    }

    @Test("a stale sidecar text leaves the verse uncoloured")
    func staleSidecar() {
        let segments = [ReaderSegment(text: "Different words.", italic: false)]
        #expect(ReaderAnnotations.split(segments, ranges: [[0, 5]], expected: "Other words.") == segments)
    }

    @Test("section headings show on KJV and BSB, never NKJV")
    func headings() async {
        #expect(await ReaderAnnotations.shared.sectionHeadings(.kjv, order: 43, chapter: 1, verse: 1) == ["The Beginning"])
        #expect(await ReaderAnnotations.shared.sectionHeadings(.bsb, order: 43, chapter: 3, verse: 1) == ["Jesus and Nicodemus"])
        #expect(await ReaderAnnotations.shared.sectionHeadings(.nkjv, order: 43, chapter: 3, verse: 1).isEmpty)
        let verses = await ReaderAnnotations.shared.chapter(.bsb, order: 40, chapter: 17, markups: Array(repeating: "", count: 27))
        #expect(verses[20].omitted)
    }

    @Test("BSB carries a name and copyright for the reader footer")
    func translationMetadata() {
        #expect(TranslationID.allCases == [.kjv, .nkjv, .bsb])
        #expect(TranslationID.bsb.name == "Berean Standard Bible")
        #expect(TranslationID.bsb.copyright == "Public domain · BSB Publishing")
        #expect(TranslationID(rawValue: "BSB") == .bsb)
    }
}

@Suite("Translation-aware Bible search (search.ts)")
struct BibleSearchTests {
    private static let offline = BibleSearch(fetch: { _ in throw URLError(.notConnectedToInternet) })

    @Test("BSB searches its own wording offline")
    func bsbOffline() async throws {
        let result = try await Self.offline.search("one and only Son", translation: .bsb)
        #expect(result.translation == .bsb)
        #expect(result.hits.contains { $0.order == 43 && $0.chapter == 3 && $0.verse == 16 })
        #expect(result.hits.allSatisfy { $0.translation == .bsb })
    }

    @Test("a BSB miss falls back to the KJV")
    func bsbFallsBackToKJV() async throws {
        let result = try await Self.offline.search("only begotten Son", translation: .bsb)
        #expect(result.translation == .kjv)
        #expect(result.hits.contains { $0.order == 43 && $0.chapter == 3 && $0.verse == 16 })
    }

    @Test("a KJV miss checks NKJV, and an unreachable NKJV is the search error")
    func kjvFallsBackToNKJV() async {
        await #expect(throws: BibleError(message: BibleSearch.error)) {
            _ = try await Self.offline.search("zzzz qqqq", translation: .kjv)
        }
    }

    @Test("queries shorter than two characters do not search")
    func shortQuery() async throws {
        let result = try await Self.offline.search(" a ", translation: .nkjv)
        #expect(result.hits.isEmpty)
        #expect(result.translation == .nkjv)
    }

    @Test("NKJV asks bolls.life for lexical matches and validates every row")
    func nkjvRequest() async throws {
        let url = try #require(BibleSearch.nkjvURL(query: "living water", limit: 100))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(url.host == "bolls.life")
        #expect(url.path == "/v2/find/NKJV")
        #expect(items.contains(URLQueryItem(name: "match_whole", value: "true")))
        #expect(items.contains(URLQueryItem(name: "search", value: "living water")))

        let good = Data(#"{"results":[{"translation":"NKJV","book":43,"chapter":4,"verse":10,"text":"given you <mark>living water</mark>&amp; more"}]}"#.utf8)
        let hits = try BibleSearch.parseNKJV(good, limit: 100)
        #expect(hits == [BibleSearchHit(order: 43, chapter: 4, verse: 10, text: "given you living water& more", translation: .nkjv)])

        let wrongTranslation = Data(#"{"results":[{"translation":"KJV","book":43,"chapter":4,"verse":10,"text":"x"}]}"#.utf8)
        #expect(throws: BibleError.self) { try BibleSearch.parseNKJV(wrongTranslation, limit: 100) }
        let badChapter = Data(#"{"results":[{"translation":"NKJV","book":43,"chapter":40,"verse":10,"text":"x"}]}"#.utf8)
        #expect(throws: BibleError.self) { try BibleSearch.parseNKJV(badChapter, limit: 100) }
    }

    @MainActor
    @Test("the status line reads exactly as Android's")
    func statusLines() async {
        let model = BibleSearchModel(search: Self.offline)
        #expect(model.hint(account: .kjv) == "Search KJV by word or phrase. If there are no matches, we check NKJV too. NKJV requires a connection.")
        #expect(model.hint(account: .bsb) == "Search BSB by word or phrase. If there are no matches, we check KJV too. NKJV requires a connection.")

        model.query = "only begotten Son"
        model.selectedTranslation = .bsb
        await model.run(account: .kjv, debounce: .zero)
        #expect(model.resultTranslation == .kjv)
        let status = model.status(account: .kjv) ?? ""
        #expect(status.hasSuffix(" in KJV. No phrase matches in BSB."))

        model.query = "John 3:16"
        await model.run(account: .kjv, debounce: .zero)
        #expect(model.referenceJump == Reference(order: 43, chapter: 3, verse: 16))
        #expect(!model.loading)
    }
}

@Suite("See also cross-references")
struct CrossReferencesTests {
    @Test("the request matches Android's query")
    func request() throws {
        let url = try #require(CrossReferencesModel.url(baseURL: URL(string: "https://sureword.app")!, reference: "John 3:16", translation: .bsb))
        #expect(url.absoluteString == "https://sureword.app/api/bible/crossrefs?reference=John%203:16&translation=BSB&limit=5")
    }

    @Test("responses are validated, stripped of markup and capped at five")
    func parse() throws {
        let rows = (1...7).map { #"{"reference":"Romans 5:\#($0)","text":"<i>grace</i> abounds"}"# }.joined(separator: ",")
        let data = Data(#"{"reference":"John 3:16","translation":"KJV","crossReferences":[\#(rows),{"reference":"Psalm 23"}]}"#.utf8)
        let items = try CrossReferencesModel.parse(data, translation: .kjv)
        #expect(items.count == 5)
        #expect(items[0] == CrossReferenceItem(reference: "Romans 5:1", text: "grace abounds"))

        #expect(throws: BibleError.self) { try CrossReferencesModel.parse(data, translation: .nkjv) }
        let badText = Data(#"{"reference":"John 3:16","translation":"KJV","crossReferences":[{"reference":"Romans 5:8","text":5}]}"#.utf8)
        #expect(throws: BibleError.self) { try CrossReferencesModel.parse(badText, translation: .kjv) }
    }

    @Test("ranges open at their first verse; unreadable labels stay plain")
    func targets() {
        #expect(CrossReferenceItem(reference: "Romans 5:8-10", text: nil).target == Reference(order: 45, chapter: 5, verse: 8))
        #expect(CrossReferenceItem(reference: "John 3:36\u{2013}4:2", text: nil).target == Reference(order: 43, chapter: 3, verse: 36))
        #expect(CrossReferenceItem(reference: "Not a book 9:9", text: nil).target == nil)
    }

    @MainActor
    @Test("a failed load shows the error state, and a retry recovers")
    func loadStates() async {
        let calls = Counter()
        let model = CrossReferencesModel(baseURL: URL(string: "https://example.invalid")!) { request in
            if await calls.next() == 1 { throw URLError(.timedOut) }
            let body = Data(#"{"reference":"John 3:16","translation":"KJV","crossReferences":[]}"#.utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        await model.load(reference: "John 3:16", translation: .kjv)
        #expect(model.state == .error)
        await model.retry(reference: "John 3:16", translation: .kjv)
        #expect(model.state == .ready([]))
    }

    private actor Counter {
        private var value = 0
        func next() -> Int { value += 1; return value }
    }
}

@Suite("Continue reading (B8 lastRead)")
struct ContinueReadingTests {
    @Test("a BSB entry is accepted and resolves to its book")
    func acceptsBSB() {
        let data = Data(#"{"lastRead":{"book":"Judges","chapter":7,"translation":"BSB","readAt":"2026-10-06T12:00:00.000Z"}}"#.utf8)
        let value = LastRead.parse(response: data)
        #expect(value == LastRead(order: 7, bookName: "Judges", chapter: 7, translation: .bsb, readAt: "2026-10-06T12:00:00.000Z"))
        #expect(value?.label == "Judges 7")
    }

    @Test("malformed or impossible entries hide the row")
    func rejects() {
        let cases = [
            #"{"lastRead":null}"#,
            #"{"lastRead":{"book":"Judges","chapter":22,"translation":"KJV","readAt":"x"}}"#,
            #"{"lastRead":{"book":"Judges","chapter":1.5,"translation":"KJV","readAt":"x"}}"#,
            #"{"lastRead":{"book":"Hezekiah","chapter":1,"translation":"KJV","readAt":"x"}}"#,
            #"{"lastRead":{"book":"Judges","chapter":1,"translation":"ESV","readAt":"x"}}"#,
            #"{"lastRead":{"book":"Judges","chapter":1,"translation":"KJV"}}"#,
        ]
        for json in cases {
            #expect(LastRead.parse(response: Data(json.utf8)) == nil, "\(json)")
        }
    }

    @MainActor
    @Test("a failed refresh hides a previously shown row")
    func failSoft() async {
        let ok = Data(#"{"lastRead":{"book":"Ruth","chapter":2,"translation":"NKJV","readAt":"x"}}"#.utf8)
        let flag = Flag()
        let model = ContinueReadingModel {
            if await flag.flip() { return ok }
            throw URLError(.notConnectedToInternet)
        }
        await model.refresh()
        #expect(model.lastRead?.label == "Ruth 2")
        await model.refresh()
        #expect(model.lastRead == nil)
    }

    private actor Flag {
        private var first = true
        func flip() -> Bool { defer { first = false }; return first }
    }
}
