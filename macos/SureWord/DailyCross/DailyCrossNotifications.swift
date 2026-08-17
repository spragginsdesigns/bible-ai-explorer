import Foundation
import UserNotifications

extension Notification.Name {
    /// Posted when the morning notification is clicked, so the window can show
    /// the Daily Cross. A `NotificationCenter` hop rather than a direct call
    /// because the delegate lives on the `NSApplicationDelegate`, outside the
    /// view hierarchy and outside the signed-in `AppModel`'s lifetime.
    static let openDailyCross = Notification.Name("sureword.openDailyCross")
}

/// The morning "Pick Up Your Cross" reminder.
///
/// This is the *local* delivery path, which is the one Android actually runs
/// today: a repeating daily notification at the chosen hour that carries no
/// verse and simply opens the Daily Cross, which then fetches or generates the
/// day. Android's other path — a remote Expo push carrying the verse — needs
/// FCM/EAS credentials it does not have yet, and its Mac equivalent would need
/// an APNs key from the paid Apple Developer Program. Until then the Mac
/// registers no push token, so the hourly cron never fires for this user and
/// `GET /api/verse-of-day/today` generates the day on first open. Same day,
/// same content, just pulled instead of pushed.
enum DailyCrossNotifications {
    /// A stable identifier, so re-scheduling replaces the existing request
    /// rather than stacking a second daily reminder on top of it.
    static let requestIdentifier = "sureword.daily-cross"

    /// Bring the scheduled reminder in line with the user's settings. Safe to
    /// call on every launch and on every settings change.
    static func sync(enabled: Bool, hour: Int) async {
        guard enabled else {
            cancel()
            return
        }
        guard await requestAuthorization() else { return }
        await schedule(hour: hour)
    }

    static func cancel() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [requestIdentifier])
    }

    /// Ask once. macOS remembers the answer, and a denial is final until the
    /// user changes it in System Settings — so a `false` here is not an error
    /// to report, just a reminder that will not be scheduled.
    private static func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional:
            return true
        case .denied:
            return false
        default:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        }
    }

    private static func schedule(hour: Int) async {
        let content = UNMutableNotificationContent()
        // Same copy as the Android local notification, deliberately.
        content.title = "✝ Pick up your cross"
        content.body = "Your word for today is ready."
        content.sound = .default

        var components = DateComponents()
        components.hour = min(max(hour, 0), 23)
        components.minute = 0

        let request = UNNotificationRequest(
            identifier: requestIdentifier,
            content: content,
            // A calendar trigger fires in the device's current timezone, which
            // is what "8 in the morning" has to mean when the user travels.
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        )

        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [requestIdentifier])
        try? await center.add(request)
    }
}
