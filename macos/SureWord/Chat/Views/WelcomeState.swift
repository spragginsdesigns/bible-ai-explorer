import SwiftUI

/// Empty-chat screen. Port of `mobile/src/features/chat/WelcomeState.tsx`, laid
/// out as a two-column grid because a Mac window is wide.
struct WelcomeState: View {
    @Environment(\.theme) private var theme
    /// This user's own opening questions, or the static six until they arrive.
    let questions: [String]
    var isLoading: Bool
    var onSelect: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 96, height: 96)
                    .clipShape(.rect(cornerRadius: Radius.xl))

                BrandMark(size: 52)

                Text(
                    "Ask anything about the Bible — answered by an AI that actually believes it. "
                        + "Every answer stands on the King James Scriptures as God's inerrant, final authority."
                )
                .font(.system(size: 13))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 520)

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 260), spacing: Spacing.md)],
                    spacing: Spacing.md
                ) {
                    if isLoading {
                        ForEach(Array(QuestionSkeleton.widths.enumerated()), id: \.offset) { _, width in
                            QuestionSkeleton(width: width)
                        }
                    } else {
                        ForEach(questions, id: \.self) { question in
                            QuestionChip(question: question) { onSelect(question) }
                        }
                    }
                }
                .frame(maxWidth: 720)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
        }
    }
}

private struct QuestionChip: View {
    @Environment(\.theme) private var theme
    let question: String
    var action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: Spacing.sm) {
                Text(question)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("↗").foregroundStyle(theme.textGhost)
            }
            .padding(Spacing.md)
            .background(
                isHovering ? theme.surfacePressed : theme.surface,
                in: .rect(cornerRadius: Radius.md)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(isHovering ? theme.accentBorder : theme.border, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
    }
}

/// A chip-shaped placeholder while this user's own questions are being drawn.
/// Definite widths, not fractions: a greedy shape pulsing forever inside a
/// scroll view re-proposes its width on every frame (see `DailyCrossView`).
private struct QuestionSkeleton: View {
    @Environment(\.theme) private var theme

    static let widths: [CGFloat] = [190, 150, 210, 170, 140, 200]
    let width: CGFloat

    @State private var lit = false

    var body: some View {
        Capsule()
            .fill(theme.accentSoft)
            .frame(width: width, height: 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
            .opacity(lit ? 0.9 : 0.4)
            .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: lit)
            .onAppear { lit = true }
            .accessibilityLabel("Preparing your questions")
    }
}
