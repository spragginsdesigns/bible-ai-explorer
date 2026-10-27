import EventKit
import EventKitUI
import SwiftUI

/// Gatherings announced from the pulpit, each with Add to Apple Calendar and
/// Add to Google Calendar - port of `mobile/src/features/sermons/ChurchEventsCard.tsx`.
/// Renders nothing when there are none.
///
/// A time the recording left unclear is never shown as certain: it says so and
/// sends the reader to the church's own app on the App Store, which has the
/// real time. Apple Calendar opens the system's own event sheet, which since
/// iOS 17 runs out of process and needs no calendar permission; the reader
/// picks the calendar and saves, or cancels.
struct ChurchEventsCard: View {
    @Environment(\.theme) private var theme

    let events: [ChurchEvent]
    let churchApp: ChurchApp?
    let title: String
    let eyebrow: String

    @State private var adding: ChurchEvent?

    var body: some View {
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(eyebrow.uppercased())
                    .appFont(.system(size: 11, weight: .bold))
                    .kerning(1)
                    .foregroundStyle(theme.accent)
                Text(title)
                    .appFont(.system(size: 20, weight: .semibold))
                    .foregroundStyle(theme.text)
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    if index > 0 { Divider().overlay(theme.borderStrong).padding(.top, Spacing.md) }
                    ChurchEventRow(event: event, churchApp: churchApp) { adding = event }
                        .padding(.top, Spacing.md)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
            .sheet(item: $adding) { event in
                AppleCalendarSheet(event: event).ignoresSafeArea()
            }
        }
    }
}

private struct ChurchEventRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    let event: ChurchEvent
    let churchApp: ChurchApp?
    let addToApple: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(event.title)
                .appFont(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.text)
            Text(event.when)
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.accent)
            if !event.certain {
                Text("TIME NOT CONFIRMED")
                    .appFont(.system(size: 11, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .overlay { Capsule().strokeBorder(theme.accent, lineWidth: 0.5) }
            }
            if !event.meta.isEmpty {
                Text(event.meta)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
            }
            if let details = event.details {
                Text(details)
                    .appFont(.system(size: 15))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("\u{201C}\(event.sourceQuote)\u{201D}")
                    .appFont(.system(size: 15).italic())
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
                    .appFont(.system(size: 15))
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
                Button(action: addToApple) {
                    Label {
                        Text("Apple Calendar")
                    } icon: {
                        Image(systemName: "apple.logo")
                    }
                }
                .buttonStyle(CalendarButtonStyle())
                .accessibilityLabel("Add \(event.title) to Apple Calendar")
                .disabled(event.startDate == nil)

                Button {
                    if let url = URL(string: event.googleCalendarUrl) { openURL(url) }
                } label: {
                    Label {
                        Text("Google Calendar")
                    } icon: {
                        Image("GoogleCalendarLogo").resizable().frame(width: 18, height: 18)
                    }
                }
                .buttonStyle(CalendarButtonStyle())
                .accessibilityLabel("Add \(event.title) to Google Calendar")
                .accessibilityAddTraits(.isLink)
            }
            .padding(.top, Spacing.sm)
        }
    }

    private func link(_ title: String, url: String) -> some View {
        Button {
            if let target = URL(string: url) { openURL(target) }
        } label: {
            Text(title)
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 32)
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
            .appFont(.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 44)
            .background(theme.surfacePressed, in: .capsule)
            .overlay { Capsule().strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            .opacity(configuration.isPressed ? 0.6 : 1)
            .contentShape(.capsule)
    }
}

/// The system's own new-event sheet, prefilled from the server's view of the
/// event so it carries the same notes, place and end as the other calendars.
private struct AppleCalendarSheet: UIViewControllerRepresentable {
    let event: ChurchEvent
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = ChurchEventCalendar.makeEvent(event, store: store)
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: DismissAction
        init(dismiss: DismissAction) { self.dismiss = dismiss }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            dismiss()
        }
    }
}
