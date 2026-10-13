import SwiftUI

struct ChatWelcomeState: View {
    let questions: [SuggestedQuestionItem]
    var isLoading: Bool
    var onSelect: (String) -> Void
    // CHOSEN FROM YOUR STUDY is rendered by the shared native content.
    var body: some View {
        ChatWelcomeContent(headline: "Come hungry for the Word.", questions: questions, isLoading: isLoading, onSelect: onSelect)
    }
}
