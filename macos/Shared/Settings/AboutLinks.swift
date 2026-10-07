import SwiftUI

/// The public pages Settings -> About links to on both Apple clients.
///
/// Deliberately not `/terms`: that page states the Pro price, and iOS must not
/// link out to anything that reads as a way to buy outside the App Store.
enum AboutLinks {
    static let privacyPolicy = URL(string: "https://sureword.app/privacy")!
    static let support = URL(string: "https://sureword.app/support")!

    /// Title and destination, in display order.
    static let all: [(title: String, url: URL)] = [
        ("Privacy Policy", privacyPolicy),
        ("Support", support),
    ]
}

/// The Privacy Policy and Support rows for the About section. Opens in the
/// system browser through SwiftUI `Link`.
struct AboutLinkRows: View {
    var body: some View {
        ForEach(AboutLinks.all, id: \.url) { link in
            Link(destination: link.url) {
                HStack {
                    Text(link.title)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .accessibilityHint("Opens \(link.url.host() ?? "sureword.app") in your browser")
        }
    }
}
