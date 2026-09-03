import SwiftUI

/// Empty-chat screen. Port of `mobile/src/features/chat/WelcomeState.tsx`, laid
/// out as a two-column grid because a Mac window is wide.
struct WelcomeState: View {
    @Environment(\.theme) private var theme
    /// This user's own opening questions, or the static six until they arrive.
    /// Each carries the gold caption Android and web render above the chip.
    let questions: [SuggestedQuestionItem]
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

                VStack(spacing: Spacing.sm) {
                    Text("Come hungry for the Word.")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .multilineTextAlignment(.center)

                    Text(
                        "SureWord is your personal Bible study companion, shaped by your reading, questions, notes, and daily walk—helping you go deeper in Scripture every day."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 560)

                    VStack(spacing: 2) {
                        Text("“As newborn babes, desire the sincere milk of the word, that ye may grow thereby:”")
                        Text("— 1 Peter 2:2, KJV")
                    }
                    .font(.system(size: 12).italic())
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 520)

                    Text("Scripture comes first. Every answer is grounded in God's inerrant, infallible Word.")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 520)
                }

                Text("CHOSEN FROM YOUR STUDY")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(theme.accent)

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 260), spacing: Spacing.md)],
                    spacing: Spacing.md
                ) {
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
                .frame(maxWidth: 720)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
        }
    }
}

private struct QuestionChip: View {
    @Environment(\.theme) private var theme
    let item: SuggestedQuestionItem
    var action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                // The gold caption above the question: a Scripture reference
                // when the question is anchored to one, otherwise the source it
                // was drawn from. Same slot, same colour and letter-spacing as
                // the Android chip and the web `text-amber-*` caption.
                if let label = item.label {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.4)
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
                    Text("↗").foregroundStyle(theme.textGhost)
                }
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
///
/// TWO bars, not one: the real chip is a gold caption above a question, so a
/// single-capsule placeholder was shorter than what replaces it and the whole
/// grid jumped taller the moment the questions arrived. Same two-bar shape,
/// padding and corner radius as `QuestionChip` and as web's `WelcomeScreen`
/// skeleton (`h-2.5 w-16` over `mt-2 h-4`), staggered by 120 ms per cell the
/// same way.
///
/// Definite widths, not fractions: a greedy shape pulsing forever inside a
/// scroll view re-proposes its width on every frame (see `DailyCrossView`).
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
