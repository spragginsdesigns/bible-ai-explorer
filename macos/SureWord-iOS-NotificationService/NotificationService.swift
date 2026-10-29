import UserNotifications

/// Attaches each SureWord push's art as its banner thumbnail. iOS always shows
/// the app icon and the text in a closed notification; an attachment is the
/// one place art can appear there. The server sets `mutable-content` on the
/// Daily Cross and answer pushes (`buildApnsPayload` in `src/lib/apns.ts`),
/// which is what wakes this extension. The art is bundled, so nothing is
/// downloaded and an offline phone still gets it.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        if let art = NotificationArt(userInfo: content.userInfo) {
            art.dress(content)
        }
        contentHandler(content)
    }
}
