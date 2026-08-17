import SwiftUI

/// The AI area of the Tap-a-verse panel: a softly glowing skeleton while the
/// model spins up, the streamed explanation once tokens arrive, or an error
/// with a retry. Port of `mobile/src/features/bible/VerseInsightSection.tsx`
/// and the web panel in `src/components/bible/ChapterReader.tsx`.
struct VerseInsightView: View {
    @Environment(\.theme) private var theme

    let status: VerseInsightModel.Status
    let text: String
    let error: String?
    let onRetry: () -> Void

    var body: some View {
        Group {
            switch status {
            case .idle:
                EmptyView()
            case .loading:
                skeleton
            case .error:
                errorState
            case .streaming, .done:
                explanation
            }
        }
    }

    // MARK: - States

    /// Three ragged bars standing in for the answer's first lines, at roughly
    /// the other clients' 100/92/64 proportions.
    ///
    /// The widths are **definite**, not measured or greedy. A shape has no
    /// intrinsic size, so a `maxWidth: .infinity` capsule under a
    /// `repeatForever` pulse keeps re-proposing its width and re-measuring
    /// everything around it — which, in this app, means a chapter of Cormorant
    /// Garamond, every animation frame.
    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SkeletonBar(width: 430, delay: 0)
            SkeletonBar(width: 396, delay: 0.18)
            SkeletonBar(width: 275, delay: 0.36)
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement()
        .accessibilityLabel("Generating an explanation")
    }

    /// The streamed text, with a caret while tokens are still arriving. The
    /// caret is concatenated into the same `Text` so it sits at the end of the
    /// last line rather than on a line of its own.
    private var explanation: some View {
        (
            Text(text)
                .font(.system(size: 13.5))
                .foregroundStyle(theme.textSecondary)
                + Text(status == .streaming ? " ▍" : "")
                .font(.system(size: 13.5))
                .foregroundStyle(theme.accent)
        )
        .lineSpacing(4)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.xs)
    }

    private var errorState: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(error ?? "The explanation could not be generated. Try again.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again", action: onRetry)
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// One glowing placeholder line. Each bar starts its pulse a beat later than
/// the one above, so the glow travels down the group as a wave.
private struct SkeletonBar: View {
    @Environment(\.theme) private var theme
    let width: CGFloat
    let delay: Double

    @State private var lit = false

    var body: some View {
        Capsule()
            .fill(theme.accentSoft)
            .overlay {
                Capsule().strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .frame(width: width, height: 13)
            .opacity(lit ? 0.9 : 0.35)
            .animation(
                .easeInOut(duration: 1.1).repeatForever(autoreverses: true).delay(delay),
                value: lit
            )
            .onAppear { lit = true }
    }
}
