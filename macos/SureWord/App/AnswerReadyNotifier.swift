import AppKit
import UserNotifications

/// Posts `AnswerReadyNotification` when an answer lands while SureWord is not
/// the active app. `MainWindow` wires it to `ChatViewModel.onAnswerReady`; a
/// click comes back through the app delegate's `NotificationTapTarget` routing
/// and opens that conversation.
@MainActor
enum AnswerReadyNotifier {
    static func answerLanded(conversationID: String, title: String?, chatReplies: Bool, recovered: Bool = false) {
        // The server pushes recovered answers after a disconnected stream.
        // A live background stream still needs this local notice.
        guard !(recovered && MacPushRegistration.isRemoteLive) else { return }
        // Read now, while the answer is landing, not after the permission
        // check below has awaited.
        let inBackground = !NSApplication.shared.isActive
        Task {
            // Never prompts: the dialog opens only at the moments
            // `NotificationPermissionCoordinator` handles, never for an
            // answer arriving unseen.
            let authorized = await DailyCrossNotifications.isAuthorized()
            guard AnswerReadyNotification.shouldNotify(
                conversationID: conversationID,
                inBackground: inBackground,
                authorized: authorized,
                chatReplies: chatReplies
            ) else { return }

            let content = UNMutableNotificationContent()
            content.title = AnswerReadyNotification.title
            content.body = AnswerReadyNotification.body(conversationTitle: title)
            content.sound = .default
            content.userInfo = AnswerReadyNotification.userInfo(conversationID: conversationID)
            let request = UNNotificationRequest(
                identifier: AnswerReadyNotification.identifier(conversationID: conversationID),
                content: content,
                // No trigger: deliver now.
                trigger: nil
            )
            try? await UNUserNotificationCenter.current().add(request)
        }
    }
}
