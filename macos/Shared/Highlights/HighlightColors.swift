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

    /// The key the account preferences document uses for this colour:
    /// "Yellow" becomes "yellow". Matches `HIGHLIGHT_COLOR_IDS` in
    /// `src/lib/preferences-contract.ts`.
    ///
    /// Deliberately not `id`: that is `Identifiable`'s, it is the hex, and the
    /// hex is what `/api/highlights` stores. Two different keys for two
    /// different jobs beats one that silently changes meaning.
    var colorId: String { name.lowercased() }
}

/// One colour of the starter set Settings offers with a single tap.
///
/// Mirrored verbatim from `HIGHLIGHT_LABEL_PRESETS` in
/// `src/lib/preferences-contract.ts`, which a server test greps this file for:
/// every client has to offer the same eight names and the same reasons, or the
/// same account reads differently depending on which one filled it in.
struct HighlightLabelPreset: Equatable, Sendable, Identifiable {
    /// The colour id, as the preferences document keys it: "yellow".
    let id: String
    let label: String
    let meaning: String
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

    // MARK: - Labels and meanings

    /// A label is one word the reader shows on a chip, so it stays short.
    /// `MAX_HIGHLIGHT_LABEL_LENGTH` in `src/lib/preferences-contract.ts`.
    static let maxLabelLength = 24

    /// A meaning is a sentence the assistant reads, so it has more room.
    /// `MAX_HIGHLIGHT_MEANING_LENGTH` in the same file.
    static let maxMeaningLength = 120

    /// The starter set behind "Use suggested labels".
    ///
    /// Named `labelPresets` rather than `presets` only because the palette
    /// above already owns that name; the order is the palette's, and the
    /// server test pins it.
    static let labelPresets: [HighlightLabelPreset] = [
        HighlightLabelPreset(
            id: "yellow",
            label: "Favorite",
            meaning: "Verses I love and want to find again"
        ),
        HighlightLabelPreset(
            id: "orange",
            label: "Command",
            meaning: "An instruction to obey"
        ),
        HighlightLabelPreset(
            id: "red",
            label: "Warning",
            meaning: "Sin, judgment, take heed"
        ),
        HighlightLabelPreset(
            id: "pink",
            label: "Love",
            meaning: "God's love and the Gospel"
        ),
        HighlightLabelPreset(
            id: "purple",
            label: "Prophecy",
            meaning: "Messianic and fulfilled prophecy"
        ),
        HighlightLabelPreset(
            id: "blue",
            label: "Promise",
            meaning: "Something God said He will do; verses I lean on"
        ),
        HighlightLabelPreset(
            id: "teal",
            label: "Question",
            meaning: "Verses I don't understand yet and want to study"
        ),
        HighlightLabelPreset(
            id: "green",
            label: "Wisdom",
            meaning: "Counsel for living"
        )
    ]

    /// The eight ids `PATCH /api/preferences` accepts. Anything else in a
    /// colour map is refused with a 400, so it is dropped before a save.
    static var labelIds: [String] { presets.map(\.colorId) }

    /// The preset a stored hex belongs to, nil for a custom colour picked out
    /// of the system colour well. Case-insensitive, like every other hex
    /// comparison in the reader.
    static func preset(forHex hex: String) -> HighlightPreset? {
        presets.first { $0.hex.caseInsensitiveCompare(hex) == .orderedSame }
    }

    /// What the user calls a colour, or nil when they have never named it.
    ///
    /// Nil rather than the hue name on purpose: the reader says a verse is
    /// marked as something only for a colour the user actually named, and
    /// telling them a blue highlight is blue would be noise.
    static func label(forHex hex: String, in labels: [String: String]) -> String? {
        guard let preset = preset(forHex: hex) else { return nil }
        let label = labels[preset.colorId]?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let label, !label.isEmpty else { return nil }
        return label
    }

    /// What to call a colour on screen: the user's label when there is one, the
    /// hue name otherwise. For swatch help text and accessibility labels, where
    /// something always has to be said.
    static func displayName(_ preset: HighlightPreset, in labels: [String: String]) -> String {
        let label = labels[preset.colorId]?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let label, !label.isEmpty else { return preset.name }
        return label
    }

    /// The map to send for a whole-map replacement: `base` with only the
    /// touched colours changed.
    ///
    /// Both colour maps are stored whole, so a PATCH has to carry every entry
    /// to keep. `edits` holds only the colours the user touched and an empty
    /// string clears one, which is how a colour goes back to its hue name.
    /// Entries outside the eight ids are dropped rather than carried: the
    /// server refuses them, and one unusable key would block every later save.
    static func merged(
        _ base: [String: String],
        edits: [String: String],
        maxLength: Int
    ) -> [String: String] {
        var result: [String: String] = [:]
        for id in labelIds {
            let raw = edits[id] ?? base[id]
            guard let raw else { continue }
            let value = String(
                raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLength)
            )
            if !value.isEmpty { result[id] = value }
        }
        return result
    }

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
