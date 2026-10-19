import AppKit
import UserNotifications

/// Posts `AnswerReadyNotification` when an answer lands while SureWord is not
/// the active app. `MainWindow` wires it to `ChatViewModel.onAnswerReady`; a
/// click comes back through the app delegate's `NotificationTapTarget` routing
/// and opens that conversation.
@MainActor
enum AnswerReadyNotifier {
    static func answerLanded(conversationID: String, title: String?, chatReplies: Bool) {
        // Read now, while the answer is landing, not after the permission
        // check below has awaited.
        let inBackground = !NSApplication.shared.isActive
        Task {
            // Never prompts: the dialog belongs to Settings and to the morning
            // reminder's first sync, never to an answer arriving unseen.
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

    /// Switching "Notify when an answer is ready" on is an explicit request, so
    /// it asks straight away, as Android and the web do inside the switch. A
    /// Mac that already answered is not asked again; macOS keeps the answer.
    static func requestAuthorization() async {
        let center = UNUserNotificationCenter.current()
        guard await center.notificationSettings().authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }
}
