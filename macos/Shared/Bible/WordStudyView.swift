import SwiftUI

/// The Words tab of the Tap-a-verse sheet: the verse's Hebrew or Greek laid out
/// one row per word or bound phrase beside the King James wording it became,
/// then a short AI study of what the original carries.
///
/// Shared by both Apple clients, exactly as `VerseInsightView` is: the Mac pins
/// it in the panel under the reader, iOS shows it in the verse bottom sheet.
/// The same view Android renders in `mobile/src/features/bible/` and web in
/// `src/components/bible/`; same rows, same labels, same two actions.
///
/// It replaced a raw chip row of the original text with a Strong's dump under
/// it. That version showed the reader letters they could not read; this one
/// shows them what the letters say.
struct WordStudyView: View {
    @Environment(\.theme) private var theme

    let api: APIClient
    /// Canonical book order, 1-66, as both hosts already hold it.
    let book: Int
    let chapter: Int
    let verse: Int
    /// Overridden only where several verses are stacked under one heading and
    /// "WORD BY WORD" would not say which verse. Both current call sites are a
    /// single verse and take the default.
    var caption: String = "WORD BY WORD"
    /// The reader's chat model. The server pins its own low effort either way,
    /// and falls back to the account default when this is nil.
    var modelId: String?
    /// Hands a prompt to chat. `attach` is true when the verse should ride with
    /// it, which is the difference between asking about this word here and
    /// searching the whole Bible for it.
    let onAsk: (_ prompt: String, _ attach: Bool) -> Void

    @State private var model = VerseWordsModel()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            switch model.status {
            case .idle, .loading:
                header(language: nil, textName: nil)
                loadingState
            case .unavailable, .blocked:
                header(language: nil, textName: nil)
                messageLine
            case .failed:
                header(language: nil, textName: nil)
                failureState
            case .ready:
                if let study = model.study {
                    header(language: study.language, textName: study.textName)
                    rows(study)
                    prose(study)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        // Keyed on the verse, so moving to another one reloads and drops the
        // open row rather than showing the previous verse's Greek.
        .task(id: "\(book):\(chapter):\(verse)") {
            model.configure(api: api, modelId: modelId)
            await model.load(book: book, chapter: chapter, verse: verse)
        }
    }

    // MARK: - Header

    @ViewBuilder
    private func header(language: String?, textName: String?) -> some View {
        Text(caption)
            .font(.system(size: 10, weight: .bold))
            .tracking(1.2)
            .foregroundStyle(theme.textMuted)

        if let subtitle = Self.subtitle(language: language, textName: textName) {
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundStyle(theme.textFaint)
        }
    }

    /// `Hebrew \u{00B7} Westminster Leningrad Codex \u{00B7} in reading order`,
    /// carrying whichever halves the payload has.
    static func subtitle(language: String?, textName: String?) -> String? {
        let parts = [language, textName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return nil }
        return (parts + ["in reading order"]).joined(separator: " \u{00B7} ")
    }

    // MARK: - States

    /// Four ragged pills and a line naming the language. The widths are
    /// definite, not greedy: a `maxWidth: .infinity` shape under a repeating
    /// pulse re-proposes its width every frame, and in this app that means
    /// re-laying-out a chapter of Cormorant Garamond with it.
    private var loadingState: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(Array(Self.skeletonWidths.enumerated()), id: \.offset) { index, width in
                Capsule()
                    .fill(theme.accentSoft)
                    .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
                    .frame(width: width, height: 13)
            }
            Text(Self.loadingLine(book: book))
                .font(.system(size: 11.5))
                .foregroundStyle(theme.textFaint)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement()
        .accessibilityLabel(Self.loadingLine(book: book))
    }

    private static let skeletonWidths: [CGFloat] = [268, 236, 252, 190]

    /// The first tap on a verse waits on the model, so the wait is named rather
    /// than left as a bare spinner.
    static func loadingLine(book: Int) -> String {
        let language = VerseWordsModel.isHebrew(book: book) ? "Hebrew" : "Greek"
        return "Reading the \(language)\u{2026}"
    }

    /// A 404 (the source texts have nothing here) or a 403 (the account's
    /// credentials refused). Neither is retryable, so neither offers a button.
    private var messageLine: some View {
        Text(model.message ?? VerseWordsModel.noTextMessage)
            .font(.system(size: 12))
            .foregroundStyle(theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, Spacing.xs)
    }

