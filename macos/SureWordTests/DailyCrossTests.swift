import Foundation
import Testing
@testable import SureWord

/// Pins the Daily Cross response shape to what `GET /api/verse-of-day/today`
/// actually sends (`src/app/api/verse-of-day/today/route.ts`), including the
/// nullable fields the other clients also treat as optional.
@Suite("Daily Cross decoding")
struct DailyCrossDecodingTests {

    private func decode(_ json: String) throws -> DailyCrossEntry {
        try JSONDecoder().decode(DailyCrossEntry.self, from: Data(json.utf8))
    }

    @Test("Decodes a full day")
    func decodesFullDay() throws {
        let entry = try decode(
            """
            {
              "reference": "Psalms 27:1",
              "book": "Psalms",
              "chapter": 27,
              "verse": 1,
              "text": "The LORD is my light and my salvation; whom shall I fear?",
              "reason": "A steadying word for a week that has felt loud.",
              "whyToday": "You have been reading through the Psalms.",
              "application": "Name the thing you are afraid of, then name who the LORD is.",
              "studyPath": [
                { "book": "Psalms", "chapter": 27, "focus": "Watch what David asks for." },
                { "book": "John", "chapter": 8, "focus": "The light claim, in Jesus' own words." }
              ],
              "question": "What am I treating as bigger than God today?",
              "sentAt": "2026-08-17T13:00:00.000Z"
            }
            """
        )

        #expect(entry.reference == "Psalms 27:1")
        #expect(entry.book == "Psalms")
        #expect(entry.chapter == 27)
        #expect(entry.verse == 1)
        #expect(entry.whyToday == "You have been reading through the Psalms.")
        #expect(entry.studyPath.count == 2)
        #expect(entry.studyPath.first?.book == "Psalms")
        #expect(entry.studyPath.last?.chapter == 8)
        #expect(entry.question == "What am I treating as bigger than God today?")
    }

    /// Rows written before the guide columns existed come back with nulls; the
    /// screen must render a shorter day rather than fail.
    @Test("Decodes a pre-guide row with every optional null")
    func decodesNullGuideFields() throws {
        let entry = try decode(
            """
            {
              "reference": "John 3:16",
              "book": "John",
              "chapter": 3,
              "verse": 16,
              "text": "For God so loved the world...",
              "reason": "The gospel, plainly.",
              "whyToday": null,
              "application": null,
              "studyPath": [],
              "question": null,
              "sentAt": "2026-08-17T13:00:00.000Z"
            }
            """
        )

        #expect(entry.whyToday == nil)
        #expect(entry.application == nil)
        #expect(entry.question == nil)
        #expect(entry.studyPath.isEmpty)
    }

    @Test("Tolerates a missing study path entirely")
    func decodesMissingStudyPath() throws {
        let entry = try decode(
            """
            {
              "reference": "John 3:16",
              "book": "John",
              "chapter": 3,
              "verse": 16,
              "text": "For God so loved the world...",
              "reason": "The gospel, plainly.",
              "sentAt": "2026-08-17T13:00:00.000Z"
            }
            """
        )

        #expect(entry.studyPath.isEmpty)
        #expect(entry.whyToday == nil)
    }

    /// The study path names books by canonical KJV name; the reader navigates
    /// by order, so the screen resolves each step through the same parser a
    /// typed reference uses. A step that does not resolve must not be openable.
    @Test("Study-path book names resolve to reader locations")
    func studyStepsResolve() {
        #expect(Bible.resolveReference("Psalms 27")?.order == 19)
        #expect(Bible.resolveReference("1 Corinthians 13")?.order == 46)
        #expect(Bible.resolveReference("Song of Solomon 2")?.order == 22)
        #expect(Bible.resolveReference("Nowhere 3") == nil)
    }
}

/// The reminder-hour formatting is copied from Android's `formatHour`; if one
/// changes, both must.
@MainActor
@Suite("Verse of the Day settings")
struct VerseOfDayHourTests {

    @Test("Formats the hour the way Android does")
    func formatsHour() {
        #expect(SettingsStore.formatHour(0) == "12:00 AM")
        #expect(SettingsStore.formatHour(8) == "8:00 AM")
        #expect(SettingsStore.formatHour(11) == "11:00 AM")
        #expect(SettingsStore.formatHour(12) == "12:00 PM")
        #expect(SettingsStore.formatHour(13) == "1:00 PM")
        #expect(SettingsStore.formatHour(23) == "11:00 PM")
    }
}
