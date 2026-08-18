import SwiftUI

/// Tap-a-verse on iOS: the tapped verse's streamed AI explanation plus the
/// four actions (Expand with AI / Copy / Share / Save to note), presented as a
/// native bottom sheet — the direct analogue of Android's `BottomSheet` in
/// `mobile/app/(app)/bible/chapter.tsx`. The Mac pins the same content in a
/// panel under the reader instead.
struct VerseSheetView: View {
    @Environment(\.theme) private var theme

    let reference: String
    let text: String
    let insight: VerseInsightModel
    let shareText: String
    let onClose: () -> Void
    let onExpand: () -> Void
    let onCopy: () -> Void
    let onSave: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                header
                verseCard

                VerseInsightView(
                    status: insight.status,
                    text: insight.text,
                    error: insight.error,
                    skeletonWidths: [300, 268, 184],
                    onRetry: { insight.retry() }
                )

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
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
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
