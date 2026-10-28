import SwiftUI

/// "See every connection on the map", under the See also list: the five
/// passages there are the strongest few, the Connections map shows them all.
/// Both readers' study views draw it; the host closes the sheet and calls
/// `AppModel.openConnections`. Android's `mapLink` in `chapter.tsx`.
struct ConnectionsMapLink: View {
    @Environment(\.theme) private var theme

    let verse: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: AppSection.connections.symbol)
                    .appFont(.system(size: 14))
                Text("See every connection on the map")
                    .appFont(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(theme.accent)
            .frame(minHeight: 44, alignment: .leading)
            .padding(.horizontal, Spacing.sm)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("See every connection of verse \(verse) on the Connections map")
    }
}
