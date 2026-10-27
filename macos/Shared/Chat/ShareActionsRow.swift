import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The one-tap answers to a share - "Verify this video" (`/verify`, only when
/// it carries a link), "Check against Scripture" (`/check`) and "Help me reply"
/// (`/reply`) - shown above the composer of the chat a
/// share opened, with any notice about what was left out. Port of
/// `mobile/src/features/share/ShareActions.tsx`, shared by the iOS chat tab and
/// the Mac chat pane.
struct ShareActionsRow: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel
    let notices: [String]

    /// Nothing to act on until there is text, an attached file, or one on its
    /// way - Android's `actionable`.
    private var isActionable: Bool {
        !chat.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !chat.fileAttachments.isEmpty
            || chat.uploadingAttachments
    }

    private var isDisabled: Bool {
        chat.uploadingAttachments || chat.isBusy
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(notices, id: \.self) { notice in
                Text(notice)
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: Spacing.sm) {
                if isActionable {
                    ForEach(ShareAction.actions(for: chat.input)) { action in
                        Button {
                            #if os(iOS)
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            #endif
                            Task { await chat.sendShareAction(action) }
                        } label: {
                            Label(
                                action.label(composerText: chat.input),
                                systemImage: action == .verify ? "play.circle" : action == .check ? "checkmark.shield" : "bubble.left"
                            )
                                .appFont(.system(size: 13, weight: .medium))
                                .lineLimit(1)
                                .foregroundStyle(theme.accent)
                                .padding(.horizontal, Spacing.md)
                                .padding(.vertical, Spacing.sm)
                                .background(theme.accentSoft, in: .capsule)
                                .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
                                .contentShape(.capsule)
                        }
                        .buttonStyle(.plain)
                        .disabled(isDisabled)
                        .opacity(isDisabled ? 0.5 : 1)
                        .accessibilityIdentifier("share-action-\(action.rawValue)")
                    }
                }
                Spacer(minLength: 0)
                Button {
                    chat.shareNotices = nil
                } label: {
                    Image(systemName: "xmark")
                        .appFont(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textFaint)
                        .frame(width: 28, height: 28)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss share actions")
            }
        }
    }
}
