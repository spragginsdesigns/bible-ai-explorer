import SwiftUI

/// SureWord design tokens — a direct port of `mobile/src/theme/index.ts`, which
/// itself was ported from the web app's `globals.css`. Values are copied verbatim
/// so all three clients render the same monochrome-glass look with the amber
/// accent; changing a colour here without changing it there breaks that.
///
/// Views must never read `SureWordColors.dark` / `.light` directly — read
/// `@Environment(\.theme)`, which resolves the user's appearance setting.
struct SureWordColors: Sendable {
    // Backgrounds (web: linear-gradient #000 → #050505 → #080808)
    let bg: Color
    let bgMid: Color
    let bgEnd: Color
    let bgElevated: Color

    // Glass surfaces
    let glass: Color
    let glassLight: Color
    let surface: Color
    let surfaceStrong: Color
    let surfacePressed: Color
    let border: Color
    let borderStrong: Color

    // Text
    let text: Color
    let textSecondary: Color
    let textMuted: Color
    let textFaint: Color
    let textGhost: Color

    // Accent (amber)
    let accent: Color
    let accentSoft: Color
    let accentBorder: Color
    let accentPressed: Color
    let accentDim: Color

    // Semantic
    let danger: Color
    let dangerSoft: Color
    let dangerBorder: Color

    // Bible reader parchment page surface. These are ink tones read against the
    // photoreal sheet in `Assets.xcassets/Parchment{Light,Dark}`, NOT against
    // the app shell - which is why they are a separate set from `text` and
    // `accent` rather than an opacity of them. Values copied verbatim from
    // `mobile/src/theme/index.ts` and `.parchment-page` in `globals.css`.
    let parchmentInk: Color
    let parchmentNumber: Color
    let parchmentHighlight: Color

    /// Which palette this is. Views read `\.theme`, never `\.colorScheme`, so
    /// anything picking an *asset* per appearance - the reader's parchment
    /// plates - needs the answer from the same place the colours came from.
    /// Reading `\.colorScheme` instead would be a second source of truth, and
    /// the two disagree for a beat whenever the setting changes.
    let isDark: Bool
}

extension SureWordColors {
    static let dark = SureWordColors(
        bg: Color(hex: 0x000000),
        bgMid: Color(hex: 0x050505),
        bgEnd: Color(hex: 0x080808),
        bgElevated: Color(hex: 0x0E0E0E),

        glass: Color(hex: 0x080808, opacity: 0.70),
        glassLight: Color(hex: 0x0E0E0E, opacity: 0.55),
        surface: Color(white: 1, opacity: 0.04),
        surfaceStrong: Color(white: 1, opacity: 0.06),
        surfacePressed: Color(white: 1, opacity: 0.10),
        border: Color(white: 1, opacity: 0.06),
        borderStrong: Color(white: 1, opacity: 0.08),

        text: Color(hex: 0xE5E5E5),
        textSecondary: Color(hex: 0xD4D4D4),
        textMuted: Color(hex: 0xA3A3A3),
        textFaint: Color(hex: 0x737373),
        textGhost: Color(hex: 0x525252),

        accent: Color(hex: 0xFBBF24),
        accentSoft: Color(hex: 0xFBBF24, opacity: 0.10),
        accentBorder: Color(hex: 0xFBBF24, opacity: 0.20),
        accentPressed: Color(hex: 0xFBBF24, opacity: 0.15),
        accentDim: Color(hex: 0xFBBF24, opacity: 0.70),

        danger: Color(hex: 0xF87171),
        dangerSoft: Color(hex: 0xF87171, opacity: 0.10),
        dangerBorder: Color(hex: 0xF87171, opacity: 0.20),

        // Ink on the dark leather-toned sheet (parchment-dark).
        parchmentInk: Color(hex: 0xE6D7AE),
        parchmentNumber: Color(hex: 0xFBBF24, opacity: 0.80),
        parchmentHighlight: Color(hex: 0xFBBF24, opacity: 0.16),

        isDark: true
    )

