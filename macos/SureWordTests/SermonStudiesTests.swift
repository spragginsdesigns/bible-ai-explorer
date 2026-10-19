import EventKit
import Foundation
import XCTest

@testable import SureWord

/// Sermon studies and church events on the Mac: the wire shapes the list and
/// study panes decode (`GET /api/sermon-studies` and `/api/sermon-studies/[id]`,
/// as in `sermonApi.ts`), and the Apple Calendar mapping the Mac saves with,
/// which is the same `ChurchEventCalendar.makeEvent` the iOS sheet uses.
final class SermonStudiesTests: XCTestCase {
    private static let homeJSON = """
    {"studies":[{"id":"smn_1","videoId":"abcdefghijk","title":"Follow Me","serviceTitle":"Sunday Morning Worship","serviceDate":"2026-09-13","preacher":"Pastor Ron Hess","preachingText":"Luke 9:57-62","bigIdea":"Christ calls before He comforts.","imageUrl":"https://sureword.app/api/sermon-studies/image?k=abc"}],
     "events":[
      {"id":"evt_1","studyId":"smn_1","title":"Ladies fellowship","details":"Bring a dish.","audience":"ladies","location":"Ministry hall",
       "startsAt":"2026-10-24T18:00:00.000Z","endsAt":null,"allDay":false,"timeZone":"America/Los_Angeles",
       "when":"Saturday, October 24 at 11:00 AM","certain":false,"sourceQuote":"Ladies fellowship at 11.",
       "sourceUrl":"https://www.youtube.com/watch?v=abcdefghijk&t=95s","googleCalendarUrl":"https://calendar.google.com/calendar/render?action=TEMPLATE",
       "calendarNotes":"For: ladies","calendarEndsAt":"2026-10-24T19:30:00.000Z","calendarLocation":"First Missionary Baptist Church",
       "icsPath":"/api/church-events/evt_1/ics"},
      {"id":"evt_bad"},
      {"id":"evt_2","title":"Church picnic","startsAt":"2026-10-31T07:00:00.000Z","allDay":true,"when":"Saturday, October 31","certain":true},
      {"id":"evt_3","title":"Prayer meeting","startsAt":"2026-10-28T02:00:00.000Z","allDay":false,"timeZone":"America/Los_Angeles","when":"Tuesday, October 27 at 7:00 PM","certain":true,"calendarNotes":""}
     ],
     "churchApp":{"name":"FMBC Fresno","androidUrl":"https://play.google.com/store/apps/details?id=x","iosUrl":"https://apps.apple.com/us/app/fmbc-fresno/id1567963142"}}
    """

    private struct HomeEnvelope: Decodable {
        let studies: [SermonStudySummary]
        let events: LenientList<ChurchEvent>
        let churchApp: ChurchApp?
    }

    private func home() throws -> HomeEnvelope {
        try JSONDecoder().decode(HomeEnvelope.self, from: Data(Self.homeJSON.utf8))
    }

    // MARK: - Decoding

    func testTheListDecodesItsStudiesEventsAndChurchApp() throws {
        let home = try home()
        XCTAssertEqual(home.studies.map(\.id), ["smn_1"])
        XCTAssertEqual(home.studies[0].imageUrl, "https://sureword.app/api/sermon-studies/image?k=abc")
        XCTAssertEqual(home.events.items.map(\.id), ["evt_1", "evt_2", "evt_3"], "a broken event is dropped, not fatal")
        XCTAssertEqual(home.churchApp?.iosUrl, "https://apps.apple.com/us/app/fmbc-fresno/id1567963142")
    }

    func testAnUnsureEventReadsAsUnsureAndCarriesItsMetaLine() throws {
        let fellowship = try home().events.items[0]
        XCTAssertFalse(fellowship.certain)
        XCTAssertEqual(fellowship.meta, "Ministry hall · For ladies")
        XCTAssertEqual(fellowship.details, "Bring a dish.")
        XCTAssertEqual(fellowship.startDate, LearnTime.parse("2026-10-24T18:00:00Z"))
        XCTAssertEqual(fellowship.calendarEndDate, LearnTime.parse("2026-10-24T19:30:00Z"))
    }

    func testMissingFieldsFallBackWithoutClaimingCertainty() throws {
        let picnic = try home().events.items[1]
        XCTAssertTrue(picnic.allDay)
        XCTAssertEqual(picnic.timeZone, "America/Los_Angeles")
        XCTAssertEqual(picnic.meta, "")
        XCTAssertEqual(picnic.googleCalendarUrl, "")
        XCTAssertNil(picnic.calendarEndDate)

        let json = #"{"id":"evt_9","title":"Revival","startsAt":"2026-11-01T17:00:00Z"}"#
        let bare = try JSONDecoder().decode(ChurchEvent.self, from: Data(json.utf8))
        XCTAssertFalse(bare.certain, "missing certain must never read as confirmed")
    }

