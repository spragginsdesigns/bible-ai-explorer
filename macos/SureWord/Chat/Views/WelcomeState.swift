import SwiftUI

/// Suggested prompts for the empty chat state.
/// Port of `mobile/src/features/chat/commonQuestions.ts`.
enum CommonQuestions {
    static let all: [String] = [
        "What is the story of creation?",
        "What is the purpose of life according to the Bible?",
        "Where was Jesus born?",
        "What does the Bible say about forgiveness?",
        "What does it mean to be born again?",
        "How should I pray according to Scripture?",
    ]
}

/// Empty-chat screen. Port of `mobile/src/features/chat/WelcomeState.tsx`, laid
/// out as a two-column grid because a Mac window is wide.
struct WelcomeState: View {
    @Environment(\.theme) private var theme
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
                    ForEach(CommonQuestions.all, id: \.self) { question in
                        QuestionChip(question: question) { onSelect(question) }
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
