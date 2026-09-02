import SwiftUI

/// Tap-a-verse on iOS: the tapped verse's streamed AI explanation plus the
/// four actions (Expand with AI / Copy / Share / Save to note), presented as a
/// native bottom sheet — the direct analogue of Android's `BottomSheet` in
/// `mobile/app/(app)/bible/chapter.tsx`. The Mac pins the same content in a
/// panel under the reader instead.
struct VerseSheetView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    let reference: String
    let text: String
    let verse: Int
    let insight: VerseInsightModel
    let shareText: String
    let onClose: () -> Void
    let onExpand: () -> Void
    let onCopy: () -> Void
    let onSave: () -> Void

    private var translation: TranslationID { app.settings.translation }

    private var highlightHex: String? {
        guard let order = app.bible.selectedBook else { return nil }
        return app.highlights.hex(
            translation: translation,
            book: order,
            chapter: app.bible.chapter,
            verse: verse
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                header
                verseCard
                highlightSection

                VerseInsightView(
                    status: insight.status,
                    text: insight.text,
                    error: insight.error,
                    skeletonWidths: [300, 268, 184],
                    onRetry: { insight.retry() }
                )

                // The Hebrew or Greek behind the verse, word by word. Renders
                // nothing at all when the route has no text for this verse, so
                // it costs the sheet no height on the half of the canon each
                // source text does not cover.
                if let order = app.bible.selectedBook {
                    OriginalLanguageView(
                        api: app.api,
                        book: order,
                        chapter: app.bible.chapter,
                        verse: verse
                    )
                }

                Button(action: onExpand) {
                    Label("Expand with AI", systemImage: "sparkles")
                        .font(.system(size: 14.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.lg)
                                .strokeBorder(theme.accentBorder, lineWidth: 1)
                        }
                        .contentShape(.rect(cornerRadius: Radius.lg))
                }
                .buttonStyle(.plain)

                actionRow(systemImage: "doc.on.doc", label: "Copy", action: onCopy)

                ShareLink(item: shareText) {
                    actionLabel(systemImage: "square.and.arrow.up", label: "Share")
                }
                .buttonStyle(.plain)

                actionRow(systemImage: "note.text", label: "Save to note", action: onSave)

                if highlightHex != nil {
                    actionRow(systemImage: "xmark.circle", label: "Remove highlight") {
                        guard let order = app.bible.selectedBook else { return }
                        app.highlights.remove(
                            translation: translation,
                            book: order,
                            chapter: app.bible.chapter,
                            verse: verse
                        )
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
    }

    // MARK: - Highlight

    /// YouVersion-style highlight picker: the shared preset swatches in a
    /// horizontal row (current colour ringed) and a native `ColorPicker` for
    /// a custom colour.
    private var highlightSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Highlight")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textMuted)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(HighlightColors.presets) { preset in
                        let isCurrent = highlightHex?.caseInsensitiveCompare(preset.hex) == .orderedSame
                        Button {
                            setHighlight(preset.hex)
                        } label: {
                            Circle()
                                .fill(Color(hex: preset.hex) ?? .clear)
                                .frame(width: 28, height: 28)
                                .overlay {
                                    if isCurrent {
                                        Circle()
                                            .strokeBorder(theme.accent, lineWidth: 2.5)
                                            .padding(-3)
                                    }
                                }
                                .contentShape(.circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Highlight \(preset.name)")
                    }
                }
                .padding(.vertical, Spacing.xs)
            }

            ColorPicker(
                "Custom color",
                selection: Binding(
                    get: { highlightHex.flatMap { Color(hex: $0) } ?? Color(hex: 0xF5D76E) },
                    set: { picked in
                        guard let hex = HighlightColors.hexString(from: picked) else { return }
                        setHighlight(hex)
                    }
                ),
                supportsOpacity: false
            )
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
        }
    }

    private func setHighlight(_ hex: String) {
        guard let order = app.bible.selectedBook else { return }
        app.highlights.setColor(
            translation: translation,
            book: order,
            chapter: app.bible.chapter,
            verse: verse,
            hex: hex
        )
    }

    private var header: some View {
        HStack {
            Text(reference)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(theme.accent)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
                    .frame(width: 28, height: 28)
                    .background(theme.surface, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close verse panel")
        }
    }

    private var verseCard: some View {
        Text(text)
            .font(.custom(FontFamily.verse, size: 15))
            .foregroundStyle(theme.textSecondary)
            .lineLimit(5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.borderStrong, lineWidth: 1)
            }
    }

    private func actionRow(systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            actionLabel(systemImage: systemImage, label: label)
        }
        .buttonStyle(.plain)
    }

    private func actionLabel(systemImage: String, label: String) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(theme.textMuted)
                .frame(width: 20)
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
            Spacer()
        }
        .padding(.horizontal, Spacing.md)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .contentShape(.rect(cornerRadius: Radius.md))
    }
}
