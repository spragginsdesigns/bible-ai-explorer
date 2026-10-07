import SwiftUI

/// One guided study - port of `mobile/app/(app)/bible/sermon.tsx`.
///
/// Two rules are visual as well as editorial: a quote is marked as the
/// preacher's own words ("WHAT WAS PREACHED"), and SureWord's teaching carries
/// its own label, so nothing written here can be mistaken for something said
/// from the pulpit. Every "Watch from m:ss" deep-links the recording at that
/// moment. The dock is the reader's dock in the same shape: Watch the service
/// on the left, Ask AI on the right, which prefills an ordinary sentence
/// naming the study (the assistant reads the study with its own tool).
struct SermonStudyView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    let id: String

    @State private var study: SermonStudyDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let error {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(error).font(.system(size: 15)).foregroundStyle(theme.textSecondary)
                        Button("Try again") { Task { await load() } }
                            .foregroundStyle(theme.accent)
                            .frame(minHeight: 44)
                    }
                    .padding(Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                } else if let study {
                    content(study)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, Spacing.xl)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle(study?.title ?? "Sermon study")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let study { dock(study) }
        }
        .task { await load() }
    }

    private func load() async {
        error = nil
        do {
            study = try await SermonStudiesAPI.study(api: app.api, id: id)
        } catch {
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
            .font(.system(size: 26, weight: .semibold))
            .foregroundStyle(theme.text)
        Text(study.bigIdea)
            .font(.system(size: 17).italic())
            .foregroundStyle(theme.textSecondary)
        if !study.credits.isEmpty {
            Text(study.credits)
                .font(.system(size: 13))
                .foregroundStyle(theme.textMuted)
        }
        link("Watch the service →") { watch(study, at: study.sermonStartMs) }
        paragraph(study.summary)

        ForEach(Array(study.sections.enumerated()), id: \.offset) { index, section in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("\(index + 1). \(section.heading)")
                    .font(.system(size: 20, weight: .semibold))
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
                            .font(.system(size: 17))
                            .foregroundStyle(theme.text)
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
                            .font(.system(size: 13, weight: .bold))
                            .kerning(1)
                            .foregroundStyle(theme.accent)
                        ForEach(verses) { verse in
                            let number = Text("\(verse.verse) ")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(theme.accent)
                            Text("\(number)\(verse.text)")
                                .font(.custom(FontFamily.verse, size: 19, relativeTo: .body))
                                .foregroundStyle(theme.textSecondary)
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
                    .font(.system(size: 16))
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
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 16))
            .foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func label(_ text: String, accent: Bool = false) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .kerning(1)
            .foregroundStyle(accent ? theme.accent : theme.textMuted)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 32)
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
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                    .foregroundStyle(theme.text)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(theme.surfacePressed, in: .capsule)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Watch the service")
            .accessibilityAddTraits(.isLink)

            Button {
                app.chat.input = SermonFormat.askPrompt(title: study.title)
                NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20))
                        .foregroundStyle(theme.text)
                    Text("Ask AI")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                }
                .frame(minWidth: 52, minHeight: 52)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ask AI about \(study.title)")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
        .overlay(alignment: .top) { Divider().overlay(theme.borderStrong) }
    }
}
