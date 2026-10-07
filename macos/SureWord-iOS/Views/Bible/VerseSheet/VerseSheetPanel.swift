import SwiftUI

/// Two-tier reader sheet: a peek that sits over the bottom of the chapter, and
/// a study view dragged (or tapped) up to 90% of the reader. Port of
/// `mobile/src/features/bible/verse-sheet/VerseSheet.tsx`.
///
/// Non-modal on purpose. A SwiftUI `.sheet` is its own presentation and takes
/// the touches behind it, and multi-verse selection depends on the chapter
/// staying tappable while the peek is up - so this is an overlay in the
/// reader, the same reason Android avoids `Modal`. It also keeps streamed
/// explanation text out of the chapter's `LazyVStack` (see `macos/README.md`,
/// "The reader is a layout minefield").
///
/// The panel is chrome, so it carries the shell's elevated surface and
/// shadow; no glass sits behind the explanation text it holds.
struct VerseSheetPanel<Peek: View, Study: View, Footer: View>: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Bindable var model: VerseSheetModel
    let title: String
    let subtitle: String?
    /// Reader height the expanded tier is measured against.
    let availableHeight: CGFloat
    let onClose: () -> Void
    @ViewBuilder let peek: () -> Peek
    @ViewBuilder let study: () -> Study
    @ViewBuilder let footer: () -> Footer

    /// Fraction of the reader the expanded tier occupies.
    static var expandedRatio: CGFloat { 0.9 }

    @State private var drag: CGFloat = 0

    private var expanded: Bool { model.tier == .expanded }

    var body: some View {
        VStack(spacing: 0) {
            header
                .contentShape(.rect)
                .gesture(dragGesture)

            if expanded {
                ScrollView {
                    study()
                        .padding(.bottom, Spacing.md)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: .infinity)
            } else {
                peek()
                    .contentShape(.rect)
                    .gesture(dragGesture)
            }

            footer()
                .padding(.bottom, Spacing.md)
        }
        .frame(maxWidth: .infinity)
        .frame(height: expanded ? max(availableHeight * Self.expandedRatio, 320) : nil, alignment: .top)
        // The surface runs on under the home indicator (and under the tab
        // bar's glass), so no strip of chapter shows below the action bar.
        .background {
            UnevenRoundedRectangle(topLeadingRadius: Radius.xl, topTrailingRadius: Radius.xl)
                .fill(theme.bgElevated)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay {
            UnevenRoundedRectangle(topLeadingRadius: Radius.xl, topTrailingRadius: Radius.xl)
                .strokeBorder(theme.borderStrong, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .shadow(color: .black.opacity(0.35), radius: 18, y: -6)
        .offset(y: visibleDrag)
        .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86), value: model.tier)
        .accessibilityElement(children: .contain)
    }

    /// Downward drags follow the finger; upward ones only hint, with the same
    /// heavy resistance Android puts on an over-drag.
    private var visibleDrag: CGFloat {
        drag >= 0 ? drag : max(drag * 0.25, -24)
    }

    private var header: some View {
        VStack(spacing: 0) {
            Button {
                model.toggleTier()
            } label: {
                Capsule()
                    .fill(theme.borderStrong)
                    .frame(width: 36, height: 4)
                    .padding(.vertical, Spacing.sm)
                    .padding(.horizontal, Spacing.xl)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Collapse details" : "Expand details")

            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textFaint)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                        .frame(width: 32, height: 32)
                        .background(theme.surface, in: .circle)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xs)
        }
    }

    /// Release rules from the Android sheet: a fast flick wins, otherwise the
    /// distance travelled decides. A tap never reads as a drag.
    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in drag = value.translation.height }
            .onEnded { value in
                let travelled = value.translation.height
                let predicted = value.predictedEndTranslation.height
                withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86)) {
                    drag = 0
                    if expanded {
                        if travelled > availableHeight * 0.6 {
                            onClose()
                        } else if travelled > 100 || predicted > 320 {
                            model.tier = .peek
                        }
                    } else if travelled < -40 || predicted < -160 {
                        model.tier = .expanded
                    } else if travelled > 60 || predicted > 220 {
                        onClose()
                    }
                }
            }
    }
}

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
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textMuted)
                    }
                    // Its own button so retrying never also expands the sheet.
                    Button("Try again", action: onRetry)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .buttonStyle(.plain)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .streaming, .done:
                Button(action: onExpand) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        if !insight.text.isEmpty {
                            Text(insight.text)
                                .font(.system(size: 14))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        HStack(spacing: 2) {
                            Text("Study")
                                .font(.system(size: 12, weight: .bold))
                            Image(systemName: "chevron.up")
                                .font(.system(size: 11, weight: .bold))
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
