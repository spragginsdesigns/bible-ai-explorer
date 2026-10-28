import AppKit
import ClerkKit
import UserNotifications

/// Posts `AnswerReadyNotification` when an answer lands while SureWord is not
/// the active app. `MainWindow` wires it to `ChatViewModel.onAnswerReady`; a
/// click comes back through the app delegate's `NotificationTapTarget` routing
/// and opens that conversation.
@MainActor
enum AnswerReadyNotifier {
    private static let delivery = AccountNotificationDelivery()

    static func invalidateForAccountChange() {
        delivery.invalidateForAccountChange()
    }

    private static func currentOwner() -> AccountNotificationDelivery.Owner? {
        guard let accountID = Clerk.shared.user?.id, let sessionID = Clerk.shared.session?.id else { return nil }
        return .init(accountID: accountID, sessionID: sessionID)
    }

    static func answerLanded(conversationID: String, title: String?, chatReplies: Bool, recovered: Bool = false, accountID: String?) {
        // The server pushes recovered answers after a disconnected stream.
        // A live background stream still needs this local notice.
        guard !(recovered && MacPushRegistration.isRemoteLive) else { return }
        guard let ticket = delivery.ticket(
            accountID: accountID,
            baseIdentifier: AnswerReadyNotification.identifier(conversationID: conversationID),
            currentOwner: currentOwner
        ) else { return }
        // Read now, while the answer is landing, not after the permission
        // check below has awaited.
        let inBackground = !NSApplication.shared.isActive
        Task {
            // Never prompts: the dialog opens only at the moments
            // `NotificationPermissionCoordinator` handles, never for an
            // answer arriving unseen.
            await delivery.deliver(
                ticket,
                currentOwner: currentOwner,
                authorized: { await DailyCrossNotifications.isAuthorized() },
                eligible: { authorized in
                    AnswerReadyNotification.shouldNotify(
                        conversationID: conversationID,
                        inBackground: inBackground,
                        authorized: authorized,
                        chatReplies: chatReplies
                    )
                },
                add: { identifier in
                    let content = UNMutableNotificationContent()
                    content.title = AnswerReadyNotification.title
                    content.body = AnswerReadyNotification.body(conversationTitle: title)
                    content.sound = .default
                    content.userInfo = AnswerReadyNotification.userInfo(conversationID: conversationID)
                    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
                    try await UNUserNotificationCenter.current().add(request)
                },
                remove: { identifier in
                    let center = UNUserNotificationCenter.current()
                    center.removePendingNotificationRequests(withIdentifiers: [identifier])
                    center.removeDeliveredNotifications(withIdentifiers: [identifier])
                }
            )
        }
    }
}