    func testTheStudyPageDecodesWithNullsAndAPartialSection() throws {
        let json = #"""
        {"study":{"id":"smn_1","videoId":"abcdefghijk","title":"Follow Me","serviceTitle":"Sunday Morning Worship",
        "serviceDate":"2026-09-13","preacher":"Pastor Ron Hess","preachingText":"Luke 9:57-62",
        "bigIdea":"Christ calls before He comforts.","imageUrl":null,"summary":"A walk.","application":"Name it.",
        "prayer":"Lord, make me willing.","sermonStartMs":120000.0,"durationSec":null,
        "sections":[{"heading":"The call","startMs":1867000,"pastorQuote":"Count the cost.","passage":"Luke 9:57-58",
        "passageText":[{"verse":57,"text":"And it came to pass"}],"explanation":"SureWord's teaching.",
        "reflection":"What has it cost?","imageUrl":"https://sureword.app/api/sermon-studies/image?k=s1"},{"heading":"Second","startMs":2000000.0}]},
        "events":null,"churchApp":null}
        """#
        struct Envelope: Decodable {
            let study: SermonStudyDetail
            let events: LenientList<ChurchEvent>?
        }
        let page = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8))
        XCTAssertEqual(page.study.sections.count, 2)
        XCTAssertEqual(page.study.sections[0].pastorQuote, "Count the cost.")
        XCTAssertEqual(page.study.sections[0].passageText?.first?.verse, 57)
        XCTAssertEqual(page.study.sections[1].startMs, 2_000_000)
        XCTAssertEqual(page.study.sections[1].reflection, "")
        XCTAssertEqual(page.study.sermonStartMs, 120_000)
        XCTAssertEqual(page.study.credits, "Sunday Morning Worship · Pastor Ron Hess · 2026-09-13")
        XCTAssertNil(page.events, "a study with no events is still a whole study")
    }

    func testWatchLinksAndTheAskPromptMatchAndroid() {
        XCTAssertEqual(
            SermonFormat.watchURL(videoID: "abcdefghijk", atMs: 1_867_999)?.absoluteString,
            "https://www.youtube.com/watch?v=abcdefghijk&t=1867s"
        )
        XCTAssertEqual(SermonFormat.timestamp(1_867_000), "31:07")
        XCTAssertEqual(SermonFormat.askPrompt(title: "Follow Me"), "Let's talk about the sermon study \"Follow Me\".")
    }

    // MARK: - Apple Calendar mapping

    func testATimedEventCarriesTheServersTimesPlaceNotesAndLink() throws {
        let store = EKEventStore()
        let timed = ChurchEventCalendar.makeEvent(try home().events.items[0], store: store)
        XCTAssertEqual(timed.title, "Ladies fellowship")
        XCTAssertFalse(timed.isAllDay)
        XCTAssertEqual(timed.startDate, LearnTime.parse("2026-10-24T18:00:00Z"))
        XCTAssertEqual(timed.endDate, LearnTime.parse("2026-10-24T19:30:00Z"))
        XCTAssertEqual(timed.location, "First Missionary Baptist Church")
        XCTAssertEqual(timed.notes, "For: ladies")
        XCTAssertEqual(timed.timeZone?.identifier, "America/Los_Angeles")
        XCTAssertEqual(timed.url?.absoluteString, "https://www.youtube.com/watch?v=abcdefghijk&t=95s")
    }

    func testATimedEventWithNoEndRunsNinetyMinutesAndEmptyNotesStayEmpty() throws {
        let store = EKEventStore()
        let prayer = ChurchEventCalendar.makeEvent(try home().events.items[2], store: store)
        let start = try XCTUnwrap(LearnTime.parse("2026-10-28T02:00:00Z"))
        XCTAssertEqual(prayer.startDate, start)
        XCTAssertEqual(prayer.endDate, start.addingTimeInterval(90 * 60))
        XCTAssertNil(prayer.notes)
        XCTAssertNil(prayer.location)
    }

    func testAnAllDayEventIsTheChurchsDayInEveryReadersZone() throws {
        let store = EKEventStore()
        let picnic = try home().events.items[1]
        // Fresno midnight on Oct 31 is still Oct 30 in Honolulu and already
        // Oct 31 morning in Tokyo; the entry must be Oct 31 in both.
        for zone in ["Pacific/Honolulu", "Asia/Tokyo", "America/Los_Angeles"] {
            var reader = Calendar(identifier: .gregorian)
            reader.timeZone = try XCTUnwrap(TimeZone(identifier: zone))
            let entry = ChurchEventCalendar.makeEvent(picnic, store: store, readerCalendar: reader)
            XCTAssertTrue(entry.isAllDay, zone)
            let day = reader.dateComponents([.year, .month, .day], from: try XCTUnwrap(entry.startDate))
            XCTAssertEqual([day.year, day.month, day.day], [2026, 10, 31], zone)
        }
    }
}
