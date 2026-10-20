import Foundation
import XCTest

@testable import SureWord

/// What's new (release notes): the same rules as Android's
/// `mobile/src/features/whatsNew/whatsNew.ts`, and a decoder that tolerates
/// a newer server.
@MainActor
final class WhatsNewTests: XCTestCase {
    private func entry(
        _ version: String,
        date: String = "2026-10-19",
        title: String = "Release",
        sections: [WhatsNewSection] = [WhatsNewSection(kind: .improved, items: ["Something better"])]
    ) -> WhatsNewEntry {
        WhatsNewEntry(version: version, versionCode: 1, date: date, sections: sections, title: title)
    }

    func testFilterMatchesEveryWordAndChangeType() {
        let entries = [
            entry("1.2.0", title: "Sermon studies", sections: [WhatsNewSection(kind: .new, items: ["Sermons from your church"])]),
            entry("1.1.0", title: "Fixes", sections: [WhatsNewSection(kind: .fixed, items: ["Reader scroll"])]),
        ]
        XCTAssertEqual(WhatsNewRules.filter(entries, query: "", kind: nil).count, 2)
        XCTAssertEqual(WhatsNewRules.filter(entries, query: "", kind: .fixed).map(\.version), ["1.1.0"])
        XCTAssertEqual(WhatsNewRules.filter(entries, query: "sermon church", kind: nil).map(\.version), ["1.2.0"])
        XCTAssertEqual(WhatsNewRules.filter(entries, query: "sermon reader", kind: nil).count, 0)
        XCTAssertEqual(WhatsNewRules.filter(entries, query: "  1.1.0 ", kind: nil).map(\.version), ["1.1.0"])
    }

    func testPrimaryKindPrefersNewWork() {
        XCTAssertEqual(
            WhatsNewRules.primaryKind(entry("1", sections: [
                WhatsNewSection(kind: .fixed, items: ["a"]), WhatsNewSection(kind: .new, items: ["b"]),
            ])),
            .new
        )
        XCTAssertEqual(WhatsNewRules.primaryKind(entry("1", sections: [WhatsNewSection(kind: .fixed, items: ["a"])])), .fixed)
        XCTAssertEqual(WhatsNewRules.primaryKind(entry("1", sections: [])), .improved)
    }

    func testDatesAndMonthGroups() {
        XCTAssertEqual(WhatsNewRules.formatDate("2026-10-01"), "October 1, 2026")
        let groups = WhatsNewRules.groupByMonth([
            entry("3", date: "2026-10-19"), entry("2", date: "2026-10-02"), entry("1", date: "2026-09-30"),
        ])
        XCTAssertEqual(groups.map(\.month), ["October 2026", "September 2026"])
        XCTAssertEqual(groups.map(\.entries.count), [2, 1])
    }

    func testTargetsMapToAppleDestinations() {
        XCTAssertEqual(WhatsNewRules.destination(for: .connections), .section(.connections))
        XCTAssertEqual(WhatsNewRules.destination(for: .chat), .section(.chat))
        XCTAssertEqual(WhatsNewRules.destination(for: .cross), .cross)
        XCTAssertEqual(WhatsNewRules.destination(for: .learn), .daily(.learn))
        // No outside entry into Study's own stack: these read "Read more".
        XCTAssertNil(WhatsNewRules.destination(for: .sermons))
        XCTAssertNil(WhatsNewRules.destination(for: .timeline))
        XCTAssertEqual(WhatsNewTarget.allCases.count, 11)
    }

    func testDecodesServerDocumentAndToleratesNewerValues() throws {
        let json = """
        {"entries":[{"version":"1.98.0","versionCode":113,"date":"2026-10-20",
          "sections":[{"kind":"new","items":["What's new"]},{"kind":"someday","items":["x"]}],
          "title":"What's new","headline":null,"why":null,
          "verse":{"text":"I will remember the works of the LORD","reference":"Psalm 77:11"},
          "target":"somewhere-new"}],
         "beginning":{"title":"Where it began","dateRange":"August 9 to 19, 2026","summary":"s","items":["a"]}}
        """
        let document = try JSONDecoder().decode(WhatsNewDocument.self, from: Data(json.utf8))
        let first = try XCTUnwrap(document.entries.first)
        XCTAssertEqual(first.versionCode, 113)
        XCTAssertNil(first.headline)
        XCTAssertNil(first.target)
        XCTAssertEqual(first.sections.map(\.kind), [.new, .improved])
        XCTAssertEqual(first.verse?.reference, "Psalm 77:11")

        let catchUp = try JSONDecoder().decode(WhatsNewCatchUp.self, from: Data("""
        {"cards":[{"version":"1.96.0","versionCode":110,"title":"Connections","summary":"s","target":"connections"}],
         "newReleaseCount":4,"seenUpTo":113,"seenCode":107}
        """.utf8))
        XCTAssertEqual(catchUp.cards.first?.target, .connections)
        XCTAssertEqual(catchUp.seenUpTo, 113)
    }
}
