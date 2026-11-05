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
                    .appFont(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.text)
                Spacer()
                Button {
                    Task { await app.onboarding.dismissGettingStarted() }
                } label: {
                    Image(systemName: "xmark")
                        .appFont(.system(size: 13, weight: .semibold))
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
                    .appFont(.system(size: 20))
                    .foregroundStyle(done ? theme.accent : theme.textFaint)
                Text(item.label)
                    .appFont(.system(size: 16))
                    .foregroundStyle(done ? theme.textMuted : theme.text)
                    .strikethrough(done, color: theme.textMuted)
                Spacer()
                if !done {
                    Text("Show me")
                        .appFont(.system(size: 13, weight: .medium))
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

/// The "?" on each main screen: a short sheet about it, with "Ask SureWord
/// about this" into a new chat (same text and flow as Android and web).
struct GuideHelpButton: View {
    @Environment(AppModel.self) private var app
    @State private var sheetPresented = false
    let screen: HelpScreen

    var body: some View {
        Button {
            sheetPresented = true
        } label: {
            Label("Help with this screen", systemImage: "questionmark.circle")
        }
        .help("Help with this screen")
        .sheet(isPresented: $sheetPresented) {
            GuideHelpSheet(screen: screen) {
                sheetPresented = false
                app.onboarding.help(screen, app: app)
            } close: {
                sheetPresented = false
            }
        }
    }
}

/// What the "?" shows before anything is sent.
struct GuideHelpSheet: View {
    let screen: HelpScreen
    let ask: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(screen.sheetTitle)
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Close help")
            }
            ForEach(screen.sheetPoints, id: \.self) { point in
                Label {
                    Text(point).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "checkmark.circle").foregroundStyle(.tint)
                }
            }
            Button(action: ask) {
                Label("Ask SureWord about this", systemImage: "bubble.left.and.text.bubble.right")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(24)
        .frame(minWidth: 320, idealWidth: 420)
        .presentationDetents([.medium, .large])
    }
}
