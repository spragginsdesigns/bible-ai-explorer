import Foundation
import XCTest

@testable import SureWord

/// The Swift twin of the "presentation" cases in Android's
/// `mobile/src/features/atlas/atlas.test.ts`, plus the atlasView helpers that
/// file leaves untested. Android is the source of truth for every string.
@MainActor
final class AtlasPresentationTests: XCTestCase {
    // MARK: Fixtures

    private func entity(_ json: String) throws -> AtlasEntityView {
        try JSONDecoder().decode(AtlasEntityView.self, from: Data(json.utf8))
    }

    private var paul: AtlasEntityView {
        get throws {
            try entity(#"{"id":"paul","kind":"person","name":"Paul","disambiguator":null,"alsoCalled":["Saul","Saul of Tarsus"],"description":"The apostle to the Gentiles.","era":"The Early Church","modernRegion":null,"refs":["Acts 9:1-22","Acts 13:9","Romans 1:1"],"related":[],"relations":[],"relationDetails":[],"events":[{"id":"conversion-of-paul","title":"The conversion of Saul","era":"The Early Church","yearLabel":"c. AD 34"}]}"#)
        }
    }

    private var rome: AtlasEntityView {
        get throws {
            try entity(#"{"id":"rome","kind":"place","name":"Rome","disambiguator":null,"alsoCalled":[],"description":"The capital of the empire.","era":null,"modernRegion":"Italy","refs":["Acts 28:16"],"related":[],"relations":[],"relationDetails":[],"events":[]}"#)
        }
    }

    private let flood = AtlasEventView(
        id: "the-flood",
        title: "The flood",
        era: .creationAndPatriarchs,
        yearLabel: "c. 2348 BC",
        date: AtlasEventDate(label: "c. 2348 BC", startYear: -2348, endYear: -2348, provenance: .traditionalUssher),
        summary: "God judges the earth with water.",
        refs: ["Genesis 6-9"],
        people: [AtlasEntityRef(id: "noah", kind: .person, name: "Noah")],
        places: [AtlasEntityRef(id: "ararat", kind: .place, name: "Ararat")]
    )

    private func hit(kind: AtlasHitKind, yearLabel: String? = nil, era: AtlasEra? = nil, refs: [String] = []) -> AtlasSearchHit {
        AtlasSearchHit(id: "x", kind: kind, name: "X", disambiguator: nil, description: "", era: era, yearLabel: yearLabel, refs: refs, score: 1)
    }

    // MARK: Android presentation cases

    func testLabelsRelationDirectionFromTheOpenEntry() {
        XCTAssertEqual(AtlasPresentation.relationDisplayLabel(.parent, direction: "outgoing"), "Parent of")
        XCTAssertEqual(AtlasPresentation.relationDisplayLabel(.parent, direction: "incoming"), "Child of")
        XCTAssertEqual(AtlasPresentation.relationDisplayLabel(.mentor, direction: "incoming"), "Student of")
        XCTAssertEqual(AtlasPresentation.relationDisplayLabel(.disciple, direction: "incoming"), "Mentor of")
        XCTAssertEqual(AtlasPresentation.relationDisplayLabel(.spouse, direction: "incoming"), "Spouse of")
    }

    func testShortensEveryEraToAChipThatFits() {
        let chips = AtlasPresentation.eraChips()
        XCTAssertEqual(chips.map(\.era), AtlasEra.allCases)
        XCTAssertEqual(AtlasPresentation.eraChipLabel(.creationAndPatriarchs), "Patriarchs")
        XCTAssertTrue(chips.allSatisfy { $0.label.count <= 12 })
        XCTAssertEqual(chips.map(\.label), ["Patriarchs", "Exodus", "Judges", "Kingdom", "Divided", "Exile", "Silence", "Christ", "Church"])
    }

    func testCaptionsAnEventWithItsDateAndEra() {
        XCTAssertEqual(AtlasPresentation.eventCaption(flood), "c. 2348 BC · Creation & the Patriarchs")
    }

    func testDescribesAnEntityInOneLine() throws {
        let paul = try paul
        XCTAssertEqual(AtlasPresentation.entitySubtitle(paul), "Person · The Early Church")
        XCTAssertEqual(AtlasPresentation.alsoCalledLine(paul), "Also called Saul, Saul of Tarsus")
        XCTAssertEqual(AtlasPresentation.entityCounts(paul), "3 key verses · 1 event")

        let rome = try rome
        XCTAssertEqual(AtlasPresentation.alsoCalledLine(rome), "")
        XCTAssertEqual(AtlasPresentation.entitySubtitle(rome), "Place · Italy")
        XCTAssertEqual(AtlasPresentation.entityCounts(rome), "1 key verse")
    }

    func testLabelsWhatASearchHitIs() {
        XCTAssertEqual(AtlasPresentation.hitKindLabel(.person), "Person")
        XCTAssertEqual(AtlasPresentation.hitKindLabel(.place), "Place")
        XCTAssertEqual(AtlasPresentation.hitKindLabel(.event), "Event")
        XCTAssertEqual(AtlasPresentation.hitSectionLabel(.person), "People")
        XCTAssertEqual(AtlasPresentation.hitSectionLabel(.place), "Places")
        XCTAssertEqual(AtlasPresentation.hitSectionLabel(.event), "Events")
    }

    func testCountsAnErasEventsWithTheRightPlural() {
        XCTAssertEqual(AtlasPresentation.eraEventCount(AtlasEraGroup(era: .lifeOfChrist, events: [])), "0 events")
        XCTAssertEqual(AtlasPresentation.eraEventCount(AtlasEraGroup(era: .creationAndPatriarchs, events: [flood])), "1 event")
    }

    func testWritesAnAskAboutThisPromptThatNamesTheThing() throws {
        XCTAssertEqual(
            AtlasPresentation.askPrompt(for: try paul),
            "Who was Paul in the Bible, and what can I learn from them?"
        )
        XCTAssertEqual(AtlasPresentation.askPrompt(for: try rome), "What happened at Rome in the Bible?")
        XCTAssertEqual(AtlasPresentation.askPrompt(for: flood), "Tell me about The flood (c. 2348 BC) from the KJV.")
    }

    func testSaysWhichChapterCameUpEmptyRatherThanJustNoResults() {
        XCTAssertEqual(
            AtlasPresentation.emptyTimelineMessage(book: "Leviticus", chapter: 13),
            "The atlas has no events, people or places recorded in Leviticus 13."
        )
        XCTAssertEqual(
            AtlasPresentation.emptyTimelineMessage(book: "Leviticus"),
            "The atlas has no events recorded in Leviticus."
        )
        XCTAssertEqual(
            AtlasPresentation.emptyTimelineMessage(era: "Life of Christ"),
            "No events on the timeline for Life of Christ."
        )
        XCTAssertEqual(AtlasPresentation.emptyTimelineMessage(), "No events on the timeline.")
    }

    // MARK: atlasView helpers Android does not test

    func testDateProvenanceWording() {
        XCTAssertEqual(AtlasPresentation.eventDateProvenanceLabel(flood), "Traditional Ussher chronology")
        XCTAssertEqual(AtlasPresentation.provenanceLabel(.scriptureExplicit), "Scripture-explicit date")
        XCTAssertEqual(AtlasPresentation.provenanceLabel(.undated), "Date not given")
        XCTAssertEqual(AtlasPresentation.provenanceLabel(nil), "Traditional Ussher chronology")
    }

    func testSearchHitDatesKeepAnHonestProvenance() {
        XCTAssertEqual(AtlasPresentation.searchHitDateLabel(hit(kind: .event, yearLabel: "c. 2348 BC")), "Traditional chronology · c. 2348 BC")
        XCTAssertEqual(AtlasPresentation.searchHitDateLabel(hit(kind: .event, yearLabel: "Undated")), "Date not given")
        XCTAssertEqual(AtlasPresentation.searchHitDateLabel(hit(kind: .person)), "")
    }

    func testEventDateFromLabelSignsBCAndKeepsTheLabel() {
        let range = AtlasPresentation.eventDate(fromLabel: "c. 1635 - 1491 BC")
        XCTAssertEqual(range.startYear, -1635)
        XCTAssertEqual(range.endYear, -1491)
        XCTAssertEqual(range.label, "c. 1635 - 1491 BC")
        XCTAssertEqual(range.provenance, .traditionalUssher)
        XCTAssertEqual(AtlasPresentation.eventDate(fromLabel: "c. AD 34").startYear, 34)
        XCTAssertEqual(AtlasPresentation.eventDate(fromLabel: "not given").provenance, .undated)
        XCTAssertEqual(AtlasPresentation.eventDate(fromLabel: "").provenance, .undated)
        XCTAssertEqual(AtlasPresentation.eventDate(fromLabel: "Before time").provenance, .undated)
    }

    func testRelationAndCertaintyWording() {
        XCTAssertEqual(AtlasPresentation.relationTypeLabel(.associatedPlace), "Associated place")
        XCTAssertEqual(AtlasPresentation.relationTypeLabel(.associated), "Associated with")
        XCTAssertEqual(AtlasPresentation.relationCertaintyLabel(.explicit), "Scripture states")
        XCTAssertEqual(AtlasPresentation.relationCertaintyLabel(.inferred), "Inferred")
        XCTAssertEqual(AtlasPresentation.relationCertaintyLabel(.disputed), "Disputed")
    }

    func testRowsAndChipsReadAsOnAndroid() throws {
        XCTAssertEqual(AtlasPresentation.referenceChipLabel("John 3:16"), "John 3:16 ›")
        XCTAssertEqual(
            AtlasPresentation.searchRowMeta(hit(kind: .event, yearLabel: "c. 2348 BC", refs: ["Genesis 7:11"])),
            "Event · Traditional chronology · c. 2348 BC · Genesis 7:11"
        )
        XCTAssertEqual(
            AtlasPresentation.searchRowMeta(hit(kind: .person, era: .lifeOfChrist, refs: ["John 1:1"])),
            "Person · Life of Christ · John 1:1"
        )
        XCTAssertEqual(AtlasPresentation.searchRowMeta(hit(kind: .place)), "Place")
        XCTAssertEqual(
            AtlasPresentation.entityRowMeta(AtlasEntitySummary(id: "rome", kind: .place, name: "Rome", modernRegion: "Italy")),
            "Place · Italy"
        )
        XCTAssertEqual(
            AtlasPresentation.entityRowMeta(AtlasEntitySummary(id: "moses", kind: .person, name: "Moses", era: .egyptAndExodus)),
            "Person · Egypt & the Exodus"
        )
        XCTAssertEqual(
            AtlasPresentation.searchSummary(shown: 12, counts: AtlasSearchCounts(total: 40, person: 20, place: 5, event: 15)),
            "12 results shown · capped at 12 · 20 people · 5 places · 15 events"
        )
    }

    func testFamilyKeepsOnlyParentsSpousesAndSiblings() throws {
        let moses = try entity(#"{"id":"moses","kind":"person","name":"Moses","description":"","refs":[],"relationDetails":[{"id":"aaron","kind":"person","name":"Aaron","description":"","relation":{"id":"r1","from":"aaron","to":"moses","type":"sibling","refs":["Exodus 4:14"],"certainty":"explicit"},"entity":{"id":"aaron","kind":"person","name":"Aaron","description":""},"direction":"incoming","label":"Sibling"},{"id":"joshua","kind":"person","name":"Joshua","description":"","relation":{"id":"r2","from":"moses","to":"joshua","type":"mentor","refs":["Deuteronomy 34:9"],"certainty":"inferred"},"entity":{"id":"joshua","kind":"person","name":"Joshua","description":""},"direction":"outgoing","label":"Disciple"}]}"#)
        let family = AtlasPresentation.immediateFamily(moses.relationDetails)
        XCTAssertEqual(family.map(\.entity.id), ["aaron"])
        XCTAssertEqual(AtlasPresentation.relationRowTitle(family[0]), "Sibling Aaron")
    }

    func testEmptyAndNotFoundCopyIsVerbatim() {
        XCTAssertEqual(AtlasPresentation.emptyDirectoryMessage(.person), "No people entries match this filter.")
        XCTAssertEqual(AtlasPresentation.emptyDirectoryMessage(.place), "No places entries match this filter.")
        XCTAssertEqual(
            AtlasPresentation.emptyChapterMessage(book: "Leviticus", chapter: 13),
            "The atlas records no one and nowhere by name in Leviticus 13."
        )
        XCTAssertEqual(AtlasPresentation.emptyFamilyMessage("Job"), "No immediate-family connections are recorded for Job.")
        XCTAssertEqual(AtlasPresentation.traceHeading("Moses"), "Trace from Moses")
        XCTAssertEqual(AtlasPresentation.traceNoPathMessage, "No reviewed connection was found between these people.")
        XCTAssertEqual(AtlasPresentation.eventNotFoundMessage, "That event is not in the Bible atlas.")
        XCTAssertTrue(AtlasPresentation.ussherNote.hasPrefix("Dates follow the traditional Ussher chronology"))
    }

    // MARK: Model contract

    func testChapterViewDecodesAndOrdersPeopleBeforePlaces() throws {
        let json = #"{"people":[{"id":"abraham","kind":"person","name":"Abraham"}],"places":[{"id":"moriah","kind":"place","name":"Moriah"}],"events":[]}"#
        let view = try JSONDecoder().decode(AtlasChapterView.self, from: Data(json.utf8))
        XCTAssertEqual(view.entities.map(\.id), ["abraham", "moriah"])
        XCTAssertEqual(
            AtlasAPI.path("/api/bible/atlas", query: [URLQueryItem(name: "book", value: "1"), URLQueryItem(name: "chapter", value: "22")]),
            "/api/bible/atlas?book=1&chapter=22"
        )
    }

    func testTraceStateIsSeparateFromTheExplorerSearchAndResets() {
        let model = AtlasModel(api: APIClient(token: { _ in nil }, onAuthFailure: {}))
        model.searchTracePeople("   ", excluding: "moses")
        XCTAssertEqual(model.traceSearchState, .idle)
        XCTAssertEqual(model.searchQuery, "", "Trace must never write the explorer's search box")
        model.resetTrace()
        XCTAssertNil(model.connectionPath)
        XCTAssertFalse(model.connectionNotFound)
        XCTAssertEqual(model.connectionState, .idle)
    }

    func testDirectoriesRememberTheirEraForLoadMoreAndRetry() {
        let model = AtlasModel(api: APIClient(token: { _ in nil }, onAuthFailure: {}))
        model.loadEntities(kind: .person, era: .lifeOfChrist, limit: 100, allPages: true)
        XCTAssertEqual(model.peopleEra, .lifeOfChrist)
        model.loadEntities(kind: .place)
        XCTAssertNil(model.placesEra)
        XCTAssertEqual(model.peopleEra, .lifeOfChrist)
        model.loadTimeline(era: .unitedKingdom, personID: "david")
        XCTAssertEqual(model.timelineKey, AtlasTimelineKey(era: .unitedKingdom, personID: "david"))
    }
}
