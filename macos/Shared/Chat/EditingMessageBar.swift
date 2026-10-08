import SwiftUI

/// The bar above the composer while a sent message is being edited
/// (`ChatViewModel.beginEdit`). It says what sending will do, because an edit
/// is destructive: the stored replies after the message are deleted. Shared by
/// the Mac and iOS composers; Android and web show the same sentence.
struct EditingMessageBar: View {
    @Environment(\.theme) private var theme
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "pencil")
                .foregroundStyle(theme.accent)
            Text(ChatViewModel.editingNotice)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Cancel", action: onCancel)
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 32)
                .contentShape(.rect)
                .accessibilityLabel("Cancel editing")
        }
        .font(.system(size: 12))
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.accentBorder, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }
}
