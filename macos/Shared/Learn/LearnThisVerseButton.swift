import SwiftUI

/// "Learn this verse" - the Apple port of
/// `mobile/src/features/learn/AddLearnButton.tsx`, for any screen that shows a
/// single verse (the reader's verse sheet, a highlight, a suggestion row).
///
/// Idle → "Adding..." → "Added to Learn." with an Open Learn button when the
/// host passes `onOpenLearn`; a failure keeps the button and shows Android's
/// error line. Hidden entirely when nobody is signed in.
struct LearnThisVerseButton: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    let book: Int
    let chapter: Int
    let verse: Int
    /// "KJV", "NKJV" or "BSB" - the translation the card should be kept in.
    let translation: String
    let source: LearnAPI.Source
    /// Overrides the spoken label where the surrounding text does not name the verse.
    var accessibilityName: String?
    var onAdded: (() -> Void)?
    var onOpenLearn: (() -> Void)?

    private enum Status { case idle, saving, saved, error }
    @State private var status: Status = .idle

    var body: some View {
        if app.learn.account != nil {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                if status == .saved {
                    Text("Added to Learn.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textMuted)
                    if let onOpenLearn {
                        actionButton("Open Learn", action: onOpenLearn)
                    }
                } else {
                    actionButton(status == .saving ? "Adding..." : "Learn this verse") {
                        Task { await add() }
                    }
                    .disabled(status == .saving)
                    .opacity(status == .saving ? 0.5 : 1)
                    .accessibilityLabel(accessibilityName ?? (status == .saving ? "Adding..." : "Learn this verse"))
                }
                if status == .error {
                    Text("Could not add this verse. Check your connection and try again.")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.danger)
                }
            }
            .padding(.vertical, Spacing.xs)
        }
    }

    private func actionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(maxWidth: .infinity, minHeight: 44)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(theme.accentBorder, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
    }

    private func add() async {
        guard status != .saving, status != .saved else { return }
        status = .saving
        do {
            try await app.learn.add(book: book, chapter: chapter, verse: verse, translation: translation, source: source)
            status = .saved
            onAdded?()
        } catch {
            status = .error
        }
    }
}
