import SwiftUI

/// Learn a verse on the Mac: today's queue at each card's masking stage, the
/// two review buttons that schedule the next review, and "Suggested for you".
///
/// Android pushes a whole screen for this (`mobile/app/(app)/bible/learn.tsx`)
/// and iOS pushes `LearnView`. Here it is a pane of the Bible section, like the
/// reading plan, so the book list stays where it was. The screen itself is the
/// shared `LearnSessionView`; this pane only adds the header, with the way
/// back and the count of verses already known.
struct LearnPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    /// Where the back button returns: the books, or Today when Today's
    /// "Learn a verse" opened it, as Android's back title follows the stack.
    var backTitle = "Bible"
    let onDismiss: () -> Void

    private var model: LearnModel { app.learn }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(theme.border)
            LearnSessionView()
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onDismiss) {
                Label(backTitle, systemImage: "chevron.left")
                    .appFont(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help(backTitle == "Bible" ? "Back to the books" : "Back to \(backTitle)")

            Text("Learn a verse")
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            Spacer(minLength: Spacing.md)

            if let today = model.today {
                Text("\(today.knownCount) verses you know")
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize()
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }
}
