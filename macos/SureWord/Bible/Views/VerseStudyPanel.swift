import SwiftUI

/// The Mac's two-tier verse sheet: a peek (reference, two-line teaser, action
/// bar) docked under the chapter, and a study tier that grows the same panel
/// to most of the reader with the Explain / Words / See also / Notes tabs.
/// The Mac counterpart of the iPhone's `VerseSheetPanel` and of
/// `mobile/src/features/bible/verse-sheet/VerseSheet.tsx`, drawing the same
/// `VerseSheetModel`.
///
/// Docked rather than floated: it sits *under* the reader in the pane's stack,
/// so the chapter above stays readable and clickable in both tiers (a click on
/// another verse grows the range) and no verse is ever painted over. Web's
/// fixed bottom panel does the same. A trailing inspector was the other
/// option, but beside the app and Bible sidebars it would leave the text
/// column a few hundred points wide at the default window size. Outside the
/// scroll view, the streamed explanation never re-measures the chapter
/// (`macos/README.md`, "The reader is a layout minefield").
///
/// A Mac has no drag sheet, so the tiers change by click: the teaser and the
/// Study button open the study tier, the same button returns to the peek, and
/// Escape closes the panel as it does on web.
struct VerseStudyPanel<Peek: View, Study: View, Footer: View>: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Bindable var model: VerseSheetModel
    let title: String
    let subtitle: String?
    /// Height of the reader and the panel together, which the study tier is
    /// measured against.
    let availableHeight: CGFloat
    let onClose: () -> Void
    @ViewBuilder let peek: () -> Peek
    @ViewBuilder let study: () -> Study
    @ViewBuilder let footer: () -> Footer

    /// Fraction of the pane the study tier takes. Less than the phone's 90%,
    /// so a few lines of the chapter stay in view to click into the range.
    static var expandedRatio: CGFloat { 0.62 }

    private var expanded: Bool { model.tier == .expanded }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            if expanded {
                ScrollView {
                    study()
                        .padding(.bottom, Spacing.md)
                }
                .frame(maxHeight: .infinity)
            } else {
                peek()
            }

            footer()
                .padding(.bottom, Spacing.md)
        }
        .padding(.top, Spacing.sm)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .frame(height: expanded ? max(availableHeight * Self.expandedRatio, 320) : nil, alignment: .top)
        .background(theme.glassLight)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.border)
                .frame(height: 1)
        }
        .animation(reduceMotion ? nil : .snappy, value: model.tier)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .appFont(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            Button {
                model.toggleTier()
            } label: {
                Label(expanded ? "Less" : "Study", systemImage: expanded ? "chevron.down" : "chevron.up")
                    .appFont(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(SubtleButtonStyle())
            .help(expanded ? "Collapse details" : "Expand details")
            .accessibilityLabel(expanded ? "Collapse details" : "Expand details")

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .appFont(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
                    .frame(width: 28, height: 28)
                    .background(theme.surface, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .help("Close")
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.bottom, Spacing.xs)
    }
}
