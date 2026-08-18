import SwiftUI

/// Shared placeholder body for the three tab roots while their lanes are
/// unbuilt: brand mark, section symbol and a one-line note over the mesh
/// background. Deleted once Chat, Bible and Notes all ship real screens.
struct TabPlaceholder: View {
    @Environment(\.theme) private var theme

    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        ZStack {
            MeshBackground()
            VStack(spacing: Spacing.md) {
                Image(systemName: symbol)
                    .font(.system(size: 36))
                    .foregroundStyle(theme.accent)
                Text(title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }
            .padding(Spacing.xxl)
        }
    }
}
