import SwiftUI

/// The Getting started card on Today (docs/onboarding/PLAN.md): five rows,
/// each ticked only by real use on any client, read from
/// `GET /api/onboarding/progress`. Tapping a row not yet done shows where it
/// lives; the X hides the card on every client.
struct GettingStartedCard: View {
    @Environment(\.theme) private var theme
    @Environment(\.textScaleFactor) private var textScale
    @Environment(AppModel.self) private var app

    var body: some View {
        // `DailyWalkHome` loads the progress.
        if let progress = app.onboarding.progress, progress.show, !progress.allDone {
            card(progress)
        }
    }

    private func card(_ progress: GettingStartedProgress) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text("Getting started")
                    .font(.system(size: 17 * textScale, weight: .semibold))
                    .foregroundStyle(theme.text)
                Spacer()
                Button {
                    Task { await app.onboarding.dismissGettingStarted() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                        .frame(width: 32, height: 32)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide Getting started")
            }

            ForEach(OnboardingRules.gettingStartedItems, id: \.key) { item in
                row(item, done: progress.items[item.key] == true)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.accentBorder, lineWidth: 1)
        }
    }

    private func row(_ item: GettingStartedItem, done: Bool) -> some View {
        Button {
            app.onboarding.show(item, app: app)
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(done ? theme.accent : theme.textFaint)
                Text(item.label)
                    .font(.system(size: 16 * textScale))
                    .foregroundStyle(done ? theme.textMuted : theme.text)
                    .strikethrough(done, color: theme.textMuted)
                Spacer()
                if !done {
                    Text("Show me")
                        .font(.system(size: 13 * textScale, weight: .medium))
                        .foregroundStyle(theme.accent)
                }
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(done)
        .accessibilityLabel(done ? "\(item.label), done" : item.label)
    }
}

/// The "?" on each main screen: a new chat that asks SureWord about it.
struct GuideHelpButton: View {
    @Environment(AppModel.self) private var app
    let screen: HelpScreen

    var body: some View {
        Button {
            app.onboarding.help(screen, app: app)
        } label: {
            Label("Help with this screen", systemImage: "questionmark.circle")
        }
        .help("Ask SureWord about this screen")
    }
}
