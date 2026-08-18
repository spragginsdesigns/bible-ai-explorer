import ClerkKitUI
import SwiftUI

extension ClerkTheme {
    /// Dress ClerkKitUI's prebuilt `AuthView` in the SureWord palette so the
    /// sign-in sheet doesn't read as a bolted-on third-party screen.
    ///
    /// Only base tokens are set — Clerk derives its border, pressed and
    /// semantic-background tokens from these, so overriding those by hand would
    /// fight the SDK rather than theme it.
    static func sureWord(scheme: ColorScheme) -> ClerkTheme {
        let palette: SureWordColors = scheme == .dark ? .dark : .light
        return ClerkTheme(
            colors: .init(
                primary: palette.accent,
                background: palette.bgElevated,
                input: palette.surface,
                danger: palette.danger,
                foreground: palette.text,
                mutedForeground: palette.textMuted,
                // Amber is a light accent in both schemes, so its foreground is
                // always the dark ground rather than the palette's text colour.
                primaryForeground: SureWordColors.dark.bg,
                inputForeground: palette.text,
                neutral: palette.textMuted,
                ring: palette.accent,
                muted: palette.textFaint,
                secondaryButtonBackground: palette.surface,
                secondaryButtonForeground: palette.textSecondary,
                border: palette.text
            ),
            design: .init(borderRadius: Radius.md)
        )
    }
}
