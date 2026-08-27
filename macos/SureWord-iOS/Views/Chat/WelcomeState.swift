import SwiftUI

/// Empty-chat screen. Port of `mobile/src/features/chat/WelcomeState.tsx`,
/// laid out as a single scrolling column of full-width chips — the Mac's
/// two-column grid doesn't fit a phone.
struct ChatWelcomeState: View {
    @Environment(\.theme) private var theme
    /// This user's own opening questions, or the static six until they arrive.
    /// Each carries the gold caption Android and web render above the chip.
    let questions: [SuggestedQuestionItem]
    var isLoading: Bool
    var onSelect: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(theme.accent)
                    .frame(width: 72, height: 72)
                    .background(theme.accentSoft, in: .rect(cornerRadius: Radius.xl))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.xl)
                            .strokeBorder(theme.accentBorder, lineWidth: 1)
                    }
                    .padding(.top, Spacing.xxl)

                BrandMark(size: 44)

                Text(
                    "Ask anything about the Bible — answered by an AI that actually believes it. "
                        + "Every answer stands on the King James Scriptures as God's inerrant, final authority."
                )
                .font(.system(size: 13))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)

                VStack(spacing: Spacing.md) {
                    if isLoading {
                        ForEach(Array(QuestionSkeleton.widths.enumerated()), id: \.offset) { index, width in
                            QuestionSkeleton(width: width, delay: Double(index) * 0.12)
                        }
                    } else {
                        ForEach(questions) { item in
                            QuestionChip(item: item) { onSelect(item.question) }
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct QuestionChip: View {
    @Environment(\.theme) private var theme
    let item: SuggestedQuestionItem
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                // Same gold caption slot as the macOS chip and the Android row.
                if let label = item.label {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(theme.accent)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(alignment: .top, spacing: Spacing.sm) {
                    Text(item.question)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textGhost)
                }
            }
            .padding(Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}

/// A chip-shaped placeholder while this user's own questions are being drawn.
///
/// TWO bars, not one: the real chip is a gold caption above a question, so a
/// single-capsule placeholder was shorter than what replaces it and the whole
/// column jumped taller the moment the questions arrived. Same two-bar shape,
/// padding and corner radius as `QuestionChip` and as web's `WelcomeScreen`
/// skeleton (`h-2.5 w-16` over `mt-2 h-4`), staggered by 120 ms per row.
///
/// Definite widths, not fractions: a greedy shape pulsing forever inside a
/// scroll view re-proposes its width on every frame.
private struct QuestionSkeleton: View {
    @Environment(\.theme) private var theme

    static let widths: [CGFloat] = [190, 150, 210, 170, 140, 200]
    let width: CGFloat
    var delay: Double = 0

    @State private var lit = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Capsule()
                .fill(theme.accentSoft)
                .frame(width: 64, height: 10)
            Capsule()
                .fill(theme.accentSoft)
                .frame(width: width, height: 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .opacity(lit ? 0.9 : 0.4)
        .animation(
            .easeInOut(duration: 1.1).repeatForever(autoreverses: true).delay(delay),
            value: lit
        )
        .onAppear { lit = true }
        .accessibilityLabel("Preparing your questions")
    }
}
