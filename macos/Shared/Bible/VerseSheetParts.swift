import SwiftUI

// The verse sheet's study tabs and peek teaser, drawn by both Apple readers:
// the iPhone's drag sheet (`VerseSheetPanel`) and the Mac's docked panel
// (`VerseStudyPanel`).

/// Segmented control across the study panes - Android's `StudyTabs`, drawn as
/// the native segmented picker.
struct StudyTabsView: View {
    @Binding var selection: VerseSheetModel.StudyTab

    var body: some View {
        Picker("Study", selection: $selection) {
            ForEach(VerseSheetModel.StudyTab.allCases) { tab in
                Text(tab.label).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Spacing.lg)
    }
}

/// The first two lines of the explanation, and the way into the study view.
/// Port of `verse-sheet/InsightTeaser.tsx`.
struct InsightTeaserView: View {
    @Environment(\.theme) private var theme

    let insight: VerseInsightModel
    let onExpand: () -> Void
    let onRetry: () -> Void

    var body: some View {
        Group {
            switch insight.status {
            case .idle, .loading:
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    skeletonBar(width: 1)
                    skeletonBar(width: 0.72)
                }
                .accessibilityElement()
                .accessibilityLabel("Generating an explanation")
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
                .onTapGesture(perform: onExpand)
            case .error:
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    if let error = insight.error {
                        Text(error)
                            .appFont(.system(size: 12))
                            .foregroundStyle(theme.textMuted)
                    }
                    // Its own button so retrying never also expands the sheet.
                    Button("Try again", action: onRetry)
                        .appFont(.system(size: 12, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .buttonStyle(.plain)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .streaming, .done:
                Button(action: onExpand) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        if !insight.text.isEmpty {
                            Text(insight.text)
                                .appFont(.system(size: 14))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        HStack(spacing: 2) {
                            Text("Study")
                                .appFont(.system(size: 12, weight: .bold))
                            Image(systemName: "chevron.up")
                                .appFont(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(theme.accent)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open the study view")
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }

    /// Definite widths only: a greedy shape under a repeating animation is
    /// exactly the layout trap the reader README warns about.
    private func skeletonBar(width fraction: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(theme.surfacePressed)
            .frame(width: 300 * fraction, height: 10)
    }
}
