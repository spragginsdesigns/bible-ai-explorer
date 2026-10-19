import EventKit
import Foundation

/// One mapping from an announced event to an EventKit event, for both apps:
/// iOS hands it to the system's new-event sheet, macOS saves it straight into
/// the calendar after a write-only access request. Keeping it here means the
/// two can never disagree about times, places or notes.
enum ChurchEventCalendar {
    /// The EventKit event for one announcement. An all-day event is a calendar
    /// day, not an instant: `startsAt` is the church's local midnight, so the
    /// day is read in the church's zone and rebuilt in the reader's calendar,
    /// or a reader west of Fresno would get the day before.
    static func makeEvent(
        _ event: ChurchEvent,
        store: EKEventStore,
        readerCalendar: Calendar = .current
    ) -> EKEvent {
        let entry = EKEvent(eventStore: store)
        entry.title = event.title
        entry.isAllDay = event.allDay
        let start = event.startDate ?? .now
        if event.allDay {
            var church = Calendar(identifier: .gregorian)
            church.timeZone = TimeZone(identifier: event.timeZone) ?? readerCalendar.timeZone
            let day = church.dateComponents([.year, .month, .day], from: start)
            let localDay = readerCalendar.date(from: day) ?? start
            entry.timeZone = nil
            entry.startDate = localDay
            entry.endDate = localDay
        } else {
            entry.timeZone = TimeZone(identifier: event.timeZone)
            entry.startDate = start
            entry.endDate = event.calendarEndDate ?? start.addingTimeInterval(90 * 60)
        }
        entry.location = event.calendarLocation
        entry.notes = event.calendarNotes.isEmpty ? nil : event.calendarNotes
        entry.url = URL(string: event.sourceUrl)
        return entry
    }
}
