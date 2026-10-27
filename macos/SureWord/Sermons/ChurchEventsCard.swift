import EventKit
import SwiftUI

/// Gatherings announced from the pulpit, each with Add to Apple Calendar and
/// Add to Google Calendar - the Mac port of
/// `mobile/src/features/sermons/ChurchEventsCard.tsx` and the iOS card.
/// Renders nothing when there are none.
///
/// A time the recording left unclear is never shown as certain: it says so and
/// sends the reader to the church's own app on the App Store, which has the
/// real time. macOS has no EventKitUI, so Apple Calendar asks for write-only
/// access once and saves the event straight into the calendar the person
/// chooses, with the same mapping the iOS sheet uses
/// (`ChurchEventCalendar.makeEvent`).
struct ChurchEventsCard: View {
    @Environment(\.theme) private var theme

    let events: [ChurchEvent]
    let churchApp: ChurchApp?
    let title: String
    let eyebrow: String

    var body: some View {
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(eyebrow.uppercased())
                    .appFont(.system(size: 10, weight: .bold))
                    .kerning(1)
                    .foregroundStyle(theme.accent)
                Text(title)
                    .appFont(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.text)
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    if index > 0 { Divider().overlay(theme.borderStrong).padding(.top, Spacing.md) }
                    ChurchEventRow(event: event, churchApp: churchApp)
                        .padding(.top, Spacing.md)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
        }
    }
}

private struct ChurchEventRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    let event: ChurchEvent
    let churchApp: ChurchApp?

    @State private var adding = false
    /// What happened to the last Apple Calendar add, shown under the buttons.
    @State private var status: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(event.title)
                .appFont(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.text)
            Text(event.when)
                .appFont(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.accent)
            if !event.certain {
                Text("TIME NOT CONFIRMED")
                    .appFont(.system(size: 10, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .overlay { Capsule().strokeBorder(theme.accent, lineWidth: 0.5) }
            }
            if !event.meta.isEmpty {
                Text(event.meta)
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
            }
            if let details = event.details {
                Text(details)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("\u{201C}\(event.sourceQuote)\u{201D}")
                    .appFont(.system(size: 13).italic())
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                link("Hear the announcement →", url: event.sourceUrl)
                    .accessibilityLabel("Hear the announcement for \(event.title)")
            }
            .padding(.leading, Spacing.md)
            .overlay(alignment: .leading) { Rectangle().fill(theme.accent).frame(width: 2) }
            .padding(.top, Spacing.xs)

            if !event.certain {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(
                        "The time was not clear in the recording. "
                            + (churchApp.map { "Check the \($0.name) app for the exact time." }
                                ?? "Check with the church for the exact time.")
                    )
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    if let churchApp {
                        link("Open \(churchApp.name) on the App Store →", url: churchApp.iosUrl)
                    }
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surfacePressed, in: .rect(cornerRadius: Radius.md))
                .padding(.top, Spacing.xs)
            }

            HStack(spacing: Spacing.sm) {
                Button {
                    addToApple()
                } label: {
                    Label {
                        Text("Apple Calendar")
                    } icon: {
                        Image(systemName: "apple.logo")
                    }
                }
                .buttonStyle(CalendarButtonStyle())
                .accessibilityLabel("Add \(event.title) to Apple Calendar")
                .help("Add to Apple Calendar")
                .disabled(event.startDate == nil || adding)

                Button {
                    if let url = URL(string: event.googleCalendarUrl) { openURL(url) }
                } label: {
                    Label {
                        Text("Google Calendar")
                    } icon: {
                        Image("GoogleCalendarLogo").resizable().frame(width: 16, height: 16)
                    }
                }
                .buttonStyle(CalendarButtonStyle())
                .accessibilityLabel("Add \(event.title) to Google Calendar")
                .accessibilityAddTraits(.isLink)
                .help("Add to Google Calendar in your browser")
            }
            .padding(.top, Spacing.sm)

            if let status {
                Text(status)
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func addToApple() {
        adding = true
        status = nil
        Task {
            let outcome = await AppleCalendar.add(event)
            adding = false
            status = switch outcome {
            case .added: "Added to your calendar."
            case .denied: "SureWord cannot add events to your calendar. Allow it in System Settings, Privacy & Security, Calendars."
            case .failed: "Could not add this event to your calendar."
            }
        }
    }

    private func link(_ title: String, url: String) -> some View {
        Button {
            if let target = URL(string: url) { openURL(target) }
        } label: {
            Text(title)
                .appFont(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 24)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }
}

private struct CalendarButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.titleAndIcon)
            .appFont(.system(size: 13, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 32)
            .background(theme.surfacePressed, in: .capsule)
            .overlay { Capsule().strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(.capsule)
    }
}

/// Saving into Apple Calendar without EventKitUI. Write-only access is all it
/// asks for: SureWord never reads the calendar, and with write-only access
/// EventKit files the event in the calendar the person chooses. Nonisolated
/// on purpose, so the store never crosses an actor boundary.
enum AppleCalendar {
    enum Outcome: Sendable {
        case added, denied, failed
    }

    static func add(_ event: ChurchEvent) async -> Outcome {
        let store = EKEventStore()
        do {
            guard try await store.requestWriteOnlyAccessToEvents() else { return .denied }
            let entry = ChurchEventCalendar.makeEvent(event, store: store)
            entry.calendar = store.defaultCalendarForNewEvents
            try store.save(entry, span: .thisEvent)
            return .added
        } catch {
            return .failed
        }
    }
}
