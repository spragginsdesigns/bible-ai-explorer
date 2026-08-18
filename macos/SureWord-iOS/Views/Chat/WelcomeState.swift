import SwiftUI

/// Empty-chat screen. Port of `mobile/src/features/chat/WelcomeState.tsx`,
/// laid out as a single scrolling column of full-width chips — the Mac's
/// two-column grid doesn't fit a phone.
struct ChatWelcomeState: View {
    @Environment(\.theme) private var theme
    /// This user's own opening questions, or the static six until they arrive.
    let questions: [String]
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
                        ForEach(0..<4, id: \.self) { _ in
                            QuestionSkeleton()
                        }
                    } else {
                        ForEach(questions, id: \.self) { question in
                            QuestionChip(question: question) { onSelect(question) }
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
    let question: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: Spacing.sm) {
                Text(question)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
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
private struct QuestionSkeleton: View {
    @Environment(\.theme) private var theme
    @State private var lit = false

    var body: some View {
        Capsule()
            .fill(theme.accentSoft)
            .frame(width: 180, height: 14)
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
