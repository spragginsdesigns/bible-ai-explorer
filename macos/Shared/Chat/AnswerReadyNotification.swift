import Foundation

/// "Your answer is ready" for an answer that lands while SureWord is in the
/// background: the Mac's version of the web's hidden-tab notice
/// (`notifyAnswerReady` in `src/lib/web-notifications.ts`, its rule
/// `shouldNotifyAnswerLocally` in `src/lib/web-notification-rules.ts`).
///
/// The server sends its push (`notifyChatAnswerReady`) only when the client
/// that asked dropped off the stream. A Mac app behind another window keeps
/// its stream open, so that push never comes, and the Mac registers no push
/// token anyway. So the notice is local and comes from the app itself, never
/// alongside the server's: one covers a live connection, the other a lost
/// one. iOS posts none of these; its notice is the server's push
/// (`PushRegistration`), because a backgrounded iPhone drops the stream.
///
/// Pure, so the rule and the payload are unit-tested
/// (`AnswerReadyNotificationTests`); the Mac's poster is `AnswerReadyNotifier`.
enum AnswerReadyNotification {
    /// The server push's and the web notice's title, word for word.
    static let title = "Your answer is ready"
    /// The web notice's body for a conversation with no title yet.
    static let fallbackBody = "Tap to read it in SureWord."

    /// Web's `shouldNotifyAnswerLocally`: only while SureWord is out of view,
    /// only with permission, and only while "Notify when an answer is ready"
    /// is on. A notice with no conversation to open is never posted.
    static func shouldNotify(
        conversationID: String,
        inBackground: Bool,
        authorized: Bool,
        chatReplies: Bool
    ) -> Bool {
        !conversationID.isEmpty && inBackground && authorized && chatReplies
    }

    /// The conversation's title, or the fallback when it is blank.
    static func body(conversationTitle: String?) -> String {
        let title = conversationTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? fallbackBody : title
    }

    /// The web's `chat-<id>` tag: a second answer in the same conversation
    /// replaces the first notice rather than stacking under it.
    static func identifier(conversationID: String) -> String {
        "chat-\(conversationID)"
    }

    /// The server push's data (`{ screen: "chat", conversationId }`), so a
    /// click routes through `NotificationTapTarget` exactly like a tapped push.
    static func userInfo(conversationID: String) -> [String: String] {
        ["screen": "chat", "conversationId": conversationID]
    }
}
