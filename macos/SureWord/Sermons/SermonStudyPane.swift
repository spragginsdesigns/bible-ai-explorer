import SwiftUI

/// One guided study - the Mac port of `mobile/app/(app)/bible/sermon.tsx` and
/// the iOS `SermonStudyView`, shown as the detail side of `SermonStudiesPane`.
///
/// Two rules are visual as well as editorial: a quote is marked as the
/// preacher's own words ("WHAT WAS PREACHED"), and SureWord's teaching carries
/// its own label, so nothing written here can be mistaken for something said
/// from the pulpit. Every "Watch from m:ss" deep-links the recording at that
/// moment. The dock keeps Android's shape: Watch the service on the left, Ask
/// AI on the right, which fills the chat composer with an ordinary sentence
/// naming the study (the assistant reads the study with its own tool) and
/// leaves sending to the person, as the Bible section's other Ask paths do.
struct SermonStudyPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    let id: String

    @State private var study: SermonStudyDetail?
    @State private var events: [ChurchEvent] = []
    @State private var churchApp: ChurchApp?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let error {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(error).appFont(.system(size: 13)).foregroundStyle(theme.textSecondary)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.plain)
                            .foregroundStyle(theme.accent)
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                } else if let study {
                    content(study)
                } else {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, Spacing.xl)
                }
            }
            .padding(Spacing.xl)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom) {
            if let study { dock(study) }
        }
        // Keyed by the study, so picking another one in the list reloads
        // rather than showing the last study's state under the new title.
        .task(id: id) {
            study = nil
            events = []
            churchApp = nil
            await load()
        }
    }

    private func load() async {
        error = nil
        // A load superseded by another selection must not land over it.
        do {
            let page = try await SermonStudiesAPI.page(api: app.api, id: id)
            guard !Task.isCancelled else { return }
            study = page.study
            events = page.events
            churchApp = page.churchApp
        } catch {
            guard !Task.isCancelled else { return }
            self.error = "Could not load this study."
        }
    }

    private func watch(_ study: SermonStudyDetail, at ms: Int?) {
        if let url = SermonFormat.watchURL(videoID: study.videoId, atMs: ms) { openURL(url) }
    }

    @ViewBuilder
    private func content(_ study: SermonStudyDetail) -> some View {
        if let url = study.imageUrl.flatMap(URL.init(string:)) {
            SermonArtwork(url: url)
        }
        Text(study.title)
            .appFont(.system(size: 24, weight: .semibold))
            .foregroundStyle(theme.text)
            .textSelection(.enabled)
        Text(study.bigIdea)
            .appFont(.system(size: 15).italic())
            .foregroundStyle(theme.textSecondary)
            .textSelection(.enabled)
        if !study.credits.isEmpty {
            Text(study.credits)
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textMuted)
        }
        link("Watch the service →") { watch(study, at: study.sermonStartMs) }
        paragraph(study.summary)

        ForEach(Array(study.sections.enumerated()), id: \.offset) { index, section in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("\(index + 1). \(section.heading)")
                    .appFont(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.text)
                link("Watch from \(SermonFormat.timestamp(section.startMs)) →") {
                    watch(study, at: section.startMs)
                }
                .accessibilityLabel("Watch from \(SermonFormat.timestamp(section.startMs))")

                if index > 0, let url = section.imageUrl.flatMap(URL.init(string:)) {
                    SermonArtwork(url: url)
                }

                if let quote = section.pastorQuote {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(quote)
                            .appFont(.system(size: 15))
                            .foregroundStyle(theme.text)
                            .textSelection(.enabled)
                        label("WHAT WAS PREACHED")
                    }
                    .padding(.leading, Spacing.md)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(theme.accent).frame(width: 2)
                    }
                }

                if let passage = section.passage, let verses = section.passageText {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(passage)
                            .appFont(.system(size: 12, weight: .bold))
                            .kerning(1)
                            .foregroundStyle(theme.accent)
                        ForEach(verses) { verse in
                            let number = Text("\(verse.verse) ")
                                .appFont(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.accent)
                            Text("\(number)\(verse.text)")
                                .appFont(.custom(FontFamily.verse, size: 17))
                                .foregroundStyle(theme.textSecondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                    .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 0.5) }
                }

                label("SUREWORD’S TEACHING")
                paragraph(section.explanation)

                Text("\(Text("Consider: ").bold().foregroundStyle(theme.text))\(section.reflection)")
                    .foregroundStyle(theme.textSecondary)
                    .appFont(.system(size: 14))
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                    .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            }
            .padding(.top, Spacing.lg)
        }

        VStack(alignment: .leading, spacing: Spacing.sm) {
            label("THIS WEEK", accent: true)
            paragraph(study.application)
        }
        .padding(.top, Spacing.lg)
        VStack(alignment: .leading, spacing: Spacing.sm) {
            label("PRAYER", accent: true)
            paragraph(study.prayer)
        }
        .padding(.top, Spacing.lg)
        if !events.isEmpty {
            ChurchEventsCard(
                events: events,
                churchApp: churchApp,
                title: "Coming up at church",
                eyebrow: "Announced at this service"
            )
            .padding(.top, Spacing.lg)
        }
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 14))
            .foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func label(_ text: String, accent: Bool = false) -> some View {
        Text(text)
            .appFont(.system(size: 10, weight: .bold))
            .kerning(1)
            .foregroundStyle(accent ? theme.accent : theme.textMuted)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .appFont(.system(size: 13))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 24)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }

    private func dock(_ study: SermonStudyDetail) -> some View {
        HStack(spacing: Spacing.md) {
            Button {
                watch(study, at: study.sermonStartMs)
            } label: {
                Label("Watch the service", systemImage: "play.circle")
                    .appFont(.system(size: 13, weight: .bold))
                    .lineLimit(1)
                    .foregroundStyle(theme.text)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(theme.surfacePressed, in: .capsule)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Watch the service")
            .accessibilityAddTraits(.isLink)
            .help("Open the recording on YouTube")

            Button {
                app.chat.input = SermonFormat.askPrompt(title: study.title)
                app.section = .chat
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "sparkles")
                        .appFont(.system(size: 16))
                        .foregroundStyle(theme.text)
                    Text("Ask AI")
                        .appFont(.system(size: 10))
                        .foregroundStyle(theme.textMuted)
                }
                .frame(minWidth: 44, minHeight: 36)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ask AI about \(study.title)")
            .help("Ask SureWord about this study")
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(.bar)
        .overlay(alignment: .top) { Divider().overlay(theme.borderStrong) }
    }
}
