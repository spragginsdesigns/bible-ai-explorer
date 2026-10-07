import SwiftUI

/// Where the verse sheet's "Added" chip goes - Android pushes
/// `/(app)/bible/learn`. The add itself (`POST /api/learn`) is live in the
/// sheet; this destination is the hook point for the Learn screens (PRD C8),
/// which replace this body with the real queue. Until then it says where the
/// verses went rather than pretending.
struct LearnEntryPoint: View {
    var body: some View {
        TabPlaceholder(
            symbol: "graduationcap",
            title: "Learn a verse",
            detail: "Your verses are saved to Learn. Practice opens here in a later update; they are already on your other devices."
        )
        .navigationTitle("Learn")
        .navigationBarTitleDisplayMode(.inline)
    }
}
