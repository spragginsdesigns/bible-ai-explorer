import Foundation
import Testing
@testable import SureWord

@Suite("Bible atlas contract")
struct AtlasTests {
    @Test("decodes search results and optional person disambiguators")
    func searchFixture() throws {
        let data = Data(
            #"{"query":"joseph","results":[{"id":"joseph","kind":"person","name":"Joseph","disambiguator":"Joseph, son of Jacob","description":"A son of Jacob.","era":"Creation & the Patriarchs","yearLabel":null,"refs":["Genesis 30:22-24"],"score":102}],"counts":{"total":1,"person":1,"place":0,"event":0}}"#.utf8
        )
        let response = try JSONDecoder().decode(AtlasSearchResponse.self, from: data)

        #expect(response.results.first?.disambiguator == "Joseph, son of Jacob")
        #expect(response.counts.total == 1)
        #expect(response.results.first?.era == .creationAndPatriarchs)
    }

    @Test("decodes entity relation details and keeps old fields optional")
    func entityFixture() throws {
        let data = Data(
            #"{"id":"moses","kind":"person","name":"Moses","disambiguator":null,"description":"A prophet.","era":"Egypt & the Exodus","modernRegion":null,"refs":[],"related":[],"relations":[{"id":"moses-joshua","from":"moses","to":"joshua","type":"mentor","refs":["Deuteronomy 34:9"],"certainty":"inferred"}],"relationDetails":[{"id":"joshua","kind":"person","name":"Joshua","description":"A leader.","era":"Conquest & Judges","modernRegion":null,"relation":{"id":"moses-joshua","from":"moses","to":"joshua","type":"mentor","refs":["Deuteronomy 34:9"],"certainty":"inferred"},"entity":{"id":"joshua","kind":"person","name":"Joshua","description":"A leader.","alsoCalled":[],"era":"Conquest & Judges","modernRegion":null},"direction":"outgoing","label":"Disciple"}],"events":[]}"#.utf8
        )
        let entity = try JSONDecoder().decode(AtlasEntityView.self, from: data)

        #expect(entity.relationDetails.count == 1)
        #expect(entity.relationDetails.first?.entity.id == "joshua")
        #expect(entity.relationDetails.first?.label == "Disciple")
        #expect(entity.related.isEmpty)
    }

    @Test("builds percent-encoded API paths")
    func encodedPaths() {
        let path = AtlasAPI.path(
            "/api/bible/atlas",
            query: [URLQueryItem(name: "q", value: "Saul & Tarsus/Paul"), URLQueryItem(name: "limit", value: "12")]
        )
        #expect(path == "/api/bible/atlas?q=Saul%20%26%20Tarsus%2FPaul&limit=12")
    }

    @Test("decodes the timeline route's eras key")
    func timelineFixture() throws {
        let data = Data(
            #"{"allEras":["Egypt & the Exodus"],"eras":[{"era":"Egypt & the Exodus","events":[]}],"events":[]}"#.utf8
        )
        let response = try JSONDecoder().decode(AtlasTimelineResponse.self, from: data)

        #expect(response.allEras == [.egyptAndExodus])
        #expect(response.groups.first?.era == .egyptAndExodus)
    }

    @Test("relation labels keep endpoint direction")
    func relationLabels() {
        let relation = AtlasRelation(
            id: "moses-joshua",
            from: "moses",
            to: "joshua",
            type: .mentor,
            refs: ["Deuteronomy 34:9"],
            certainty: .inferred
        )
        #expect(AtlasRelationLabels.label(for: relation, perspectiveID: "moses") == "Disciple")
        #expect(AtlasRelationLabels.label(for: relation, perspectiveID: "joshua") == "Mentor")
    }

    @Test("model starts idle and distinguishes an empty search")
    @MainActor
    func initialState() {
        let api = APIClient(token: { _ in nil }, onAuthFailure: {})
        let model = AtlasModel(api: api)

        #expect(model.timelineState == .idle)
        #expect(model.searchState == .idle)
        #expect(model.people.isEmpty)

        model.search("   ")
        #expect(model.searchState == .empty)
        #expect(model.searchResults.isEmpty)
    }
}
