import SwiftUI

/// The pieces of the "Scripture in this answer" sheet that macOS and iOS share.
/// Each platform's `RetrievedVersesCard` (`ChatCards.swift`) owns the inline
/// card and the sheet chrome around `VersesSheetContent`. Port of the sheet in
/// `mobile/src/features/chat/RetrievedVersesCard.tsx`.

/// Which passage the sheet opens on; an empty key opens it at the top.
struct VersesSheetFocus: Identifiable, Equatable {
    let key: String
    var id: String { key }
}

/// Left-aligned row that wraps its children onto new lines, for chips.
struct ChipFlowLayout: Layout {
    var spacing: CGFloat = Spacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let frames = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = frames.map(\.maxX).max() ?? 0
        let height = frames.map(\.maxY).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(width: bounds.width, subviews: subviews)
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }

    private func arrange(width maxWidth: CGFloat, subviews: Subviews) -> [CGRect] {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let ideal = subview.sizeThatFits(.unspecified)
            // A chip wider than the row truncates rather than overflowing it.
            let size = CGSize(width: min(ideal.width, maxWidth), height: ideal.height)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return frames
    }
}

/// One reference chip on the inline card ("Psalms 56:1-4", or "+3 more").
struct PassageReferenceChip: View {
    @Environment(\.theme) private var theme
    let label: String
    var isMore = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isMore ? theme.textMuted : theme.accent)
                .lineLimit(1)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, 6)
                .overlay {
                    Capsule().strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isMore ? label : "Open \(label)")
    }
}

/// Every passage, then the search hits under their own heading and badge.
struct VersesSheetContent: View {
    @Environment(\.theme) private var theme

    let grouped: GroupedVerses
    let strength: MatchStrength?
    let focusKey: String
    var onCopy: (VersePassage) -> Void
    /// Opens the Share sheet (a card, or the words as text) for one passage.
    var onShare: (VersePassage) -> Void
    var onSaveToNote: (VersePassage) -> Void
    var onReadInBible: (VersePassage) -> Void

    private var badgeColor: Color {
        switch strength {
        case .strong: theme.accent
        case .moderate: theme.accentDim
        case .broad, nil: theme.textFaint
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(grouped.passages) { passage in block(passage) }

                    if !grouped.searchHits.isEmpty {
                        HStack(spacing: Spacing.sm) {
                            Text("FOUND BY SEARCH")
                                .font(.system(size: 11, weight: .bold))
                                .kerning(0.4)
                                .foregroundStyle(theme.textMuted)
                            // Only search hits carry a real score: a getPassage
                            // lookup is exact, so it gets no badge.
                            if let strength {
                                Text(strength.label.uppercased())
                                    .font(.system(size: 10, weight: .bold))
                                    .kerning(0.4)
                                    .foregroundStyle(badgeColor)
                                    .padding(.horizontal, Spacing.sm)
                                    .padding(.vertical, 2)
                                    .overlay { Capsule().strokeBorder(badgeColor, lineWidth: 1) }
                            }
                        }
                        .padding(.top, Spacing.sm)

                        ForEach(grouped.searchHits) { passage in block(passage) }
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.lg)
            }
            // `.sheet(item:)` builds this view fresh on every open, so the task
            // runs each time; yielding once lets the sheet lay out before the
            // scroll, which a first-frame `onAppear` can beat.
            .task(id: focusKey) {
                guard !focusKey.isEmpty else { return }
                await Task.yield()
                proxy.scrollTo(focusKey, anchor: .top)
            }
        }
    }

    private func block(_ passage: VersePassage) -> some View {
        PassageBlock(
            passage: passage,
            focused: passage.key == focusKey,
            onCopy: { onCopy(passage) },
            onShare: { onShare(passage) },
            onSaveToNote: { onSaveToNote(passage) },
            onReadInBible: { onReadInBible(passage) }
        )
        .id(passage.key)
    }
}

/// One passage: reference, translation (or a search hit's score), the text with
/// small verse numbers when it spans several verses, and its actions.
struct PassageBlock: View {
    @Environment(\.theme) private var theme

    let passage: VersePassage
    let focused: Bool
    var onCopy: () -> Void
    var onShare: () -> Void
    var onSaveToNote: () -> Void
    var onReadInBible: () -> Void

    @State private var copied = false

    /// A scored search hit shows its score; exact lookups have none, so they
    /// show the translation.
    private var meta: String {
        if let similarity = passage.similarity { return "\(Int((similarity * 100).rounded()))%" }
        return passage.translation?.rawValue ?? ""
    }

    private var verseText: AttributedString {
        guard passage.verses.count > 1 else { return AttributedString(passage.verses.first?.text ?? "") }
        var result = AttributedString()
        for (index, entry) in passage.verses.enumerated() {
            var number = AttributedString("\(index > 0 ? " " : "")\(entry.verse) ")
            number.font = .system(size: 12, weight: .bold)
            number.foregroundColor = theme.accentDim
            result += number
            result += AttributedString(entry.text ?? "")
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(passage.reference)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.accent)
                Spacer(minLength: Spacing.sm)
                Text(meta)
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
            }

            Text(verseText)
                .font(.custom(FontFamily.verse, size: 17))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            ChipFlowLayout {
                Button(copied ? "Copied" : "Copy") {
                    onCopy()
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        copied = false
                    }
                }
                .buttonStyle(PassageActionChipStyle())

                Button("Share", action: onShare)
                    .buttonStyle(PassageActionChipStyle())

                Button("Save to note", action: onSaveToNote)
                    .buttonStyle(PassageActionChipStyle(accent: true))

                Button("Read in context", action: onReadInBible)
                    .buttonStyle(PassageActionChipStyle())
            }
            .padding(.top, Spacing.xs)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(focused ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(focused ? theme.accentBorder : theme.border, lineWidth: 1)
        }
    }
}

extension VersePassage {
    /// The Share sheet for this passage. A passage with no known translation
    /// shares as text only: a card would otherwise draw the KJV under words
    /// the reader saw in another version. The text keeps the KJV label it
    /// always carried.
    var shareCardItem: ShareCardItem {
        ShareCardItem(
            target: .verse(reference: reference, translation: translation?.rawValue ?? ""),
            shareText: VerseAttachment.formatForSharing(
                reference: reference,
                text: plainText,
                translation: translation ?? .kjv
            )
        )
    }
}

/// The small capsule actions under each passage.
private struct PassageActionChipStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    var accent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(accent ? theme.accent : theme.textMuted)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 6)
            .background(
                configuration.isPressed ? theme.surfacePressed : (accent ? theme.accentSoft : theme.surface),
                in: .capsule
            )
            .overlay {
                Capsule().strokeBorder(accent ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
            }
            .contentShape(.capsule)
    }
}
