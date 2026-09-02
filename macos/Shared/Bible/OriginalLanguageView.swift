import SwiftUI

/// The "Original language" area of the Tap-a-verse panel: the Hebrew (WLC) or
/// Greek (TR) behind the verse as a wrapping row of tappable words, and the
/// open word's Strong's entry below.
///
/// Shared by both Apple clients, exactly as `VerseInsightView` is: the Mac pins
/// it in the panel under the reader, iOS shows it in the verse bottom sheet.
///
/// The section is pure enrichment, so it fails silently. A verse the route has
/// no text for (every New Testament verse for the WLC, and the reverse) and any
/// transport failure both render nothing at all - never an error row the reader
/// has to read past to reach the verse actions below.
struct OriginalLanguageView: View {
    @Environment(\.theme) private var theme

    let api: APIClient
    /// Canonical book order, 1-66, as both hosts already hold it.
    let book: Int
    let chapter: Int
    let verse: Int

    @State private var model = OriginalLanguageModel()

    var body: some View {
        Group {
            switch model.status {
            case .idle, .unavailable:
                EmptyView()
            case .loading:
                skeleton
            case .ready:
                if let loaded = model.verse {
                    content(loaded)
                }
            }
        }
        // Keyed on the verse, so moving to another one reloads and drops the
        // open word rather than showing the previous verse's Greek.
        .task(id: "\(book):\(chapter):\(verse)") {
            model.configure(api)
            await model.load(book: book, chapter: chapter, verse: verse)
        }
    }

    // MARK: - States

