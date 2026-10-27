import SwiftUI

struct TextSizeControls: View {
    @Environment(SettingsStore.self) private var settings
    var showPreview = true

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("\(settings.textScale.label) · \(Int((settings.textScale.factor * 100).rounded()))%")
                .appFont(.body.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityValue(settings.textScale.label)
                .accessibilityIdentifier("text-size-value")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.md) { adjustmentButtons; resetButton }
                    .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    adjustmentButtons
                    resetButton
                }
            }
            if showPreview {
                Text("Thy word is a lamp unto my feet, and a light unto my path.")
                    .appFont(.custom(FontFamily.verse, size: 20))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("text-size-preview")
                Text("Psalm 119:105 · KJV")
                    .appFont(.caption)
                    .foregroundStyle(.secondary)
                Text("Applies throughout SureWord. Your device's accessibility text size still applies.")
                    .appFont(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var adjustmentButtons: some View {
        HStack(spacing: Spacing.md) {
            Button { settings.textScale = settings.textScale.stepped(-1) } label: {
                Text("A−")
                    .fixedSize(horizontal: true, vertical: true)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
                .disabled(!settings.textScale.canDecrease)
                .accessibilityLabel("Decrease text size")
                .accessibilityIdentifier("text-size-decrease")
            Button { settings.textScale = settings.textScale.stepped(1) } label: {
                Text("A+")
                    .fixedSize(horizontal: true, vertical: true)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
                .disabled(!settings.textScale.canIncrease)
                .accessibilityLabel("Increase text size")
                .accessibilityIdentifier("text-size-increase")
        }
        .buttonStyle(.bordered)
        .appFont(.body)
    }

    private var resetButton: some View {
        Button { settings.textScale = .standard } label: {
            Text("Reset")
                .fixedSize(horizontal: true, vertical: true)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
            .disabled(settings.textScale == .standard)
            .accessibilityLabel("Reset text size to Standard")
            .accessibilityIdentifier("text-size-reset")
    }
}

struct TextSizeQuickButton: View {
    @State private var presented = false

    var body: some View {
        Button { presented = true } label: {
            Image(systemName: "textformat.size")
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
            .accessibilityLabel("Text size")
            .accessibilityIdentifier("text-size-quick-access")
            .popover(isPresented: $presented) {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        Text("Text size").appFont(.headline)
                        TextSizeControls()
                    }
                    .padding(Spacing.lg)
                }
                .frame(idealWidth: 340, maxHeight: 440)
                #if os(iOS)
                .presentationCompactAdaptation(.popover)
                #endif
            }
    }
}
