import SwiftUI

/// One chip on the verse sheet's action bar.
struct VerseSheetAction: Identifiable {
    let id: String
    let systemImage: String
    let label: String
    var disabled = false
    /// Draws the icon and label in the accent.
    var active = false
    /// Set for Share, which is a `ShareLink` rather than a button.
    var shareText: String?
    let action: () -> Void
}

/// The dots and chips pinned to the bottom of the verse sheet in both tiers.
/// Port of `verse-sheet/VerseActionBar.tsx`: re-tapping the colour already on
/// the selection removes it, and on a range that is highlighted but not in one
/// colour the last dot becomes the way to clear them.
struct VerseActionBarView: View {
    @Environment(\.theme) private var theme

    /// Highlight colour shared by the whole selection, or nil.
    let color: String?
    /// Some verse in the selection carries a highlight.
    let canRemove: Bool
    let labelForPreset: (HighlightPreset) -> String
    let onHighlight: (String) -> Void
    let onRemoveHighlight: () -> Void
    let onCustomColor: () -> Void
    let actions: [VerseSheetAction]
    var message: VerseSheetModel.Message?

    private static let dotSize: CGFloat = 30
    /// Dark enough to read on every preset, which are all mid-tone or lighter.
    private static let dotGlyph = Color.black.opacity(0.65)

    private var current: String? {
        guard let color else { return nil }
        let trimmed = color.trimmingCharacters(in: .whitespaces).lowercased()
        return trimmed.isEmpty ? nil : trimmed
    }

    private var customActive: Bool {
        guard let current else { return false }
        return !HighlightColors.presets.contains { $0.hex.lowercased() == current }
    }

    private var mixedRemove: Bool { current == nil && canRemove }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(HighlightColors.presets) { preset in
                        presetDot(preset)
                    }
                    customDot
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, 2)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(actions) { action in
                        chip(action)
                    }
                }
                .padding(.horizontal, Spacing.lg)
            }

            if let message {
                Text(message.text)
                    .font(.system(size: 12))
                    .foregroundStyle(message.tone == .danger ? theme.danger : theme.textMuted)
                    .padding(.horizontal, Spacing.lg)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .sensoryFeedback(.selection, trigger: color)
    }

    private func presetDot(_ preset: HighlightPreset) -> some View {
        let selected = current == preset.hex.lowercased()
        let label = labelForPreset(preset)
        return Button {
            selected ? onRemoveHighlight() : onHighlight(preset.hex)
        } label: {
            Circle()
                .fill(Color(hex: preset.hex) ?? .clear)
                .frame(width: Self.dotSize, height: Self.dotSize)
                .overlay {
                    if selected {
                        Circle().strokeBorder(theme.text, lineWidth: 2)
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Self.dotGlyph)
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(selected ? "Remove \(label) highlight" : "Highlight \(label)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var customDot: some View {
        Button {
            customActive || mixedRemove ? onRemoveHighlight() : onCustomColor()
        } label: {
            ZStack {
                if customActive, let color, let fill = Color(hex: color) {
                    Circle().fill(fill)
                } else {
                    Circle().fill(theme.surface)
                    Circle().strokeBorder(theme.borderStrong, lineWidth: 0.5)
                }
                if customActive || mixedRemove {
                    Circle().strokeBorder(theme.text, lineWidth: 2)
                }
                Image(systemName: customActive || mixedRemove ? "xmark" : "plus")
                    .font(.system(size: customActive || mixedRemove ? 12 : 14, weight: .bold))
                    .foregroundStyle(customActive ? Self.dotGlyph : theme.textMuted)
            }
            .frame(width: Self.dotSize, height: Self.dotSize)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            customActive ? "Remove custom highlight"
                : mixedRemove ? "Remove highlights" : "Custom highlight color"
        )
    }

    @ViewBuilder
    private func chip(_ action: VerseSheetAction) -> some View {
        let tint = action.active ? theme.accent : theme.text
        let label = VStack(spacing: 4) {
            Image(systemName: action.systemImage)
                .font(.system(size: 20))
                .foregroundStyle(tint)
                .frame(height: 24)
            Text(action.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(action.active ? theme.accent : theme.textMuted)
                .lineLimit(1)
        }
        .frame(minWidth: 64, minHeight: 56)
        .padding(.horizontal, Spacing.xs)
        .contentShape(.rect(cornerRadius: Radius.md))

        if let shareText = action.shareText {
            ShareLink(item: shareText) { label }
                .buttonStyle(.plain)
                .accessibilityLabel(action.label)
        } else {
            Button(action: action.action) { label }
                .buttonStyle(.plain)
                .disabled(action.disabled)
                .opacity(action.disabled ? 0.4 : 1)
                .accessibilityLabel(action.label)
                .accessibilityAddTraits(action.active ? .isSelected : [])
        }
    }
}

/// Custom highlight colour. Android opens a colour-wheel modal over the sheet;
/// iOS uses the system colour well, applied with an explicit button so
/// dragging through the wheel does not write a highlight per frame.
struct CustomHighlightSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State var color: Color
    let onApply: (String) -> Void

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Text("Custom color")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            ColorPicker("Color", selection: $color, supportsOpacity: false)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
            Circle()
                .fill(color)
                .frame(width: 56, height: 56)
                .accessibilityHidden(true)
            Button("Apply") {
                if let hex = HighlightColors.hexString(from: color) { onApply(hex) }
                dismiss()
            }
            .buttonStyle(AccentButtonStyle())
        }
        .padding(Spacing.xl)
        .presentationDetents([.height(300)])
        .presentationDragIndicator(.visible)
    }
}
