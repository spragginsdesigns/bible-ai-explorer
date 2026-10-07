import SwiftUI

/// One verse, one job, in whichever mode the card opened in - port of
/// `mobile/src/features/learn/VersePractice.tsx`. Every mode works from the
/// downloaded card, so practice keeps working with no connection. The parent
/// re-identifies this view per card, review and mode (`.id(practiceRound)`),
/// which is what clears a round.
struct VersePracticeView: View {
    @Environment(\.theme) private var theme

    let mode: LearnMode
    let text: String
    let stage: Int
    /// The card's revision, so the shuffle and the part of a long verse move with the card.
    let seed: Int
    let disabled: Bool
    let onModeChange: (LearnMode) -> Void
    /// Type it out is the one mode that gates Continue: only a word-for-word verse passes.
    let onTypedScore: (Bool) -> Void

    @State private var revealed: Set<Int> = []
    @State private var placed: [Int] = []
    @State private var expected: Int?
    @State private var draft = ""
    @State private var score: TypedScore?

    private var verseFont: Font { .custom(FontFamily.verse, size: 30, relativeTo: .title) }

    var body: some View {
        VStack(spacing: Spacing.xl) {
            switch mode {
            case .blanks: blanks
            case .letters: letters
            case .order: order
            case .typed: typed
            }

            Text(LearnPractice.hint(mode, stage: stage))
                .font(.system(size: 14))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)

            CenteredFlow(spacing: Spacing.sm) {
                ForEach(LearnPractice.modes, id: \.self) { item in
                    Button {
                        onModeChange(item)
                    } label: {
                        Text(item.label)
                            .font(.system(size: 14, weight: item == mode ? .bold : .regular))
                            .foregroundStyle(item == mode ? theme.accent : theme.textMuted)
                            .padding(.horizontal, Spacing.md)
                            .frame(minHeight: 44)
                            .background(item == mode ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.lg))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.lg)
                                    .strokeBorder(item == mode ? theme.accentBorder : theme.border, lineWidth: 1)
                            }
                            .contentShape(.rect(cornerRadius: Radius.lg))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Practice mode: \(item.label)")
                    .accessibilityAddTraits(item == mode ? .isSelected : [])
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Fill the blanks / First letters

    private var blanks: some View {
        let words = Learn.verseWords(text, stage: stage)
        return CenteredFlow(spacing: 8, lineSpacing: 4) {
            ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                if word.hidden && !revealed.contains(index) {
                    hiddenWord(word.blank, index: index, label: "Reveal word \(index + 1)")
                } else {
                    Text(word.text).font(verseFont).foregroundStyle(theme.text)
                }
            }
        }
    }

    private var letters: some View {
        let words = LearnPractice.firstLetterWords(text)
        return CenteredFlow(spacing: 8, lineSpacing: 4) {
            ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                if revealed.contains(index) {
                    Text(word.text).font(verseFont).foregroundStyle(theme.text)
                } else {
                    hiddenWord(word.clue, index: index, label: "See word \(index + 1)")
                }
            }
        }
    }

    private func hiddenWord(_ shown: String, index: Int, label: String) -> some View {
        Button {
            revealed.insert(index)
        } label: {
            Text(shown)
                .font(verseFont)
                .underline()
                .foregroundStyle(theme.accent)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(label)
    }

    // MARK: - Tap the next word

    private var order: some View {
        let round = LearnPractice.orderRound(text, seed: seed)
        let taken = Set(placed)
        let done = placed.count == round.answer.count
        return VStack(spacing: Spacing.lg) {
            Text(placed.map { round.choices[$0] }.joined(separator: " "))
                .font(verseFont)
                .foregroundStyle(theme.text)
                .multilineTextAlignment(.center)
                .frame(minHeight: 44)
                .accessibilityAddTraits(.updatesFrequently)
            if round.partial {
                note("This verse is long, so practice comes a part at a time.")
            }
            if done {
                note("That is the verse.")
            } else {
                CenteredFlow(spacing: Spacing.sm, lineSpacing: Spacing.sm) {
                    ForEach(Array(round.choices.enumerated()), id: \.offset) { index, word in
                        if !taken.contains(index) {
                            Button {
                                let result = LearnPractice.tapOrderWord(round, placed: placed, choice: index)
                                placed = result.placed
                                expected = result.expected
                            } label: {
                                Text(word)
                                    .font(.custom(FontFamily.verse, size: 20, relativeTo: .body))
                                    .foregroundStyle(theme.text)
                                    .padding(.horizontal, Spacing.md)
                                    .frame(minHeight: 44)
                                    .background(index == expected ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.lg))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: Radius.lg)
                                            .strokeBorder(index == expected ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                                    }
                                    .contentShape(.rect(cornerRadius: Radius.lg))
                            }
                            .buttonStyle(.plain)
                            .disabled(disabled)
                            .opacity(disabled ? 0.5 : 1)
                            .accessibilityLabel("Place \(word)")
                        }
                    }
                }
                if expected != nil {
                    note("That word comes later. The next one is marked.")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: placed.count)
    }

    // MARK: - Type it out

    private var typed: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            TextField("", text: $draft, axis: .vertical)
                .lineLimit(5...10)
                .font(.custom(FontFamily.verse, size: 20, relativeTo: .body))
                .foregroundStyle(theme.text)
                .textInputAutocapitalization(.sentences)
                .padding(Spacing.md)
                .frame(minHeight: 140, alignment: .topLeading)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .disabled(disabled)
                .accessibilityLabel("Type the verse")
                .onChange(of: draft) { _, _ in
                    if score != nil {
                        score = nil
                        onTypedScore(false)
                    }
                }

            let empty = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            Button {
                let result = LearnPractice.scoreTypedVerse(text, typed: draft)
                score = result
                onTypedScore(result.perfect)
            } label: {
                Text("Check the verse")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.text)
                    .padding(.horizontal, Spacing.lg)
                    .frame(minHeight: 48)
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 1)
                    }
                    .contentShape(.rect(cornerRadius: Radius.lg))
            }
            .buttonStyle(.plain)
            .disabled(disabled || empty)
            .opacity(disabled || empty ? 0.5 : 1)

            if let score {
                scoredText(score)
                    .font(.custom(FontFamily.verse, size: 20, relativeTo: .body))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                note(score.perfect ? "Word for word." : "The marked words are the ones to mend.")
            }
        }
    }

    /// Matched words plain, missed words underlined in gold, extra words struck.
    private func scoredText(_ score: TypedScore) -> Text {
        var result = AttributedString()
        for (index, word) in score.words.enumerated() {
            if index > 0 { result += AttributedString(" ") }
            switch word.result {
            case .match:
                var part = AttributedString(word.expected ?? "")
                part.foregroundColor = theme.text
                result += part
            case .missed:
                var part = AttributedString(word.expected ?? "")
                part.foregroundColor = theme.accent
                part.underlineStyle = .single
                result += part
            case .extra:
                var part = AttributedString(word.typed ?? "")
                part.foregroundColor = theme.textMuted
                part.strikethroughStyle = .single
                result += part
            }
        }
        return Text(result)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(theme.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
}

/// Wrapping, centred row layout for verse words and tiles.
struct CenteredFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: width.isFinite ? width : widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews: subviews, width: bounds.width) {
            var x = bounds.minX + max(0, (bounds.width - row.width) / 2)
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let advance = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if !row.indices.isEmpty, advance > width {
                rows.append(row)
                row = Row(indices: [index], width: size.width, height: size.height)
            } else {
                row.indices.append(index)
                row.width = advance
                row.height = max(row.height, size.height)
            }
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
