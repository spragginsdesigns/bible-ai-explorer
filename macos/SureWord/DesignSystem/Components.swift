import SwiftUI

/// The app's ground: the vertical mesh gradient every screen sits on.
struct MeshBackground: View {
    @Environment(\.theme) private var theme

    var body: some View {
        LinearGradient(
            colors: theme.meshStops,
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

/// Glass surface with a hairline border — the repeated card shape from the
/// Android client (`mobile/src/components/ui.tsx`).
struct GlassCard<Content: View>: View {
    @Environment(\.theme) private var theme

    var cornerRadius: CGFloat = Radius.lg
    var padding: CGFloat = Spacing.lg
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(theme.glassLight, in: .rect(cornerRadius: cornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
    }
}

/// Amber pill used for primary actions and follow-up chips.
struct AccentButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(isEnabled ? theme.accent : theme.textGhost)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .background(
                configuration.isPressed ? theme.accentPressed : theme.accentSoft,
                in: .rect(cornerRadius: Radius.full)
            )
            .overlay {
                Capsule().strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.capsule)
            .opacity(isEnabled ? 1 : 0.6)
    }
}

/// Quiet, borderless control that only reveals a surface on hover/press —
/// the Mac equivalent of the Android pressable rows.
struct SubtleButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @State private var isHovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(
                configuration.isPressed
                    ? theme.surfacePressed
                    : (isHovering ? theme.surface : .clear),
                in: .rect(cornerRadius: Radius.sm)
            )
            .contentShape(.rect(cornerRadius: Radius.sm))
            .onHover { isHovering = $0 }
    }
}

/// The wordmark, in Pirata One.
struct BrandMark: View {
    @Environment(\.theme) private var theme
    var size: CGFloat = 28

    var body: some View {
        Text("SureWord")
            .font(.custom(FontFamily.brand, size: size))
            .foregroundStyle(theme.accent)
    }
}
