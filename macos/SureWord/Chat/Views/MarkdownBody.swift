import SwiftUI

/// Renders a chat answer from `MarkdownDocument` blocks.
/// Port of `mobile/src/features/chat/MarkdownBody.tsx` — same block styles,
/// same signature look: quoted Scripture as an amber-edged glass slab set in
/// Cormorant Garamond.
struct MarkdownBody: View {
    @Environment(\.theme) private var theme
    let text: String
    /// True while the answer is still arriving. Mid-stream the buffer ends in
    /// half-typed markup, so the normalizer closes what the model has opened
    /// instead of letting a literal `**` flash on screen. Matches the
    /// `streaming` flag `mobile/src/features/chat/MessageBubble.tsx` and
    /// `src/components/ChatMessage.tsx` pass.
    var streaming: Bool = false

    var body: some View {
        // Every client runs the assistant's markdown through the same
        // normalizer before rendering: exactly one Scripture card per quoted
        // verse, fences/lists/HTML/CRLF repaired. See `AssistantMarkdown`.
        let blocks = MarkdownDocument.parse(
            AssistantMarkdown.normalize(text, streaming: streaming)
        )
        VStack(alignment: .leading, spacing: Spacing.md) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let source):
            Text(MarkdownInline.render(source, style: .body(theme)))
                .font(.system(size: 14))
                .lineSpacing(5)
                .bodyText(theme)

        case .heading(let level, let source):
            let style = headingStyle(level)
            Text(MarkdownInline.render(source, style: .body(theme, size: style.size)))
                .font(.system(size: style.size, weight: style.weight))
                .foregroundStyle(style.color)
                .padding(.top, level <= 2 ? Spacing.xs : 0)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .blockquote(let paragraphs):
            BlockquoteView(paragraphs: paragraphs)

        case .list(let ordered, let start, let items):
            ListView(ordered: ordered, start: start, items: items)

        case .codeBlock(_, let code):
            Text(code)
                .font(.system(size: 12.5, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgElevated, in: .rect(cornerRadius: Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(theme.border, lineWidth: 1)
                }

        case .table(let header, let rows):
            TableView(header: header, rows: rows)

        case .rule:
            Rectangle()
                .fill(theme.borderStrong)
                .frame(height: 1)
                .padding(.vertical, Spacing.xs)
        }
    }

    private func headingStyle(_ level: Int) -> (size: CGFloat, weight: Font.Weight, color: Color) {
        switch level {
        case 1: (20, .bold, theme.text)
        case 2: (17, .bold, theme.text)
        case 3: (15, .bold, theme.textSecondary)
        case 4: (14, .semibold, theme.textSecondary)
        case 5: (13, .semibold, theme.textMuted)
        default: (12, .semibold, theme.textMuted)
        }
    }
}

// MARK: - Blockquote (Scripture)

private struct BlockquoteView: View {
    @Environment(\.theme) private var theme
    let paragraphs: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(MarkdownInline.render(paragraph, style: .verse(theme)))
                    .font(.custom(FontFamily.verse, size: 18))
                    .lineSpacing(4)
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accentSoft)
        .overlay(alignment: .leading) {
            Rectangle().fill(theme.accent).frame(width: 3)
        }
        .clipShape(.rect(cornerRadius: Radius.md))
    }
}

// MARK: - Lists

private struct ListView: View {
    @Environment(\.theme) private var theme
    let ordered: Bool
    let start: Int
    let items: [MarkdownListItem]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                row(marker: ordered ? "\(start + index)." : "•", text: item.text)
                ForEach(Array(item.children.enumerated()), id: \.offset) { _, child in
                    row(marker: "◦", text: child.text)
                        .padding(.leading, Spacing.xl)
                }
            }
        }
    }

    private func row(marker: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(marker)
                .font(.system(size: 14, weight: ordered ? .medium : .regular))
                .foregroundStyle(theme.accent)
                .frame(minWidth: ordered ? 18 : 0, alignment: .trailing)
            Text(MarkdownInline.render(text, style: .body(theme)))
                .font(.system(size: 14))
                .lineSpacing(4)
                .bodyText(theme)
        }
    }
}

// MARK: - Tables

private struct TableView: View {
    @Environment(\.theme) private var theme
    let header: [String]
    let rows: [[String]]

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                    Text(MarkdownInline.render(cell, style: .body(theme, size: 12)))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                        .padding(Spacing.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(theme.surface)

            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider().overlay(theme.border).gridCellColumns(max(header.count, 1))
                GridRow {
                    // Ragged rows happen in streamed output; pad to the header.
                    ForEach(0..<max(header.count, 1), id: \.self) { column in
                        Text(MarkdownInline.render(column < row.count ? row[column] : "", style: .body(theme, size: 13)))
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textSecondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(Spacing.sm)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .clipShape(.rect(cornerRadius: Radius.md))
    }
}

// MARK: - Inline styling

/// Inline Markdown (bold, italics, links, inline code) via `AttributedString`,
/// restyled run-by-run to the SureWord palette.
enum MarkdownInline {
    struct Style {
        var baseColor: Color
        var strongColor: Color
        var accent: Color
        var codeBackground: Color
        /// Point size restyled runs inherit, so bold inside a heading or a
        /// table cell keeps that context's size.
        var size: CGFloat = 14
        /// Set for Scripture: emphasis swaps to the Cormorant italic face
        /// instead of the synthesized system italic.
        var verseItalicFont: Font?

        static func body(_ theme: SureWordColors, size: CGFloat = 14) -> Style {
            Style(
                baseColor: theme.textSecondary,
                strongColor: theme.text,
                accent: theme.accent,
                codeBackground: theme.surfaceStrong,
                size: size
            )
        }

        static func verse(_ theme: SureWordColors) -> Style {
            Style(
                baseColor: theme.textSecondary,
                strongColor: theme.text,
                accent: theme.accent,
                codeBackground: theme.surfaceStrong,
                size: 18,
                verseItalicFont: .custom(FontFamily.verseItalic, size: 18)
            )
        }
    }

    static func render(_ source: String, style: Style) -> AttributedString {
        var attributed = (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(source)

        for run in attributed.runs {
            let intent = run.inlinePresentationIntent ?? []

            if intent.contains(.code) {
                attributed[run.range].font = .system(size: style.size - 1.5, design: .monospaced)
                attributed[run.range].foregroundColor = style.accent
                attributed[run.range].backgroundColor = style.codeBackground
                continue
            }

            if run.link != nil {
                attributed[run.range].foregroundColor = style.accent
                attributed[run.range].underlineStyle = .single
                continue
            }

            let strong = intent.contains(.stronglyEmphasized)
            let emphasized = intent.contains(.emphasized)

            if emphasized, let verseItalic = style.verseItalicFont {
                attributed[run.range].font = verseItalic
            } else if strong && emphasized {
                attributed[run.range].font = .system(size: style.size, weight: .bold).italic()
            } else if strong {
                attributed[run.range].font = .system(size: style.size, weight: .bold)
            } else if emphasized {
                attributed[run.range].font = .system(size: style.size).italic()
            }

            if strong {
                attributed[run.range].foregroundColor = style.strongColor
            }
        }

        return attributed
    }
}

// MARK: - Shared modifiers

private extension View {
    /// The repeated paragraph treatment: selectable, wrapping, full width.
    func bodyText(_ theme: SureWordColors) -> some View {
        foregroundStyle(theme.textSecondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
