import SwiftUI

/// A font's unscaled design, resolved once against the app preference and the
/// system's independent Dynamic Type setting. Available on macOS 15 as well.
struct AppFont {
    let textStyle: Font.TextStyle
    private let makeFont: (CGFloat) -> Font

    func resolve(scale: CGFloat) -> Font { makeFont(scale) }

    static func system(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Self {
        Self(textStyle: .body) { .system(size: size * $0, weight: weight, design: design) }
    }

    static func custom(_ name: String, size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Self {
        // ScaledMetric already applies Dynamic Type. fixedSize prevents the
        // custom font initializer applying the same system multiplier again.
        Self(textStyle: style) { .custom(name, fixedSize: size * $0) }
    }

    private static func semantic(_ style: Font.TextStyle, iOS: CGFloat, macOS: CGFloat, weight: Font.Weight = .regular) -> Self {
        #if os(iOS)
        let size = iOS
        #else
        let size = macOS
        #endif
        return Self(textStyle: style) { .system(size: size * $0, weight: weight) }
    }

    static var largeTitle: Self { semantic(.largeTitle, iOS: 34, macOS: 26) }
    static var title: Self { semantic(.title, iOS: 28, macOS: 22) }
    static var title2: Self { semantic(.title2, iOS: 22, macOS: 17) }
    static var title3: Self { semantic(.title3, iOS: 20, macOS: 15) }
    static var headline: Self { semantic(.headline, iOS: 17, macOS: 13, weight: .semibold) }
    static var body: Self { semantic(.body, iOS: 17, macOS: 13) }
    static var callout: Self { semantic(.callout, iOS: 16, macOS: 12) }
    static var subheadline: Self { semantic(.subheadline, iOS: 15, macOS: 11) }
    static var footnote: Self { semantic(.footnote, iOS: 13, macOS: 10) }
    static var caption: Self { semantic(.caption, iOS: 12, macOS: 10) }
    static var caption2: Self { semantic(.caption2, iOS: 11, macOS: 10) }

    func weight(_ weight: Font.Weight) -> Self { map { $0.weight(weight) } }
    func bold() -> Self { weight(.bold) }
    func italic() -> Self { map { $0.italic() } }
    func monospacedDigit() -> Self { map { $0.monospacedDigit() } }
    func monospaced() -> Self { map { $0.monospaced() } }
    private func map(_ transform: @escaping (Font) -> Font) -> Self {
        Self(textStyle: textStyle) { transform(makeFont($0)) }
    }
}

private struct AppFontModifier: ViewModifier {
    @Environment(\.textScaleFactor) private var appScale
    @ScaledMetric private var systemScale: CGFloat = 1
    let font: AppFont

    init(font: AppFont) {
        self.font = font
        _systemScale = ScaledMetric(wrappedValue: 1, relativeTo: font.textStyle)
    }

    func body(content: Content) -> some View {
        content.font(font.resolve(scale: appScale * systemScale))
    }
}

extension View {
    func appFont(_ font: AppFont) -> some View { modifier(AppFontModifier(font: font)) }
}

extension Text {
    /// Text concatenation needs Text rather than a wrapped View. Callers pass
    /// their observed app factor times ScaledMetric, preserving inline runs.
    func appFont(_ font: AppFont, scale: CGFloat) -> Text { self.font(font.resolve(scale: scale)) }
}

// Symbols in fixed control hit targets are glyphs, not reading text. Keeping
// their design size prevents them overflowing 24/32/44pt buttons at AX sizes.
extension Image {
    func appFont(_ font: AppFont) -> some View { self.font(font.resolve(scale: 1)) }
}
