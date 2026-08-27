import Foundation
import Testing
@testable import SureWord

/// Ported one-for-one from `mobile/src/features/church/church.test.ts` so the
/// Apple clients' rules are pinned to the Android/web behaviour rather than
/// re-derived. If a case here changes, the vitest suite must change with it.
@Suite("Church rules")
struct ChurchRulesTests {

    @Test("Rejects anything the server would 400")
    func rejectsShortQueries() {
        #expect(ChurchRules.minQueryLength == 3)
        #expect(!ChurchRules.shouldSearch(""))
        #expect(!ChurchRules.shouldSearch("a"))
        #expect(!ChurchRules.shouldSearch("ab"))
        // Whitespace is not length: "  a  " is a one-character query.
        #expect(!ChurchRules.shouldSearch("  a  "))
    }

    @Test("Accepts the minimum the server allows")
    func acceptsMinimumQuery() {
        #expect(ChurchRules.shouldSearch("abc"))
        #expect(ChurchRules.shouldSearch("  grace chapel "))
    }

    @Test("Hostname strips scheme, www, port and path")
    func hostnameStrips() {
        #expect(ChurchRules.hostname(of: "https://www.gracechapel.org/about") == "gracechapel.org")
        #expect(ChurchRules.hostname(of: "http://gracechapel.org") == "gracechapel.org")
        #expect(ChurchRules.hostname(of: "https://WWW.Grace.org:8443/a?b=c#d") == "Grace.org")
        #expect(ChurchRules.hostname(of: "https://user:pass@grace.org/x") == "grace.org")
    }

    @Test("Hostname is nil for anything it cannot read")
    func hostnameFailures() {
        #expect(ChurchRules.hostname(of: nil) == nil)
        #expect(ChurchRules.hostname(of: "") == nil)
        #expect(ChurchRules.hostname(of: "gracechapel.org") == nil)
        #expect(ChurchRules.hostname(of: "https:///path") == nil)
    }

    @Test("Mission toggle appears only past the clamp")
    func missionClamp() {
        #expect(ChurchRules.missionClampLines == 6)
        #expect(!ChurchRules.missionIsLong("Short and to the point."))
        #expect(!ChurchRules.missionIsLong(String(repeating: "a", count: 400)))
        #expect(ChurchRules.missionIsLong(String(repeating: "a", count: 401)))
        // Six lines fit; a seventh does not.
        #expect(!ChurchRules.missionIsLong(Array(repeating: "line", count: 6).joined(separator: "\n")))
        #expect(ChurchRules.missionIsLong(Array(repeating: "line", count: 7).joined(separator: "\n")))
    }

    @Test("Drops responses from superseded keystrokes")
    func staleResponses() {
        #expect(ChurchRules.isLatestRequest(4, latest: 4))
        #expect(!ChurchRules.isLatestRequest(3, latest: 4))
    }

    @Test("tel: keeps only the digits and a leading plus")
    func telURLs() {
        #expect(ChurchRules.telURL(for: "(559) 123-4567")?.absoluteString == "tel:5591234567")
        #expect(ChurchRules.telURL(for: "+1 559-123-4567")?.absoluteString == "tel:+15591234567")
        #expect(ChurchRules.telURL(for: "call us") == nil)
    }

    @Test("Search debounce matches the other clients")
    func debounce() {
        #expect(ChurchRules.searchDebounceMilliseconds == 350)
    }
}

/// The wire contracts of `src/app/api/church/*`. These shapes are what the
/// clients agree on; a rename on the server has to break a test here.
@Suite("Church API payloads")
struct ChurchPayloadTests {

