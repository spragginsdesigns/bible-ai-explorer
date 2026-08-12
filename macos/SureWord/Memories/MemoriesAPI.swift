import Foundation

/// Memory models and endpoints — a port of
/// `mobile/src/features/memories/api.ts`, talking to the same shared routes in
/// `src/app/api/memories/*`.
///
/// The enable flag is **server state**, not a local preference: it lives on the
/// `User` row and is what `src/lib/memory.ts` checks before injecting or
/// extracting memories. Caching it in UserDefaults would let the Mac disagree
/// with the phone, so it is always read from `GET /api/memories`.

struct MemoryRecord: Identifiable, Decodable, Sendable, Equatable {
    let id: String
    let content: String
    let category: String
    let updatedAt: String
}

struct MemorySummarySection: Identifiable, Decodable, Sendable, Equatable {
    var id: String { title }
    let title: String
    let content: String
}

struct MemorySummary: Decodable, Sendable, Equatable {
    let overview: String
    let sections: [MemorySummarySection]
}

struct MemoriesResponse: Decodable, Sendable, Equatable {
    let enabled: Bool
    let memories: [MemoryRecord]
}

struct MemorySummaryResponse: Decodable, Sendable, Equatable {
    let summary: MemorySummary?
    let generatedAt: String?
}

/// Caps enforced by `src/lib/memory.ts`; mirrored here so the UI can stop the
/// user before the server has to.
enum MemoryLimits {
    static let maxPerUser = 60
    static let maxContentLength = 500
}

extension APIClient {
    /// Listing works whether or not memory is enabled — the toggle only gates
    /// injection and extraction, never visibility.
    func fetchMemories() async throws -> MemoriesResponse {
        try await json("/api/memories")
    }

    @discardableResult
    func setMemoryEnabled(_ enabled: Bool) async throws -> Bool {
        struct Body: Encodable { let enabled: Bool }
        struct Payload: Decodable { let enabled: Bool }
        let payload = try await json(
            "/api/memories",
            method: "PATCH",
            body: Body(enabled: enabled),
            as: Payload.self
        )
        return payload.enabled
    }

    /// The server picks the category when none is supplied.
    func addMemory(content: String) async throws -> MemoryRecord {
        struct Body: Encodable { let content: String }
        return try await json("/api/memories", method: "POST", body: Body(content: content))
    }

    func deleteMemory(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        try await data("/api/memories/\(escaped)", method: "DELETE")
    }

    func clearMemories() async throws {
        try await data("/api/memories", method: "DELETE")
    }

    /// LLM-backed and never persisted — "regenerate" is simply another POST.
    /// The route declares `maxDuration = 60`, so the client waits that long
    /// rather than timing out at 30s on a summary the server is still writing.
    func generateMemorySummary() async throws -> MemorySummaryResponse {
        try await json("/api/memories/summary", method: "POST", timeout: 60)
    }
}
