import Foundation

/// Conversations whose answer this device deliberately walked away from - the
/// user pressed stop, switched conversations, or started a new chat. A port of
/// `mobile/src/features/notifications/chatStopSignals.ts`.
///
/// The server cannot tell those apart from a backgrounded app: both look like
/// the same dropped connection, and both leave a finished answer worth keeping.
/// It sends "Your answer is ready" for either, so the client suppresses the
/// ones it knows the user did not want. Memory-only and short-lived by design:
/// a push for an answer abandoned minutes ago is stale anyway.
///
/// Locked rather than main-actor isolated because the notification delegate
/// that reads it (`userNotificationCenter(_:willPresent:)`) is nonisolated.
final class ChatStopSignals: @unchecked Sendable {
    /// Shared by the chat model that marks and the notification delegate that
    /// reads.
    static let shared = ChatStopSignals()

    /// Android's `STOP_MEMORY_MS`.
    static let memory: TimeInterval = 3 * 60

    private let lock = NSLock()
    private var stoppedAt: [String: Date] = [:]

    init() {}

    func markStopped(_ conversationID: String, now: Date = Date()) {
        lock.lock()
        defer { lock.unlock() }
        stoppedAt[conversationID] = now
        // Sweep here rather than on a timer; the map only ever holds
        // conversations this session actually stopped.
        stoppedAt = stoppedAt.filter { now.timeIntervalSince($0.value) <= Self.memory }
    }

    func wasStopped(_ conversationID: String, now: Date = Date()) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let at = stoppedAt[conversationID] else { return false }
        if now.timeIntervalSince(at) > Self.memory {
            stoppedAt[conversationID] = nil
            return false
        }
        return true
    }

    /// Whether a delivered push is a chat answer the user walked away from.
    /// Reads the payload the server sends (`{ screen: "chat", conversationId }`,
    /// `notifyChatAnswerReady` in `src/lib/push.ts`) the way Android's
    /// notification handler does, so the app delegate only has to ask.
    func isUnwantedChatPush(_ userInfo: [AnyHashable: Any], now: Date = Date()) -> Bool {
        // Top level for a plain APNs payload; Expo's push service nests the
        // custom data under `body`, and some senders use `data`.
        let data = (userInfo["body"] as? [AnyHashable: Any])
            ?? (userInfo["data"] as? [AnyHashable: Any])
            ?? userInfo
        guard data["screen"] as? String == "chat",
              let conversationID = data["conversationId"] as? String
        else { return false }
        return wasStopped(conversationID, now: now)
    }
}
