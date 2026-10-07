import SwiftUI

/// The study rows Android's Bible home shows above the books
/// (`mobile/app/(app)/bible/index.tsx`): Learn a verse, the reading plan card,
/// and Sermon studies - the last only for an account whose church has
/// studies, the same way Listen and My church stay invisible when
/// unconfigured (fail-soft: any error leaves it hidden).
///
/// Self-contained on purpose so the Bible home only mounts one line; each row
/// pushes its screen onto the Bible tab's `NavigationStack`, as Android pushes
/// `/bible/learn`, `/bible/plan` and `/bible/sermons`.
struct BibleHomeStudyCards: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @State private var hasSermons = false

    private var plan: ReadingPlanModel { app.bible.plan }

    var body: some View {
        VStack(spacing: 0) {
            row(
                symbol: "sparkle",
                title: "Learn a verse",
                subtitle: "Practice today's verses",
                accessibility: "Learn a verse"
            ) {
                LearnView()
            }
            row(
                symbol: "calendar",
                title: plan.plan?.title ?? "Reading plan",
                subtitle: PlanView.planCardSubtitle(plan.plan),
                accessibility: plan.plan != nil ? "Reading plan - today's reading" : "Start a reading plan"
            ) {
                ReadingPlanView()
            }
            if hasSermons {
                row(
                    symbol: "building.columns",
                    title: "Sermon studies",
                    subtitle: "Walk through your church's latest message",
                    accessibility: "Sermon studies from your church"
                ) {
                    SermonStudiesView()
                }
            }
        }
        // Read-only here: the card shows where the plan stands; the plan screen
        // owns every action. `loadIfNeeded` costs one request per session.
        .task { plan.loadIfNeeded() }
        .task {
            let studies = try? await SermonStudiesAPI.list(api: app.api)
            hasSermons = !(studies ?? []).isEmpty
        }
    }

    private func row<Destination: View>(
        symbol: String,
        title: String,
        subtitle: String,
        accessibility: String,
        @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: symbol)
                    .font(.system(size: 17))
                    .foregroundStyle(theme.textMuted)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.sm)
        .accessibilityLabel(accessibility)
    }
}
