import SwiftUI

/// A study's or a section's artwork at Android's 3:2, with a quiet placeholder
/// while it loads and nothing at all if it fails.
struct SermonArtwork: View {
    @Environment(\.theme) private var theme
    let url: URL

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                Color.clear
            default:
                theme.surfaceStrong
            }
        }
        .aspectRatio(3 / 2, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(.rect(cornerRadius: Radius.lg))
        .accessibilityHidden(true)
    }
}
