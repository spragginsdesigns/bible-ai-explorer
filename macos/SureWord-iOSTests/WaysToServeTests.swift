import Foundation
import XCTest

@testable import SureWord

/// Ways to Serve (GitHub issue #28): the Apple decoders read the server's
/// `GET /api/serve` shape leniently, and each way's action maps to the same
/// destination as the web's `serveActionTarget` (`src/components/serve/serveActions.ts`).
final class WaysToServeTests: XCTestCase {
    private let viewJSON = """
    {
      "status": "ok",
      "serve": {
        "title": "Ways to Serve",
        "settings": { "mode": "both", "givesToChurch": false },
        "intro": {
          "text": "Serving never saves anyone.",
          "verses": [
            { "reference": "Ephesians 2:8", "text": "For by grace are ye saved through faith;" },
            { "reference": "Ephesians 2:9", "text": "Not of works, lest any man should boast." },
            { "reference": "Ephesians 2:10", "text": "For we are his workmanship," }
          ]
        },
        "today": {
          "id": "encourage", "kind": "online", "title": "Send someone a verse",
          "detail": "Think of one person.", "action": "share-verse",
          "verse": { "reference": "Hebrews 3:13", "text": "But exhort one another daily," }
        },
        "ways": [
          { "id": "encourage", "kind": "online", "title": "Send someone a verse", "detail": "d",
            "action": "share-verse", "verse": { "reference": "Hebrews 3:13", "text": "t" } },
          { "id": "give-church", "kind": "online", "title": "Give to your church", "detail": "d",
            "action": "give-church", "needsChurch": true, "giving": "church",
            "verse": { "reference": "2 Corinthians 9:7", "text": "t" } },
          { "id": "future", "kind": "online", "title": "Something new", "detail": "d",
            "action": "teleport", "verse": { "reference": "John 3:16", "text": "t" } },
          { "id": "plain", "kind": "nearby", "title": "No button", "detail": "d",
            "action": null, "verse": { "reference": "John 3:17", "text": "t" } }
        ],
        "church": { "name": "Grace Chapel", "website": null },
        "nearby": { "available": true, "searches": [ { "id": "food", "label": "Food banks and pantries" } ] },
        "journal": {
          "title": "What I did", "prompt": "A private place.",
          "verse": { "reference": "Matthew 25:40", "text": "Inasmuch as ye have done it" }
        }
      }
    }
    """

    private func decodeView(_ json: String) throws -> ServeView {
        try JSONDecoder().decode(ServeResponse.self, from: Data(json.utf8)).serve
    }

    private func way(_ action: ServeAction?, title: String = "Check on someone", reference: String = "Galatians 6:2") -> ServeWay {
        ServeWay(
            id: "w", kind: "online", title: title, detail: "d", action: action,
            verse: ServeVerse(reference: reference, text: "t")
        )
    }

    // MARK: - Decoding

    func testDecodesTheWholeViewAndReadsUnknownActionsAsNoAction() throws {
        let view = try decodeView(viewJSON)
        XCTAssertEqual(view.title, "Ways to Serve")
        XCTAssertEqual(view.settings, ServeSettings(mode: .both, givesToChurch: false))
        XCTAssertEqual(view.intro.verses.map(\.reference), ["Ephesians 2:8", "Ephesians 2:9", "Ephesians 2:10"])
        XCTAssertEqual(view.today?.action, .shareVerse)
        XCTAssertEqual(view.ways.count, 4)
        XCTAssertEqual(view.ways[1].action, .giveChurch)
        XCTAssertEqual(view.ways[1].needsChurch, true)
        XCTAssertEqual(view.ways[1].giving, "church")
        XCTAssertNil(view.ways[2].action, "an action newer than this build must not fail the page")
        XCTAssertNil(view.ways[3].action)
        XCTAssertEqual(view.church, ServeChurch(name: "Grace Chapel", website: nil))
        XCTAssertTrue(view.nearby.available)
        XCTAssertEqual(view.nearby.searches.first?.id, "food")
        XCTAssertEqual(view.journal.verse.reference, "Matthew 25:40")
    }

    func testOffModeHasNoTodayAndUnknownModeReadsAsOnline() throws {
        let off = viewJSON
            .replacingOccurrences(of: "\"mode\": \"both\"", with: "\"mode\": \"off\"")
        var view = try decodeView(off)
        XCTAssertEqual(view.settings.mode, .off)

        let unknown = viewJSON
            .replacingOccurrences(of: "\"mode\": \"both\"", with: "\"mode\": \"sometimes\"")
        view = try decodeView(unknown)
        XCTAssertEqual(view.settings.mode, .online)
        XCTAssertEqual(ServeMode.read(nil), .online)
    }

    func testEveryWireActionDecodes() {
        let wire = ["share-verse", "pray", "reach-out", "nearby", "church", "give-church", "give-need", "journal"]
        XCTAssertEqual(wire.compactMap(ServeAction.init(rawValue:)).count, wire.count)
        XCTAssertEqual(Set(ServeAction.allCases.map(\.rawValue)), Set(wire))
    }

