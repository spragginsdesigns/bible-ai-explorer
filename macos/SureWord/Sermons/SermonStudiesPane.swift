import SwiftUI

/// Guided studies of this reader's own church services on the Mac - port of
/// `mobile/app/(app)/bible/sermons.tsx` and the iOS `SermonStudiesView`.
///
/// Android pushes the list and then the study; here both are one pane of the
/// Bible section, list on the left and the chosen study beside it, so the
/// book list stays where it was. Under `Layout.twoColumnWidth` it folds back
/// into one column: the list, then the study in its place with a way back.
/// An account whose church has no recorded services gets an empty list whose
/// copy says why rather than reading like a failure; the Bible sidebar only
/// shows the way in when the list is non-empty.
struct SermonStudiesPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Back to the books.
    let onDismiss: () -> Void

    private enum Layout {
        /// Below this the list and the study stack instead of splitting.
        static let twoColumnWidth: CGFloat = 820
        static let listColumnWidth: CGFloat = 340
    }

    @State private var studies: [SermonStudySummary]?
    @State private var events: [ChurchEvent] = []
    @State private var churchApp: ChurchApp?
    @State private var busy = false
    @State private var error: String?
    @State private var selectedID: String?

    var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= Layout.twoColumnWidth
            VStack(spacing: 0) {
                header(wide: wide)
                Divider().overlay(theme.border)
                if wide {
                    HStack(spacing: 0) {
                        list
                            .frame(width: Layout.listColumnWidth)
                        Divider().overlay(theme.border)
                        if let selectedID {
                            SermonStudyPane(id: selectedID)
                        } else {
                            noSelection
                        }
                    }
                } else if let selectedID {
                    SermonStudyPane(id: selectedID)
                } else {
                    list
                }
            }
        }
        .task { await load() }
        .analyticsScreen(AnalyticsScreen.sermons)
        // Choosing a study is Android pushing `/bible/sermon`; back to the
        // list is the list again.
        .onChange(of: selectedID) { _, id in
            Analytics.shared.screen(id == nil ? AnalyticsScreen.sermons : AnalyticsScreen.sermon)
        }
    }

    private func load() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let home = try await SermonStudiesAPI.home(api: app.api)
            studies = home.studies
            events = home.events
            churchApp = home.churchApp
        } catch {
            self.error = "Could not load your sermon studies."
        }
    }

    // MARK: - Header

    private func header(wide: Bool) -> some View {
        // In one column a chosen study covers the list, so back goes to the
        // list first and only then to the books.
        let backToList = !wide && selectedID != nil
        return HStack(spacing: Spacing.md) {
            Button {
                if backToList { selectedID = nil } else { onDismiss() }
            } label: {
                Label(backToList ? "Sermon studies" : "Bible", systemImage: "chevron.left")
                    .appFont(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help(backToList ? "Back to the studies" : "Back to the books")

            Text("Sermon studies")
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            Spacer(minLength: Spacing.md)

            if busy {
                ProgressView().controlSize(.small)
            } else {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .appFont(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Refresh")
                .accessibilityLabel("Refresh sermon studies")
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.md) {
                Text("A guided walk through each recorded service, so you can follow the message even when you could not be there.")
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if !events.isEmpty {
                    ChurchEventsCard(events: events, churchApp: churchApp, title: "Coming up", eyebrow: "Announced at church")
                }

                if let studies, !studies.isEmpty {
                    ForEach(studies) { study in
                        Button {
                            selectedID = study.id
                        } label: {
                            row(study)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open \(study.title)")
                        .accessibilityAddTraits(selectedID == study.id ? [.isSelected] : [])
                    }
                } else if busy {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, Spacing.xl)
                } else if let error {
                    card(selected: false) {
                        Text(error)
                            .appFont(.system(size: 13))
                            .foregroundStyle(theme.textSecondary)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.plain)
                            .foregroundStyle(theme.accent)
                    }
                } else if studies != nil {
                    card(selected: false) {
                        Text("No studies yet")
                            .appFont(.system(size: 14, weight: .semibold))
                            .foregroundStyle(theme.text)
                        Text("Studies appear here after a service is recorded and processed. Set your church in Settings to follow along.")
                            .appFont(.system(size: 13))
                            .foregroundStyle(theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
    }

    private func row(_ study: SermonStudySummary) -> some View {
        card(selected: selectedID == study.id) {
            if let url = study.imageUrl.flatMap(URL.init(string:)) {
                SermonArtwork(url: url)
            }
            HStack(spacing: Spacing.sm) {
                if let when = SermonFormat.serviceDate(study.serviceDate) {
                    Text(when)
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                }
                if let text = study.preachingText {
                    Text(text)
                        .appFont(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            Text(study.title)
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .multilineTextAlignment(.leading)
            Text(study.bigIdea)
                .appFont(.system(size: 13))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
    }

    private func card<Content: View>(selected: Bool, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(selected ? theme.accentSoft : theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(selected ? theme.accentBorder : theme.borderStrong, lineWidth: selected ? 1 : 0.5)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
    }

    private var noSelection: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "building.columns")
                .appFont(.system(size: 28))
                .foregroundStyle(theme.textGhost)
            Text("Choose a study")
                .appFont(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("Each study walks through one service: what was preached, the passages, and a question to carry into your week.")
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
