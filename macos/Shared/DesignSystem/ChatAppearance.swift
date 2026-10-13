import SwiftUI

/// Chat-only colors. Bible reader ink and other surfaces retain their own palette.
enum ChatAppearance {
    static func colors(for c: SureWordColors) -> SureWordColors {
        SureWordColors(
            bg: Color(hex: c.isDark ? 0x0d100d : 0xf6f2e9),
            bgMid: Color(hex: c.isDark ? 0x0d100d : 0xf6f2e9),
            bgEnd: Color(hex: c.isDark ? 0x0d100d : 0xf6f2e9),
            bgElevated: Color(hex: c.isDark ? 0x141713 : 0xfaf8f2),
            glass: Color(hex: c.isDark ? 0x141713 : 0xfffdf7),
            glassLight: Color(hex: c.isDark ? 0x1d211b : 0xfffdf7),
            surface: Color(hex: c.isDark ? 0x1b201b : 0xeeeade),
            surfaceStrong: Color(hex: c.isDark ? 0x1d211b : 0xfffdf7),
            surfacePressed: Color(hex: c.isDark ? 0x2b3027 : 0xe3dece),
            border: Color(hex: c.isDark ? 0xe5b664 : 0x79561f, opacity: 0.12),
            borderStrong: Color(hex: c.isDark ? 0xe5b664 : 0x79561f, opacity: 0.2),
            text: Color(hex: c.isDark ? 0xf6eedd : 0x26322c),
            textSecondary: Color(hex: c.isDark ? 0xeee7dc : 0x334239),
            textMuted: Color(hex: c.isDark ? 0xbbb3a7 : 0x5f6658),
            textFaint: Color(hex: c.isDark ? 0xafa79a : 0x626658),
            textGhost: Color(hex: c.isDark ? 0xaaa295 : 0x626658),
            accent: Color(hex: c.isDark ? 0xe5b664 : 0x79561f),
            accentSoft: Color(hex: c.isDark ? 0xe5b664 : 0x79561f, opacity: 0.08),
            accentBorder: Color(hex: c.isDark ? 0xe5b664 : 0x79561f, opacity: 0.28),
            accentPressed: Color(hex: c.isDark ? 0xe5b664 : 0x79561f, opacity: 0.14),
            accentDim: Color(hex: c.isDark ? 0xd5b479 : 0x79561f),
            danger: c.danger,
            dangerSoft: c.dangerSoft,
            dangerBorder: c.dangerBorder,
            parchmentInk: c.parchmentInk,
            parchmentNumber: c.parchmentNumber,
            parchmentHighlight: c.parchmentHighlight,
            isDark: c.isDark
        )
    }
}