    static let light = SureWordColors(
        bg: Color(hex: 0xFAFAFA),
        bgMid: Color(hex: 0xF5F5F5),
        bgEnd: Color(hex: 0xECECEC),
        bgElevated: Color(hex: 0xFFFFFF),

        glass: Color(white: 1, opacity: 0.75),
        glassLight: Color(white: 1, opacity: 0.60),
        surface: Color(white: 0, opacity: 0.04),
        surfaceStrong: Color(white: 0, opacity: 0.06),
        surfacePressed: Color(white: 0, opacity: 0.10),
        border: Color(white: 0, opacity: 0.08),
        borderStrong: Color(white: 0, opacity: 0.12),

        text: Color(hex: 0x171717),
        textSecondary: Color(hex: 0x262626),
        textMuted: Color(hex: 0x525252),
        textFaint: Color(hex: 0x737373),
        textGhost: Color(hex: 0xA3A3A3),

        // Web light mode uses amber-600 for contrast against a light ground.
        accent: Color(hex: 0xD97706),
        accentSoft: Color(hex: 0xD97706, opacity: 0.10),
        accentBorder: Color(hex: 0xD97706, opacity: 0.25),
        accentPressed: Color(hex: 0xD97706, opacity: 0.16),
        accentDim: Color(hex: 0xD97706, opacity: 0.75),

        danger: Color(hex: 0xDC2626),
        dangerSoft: Color(hex: 0xDC2626, opacity: 0.08),
        dangerBorder: Color(hex: 0xDC2626, opacity: 0.20),

        // Dark sepia on the aged sheet (parchment-light).
        parchmentInk: Color(hex: 0x38270E),
        parchmentNumber: Color(hex: 0x7C4A11),
        parchmentHighlight: Color(hex: 0x78480A, opacity: 0.16),

        isDark: false
    )

    /// Vertical gradient stops standing in for the web's radial mesh.
    var meshStops: [Color] { [bg, bgMid, bgEnd] }
}

// MARK: - Metrics

enum Radius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let full: CGFloat = 999
}

enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

enum FontFamily {
    /// Pirata One — the SureWord brand title only.
    static let brand = "PirataOne-Regular"
    /// Cormorant Garamond — quoted Scripture.
    static let verse = "CormorantGaramond-Medium"
    static let verseItalic = "CormorantGaramond-MediumItalic"
}

// MARK: - Appearance

/// Mirrors the Android setting (`mobile/src/features/settings/settingsStore.ts`).
enum AppearanceSetting: String, CaseIterable, Sendable {
    case system, dark, light

    var label: String {
        switch self {
        case .system: "System"
        case .dark: "Dark"
        case .light: "Light"
        }
    }

    /// SwiftUI colour scheme override; `nil` means follow the system.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }
}

// MARK: - Environment

private struct ThemeKey: EnvironmentKey {
    static let defaultValue = SureWordColors.dark
}

extension EnvironmentValues {
    var theme: SureWordColors {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

extension View {
    /// Resolve and inject the palette for a colour scheme.
    func sureWordTheme(for scheme: ColorScheme) -> some View {
        environment(\.theme, scheme == .dark ? .dark : .light)
    }
}

// MARK: - AI guide

enum GuidePhase: String {
    case idle, thinking, answering
    static func resolve(streaming: Bool, content: String) -> Self {
        !streaming ? .idle : content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .thinking : .answering
    }
    var label: String {
        switch self {
        case .idle: "SureWord study companion"
        case .thinking: "SureWord companion reaching upward in prayer while thinking"
        case .answering: "SureWord companion raising its page arms in praise while answering"
        }
    }
}

struct SureWordGuideAvatar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.scenePhase) private var scenePhase
    var size: CGFloat = 40
    var active = false
    var phase: GuidePhase? = nil
    var hero = false
    @State private var lifted = false
    private var pose: GuidePhase { phase ?? (active ? .thinking : .idle) }
    private var shouldAnimate: Bool { (hero || pose != .idle) && !reduceMotion && !voiceOver && scenePhase == .active }
    private var duration: Double { pose == .thinking ? 2.2 : pose == .answering ? 2.6 : 3.2 }
    var body: some View {
        ChatArtwork.image("sureword-companion-\(pose.rawValue)")
            .resizable().scaledToFit()
            .frame(width: size, height: size * 1.2)
            .offset(y: lifted ? (hero ? -3 : -1.2) : 0)
            .rotationEffect(.degrees(lifted ? 1 : -1))
            .animation(shouldAnimate ? .easeInOut(duration: duration).repeatForever(autoreverses: true) : nil, value: lifted)
            .onAppear { lifted = shouldAnimate }
            .onChange(of: shouldAnimate) { _, value in lifted = value }
            .onChange(of: pose) { _, _ in
                lifted = false
                if shouldAnimate { lifted = true }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isImage)
            .accessibilityLabel(pose.label)
            .accessibilityIdentifier("sureword-companion-\(pose.rawValue)")
    }
}

// MARK: - Helpers

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
