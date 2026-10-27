import SwiftUI

/// App-wide text size (Settings, and the first card of Walk with me). Mirrors
/// `TEXT_SCALES` in `src/lib/preferences-contract.ts`, `TEXT_SCALE_FACTORS`
/// in `src/lib/onboarding-rules.ts` and `src/lib/text-scale.ts`.
///
/// The app factor and system Dynamic Type are independent. AppTypography
/// resolves each font from its baseline once, with both multipliers.
enum TextScale: String, CaseIterable, Sendable, Identifiable {
    case standard, large, largest

    static let `default`: TextScale = .standard

    var id: String { rawValue }

    /// How much bigger this size draws, on every client.
    var factor: CGFloat {
        switch self {
        case .standard: 1
        case .large: 1.15
        case .largest: 1.3
        }
    }

    /// The chip and picker label, the same words the card offers.
    var label: String {
        switch self {
        case .standard: "Standard"
        case .large: "Large"
        case .largest: "Largest"
        }
    }

    var canDecrease: Bool { self != .standard }
    var canIncrease: Bool { self != .largest }

    func stepped(_ direction: Int) -> Self {
        let index = Self.allCases.firstIndex(of: self) ?? 0
        let delta = direction == 0 ? 0 : direction > 0 ? 1 : -1
        return Self.allCases[min(max(index + delta, 0), Self.allCases.count - 1)]
    }

    /// The scale a text size chip ("Large") stands for, or nil for anything else.
    init?(label: String) {
        guard let match = Self.allCases.first(where: { $0.label == label }) else { return nil }
        self = match
    }

    /// Unknown or missing values read as Standard, as on the server.
    static func normalize(_ raw: String?) -> TextScale {
        raw.flatMap(TextScale.init(rawValue:)) ?? .default
    }

    /// App sizing never replaces or caps the user's accessibility setting.
    func dynamicTypeSize(over system: DynamicTypeSize) -> DynamicTypeSize {
        system
    }
}

private struct TextScaleFactorKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
    /// The account's text size as a multiplier for fixed point sizes. Set
    /// once at the app root (`textScaled()`).
    var textScaleFactor: CGFloat {
        get { self[TextScaleFactorKey.self] }
        set { self[TextScaleFactorKey.self] = newValue }
    }
}

private struct TextScaleRoot: ViewModifier {
    let scale: TextScale

    func body(content: Content) -> some View {
        content
            .appFont(.body)
            .environment(\.textScaleFactor, scale.factor)
    }
}

extension View {
    /// Keep the shared preference reactive, including sheets, without changing
    /// view identity or replacing the system's Dynamic Type setting.
    func textScaled(_ scale: TextScale) -> some View {
        modifier(TextScaleRoot(scale: scale))
    }
}
