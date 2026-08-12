import Foundation
import Testing
@testable import SureWord

/// Port of `mobile/src/features/bible/translations.test.ts`. The Vitest suite
/// stubs `fetch`; here the transport is injected into `NKJVProvider` for the
/// same reason — the rows, the URL and the cache are the behaviour under test,
/// not bolls.life's uptime.
@Suite("Chapter loading")
struct BibleTranslationsTests {
    /// bolls.life responses carry extra fields (pk, comment); only verse and
    /// text are mapped, with stray double spaces collapsed.
    private static let john3 = """
        [
          {"pk": 1011, "verse": 2, "text": "The same came to Jesus by night,  and said unto him…", "comment": null},
          {"pk": 1010, "verse": 1, "text": "There was a man of the Pharisees, named Nicodemus…", "comment": null}
        ]
        """

    private static func provider(
        body: String = john3,
        status: Int = 200,
        recorder: URLRecorder? = nil,
        failure: (any Error)? = nil
    ) -> NKJVProvider {
        NKJVProvider { request in
            if let recorder { await recorder.record(request) }
            if let failure { throw failure }
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(body.utf8), response)
        }
    }

    @Test("maps bolls.life rows to an ordered verse list with collapsed spacing")
    func mapsRows() async throws {
        let verses = try await BibleTranslations.chapter(
            .nkjv,
            order: 43,
            chapter: 3,
            nkjv: Self.provider()
        )
        #expect(
            verses == [
                "There was a man of the Pharisees, named Nicodemus…",
                "The same came to Jesus by night, and said unto him…",
            ]
        )
    }

    @Test("requests the expected bolls.life URL")
    func requestsURL() async throws {
        let recorder = URLRecorder()
        _ = try await BibleTranslations.chapter(
            .nkjv,
            order: 19,
            chapter: 23,
            nkjv: Self.provider(recorder: recorder)
        )
        let requests = await recorder.requests
        #expect(requests.count == 1)
        #expect(requests.first?.url?.absoluteString == "https://bolls.life/get-chapter/NKJV/19/23/")
        #expect(requests.first?.timeoutInterval == NKJVProvider.timeout)
    }

    @Test("caches chapters in memory")
    func caches() async throws {
        let recorder = URLRecorder()
        let nkjv = Self.provider(recorder: recorder)
        _ = try await BibleTranslations.chapter(.nkjv, order: 1, chapter: 1, nkjv: nkjv)
        _ = try await BibleTranslations.chapter(.nkjv, order: 1, chapter: 1, nkjv: nkjv)
        #expect(await recorder.requests.count == 1)
    }

    @Test("reports the friendly error when the request fails")
    func httpFailure() async {
        await #expect(throws: BibleError(message: BibleTranslations.chapterLoadError)) {
            try await BibleTranslations.chapter(
                .nkjv,
                order: 43,
                chapter: 4,
                nkjv: Self.provider(body: "{}", status: 500)
            )
        }
    }

    @Test("reports the friendly error on network failure")
    func networkFailure() async {
        await #expect(throws: BibleError(message: BibleTranslations.chapterLoadError)) {
            try await BibleTranslations.chapter(
                .nkjv,
                order: 43,
                chapter: 5,
                nkjv: Self.provider(failure: URLError(.notConnectedToInternet))
            )
        }
    }

    @Test("KJV resolves from the bundle without touching the network")
    func kjvIsOffline() async throws {
        let recorder = URLRecorder()
        let verses = try await BibleTranslations.chapter(
            .kjv,
            order: 43,
            chapter: 3,
            nkjv: Self.provider(recorder: recorder)
        )
        #expect(verses.count == 36)
        #expect(await recorder.requests.isEmpty)
    }

    @Test("an unknown KJV chapter reports the friendly error, not the internal one")
    func kjvOutOfRange() async {
        await #expect(throws: BibleError(message: BibleTranslations.chapterLoadError)) {
            try await BibleTranslations.chapter(.kjv, order: 65, chapter: 2)
        }
    }
}

/// Collects the requests a stubbed transport was handed.
actor URLRecorder {
    private(set) var requests: [URLRequest] = []

    func record(_ request: URLRequest) {
        requests.append(request)
    }
}
