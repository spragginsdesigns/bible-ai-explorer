import SwiftUI

/// The study view's "See also" tab: the top five related passages for one
/// verse, each opening in the reader. Port of `CrossReferencesSection.tsx` in
/// its `alwaysExpanded` form - the tab already names the section, so there is
/// no collapsible header, and an empty answer says why instead of vanishing.
struct CrossReferencesView: View {
    @Environment(\.theme) private var theme

    let model: CrossReferencesModel
    let reference: String
    let translation: TranslationID
    let onNavigate: (Reference) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            switch model.state {
            case .idle, .loading:
                message("Loading related passages…")
            case .error:
                HStack(spacing: Spacing.md) {
                    message("Related passages could not be loaded.")
                    Button("Try again") {
                        Task { await model.retry(reference: reference, translation: translation) }
                    }
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .buttonStyle(.plain)
                }
            case .ready(let items) where items.isEmpty:
                message("No related passages are listed for this verse.")
            case .ready(let items):
                ForEach(items) { item in
                    row(item)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: "\(translation.rawValue)|\(reference)") {
            await model.load(reference: reference, translation: translation)
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(theme.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ item: CrossReferenceItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let target = item.target {
                Button {
                    onNavigate(target)
                } label: {
                    Text(item.reference)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .frame(minHeight: 32, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(item.reference)")
                .accessibilityAddTraits(.isLink)
            } else {
                Text(item.reference)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.accent)
            }
            if let text = item.text {
                Text(text)
                    .font(.custom(FontFamily.verse, size: 17))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
