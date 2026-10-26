import SwiftUI

/// App-wide text size (Settings, and the first card of Walk with me). Mirrors
/// `TEXT_SCALES` in `src/lib/preferences-contract.ts`, `TEXT_SCALE_FACTORS`
/// in `src/lib/onboarding-rules.ts` and `src/lib/text-scale.ts`.
///
/// Apple applies a size two ways at once. The app root steps Dynamic Type up
/// from whatever the system is set to (never instead of it), which reaches
/// every text style font and the system controls. Most of SureWord's text is
/// set in fixed point sizes, which Dynamic Type does not touch, so the screens
/// people read most (chat answers, the Walk with me cards, the Bible reader)
/// also multiply their sizes by `factor` through `\.textScaleFactor`.
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

    /// Dynamic Type steps added on top of the system's size: Large is two
    /// steps (about 15% at the default size), Largest four (about 30%).
    var dynamicTypeSteps: Int {
        switch self {
        case .standard: 0
        case .large: 2
        case .largest: 4
        }
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

    /// The system's own size, stepped up by this scale and clamped to the
    /// largest size Dynamic Type has.
    func dynamicTypeSize(over system: DynamicTypeSize) -> DynamicTypeSize {
        let sizes = DynamicTypeSize.allCases
        guard let index = sizes.firstIndex(of: system) else { return system }
        return sizes[min(index + dynamicTypeSteps, sizes.count - 1)]
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
    @Environment(\.dynamicTypeSize) private var systemSize
    let scale: TextScale

    func body(content: Content) -> some View {
        content
            .dynamicTypeSize(scale.dynamicTypeSize(over: systemSize))
            .environment(\.textScaleFactor, scale.factor)
    }
}

extension View {
    /// Apply the account's text size to everything below: Dynamic Type for
    /// text styles and system controls, and the factor for fixed sizes.
    func textScaled(_ scale: TextScale) -> some View {
        modifier(TextScaleRoot(scale: scale))
    }
}
