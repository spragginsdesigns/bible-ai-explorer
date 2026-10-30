import ClerkKit
import Foundation

/// A locator supplied by the owned-history boundary, never inferred from text.
struct SavedAnswerLocator: Codable, Sendable, Equatable {
    enum Surface: String, Codable, Sendable { case chat, note }
    let surface: Surface
    let parentId: String
    let messageId: String

    init?(surface: String, parentId: String, messageId: String) {
        guard let surface = Surface(rawValue: surface), Self.validID(parentId), Self.validID(messageId) else { return nil }
        self.surface = surface
        self.parentId = parentId
        self.messageId = messageId
    }

    var query: String {
        // The server's ID grammar excludes query delimiters and percent escapes.
        "surface=\(surface.rawValue)&parentId=\(parentId)&messageId=\(messageId)"
    }

    private static func validID(_ value: String) -> Bool {
        (1...160).contains(value.utf8.count) && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45
        }
    }
}

enum SavedAnswerReviewState: String, Sendable { case verified, notice, pending, withheld }

struct SavedAnswerReviewMetadata: Sendable, Equatable {
    let locator: SavedAnswerLocator
    let state: SavedAnswerReviewState
    let sourceDigest: String

    init?(_ value: JSONValue, messageID: String) {
        guard let surface = value["surface"]?.stringValue,
              let parent = value["parentId"]?.stringValue,
              let message = value["messageId"]?.stringValue, message == messageID,
              let locator = SavedAnswerLocator(surface: surface, parentId: parent, messageId: message),
              let rawState = value["state"]?.stringValue,
              let state = SavedAnswerReviewState(rawValue: rawState), state == .pending || state == .withheld,
              let code = value["code"]?.stringValue, !code.isEmpty,
              let digest = value["sourceDigest"]?.stringValue, Self.validDigest(digest)
        else { return nil }
        self.locator = locator
        self.state = state
        self.sourceDigest = digest
    }

    static func validDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// A malformed marker must not fall back to rendering an unchecked answer.
enum SavedAnswerReviewRequirement: Sendable, Equatable {
    case invalid
    case review(SavedAnswerReviewMetadata)

    init?(_ value: JSONValue?, messageID: String) {
        guard let value else { return nil }
        self = SavedAnswerReviewMetadata(value, messageID: messageID).map(Self.review) ?? .invalid
    }

    var metadata: SavedAnswerReviewMetadata? {
        if case .review(let value) = self { return value }
        return nil
    }
}

struct SavedAnswerReviewOwner: Sendable, Equatable {
    let accountID: String
    let sessionID: String

    @MainActor static var current: Self? {
        guard let account = Clerk.shared.user?.id, let session = Clerk.shared.session?.id else { return nil }
        return Self(accountID: account, sessionID: session)
    }
}

struct SavedAnswerReviewBinding: Sendable, Equatable {
    let owner: SavedAnswerReviewOwner
    let metadata: SavedAnswerReviewMetadata
}

/// Only these four fields can leave the client on an explicit check.
struct SavedAnswerRecheckRequest: Encodable, Sendable, Equatable {
    let surface: SavedAnswerLocator.Surface
    let parentId: String
    let messageId: String
    let expectedSourceDigest: String

    init(_ metadata: SavedAnswerReviewMetadata) {
        surface = metadata.locator.surface
        parentId = metadata.locator.parentId
        messageId = metadata.locator.messageId
        expectedSourceDigest = metadata.sourceDigest
    }
}

struct SavedAnswerReviewResponse: Sendable {
    let state: SavedAnswerReviewState
    let message: ChatViewMessage?

    init(data: Data, matching metadata: SavedAnswerReviewMetadata) throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let rawState = value["state"]?.stringValue, let state = SavedAnswerReviewState(rawValue: rawState),
              value["sourceDigest"]?.stringValue == metadata.sourceDigest,
              let row = value["row"], row["id"]?.stringValue == metadata.locator.messageId,
              row["role"]?.stringValue == "assistant", row["content"]?.stringValue != nil,
              let parts = row["metadata"]?["parts"]?.arrayValue, parts.allSatisfy({ $0.objectValue != nil }),
              let stored = UIMessage(storedRow: row)
        else { throw SavedAnswerReviewError.invalidResponse }
        self.state = state
        if state == .verified || state == .notice {
            // A checked row has no pending/withheld marker. Refuse contradictory
            // responses instead of removing a marker to expose their content.
            guard row["metadata"]?["historyVerification"] == nil else { throw SavedAnswerReviewError.invalidResponse }
            self.message = ChatViewMessage(message: stored, isStreaming: false)
        } else {
            // Pending/withheld rows are represented with our fixed notice. No
            // unchecked text, cards, or tool actions enter the bubble renderer.
            self.message = nil
        }
    }
}

enum SavedAnswerReviewError: Error { case invalidResponse, invalidOriginal }

/// Injectable suspensions let tests hold real lifecycle boundaries without a
/// provider, account, or entitlement write. Production always uses APIClient.
@MainActor
struct SavedAnswerReviewTransport {
    var recheck: (SavedAnswerRecheckRequest) async throws -> Void
    var state: (SavedAnswerLocator) async throws -> Data
    var original: (SavedAnswerLocator) async throws -> Data