    private var failureState: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(model.message ?? VerseWordsModel.buildFailureMessage)
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button("Retry") {
                Task { await model.retry() }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.accent)
        }
        .padding(.vertical, Spacing.xs)
    }

    // MARK: - Rows

    private func rows(_ study: VerseWordStudy) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(Array(study.rows.enumerated()), id: \.offset) { index, row in
                interlinearRow(row, index: index)
                if model.openRow == index {
                    detailCard(row: row, index: index, language: study.language)
                }
            }
        }
    }

    private func interlinearRow(_ row: VerseWordRow, index: Int) -> some View {
        let open = model.openRow == index
        return Button {
            model.toggle(row: index)
        } label: {
            HStack(alignment: .center, spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    kjvLine(row, open: open)
                    if !row.sense.isEmpty {
                        Text(row.sense)
                            .font(.system(size: 12.5))
                            .foregroundStyle(theme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Hebrew scalars carry their own direction, but a row of them
                // beginning with a prefixed particle still needs the paragraph
                // direction flipped or the pieces land in English order.
                Text(row.original)
                    .font(.system(size: 21))
                    .foregroundStyle(theme.text)
                    .multilineTextAlignment(.trailing)
                    .environment(
                        \.layoutDirection,
                        model.isRightToLeft ? .rightToLeft : .leftToRight
                    )
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                open ? theme.accentSoft : theme.surface,
                in: .rect(cornerRadius: Radius.md)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(open ? theme.accentBorder : theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(row.kjv.isEmpty ? row.original : row.kjv)
        .accessibilityValue(row.sense)
        .accessibilityAddTraits(open ? [.isSelected] : [])
    }

    /// The King James wording in the verse serif, with the reader's
    /// transliteration trailing it small and italic on the same line.
    private func kjvLine(_ row: VerseWordRow, open: Bool) -> Text {
        let kjv = Text(row.kjv)
            .font(.custom(FontFamily.verse, size: 18).weight(.semibold))
            .foregroundStyle(open ? theme.accent : theme.text)
        guard !row.translit.isEmpty else { return kjv }
        return kjv
            + Text("  \(row.translit)")
            .font(.system(size: 11.5).italic())
            .foregroundStyle(theme.textFaint)
    }

    // MARK: - Detail

    private func detailCard(row: VerseWordRow, index: Int, language: String) -> some View {
        let words = model.words(inRow: index)
        let head = model.drivingWord(inRow: index)
        let entry = model.entry(inRow: index)
        let translit = VerseWordsModel.headTranslit(row: row, word: head)
        let definition = VerseWordsModel.definitionText(entry: entry, word: head)
        let examples = entry?.occurrences?.examples ?? []

        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                if let translit {
                    Text(translit)
                        .font(.custom(FontFamily.verseItalic, size: 20))
                        .foregroundStyle(theme.accent)
                }
                Spacer(minLength: Spacing.sm)
                if let head {
                    Text(VerseWordsModel.headword(head))
                        .font(.system(size: 28))
                        .foregroundStyle(theme.text)
                }
            }

            // One grammar line per word when the row is a bound phrase: the
            // prefix and its noun are different parts of speech, and collapsing
            // them would describe neither.
            ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                if let meta = VerseWordsModel.metaLine(word) {
                    Text(meta)
                        .font(.system(size: 12.5))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let features = head?.grammar?.features, !features.isEmpty {
                ChipFlow(spacing: Spacing.xs) {
                    ForEach(Array(features.enumerated()), id: \.offset) { _, feature in
                        featureChip(feature)
                    }
                }
            }

            if let definition {
                labelled("STRONG'S", definition)
            } else if model.isEntryLoading(inRow: index) {
                labelled("STRONG'S", "\u{2026}")
            }

            if !examples.isEmpty {
                elsewhere(examples)
            }

            actions(row: row, head: head, language: language, entry: entry)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgElevated, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.accentBorder, lineWidth: 1)
        }
        .textSelection(.enabled)
    }

    private func featureChip(_ feature: String) -> some View {
        Text(feature)
            .font(.system(size: 12))
            .foregroundStyle(theme.textMuted)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(theme.surfaceStrong, in: .rect(cornerRadius: 6))
    }

    private func labelled(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(theme.textGhost)
            Text(value)
                .font(.system(size: 13.5))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func elsewhere(_ examples: [StrongsOccurrence]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("ELSEWHERE IN THE KJV")
                .font(.system(size: 10, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(theme.textGhost)

            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(examples.prefix(VerseWordsAPI.exampleCount).enumerated()), id: \.offset) {
                    _, example in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(example.reference)
                            .font(.system(size: 12.5, weight: .bold))
                            .foregroundStyle(theme.accentDim)
                            .fixedSize(horizontal: true, vertical: false)
                        Text(example.text)
                            .font(.custom(FontFamily.verse, size: 15))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Two ways deeper: the word here, and the word everywhere. Both hand chat
    /// a written-out question rather than a bare verse, so the reader sees what
    /// they are about to ask before they send it.
    @ViewBuilder
    private func actions(
        row: VerseWordRow,
        head: VerseWordDetail?,
        language: String,
        entry: StrongsEntry?
    ) -> some View {
        if let head, let number = head.strongsNumber {
            let lemma = VerseWordsModel.headword(head)
            let translit = VerseWordsModel.headTranslit(row: row, word: head)
            // No count until the occurrence list lands: "Every verse \u{00B7} 0"
            // would be a lie the moment before it became a number.
            let total = entry?.occurrences?.total
            let everyVerseLabel =
                total.map { "Every verse \u{00B7} \($0)" } ?? "Every verse"

            HStack(spacing: Spacing.sm) {
                actionButton("Ask about this word", primary: true) {
                    onAsk(
                        VerseWordsModel.askPrompt(
                            language: language,
                            lemma: lemma,
                            translit: translit,
                            number: number
                        ),
                        true
                    )
                }
                actionButton(everyVerseLabel, primary: false) {
                    onAsk(
                        VerseWordsModel.everyVersePrompt(
                            language: language,
                            lemma: lemma,
                            number: number
                        ),
                        false
                    )
                }
            }
            .padding(.top, 2)
        }
    }

    private func actionButton(
        _ label: String,
        primary: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(primary ? theme.accent : theme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity, minHeight: 34)
                .background(
                    primary ? theme.accentSoft : theme.surfaceStrong,
                    in: .rect(cornerRadius: Radius.sm)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(
                            primary ? theme.accentBorder : theme.borderStrong,
                            lineWidth: 1
                        )
                }
                .contentShape(.rect(cornerRadius: Radius.sm))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Study

    @ViewBuilder
    private func prose(_ study: VerseWordStudy) -> some View {
        if !study.study.isEmpty || !study.carry.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("WHAT THE ORIGINAL SAYS")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(theme.textMuted)

                ForEach(Array(study.study.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.system(size: 14.5))
                        .foregroundStyle(theme.textSecondary)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if !study.carry.isEmpty {
                    carryCallout(study.carry)
                }

                footer(language: study.language)
            }
            .padding(.top, Spacing.sm)
            .textSelection(.enabled)
        }
    }

    /// The one sentence to take away, set off by a rule in the accent rather
    /// than a box: it is the end of the study, not a separate card.
    private func carryCallout(_ carry: String) -> some View {
        (
            Text("Carry this. ")
                .font(.system(size: 13.5, weight: .bold))
                .foregroundStyle(theme.accent)
                + Text(carry)
                .font(.system(size: 13.5))
                .foregroundStyle(theme.textSecondary)
        )
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, 10)
        .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(theme.accent)
                .frame(width: 2)
        }
        .clipShape(.rect(cornerRadius: Radius.sm))
    }

    private func footer(language: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Text("Grounded in the \(VerseWordsModel.sourceName(language: language)) and Strong's")
            Circle()
                .fill(theme.textGhost)
                .frame(width: 4, height: 4)
            Text("Tap a word for more")
        }
        .font(.system(size: 11.5))
        .foregroundStyle(theme.textGhost)
        .padding(.top, Spacing.xs)
    }
}

// MARK: - Layout

/// Wrapping row of grammar chips. A `Layout` rather than a `LazyVGrid` because
/// the chips are all different widths and a grid would column-align them.
///
/// Deliberately left-to-right only: the chips are English grammar words
/// ("feminine", "singular"), not the original text, so they read in the
/// reader's own direction whatever the verse is in.
private struct ChipFlow: Layout {
    var spacing: CGFloat = Spacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews: subviews, width: width)
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
        for row in rows(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
            y += row.height + spacing
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