    func testNearbyAndJournalResponses() throws {
        let unavailable = try JSONDecoder().decode(ServeNearbyResponse.self, from: Data(#"{"status":"unavailable"}"#.utf8))
        XCTAssertEqual(unavailable, .unavailable)

        let results = try JSONDecoder().decode(ServeNearbyResponse.self, from: Data("""
        {"status":"ok","results":[{"placeId":"p1","name":"Food Bank","address":"1 Main St","phone":null,"website":"https://fb.org","mapsUrl":null}]}
        """.utf8))
        guard case .ok(let places) = results else { return XCTFail("expected results") }
        XCTAssertEqual(places.first?.name, "Food Bank")
        XCTAssertNil(places.first?.phone)

        let entry = try JSONDecoder().decode(ServeEntryResponse.self, from: Data("""
        {"status":"ok","entry":{"id":"e1","text":"Called Mrs. Lee","verseRef":null,"createdAt":"2026-10-27T18:30:00.123Z"}}
        """.utf8)).entry
        XCTAssertEqual(entry.text, "Called Mrs. Lee")
        XCTAssertNil(entry.verseRef)
        XCTAssertNotNil(ServeRules.entryDate(entry.createdAt))
        XCTAssertNotNil(ServeRules.entryDate("2026-10-27T18:30:00Z"))
    }

    // MARK: - Actions

    func testActionsMapLikeTheWeb() {
        XCTAssertEqual(
            ServeRules.target(for: way(.shareVerse), nearbyAvailable: false, churchWebsite: nil),
            .sendWord(reference: "Galatians 6:2")
        )
        XCTAssertEqual(
            ServeRules.target(for: way(.shareVerse, reference: " "), nearbyAvailable: false, churchWebsite: nil),
            .chat(prompt: "Help me send someone a verse with a word of encouragement")
        )
        XCTAssertEqual(
            ServeRules.target(for: way(.pray), nearbyAvailable: false, churchWebsite: nil),
            .chat(prompt: "I want to pray for someone by name today.")
        )
        XCTAssertEqual(
            ServeRules.target(for: way(.reachOut, title: "Call someone who's alone"), nearbyAvailable: false, churchWebsite: nil),
            .chat(prompt: "Help me write a kind message to call someone who's alone.")
        )
        for action in [ServeAction.nearby, .giveNeed] {
            XCTAssertEqual(ServeRules.target(for: way(action), nearbyAvailable: true, churchWebsite: nil), .focusNearby)
            XCTAssertEqual(
                ServeRules.target(for: way(action), nearbyAvailable: false, churchWebsite: nil),
                .chat(prompt: "Where could I help or give near me?")
            )
        }
        XCTAssertEqual(ServeRules.target(for: way(.church), nearbyAvailable: false, churchWebsite: nil), .myChurch)
        XCTAssertEqual(ServeRules.target(for: way(.journal), nearbyAvailable: false, churchWebsite: nil), .focusJournal)
        XCTAssertNil(ServeRules.target(for: way(nil), nearbyAvailable: true, churchWebsite: nil))
    }

    func testGiveToChurchOpensOnlyAnHTTPWebsite() throws {
        let site = try XCTUnwrap(URL(string: "https://gracechapel.org/give"))
        XCTAssertEqual(
            ServeRules.target(for: way(.giveChurch), nearbyAvailable: false, churchWebsite: "https://gracechapel.org/give"),
            .website(site)
        )
        XCTAssertNil(ServeRules.target(for: way(.giveChurch), nearbyAvailable: false, churchWebsite: nil))
        XCTAssertNil(ServeRules.target(for: way(.giveChurch), nearbyAvailable: false, churchWebsite: "javascript:alert(1)"))
        XCTAssertNil(ServeRules.target(for: way(.giveChurch), nearbyAvailable: false, churchWebsite: "ftp://x.org"))
    }

    func testButtonLabels() {
        XCTAssertEqual(ServeRules.label(for: .shareVerse, target: .sendWord(reference: "John 3:16")), "Send a verse")
        XCTAssertEqual(ServeRules.label(for: .shareVerse, target: .chat(prompt: "x")), "Help me send one")
        XCTAssertEqual(ServeRules.label(for: .pray, target: .chat(prompt: "x")), "Pray with SureWord")
        XCTAssertEqual(ServeRules.label(for: .reachOut, target: .chat(prompt: "x")), "Help me write it")
        XCTAssertEqual(ServeRules.label(for: .nearby, target: .focusNearby), "Find places near me")
        XCTAssertEqual(ServeRules.label(for: .giveNeed, target: .chat(prompt: "x")), "Ask SureWord")
        XCTAssertEqual(ServeRules.label(for: .church, target: .myChurch), "Open My church")
        XCTAssertEqual(ServeRules.label(for: .journal, target: .focusJournal), "Write it down")
    }

    // MARK: - Requests and limits

    func testRequestPathsEscapeTheirInput() {
        XCTAssertEqual(
            ServeRules.nearbyPath(location: "Fresno, CA & more", kind: "food"),
            "/api/serve/nearby?location=Fresno,%20CA%20%26%20more&kind=food"
        )
        XCTAssertEqual(ServeRules.entryPath(id: "a/b"), "/api/serve/journal/a%2Fb")
        XCTAssertNil(ServeRules.cleanLocation(" F "))
        XCTAssertEqual(ServeRules.cleanLocation(" 93720 "), "93720")
        XCTAssertNil(ServeRules.cleanEntry("   "))
        XCTAssertNil(ServeRules.cleanEntry(String(repeating: "a", count: ServeRules.maxEntryLength + 1)))
    }

    func testChatToolsHaveActivityLabels() {
        XCTAssertEqual(ChatViewMessage.toolActivityLabels["tool-getWaysToServe"], "Looking at ways to serve")
        XCTAssertEqual(ChatViewMessage.toolActivityLabels["tool-saveServeEntry"], "Writing it in your journal")
        XCTAssertEqual(ChatViewMessage.toolActivityLabels["tool-listServeEntries"], "Reading your journal")
    }
}