    /// Two bars, matching `VerseInsightView`'s skeleton so the panel has one
    /// loading language rather than two.
    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach([Self.skeletonWide, Self.skeletonNarrow], id: \.self) { width in
                Capsule()
                    .fill(theme.accentSoft)
                    .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
                    .frame(width: width, height: 13)
            }
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement()
        .accessibilityLabel("Loading the original language")
    }

    private static let skeletonWide: CGFloat = 240
    private static let skeletonNarrow: CGFloat = 168

    private func content(_ loaded: OriginalVerse) -> some View {
        let rightToLeft = OriginalLanguageModel.isRightToLeft(language: loaded.language)

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            caption
            subtitle(loaded)

            // Only the words flip. The caption, the subtitle and the detail
            // card stay in the reader's own reading direction, which is what
            // the other clients do and what keeps the Strong's number legible.
            //
            // The flip is the layout's own doing, not
            // `environment(\.layoutDirection,)`. SwiftUI does not mirror a
            // custom `Layout` for you - `placeSubviews` is handed the same
            // rect either way - so setting the environment alone would leave
            // Hebrew reading left to right while claiming otherwise.
            OriginalWordFlow(spacing: Spacing.xs, rightToLeft: rightToLeft) {
                ForEach(Array(loaded.words.enumerated()), id: \.offset) { index, word in
                    wordChip(word, index: index, rightToLeft: rightToLeft)
                }
            }
            .frame(maxWidth: .infinity, alignment: rightToLeft ? .trailing : .leading)

            if let word = model.selectedWord {
                detailCard(word, rightToLeft: rightToLeft)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private var caption: some View {
        Text("ORIGINAL LANGUAGE")
            .font(.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(theme.textGhost)
    }

    @ViewBuilder
    private func subtitle(_ loaded: OriginalVerse) -> some View {
        let parts = [loaded.language, loaded.textName].filter { !$0.isEmpty }
        if !parts.isEmpty {
            Text(parts.joined(separator: " \u{00B7} "))
                .font(.system(size: 11))
                .foregroundStyle(theme.textFaint)
        }
    }

    // MARK: - Words

    private func wordChip(_ word: OriginalWord, index: Int, rightToLeft: Bool) -> some View {
        let active = model.selectedIndex == index
        return Button {
            model.select(word: index)
        } label: {
            Text(OriginalLanguageModel.stripCantillation(word.text))
                // Hebrew carries its vowel points below the consonants and
                // needs the extra size to stay legible next to Greek.
                .font(.system(size: rightToLeft ? 22 : 20))
                .foregroundStyle(active ? theme.accent : theme.textSecondary)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, 2)
                .background(
                    active ? theme.accentSoft : Color.clear,
                    in: .rect(cornerRadius: Radius.sm)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(active ? theme.accentBorder : .clear, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.sm))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(word.translit ?? word.text)
        .accessibilityValue(word.gloss ?? "")
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    // MARK: - Detail

    private func detailCard(_ word: OriginalWord, rightToLeft: Bool) -> some View {
        let entry = model.selectedDefinition

        return VStack(alignment: .leading, spacing: Spacing.xs) {
            // No `layoutDirection` override here. Hebrew scalars are strongly
            // right-to-left, so the text engine lays the lemma out correctly on
            // its own, while flipping the environment would resolve this row's
            // `.leading` alignment guide against the card's other rows.
            Text(OriginalLanguageModel.stripCantillation(word.lemma ?? word.text))
                .font(.system(size: rightToLeft ? 20 : 18, weight: .semibold))
                .foregroundStyle(theme.textSecondary)

            if let translit = word.translit ?? entry?.translit, !translit.isEmpty {
                Text(translit)
                    .font(.system(size: 12.5).italic())
                    .foregroundStyle(theme.textMuted)
            }

            if let meta = Self.metaLine(word) {
                Text(meta)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
            }

            if let gloss = word.gloss ?? entry?.kjv, !gloss.isEmpty {
                labelled("KJV", gloss)
            }

            // An ellipsis rather than a spinner while the lexicon entry is on
            // its way: the definition is one line of a card that is already on
            // screen, and a spinner would pull the eye off the word the reader
            // just tapped. A word the lexicon has nothing for shows no line at
            // all rather than an ellipsis that never resolves.
            if let definition = Self.definitionText(entry, isLoading: model.isDefinitionLoading) {
                Text(definition)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .textSelection(.enabled)
    }

    private func labelled(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(theme.textGhost)
            Text(value)
                .font(.system(size: 12.5))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The lexicon definition; an ellipsis while one is still on its way; and
    /// nothing at all for a word the lexicon does not carry, so a chip with no
    /// Strong's number never sits under a placeholder that cannot resolve.
    static func definitionText(_ entry: StrongsEntry?, isLoading: Bool) -> String? {
        let def = entry?.def?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !def.isEmpty { return def }
        return isLoading ? "\u{2026}" : nil
    }

    /// `H430 \u{00B7} Ncmpa`, with whichever half the payload actually has.
    static func metaLine(_ word: OriginalWord) -> String? {
        let morph = word.morph?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let parts = [word.strongsNumber, morph.isEmpty ? nil : morph].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }
}

// MARK: - Layout

/// Wrapping row of word chips. `Layout` rather than a `LazyVGrid` because the
/// words are all different widths and a grid would column-align them.
///
/// A near-twin of `FlowRow` in the macOS `ReadingPlanPane` and `FlowLayout` in
/// the iOS `AtlasExplorerView`, both of which are file-private to shells this
/// shared view cannot reach.
private struct OriginalWordFlow: Layout {
    var spacing: CGFloat = Spacing.xs
    /// Hebrew: fill each row from the trailing edge inwards, so the first word
    /// of the verse is the rightmost one.
    var rightToLeft = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = layout(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: min(width, max(widest, 0)), height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var y = bounds.minY
        for row in layout(subviews: subviews, width: bounds.width) {
            var x = rightToLeft ? bounds.maxX : bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: rightToLeft ? x - size.width : x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += rightToLeft ? -(size.width + spacing) : size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func layout(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let advance = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if !row.indices.isEmpty, advance > width {
                rows.append(row)
                row = Row()
                row.indices = [index]
                row.width = size.width
                row.height = size.height
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
