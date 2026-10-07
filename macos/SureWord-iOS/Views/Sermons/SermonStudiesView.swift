import SwiftUI

/// Guided studies of this reader's own church services - port of
/// `mobile/app/(app)/bible/sermons.tsx`. An account whose church has no
/// recorded services gets an empty list whose copy says why rather than
/// reading like a failure. The Bible home only shows the way in when the
/// list is non-empty (`BibleHomeStudyCards`).
struct SermonStudiesView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @State private var studies: [SermonStudySummary]?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.md) {
                Text("A guided walk through each recorded service, so you can follow the message even when you could not be there.")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let studies, !studies.isEmpty {
                    ForEach(studies) { study in
                        NavigationLink {
                            SermonStudyView(id: study.id)
                        } label: {
                            row(study)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open \(study.title)")
                    }
                } else if busy {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, Spacing.xl)
                } else if let error {
                    card {
                        Text(error)
                            .font(.system(size: 15))
                            .foregroundStyle(theme.textSecondary)
                        Button("Try again") { Task { await load() } }
                            .foregroundStyle(theme.accent)
                            .frame(minHeight: 44)
                    }
                } else if studies != nil {
                    card {
                        Text("No studies yet")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(theme.text)
                        Text("Studies appear here after a service is recorded and processed. Set your church in Settings to follow along.")
                            .font(.system(size: 15))
                            .foregroundStyle(theme.textSecondary)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle("Sermon studies")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            studies = try await SermonStudiesAPI.list(api: app.api)
        } catch {
            self.error = "Could not load your sermon studies."
        }
    }

    private func row(_ study: SermonStudySummary) -> some View {
        card {
            if let url = study.imageUrl.flatMap(URL.init(string:)) {
                SermonArtwork(url: url)
            }
            HStack(spacing: Spacing.sm) {
                if let when = SermonFormat.serviceDate(study.serviceDate) {
                    Text(when)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                }
                if let text = study.preachingText {
                    Text(text)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            Text(study.title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.text)
                .multilineTextAlignment(.leading)
            Text(study.bigIdea)
                .font(.system(size: 15))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 0.5) }
            .contentShape(.rect(cornerRadius: Radius.lg))
    }
}

/// A study's or a section's artwork at Android's 3:2, with a quiet placeholder
/// while it loads and nothing at all if it fails.
struct SermonArtwork: View {
    @Environment(\.theme) private var theme
    let url: URL

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                Color.clear
            default:
                theme.surfaceStrong
            }
        }
        .aspectRatio(3 / 2, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(.rect(cornerRadius: Radius.lg))
        .accessibilityHidden(true)
    }
}
