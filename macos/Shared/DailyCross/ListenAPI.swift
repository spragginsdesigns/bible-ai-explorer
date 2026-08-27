import Foundation

/// The two calls behind "Listen". Both go through the shared `APIClient` -
/// there is no second networking layer, and the Clerk token, the 401 retry and
/// the offline translation all come for free.
enum ListenAPI {
    /// The state of today's spoken devotional. Cheap and side-effect free, and
    /// the only call the card makes while it waits: the narration is scheduled
    /// server-side WITH the day, so nothing here starts a generation.
    static func state(api: APIClient) async throws -> DailyCrossAudio {
        try await api.json("/api/verse-of-day/audio", as: DailyCrossAudio.self)
    }

    /// The manual retry behind a failed card, and the ONLY thing that ever
    /// POSTs. Safe to call twice - the route reuses a ready row and a pending
    /// row under three minutes old - but every call that does reach ElevenLabs
    /// is billed per character, so nothing may call this in a loop.
    static func retry(api: APIClient) async throws -> DailyCrossAudio {
        try await api.json(
            "/api/verse-of-day/audio",
            method: "POST",
            timeout: DailyCrossAPI.generationTimeout,
            as: DailyCrossAudio.self
        )
    }
}
