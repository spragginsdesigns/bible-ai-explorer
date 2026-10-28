import Foundation
import XCTest

@testable import SureWord

private actor AtlasRequestProbe {
    private(set) var count = 0
    func requested() { count += 1 }
}

@MainActor
final class AtlasOfflineTests: XCTestCase {
    private struct Golden: Decodable {
        let inputSha256: String
        let counts: [String: Int]
        let cases: [Case]

        struct Case: Decodable {
            let name: String
            let operation: BundledAtlas.Operation
            let parameters: BundledAtlas.Parameters
            let status: Int
            let value: JSONValue?
        }
    }

    private func golden() throws -> Golden {
        let url = try XCTUnwrap(Bundle(for: AtlasOfflineTests.self).url(forResource: "AtlasOfflineGolden", withExtension: "json"))
        return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }

    private func resourceURL() throws -> URL {
        try XCTUnwrap(Bundle.main.url(forResource: "atlas", withExtension: "js", subdirectory: "AtlasData"))
    }

    func testCanonicalGoldenRepliesAndUnknownIDsUseRealJavaScriptCore() async throws {
        let fixture = try golden()
        let atlas = BundledAtlas(resourceURL: try resourceURL())
        XCTAssertEqual(fixture.cases.count, 31)
        for item in fixture.cases {
            do {
                let actual = try await atlas.query(item.operation, parameters: item.parameters, as: JSONValue.self)
                XCTAssertEqual(item.status, 200, item.name)
                XCTAssertEqual(actual, item.value, item.name)
            } catch let error as APIError {
                XCTAssertNotEqual(item.status, 200, item.name)
                XCTAssertEqual(error.status, item.status, item.name)
            }
        }
    }

    func testEveryNativeOperationWorksWithoutRequestingAuthenticationOrNetwork() async throws {
        let probe = AtlasRequestProbe()
        let api = APIClient(
            baseURL: URL(string: "https://offline-atlas.invalid")!,
            token: { _ in
                await probe.requested()
                throw APIError.offline
            },
            onAuthFailure: {}
        )
        let timeline = try await AtlasAPI.timeline(api: api)
        XCTAssertEqual(timeline.events.count, 220)
        XCTAssertEqual(timeline.allEras.count, 9)

        let first = try await AtlasAPI.entities(api: api, kind: .person, limit: 3)
        let second = try await AtlasAPI.entities(api: api, kind: .person, cursor: first.nextCursor, limit: 3)
        XCTAssertEqual(first.results.count, 3)
        XCTAssertEqual(Set((first.results + second.results).map(\.id)).count, 6)

        let search = try await AtlasAPI.search(api: api, query: "Saul", limit: 25)
        XCTAssertTrue(search.results.contains { $0.id == "paul" })
        let common = try await AtlasAPI.search(api: api, query: "the", limit: 2)
        XCTAssertGreaterThan(common.counts.total, common.results.count)

        let chapter = try await AtlasAPI.chapter(api: api, book: 6, chapter: 6)
        XCTAssertTrue(chapter.places.contains { $0.id == "jericho" })
        let person = try await AtlasAPI.entity(api: api, id: "abraham")
        XCTAssertEqual(person.kind, .person)
        XCTAssertTrue(person.relations.contains { $0.type == .parent })
        XCTAssertTrue(person.relationDetails.contains { $0.label == "Child" })
        let event = try await AtlasAPI.event(api: api, id: "the-flood")
        XCTAssertTrue(event.people.contains { $0.id == "noah" })
        let connection = try await AtlasAPI.connection(api: api, from: "abraham", to: "jacob")
        XCTAssertEqual(connection.ids, ["abraham", "isaac", "jacob"])
        let authenticationCalls = await probe.count
        XCTAssertEqual(authenticationCalls, 0, "Atlas must not ask the API client for a token or attempt an online fallback")
    }

    func testBundledFingerprintAndCountsMatchTheCanonicalSourceFixture() async throws {
        let fixture = try golden()
        let atlas = BundledAtlas(resourceURL: try resourceURL())
        let manifest = try await atlas.manifest()
        XCTAssertEqual(manifest.schemaVersion, 1)
        XCTAssertEqual(manifest.inputSha256, fixture.inputSha256)
        XCTAssertEqual(manifest.counts, fixture.counts)
        XCTAssertEqual(manifest.counts, ["events": 220, "people": 186, "places": 93, "relations": 83])
        XCTAssertEqual(manifest.scriptSha256.count, 64)
    }

    func testMissingBundleFailsExplicitlyWithoutEchoingTheQuery() async throws {
        let atlas = BundledAtlas(resourceURL: nil)
        do {
            _ = try await atlas.query(.search, parameters: .init(query: "private synthetic query"), as: AtlasSearchResponse.self)
            XCTFail("A missing bundle must not silently use the network")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "atlas_bundle_unavailable")
            XCTAssertFalse(error.message.contains("private synthetic"))
            XCTAssertFalse(error.isNetworkError)
        }
    }

    func testChangedBundleIsRejectedBeforeExecutingItsCode() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "atlas-integrity-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = try resourceURL()
        let changed = directory.appending(path: "atlas.js")
        try Data("throw new Error('private synthetic exception');".utf8).write(to: changed)
        try FileManager.default.copyItem(
            at: original.deletingLastPathComponent().appending(path: "manifest.json"),
            to: directory.appending(path: "manifest.json")
        )
        let atlas = BundledAtlas(resourceURL: changed)
        do {
            _ = try await atlas.query(.timeline, as: AtlasTimelineResponse.self)
            XCTFail("A modified bundle must fail its manifest hash")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "atlas_bundle_unavailable")
            XCTAssertFalse(error.message.contains("private synthetic"))
        }
    }

    func testConcurrentQueriesStaySerializedAndRepeatable() async throws {
        let atlas = BundledAtlas(resourceURL: try resourceURL())
        let values = try await withThrowingTaskGroup(of: [String].self) { group in
            for _ in 0..<24 {
                group.addTask {
                    let response = try await atlas.query(.connection, parameters: .init(from: "abraham", to: "jacob"), as: AtlasConnectionResponse.self)
                    return response.path?.ids ?? []
                }
            }
            var values: [[String]] = []
            for try await value in group { values.append(value) }
            return values
        }
        XCTAssertEqual(values.count, 24)
        XCTAssertTrue(values.allSatisfy { $0 == ["abraham", "isaac", "jacob"] })
    }

    func testCancelledQueryDoesNotReturnAResult() async throws {
        let atlas = BundledAtlas(resourceURL: try resourceURL())
        let request = Task {
            try await atlas.query(.timeline, as: AtlasTimelineResponse.self)
        }
        request.cancel()
        do {
            _ = try await request.value
            XCTFail("An already cancelled native query must not publish a result")
        } catch is CancellationError {
            // The shared view model's existing cancellation guard owns UI state.
        }
    }
}

