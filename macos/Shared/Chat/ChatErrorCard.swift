import SwiftUI

/// Port of `mobile/src/features/chat/ErrorCard.tsx`, shared by both chats:
/// the error's title, its message, a "ref:" code a screenshot identifies it
/// by, Retry only when retrying can help, and an optional "See SureWord Pro".
/// Full width; the Mac caps it where it is placed.
struct ChatErrorCard: View {
    @Environment(\.theme) private var theme
    var title: String?
    let message: String
    /// Shown muted as "ref: <code>" so a screenshot identifies the failure.
    var code: String?
    var actionTitle: String = "Retry"
    /// Nil hides the button - Android offers none when retrying cannot help.
    var action: (() -> Void)?
    /// "See SureWord Pro", for a Free reader's used-up allowance. Nil hides it.
    var onSeePro: (() -> Void)? = nil

    init(
        title: String? = nil,
        message: String,
        code: String? = nil,
        actionTitle: String = "Retry",
        action: (() -> Void)?
    ) {
        self.title = title
        self.message = message
        self.code = code
        self.actionTitle = actionTitle
        self.action = action
    }

    /// A classified chat error: its title, message and code, and the action
    /// only when the error says retrying can help (`onRetry={error.retryable ?
    /// retrySend : undefined}` on Android).
    init(
        error: ClassifiedChatError,
        actionTitle: String,
        alwaysRetry: Bool = false,
        onSeePro: (() -> Void)? = nil,
        action: @escaping () -> Void
    ) {
        self.init(
            title: error.title,
            message: error.message,
            code: error.code.rawValue,
            actionTitle: actionTitle,
            action: (error.retryable || alwaysRetry) ? action : nil
        )
        self.onSeePro = onSeePro
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let title {
                Text(title)
                    .appFont(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(message)
                .appFont(.system(size: 13))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let code {
                Text("ref: \(code)")
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
            }
            if let action {
                Button(actionTitle, action: action)
                    .buttonStyle(AccentButtonStyle())
            }
            if let onSeePro {
                Button("See SureWord Pro", action: onSeePro)
                    .buttonStyle(.bordered)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.dangerBorder, lineWidth: 1)
        }
    }
}

/// Whether a used-up allowance's card offers "See SureWord Pro". Android's
/// `usePlayUpgrade`: only when the store on this device can actually sell Pro,
/// read from `/api/billing/status` on demand. On iOS that means App Store
/// checkout answers `.purchasable`; an account that is already Pro elsewhere,
/// or a server that cannot verify a StoreKit purchase, gets no button, since
/// no button beats one that leads nowhere.
enum ChatProOffer {
    static func canOffer(upgrade: Bool, membership: MembershipResponse?) -> Bool {
        upgrade && ProUpgradeOffer.canOffer(membership, platform: .iOS)
    }
}
