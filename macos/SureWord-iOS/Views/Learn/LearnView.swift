import SwiftUI

/// Learn a verse on iOS - pushed on the Bible stack from the Bible home's
/// "Learn a verse" card, the reader's Added chip and a chat "Learning ..."
/// receipt, as Android pushes `/bible/learn`. The screen itself is the shared
/// `LearnSessionView`; this adds the navigation title and the count of
/// verses already known.
struct LearnView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    private var model: LearnModel { app.learn }

    var body: some View {
        LearnSessionView()
            .background { MeshBackground() }
            .navigationTitle("Learn a verse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let today = model.today {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text("\(today.knownCount) verses you know")
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textMuted)
                            .fixedSize()
                    }
                }
            }
    }
}
