import SwiftUI

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// One swatch in the highlight palette.
struct HighlightPreset: Equatable, Sendable, Identifiable {
    let name: String
    /// "#RRGGBB" — the exact string sent to and stored by `/api/highlights`.
    let hex: String

    var id: String { hex }
}

/// The YouVersion-style verse-highlight palette. The order and the hex values
/// are shared with the web and Android clients, so a highlight made anywhere
/// renders the same colour everywhere — do not reorder or retune.
enum HighlightColors {
    static let presets: [HighlightPreset] = [
        HighlightPreset(name: "Yellow", hex: "#F5D76E"),
        HighlightPreset(name: "Orange", hex: "#F5A623"),
        HighlightPreset(name: "Red", hex: "#E84C3D"),
        HighlightPreset(name: "Pink", hex: "#E87EA1"),
        HighlightPreset(name: "Purple", hex: "#9B59B6"),
        HighlightPreset(name: "Blue", hex: "#4A90D9"),
        HighlightPreset(name: "Teal", hex: "#1ABC9C"),
        HighlightPreset(name: "Green", hex: "#27AE60")
    ]

    /// The translucent wash a highlighted verse row is painted with — full
    /// strength would drown the text, so the row gets the colour at 25%.
    static func wash(_ hex: String) -> Color {
        (Color(hex: hex) ?? .clear).opacity(0.25)
    }

    /// Best-effort sRGB "#RRGGBB" for a SwiftUI `Color`, used to turn a
    /// `ColorPicker` selection back into the string the API stores.
    static func hexString(from color: Color) -> String? {
        #if canImport(AppKit)
        guard let nsColor = NSColor(color).usingColorSpace(.sRGB) else { return nil }
        return String(
            format: "#%02X%02X%02X",
            Int((nsColor.redComponent * 255).rounded()),
            Int((nsColor.greenComponent * 255).rounded()),
            Int((nsColor.blueComponent * 255).rounded())
        )
        #elseif canImport(UIKit)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return nil
        }
        return String(
            format: "#%02X%02X%02X",
            Int((red * 255).rounded()),
            Int((green * 255).rounded()),
            Int((blue * 255).rounded())
        )
        #else
        return nil
        #endif
    }
}

extension Color {
    /// "#RRGGBB" (the leading `#` optional) → sRGB colour; nil on anything
    /// else. Complements the `UInt32` init in `Theme.swift`, which the design
    /// system's compile-time constants use.
    init?(hex: String) {
        var string = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if string.hasPrefix("#") { string.removeFirst() }
        guard string.count == 6, let value = UInt32(string, radix: 16) else { return nil }
        self.init(hex: value)
    }
}
