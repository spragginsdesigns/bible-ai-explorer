# Bundled brand fonts

Downloaded from Google Fonts (fonts.gstatic.com), both licensed under the
SIL Open Font License 1.1:

| File | Family | Used for |
|---|---|---|
| `PirataOne-Regular.ttf` | Pirata One | The SureWord wordmark only |
| `CormorantGaramond-Medium.ttf` | Cormorant Garamond | Quoted Scripture |
| `CormorantGaramond-MediumItalic.ttf` | Cormorant Garamond | Emphasis inside Scripture |

These mirror the Android app's `@expo-google-fonts/pirata-one` and
`@expo-google-fonts/cormorant-garamond` packages and the web's `next/font`
imports (`src/app/layout.tsx`) — the three clients must stay on the same faces.

Loaded via `ATSApplicationFontsPath` in the macOS Info.plist and `UIAppFonts`
in the iOS one (both in `project.yml`); the `FontFamily` constants in
`DesignSystem/Theme.swift` are these files' PostScript names.