    private func decode<T: Decodable>(_ json: String, as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test("An unconfigured server is a distinct answer, not an absent church")
    func decodesUnavailable() throws {
        #expect(try decode(#"{"status":"unavailable"}"#, as: ChurchResponse.self) == .unavailable)
        #expect(
            try decode(#"{"status":"unavailable"}"#, as: ChurchSearchResponse.self) == .unavailable
        )
    }

    @Test("Decodes GET /api/church with no church saved")
    func decodesNullChurch() throws {
        let response = try decode(#"{"status":"ok","church":null}"#, as: ChurchResponse.self)
        #expect(response == .ok(church: nil))
    }

    @Test("Decodes a full church profile")
    func decodesProfile() throws {
        let json = """
        {"status":"ok","church":{
          "placeId":"ChIJ123","name":"Grace Chapel","address":"1 Main St, Clovis, CA",
          "phone":"(559) 123-4567","website":"https://www.gracechapel.org",
          "mapsUrl":"https://maps.google.com/?cid=1",
          "photoUrl":"https://sureword.app/api/church/photo?placeId=ChIJ123",
          "mission":"To know Christ and make Him known.",
          "about":"A KJV-preaching church.",
          "missionSource":"https://www.gracechapel.org/about",
          "updatedAt":"2026-08-27T04:05:06.789Z"}}
        """
        guard case .ok(let church?) = try decode(json, as: ChurchResponse.self) else {
            Issue.record("expected an ok response carrying a church")
            return
        }
        #expect(church.placeId == "ChIJ123")
        #expect(church.name == "Grace Chapel")
        #expect(church.website == "https://www.gracechapel.org")
        #expect(ChurchRules.hostname(of: church.missionSource) == "gracechapel.org")
        #expect(church.id == church.placeId)
    }

    @Test("Every optional field may be null")
    func decodesSparseProfile() throws {
        let json = """
        {"status":"ok","church":{
          "placeId":"p","name":"n","address":"a","phone":null,"website":null,
          "mapsUrl":null,"photoUrl":null,"mission":null,"about":null,
          "missionSource":null,"updatedAt":"2026-08-27T00:00:00Z"}}
        """
        guard case .ok(let church?) = try decode(json, as: ChurchResponse.self) else {
            Issue.record("expected an ok response carrying a church")
            return
        }
        #expect(church.phone == nil)
        #expect(church.mission == nil)
        #expect(church.photoUrl == nil)
    }

    @Test("Decodes GET /api/church/search results")
    func decodesSearch() throws {
        let json = """
        {"status":"ok","results":[
          {"placeId":"p1","name":"Grace Chapel","address":"Clovis, CA","hasPhoto":true},
          {"placeId":"p2","name":"Grace Bible","address":"Fresno, CA","hasPhoto":false}]}
        """
        guard case .ok(let results) = try decode(json, as: ChurchSearchResponse.self) else {
            Issue.record("expected an ok search response")
            return
        }
        #expect(results.count == 2)
        #expect(results[0].hasPhoto)
        #expect(!results[1].hasPhoto)
        #expect(results[1].id == "p2")
    }

    @Test("An ok search with no results array decodes as empty")
    func decodesEmptySearch() throws {
        #expect(try decode(#"{"status":"ok"}"#, as: ChurchSearchResponse.self) == .ok(results: []))
    }
}

@Suite("Church model")
@MainActor
struct ChurchModelTests {

    @Test("Nothing is requested before a client is configured")
    func noApiIsANoOp() async {
        let model = ChurchModel()
        await model.load()
        await model.pick("p1")
        await model.remove()
        #expect(model.state == .loading)
        #expect(model.church == nil)
        #expect(model.results.isEmpty)
        #expect(model.savingPlaceId == nil)
        #expect(!model.isRemoving)
    }

    @Test("A short query never schedules a search")
    func shortQueryClearsResults() {
        let model = ChurchModel()
        model.query = "gr"
        model.queryChanged()
        #expect(!model.isSearchPending)
        #expect(model.results.isEmpty)
        #expect(model.showsKeepTypingHint)
    }

    @Test("A long enough query goes pending while it debounces")
    func longQueryGoesPending() {
        let model = ChurchModel()
        model.query = "grace chapel"
        model.queryChanged()
        #expect(model.isSearchPending)
        #expect(!model.showsKeepTypingHint)
    }

    @Test("Clearing the query drops the pending search")
    func clearQuery() {
        let model = ChurchModel()
        model.query = "grace chapel"
        model.queryChanged()
        model.clearQuery()
        #expect(model.query.isEmpty)
        #expect(!model.isSearchPending)
        #expect(!model.showsKeepTypingHint)
        #expect(!model.showsNoResultsHint)
    }

    @Test("Cancel is only offered when there is a saved church to return to")
    func cancelNeedsASavedChurch() {
        let model = ChurchModel()
        #expect(!model.canCancelPicking)
        model.startChange()
        model.cancelChange()
        // With nothing saved, cancelling must not strand the user on an empty
        // card with no way back to the picker.
        #expect(model.isPicking)
    }
}