    init(api: APIClient) {
        recheck = { request in
            try await Self.authorizeRecheck()
            // A rejected check can still have safely moved the row to withheld.
            // The POST body is content-free; the following GET is authoritative.
            _ = try await api.response("/api/ai/history/recheck", method: "POST", body: request, timeout: 90)
        }
        state = { try await api.data("/api/ai/history/state?\($0.query)") }
        original = { try await api.data("/api/ai/history/original?\($0.query)") }
    }

    /// Consent may hold a sheet open. It cannot authorize a replacement
    /// account/session or a caller that disappeared while the sheet was up.
    static func authorizeRecheck(
        owner: () -> SavedAnswerReviewOwner? = { SavedAnswerReviewOwner.current },
        consent: () async -> Bool = { await AIConsentGate.ensure() }
    ) async throws {
        try Task.checkCancellation()
        guard let captured = owner() else { throw APIError(message: "The reading account changed.", status: 401) }
        let granted = await consent()
        try Task.checkCancellation()
        guard owner() == captured else { throw APIError(message: "The reading account changed.", status: 401) }
        guard granted else { throw APIError(message: AIConsent.declinedNotice, status: 403) }
    }

    init(recheck: @escaping (SavedAnswerRecheckRequest) async throws -> Void,
         state: @escaping (SavedAnswerLocator) async throws -> Data,
         original: @escaping (SavedAnswerLocator) async throws -> Data) {
        self.recheck = recheck
        self.state = state
        self.original = original
    }
}

@MainActor
@Observable
final class SavedAnswerReviewModel {
    private(set) var isChecking = false
    private(set) var isDownloading = false
    private(set) var state: SavedAnswerReviewState?
    private(set) var error: String?
    private var binding: SavedAnswerReviewBinding?
    private var checkedMessage: ChatViewMessage?
    private var original: Data?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private let owner: () -> SavedAnswerReviewOwner?

    init(owner: @escaping () -> SavedAnswerReviewOwner? = { SavedAnswerReviewOwner.current }) { self.owner = owner }

    func activate(_ next: SavedAnswerReviewBinding?) {
        generation = UUID()
        binding = next
        checkedMessage = nil
        original = nil
        state = nil
        error = nil
        isChecking = false
        isDownloading = false
    }

    func message(for current: SavedAnswerReviewBinding?) -> ChatViewMessage? {
        guard let current, owns(current, generation: generation) else { return nil }
        return checkedMessage
    }

    func download(for current: SavedAnswerReviewBinding?) -> Data? {
        guard let current, owns(current, generation: generation) else { return nil }
        return original
    }

    func check(_ current: SavedAnswerReviewBinding, using transport: SavedAnswerReviewTransport) async {
        let ticket = generation
        guard owns(current, generation: ticket), !isChecking, !isDownloading else { return }
        isChecking = true
        error = nil
        defer { if owns(current, generation: ticket, allowCancelled: true) { isChecking = false } }
        do {
            try await transport.recheck(SavedAnswerRecheckRequest(current.metadata))
            guard owns(current, generation: ticket) else { return }
            let data = try await transport.state(current.metadata.locator)
            guard owns(current, generation: ticket) else { return }
            let response = try SavedAnswerReviewResponse(data: data, matching: current.metadata)
            checkedMessage = response.message
            state = response.state
        } catch {
            guard owns(current, generation: ticket) else { return }
            self.error = "The saved answer couldn't be checked. Try again or reopen it."
        }
    }

    func prepareDownload(_ current: SavedAnswerReviewBinding, using transport: SavedAnswerReviewTransport) async {
        let ticket = generation
        guard owns(current, generation: ticket), !isChecking, !isDownloading else { return }
        isDownloading = true
        original = nil
        error = nil
        defer { if owns(current, generation: ticket, allowCancelled: true) { isDownloading = false } }
        do {
            let data = try await transport.original(current.metadata.locator)
            guard owns(current, generation: ticket) else { return }
            // JSON is only carried to FileExporter. It is never a message or a
            // share/provider input, even when it contains old tool payloads.
            guard data.count <= 2_000_000,
                  let value = try? JSONDecoder().decode(JSONValue.self, from: data),
                  value["formatVersion"]?.doubleValue == 1,
                  value["surface"]?.stringValue == current.metadata.locator.surface.rawValue,
                  value["parentId"]?.stringValue == current.metadata.locator.parentId,
                  value["messageId"]?.stringValue == current.metadata.locator.messageId,
                  value["current"]?["id"]?.stringValue == current.metadata.locator.messageId,
                  value["versions"]?.arrayValue != nil
            else { throw SavedAnswerReviewError.invalidOriginal }
            original = data
        } catch {
            guard owns(current, generation: ticket) else { return }
            self.error = "The original couldn't be downloaded. Try again."
        }
    }

    func discardDownload() { original = nil }

    private func owns(_ current: SavedAnswerReviewBinding, generation ticket: UUID, allowCancelled: Bool = false) -> Bool {
        (allowCancelled || !Task.isCancelled) && generation == ticket && binding == current && owner() == current.owner
    }
}
