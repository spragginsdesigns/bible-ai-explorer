import Foundation

/// One transport attempt, rather than the user message (which retries reuse).
/// The same identifier is sent with the stream and its deliberate Stop.
struct ChatNotificationAttempt: Encodable, Equatable, Sendable {
    struct Acknowledgement: Decodable, Sendable {
        let stopped: Bool
    }

    let conversationId: String
    let attemptId: String

    init(conversationID: String, id: UUID = UUID()) {
        conversationId = conversationID
        attemptId = id.uuidString.lowercased()
    }

    /// Depart only after the server acknowledges the tombstone. On failure,
    /// keep draining the abandoned response: normal EOF does not notify. The
    /// view model has already detached this attempt from visible state.
    func stop(
        acknowledge: @Sendable (ChatNotificationAttempt) async throws -> Void,
        depart: @Sendable () -> Void
    ) async {
        do {
            try await acknowledge(self)
            depart()
        } catch {
            // Offline/failed Stop has no acknowledged server decision. Do not
            // manufacture a disconnection that would request a remote push.
        }
    }
}
