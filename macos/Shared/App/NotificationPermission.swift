import Foundation

/// When to show the system notification permission dialog - the Apple port of
/// `mobile/src/features/notifications/permissionPrompt.ts` (Android 1.55.0,
/// PRD B6a).
///
/// Asking seconds after sign-in, before the user has seen anything worth being
/// notified about, is the classic way to collect a permanent "Don't Allow". The
/// dialog waits for a moment that explains itself: the first answer that
/// settles in chat (so "your answer is ready" means something) or the first
/// visit to Pick Up Your Cross (so the morning word means something). It is
/// shown at most once per install, except when the user switches notifications
/// on in Settings, which is an explicit request and always asks.
///
/// No UserNotifications import, so the decision stays unit-testable.
enum NotificationPermissionTrigger: String, Sendable {
    case firstAnswer = "first-answer"
    case crossVisit = "cross-visit"
    case settingsEnabled = "settings-enabled"
}

struct NotificationPermissionStatus: Equatable, Sendable {
    var granted: Bool
    /// False once the system will no longer show the dialog. On iOS that is
    /// any answer at all: only `.notDetermined` can still be asked.
    var canAskAgain: Bool
}

enum NotificationPermissionPrompt {
    /// Device state, not a preference: the epoch seconds this install last
    /// showed the dialog. Kept per install like Android's `permissionAskedAt`.
    static let askedAtKey = "settings.notifications.permissionAskedAt"

    static func shouldRequest(
        verseOfDayEnabled: Bool,
        chatReplies: Bool,
        asked: Bool,
        status: NotificationPermissionStatus,
        trigger: NotificationPermissionTrigger
    ) -> Bool {
        // Nothing to ask for: registration proceeds exactly as it always has.
        if status.granted { return false }
        // The user asked for notifications themselves, so the once-per-install
        // cap does not apply. A request the system will not show is a no-op.
        if trigger == .settingsEnabled { return true }
        if !verseOfDayEnabled && !chatReplies { return false }
        if asked { return false }
        return status.canAskAgain
    }

    static func hasAsked(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: askedAtKey) != nil
    }

    /// Recorded before the dialog opens, so two triggers racing cannot both ask.
    static func markAsked(_ defaults: UserDefaults = .standard, now: Date = Date()) {
        defaults.set(now.timeIntervalSince1970, forKey: askedAtKey)
    }
}

/// Moments when asking would make sense, reported from wherever they happen
/// (a settled chat answer, the Cross sheet opening, a Settings switch) to the
/// one listener that owns the dialog.
///
/// Cheap and safe to signal on every answer or every visit: the listener
/// decides, and the persisted flag turns repeats into no-ops. A trigger that
/// fires before the listener exists is held, because a notification tap that
/// cold-opens the Daily Cross arrives before the signed-in shell subscribes.
@MainActor
final class NotificationPermissionMoments {
    static let shared = NotificationPermissionMoments()

    typealias Listener = @MainActor (NotificationPermissionTrigger) -> Void

    private var listener: (id: UUID, call: Listener)?
    private var pending: NotificationPermissionTrigger?

    init() {}

    func signal(_ trigger: NotificationPermissionTrigger) {
        if let listener {
            listener.call(trigger)
            return
        }
        // An explicit Settings request outranks a passive moment while queued.
        if pending != .settingsEnabled { pending = trigger }
    }

    /// Returns the token `unsubscribe` takes. Delivers a queued trigger at once.
    @discardableResult
    func subscribe(_ call: @escaping Listener) -> UUID {
        let id = UUID()
        listener = (id, call)
        let queued = pending
        pending = nil
        if let queued { call(queued) }
        return id
    }

    func unsubscribe(_ id: UUID) {
        if listener?.id == id { listener = nil }
    }
}

/// Where a notification tap lands - the port of
/// `mobile/src/features/notifications/tapTarget.ts`. Notifications carry
/// `screen: "cross"` (the guided day) or `screen: "chat"` with the conversation
/// whose answer finished while the app was away; older ones carry only a verse
/// reference and fall back to the Bible reader; anything else, including a
/// local reminder with no payload, is decided by the caller.
enum NotificationTapTarget: Equatable, Sendable {
    case cross
    case chat(conversationID: String)
    case reference(String)

    init?(userInfo: [AnyHashable: Any]) {
        // Expo nests the sender's `data` under "body" in the APNs payload;
        // a payload built by hand may put it at the top level.
        let data = (userInfo["body"] as? [AnyHashable: Any]) ?? userInfo
        let screen = data["screen"] as? String
        if screen == "cross" {
            self = .cross
            return
        }
        if screen == "chat" {
            guard let id = data["conversationId"] as? String, !id.isEmpty else { return nil }
            self = .chat(conversationID: id)
            return
        }
        guard let book = data["book"] as? String,
              let chapter = Self.integer(data["chapter"]),
              let verse = Self.integer(data["verse"])
        else { return nil }
        self = .reference("\(book) \(chapter):\(verse)")
    }

    private static func integer(_ value: Any?) -> Int? {
        switch value {
        case let number as Int: number
        case let number as Double where number.rounded() == number: Int(number)
        case let string as String: Int(string.trimmingCharacters(in: .whitespaces))
        default: nil
        }
    }
}
