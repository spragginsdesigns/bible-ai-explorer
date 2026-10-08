import Foundation

/// The calls behind "Listen". All go through the shared `APIClient` - there is
/// no second networking layer, and the Clerk token, the 401 retry and the
/// offline translation all come for free.
enum ListenAPI {
    /// The state of today's spoken devotional. Cheap and side-effect free:
    /// read on opening the card, then polled only while a generation is
    /// pending. Nothing here ever starts one.
    static func state(api: APIClient) async throws -> DailyCrossAudio {
        try await api.json("/api/verse-of-day/audio", as: DailyCrossAudio.self)
    }

    /// The explicit "Generate audio narrative" request, and the ONLY thing
    /// that ever POSTs. Body `{ voiceId?, style? }`. Safe to call twice - the
    /// route reuses a ready row and a pending row under three minutes old -
    /// but every call that does reach ElevenLabs is billed per character, so
    /// nothing may call this in a loop.
    static func generate(api: APIClient, options: NarrationOptions) async throws -> DailyCrossAudio {
        try await api.json(
            "/api/verse-of-day/audio",
            method: "POST",
            body: options,
            timeout: DailyCrossAPI.generationTimeout,
            as: DailyCrossAudio.self
        )
    }

    /// The narrator catalog: metadata and existing previews only, so it never
    /// synthesizes speech.
    static func voices(api: APIClient) async throws -> NarrationVoices {
        try await api.json("/api/verse-of-day/audio/voices", as: NarrationVoices.self)
    }
}

/// What `ListenModel` asks the network for, as closures so the state machine
/// can be driven in tests without a server. `live` is the only production
/// value.
struct ListenTransport: Sendable {
    var state: @Sendable () async throws -> DailyCrossAudio
    var generate: @Sendable (NarrationOptions) async throws -> DailyCrossAudio
    var voices: @Sendable () async throws -> NarrationVoices

    static func live(api: APIClient) -> ListenTransport {
        ListenTransport(
            state: { try await ListenAPI.state(api: api) },
            generate: { try await ListenAPI.generate(api: api, options: $0) },
            voices: { try await ListenAPI.voices(api: api) }
        )
    }
}
