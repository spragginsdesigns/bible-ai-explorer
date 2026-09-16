import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Sharing one settled answer as a public page - the contract in
/// `docs/FEATURES.md` ("Share an answer: a public page, and a card image").
///
/// The link is a **capability, not the message id**: the server mints a random
/// slug and snapshots the question, the answer text and the references into its
/// own row, so the public page never reads `Message`. Editing or deleting the
/// conversation afterwards cannot change what a link shows, and revoking is the
/// only way to take one back.
///
/// Nothing here uploads content. The client names the pair it wants shared and
/// the server does the snapshotting (`src/app/api/shared/route.ts`).

// MARK: - Wire types

/// Body of `POST /api/shared`.
///
/// Both keys are required and the route 400s without either
/// (`readBody`, `src/app/api/shared/route.ts:46`). The wire names are camelCase
/// and must stay exactly these two: the route reads no others.
struct ShareAnswerRequest: Sendable, Equatable, Encodable {
    var conversationId: String
    var messageId: String
}

/// Response of `POST /api/shared`: the minted, or re-used, link.
///
/// Sharing is idempotent on the message, so a second tap on an answer that is
/// already shared returns this same id rather than minting a second capability
/// for the same text.
struct SharedAnswerLink: Sendable, Equatable, Decodable {
    var id: String
    var url: String
    var createdAt: String?

    /// The `ShareLink` item. Optional rather than force-unwrapped because a URL
    /// this build cannot parse must surface as a failed share, never a crash.
    var shareURL: URL? { URL(string: url) }

    init(id: String, url: String, createdAt: String? = nil) {
        self.id = id
        self.url = url
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, url, createdAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        url = (try? container.decode(String.self, forKey: .url)) ?? ""
        createdAt = try? container.decode(String.self, forKey: .createdAt)
    }
}

/// One row of `GET /api/shared`, for Settings -> Shared answers.
///
/// Decoded leniently for the same reason `AnswerFeedbackResult` is
/// (`Shared/Chat/AnswerFeedback.swift:87`): one odd row must not empty the whole
/// list. `revokedAt` is null on a live link and a timestamp once taken back.
struct SharedAnswerRow: Sendable, Equatable, Decodable, Identifiable {
    var id: String
    var url: String
    var question: String
    var createdAt: String?
    /// `var` so the optimistic revoke in `SharedAnswersModel` can write one back.
    var revokedAt: String?

    var isRevoked: Bool { revokedAt != nil }

    /// The question is a snapshot of the user's prompt, and the server stores an
    /// empty string when the assistant turn had no user row before it
    /// (`shareQuestion(prompt?.content ?? "")`). A blank row would read as a
    /// rendering bug, so it gets a name instead.
    var title: String {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? Self.untitled : trimmed
    }

    static let untitled = "Shared answer"

    init(
        id: String,
        url: String,
        question: String,
        createdAt: String? = nil,
        revokedAt: String? = nil
    ) {
        self.id = id
        self.url = url
        self.question = question
        self.createdAt = createdAt
        self.revokedAt = revokedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, url, question, createdAt, revokedAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        url = (try? container.decode(String.self, forKey: .url)) ?? ""
        question = (try? container.decode(String.self, forKey: .question)) ?? ""
        createdAt = try? container.decode(String.self, forKey: .createdAt)
        revokedAt = try? container.decode(String.self, forKey: .revokedAt)
    }
}

/// Envelope of `GET /api/shared`.
struct SharedAnswersResponse: Sendable, Equatable, Decodable {
    var shares: [SharedAnswerRow]

    init(shares: [SharedAnswerRow]) {
        self.shares = shares
    }

    private enum CodingKeys: String, CodingKey { case shares }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        shares = (try? container.decode([SharedAnswerRow].self, forKey: .shares)) ?? []
    }
}

// MARK: - API

extension APIClient {
    /// Mint the public link for one assistant answer, or re-use the one the
    /// server already holds for it. Idempotent on the message, and re-sharing a
    /// revoked answer un-revokes the original id.
    func shareAnswer(conversationID: String, messageID: String) async throws -> SharedAnswerLink {
        try await json(
            "/api/shared",
            method: "POST",
            body: ShareAnswerRequest(conversationId: conversationID, messageId: messageID),
            as: SharedAnswerLink.self
        )
    }

    /// The owner's own links. There is no public index of shared answers.
    func listShares() async throws -> [SharedAnswerRow] {
        try await json("/api/shared", as: SharedAnswersResponse.self).shares
    }

    /// Take a link back. The row is stamped, not deleted, so the list can still
    /// show what was shared and when it was revoked. Idempotent.
    ///
    /// The id is base64url and needs no escaping, but it is escaped for the same
    /// reason `deleteMemory(id:)` escapes its own
    /// (`Shared/Memories/MemoriesAPI.swift:113`): a server-minted id is still
    /// data, and building a path out of it unescaped is the habit that bites.
    func revokeShare(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        try await data("/api/shared/\(escaped)", method: "DELETE")
    }
}

// MARK: - Pasteboard

/// Copying a plain string, the platform-split half of `VerseActions.copy`
/// (`Shared/Chat/VerseActions.swift:74`) without its verse formatting - a link
/// is already the exact text to paste.
enum SharedAnswerPasteboard {
    static func copy(_ value: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        #else
        UIPasteboard.general.string = value
        #endif
    }
}

// MARK: - Settings model

/// State behind Settings -> Shared answers on both platforms, shaped like
/// `MemoriesModel` (`Shared/Memories/MemoriesModel.swift:12`): the view is
/// `@State`-owned by each Settings screen and hands over the session's client
/// the first time it appears, because a `@State` initializer cannot read the
/// environment.
@MainActor
@Observable
final class SharedAnswersModel {
    struct ErrorAlert: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let message: String
    }

    private(set) var shares: [SharedAnswerRow] = []
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    /// Rows with a DELETE in flight, so one row's buttons go quiet without
    /// disabling the rest of the list.
    private(set) var pendingRevokeIDs: Set<String> = []

    var errorAlert: ErrorAlert?

    private var api: APIClient?

    func configure(_ api: APIClient) {
        if self.api == nil { self.api = api }
    }

    func isRevoking(_ share: SharedAnswerRow) -> Bool {
        pendingRevokeIDs.contains(share.id)
    }

    // MARK: Loading

    func load() async {
        guard let api else { return }
        do {
            shares = try await api.listShares()
            loadError = nil
        } catch {
            loadError = Self.message(error, fallback: "Could not load your shared answers.")
        }
        hasLoaded = true
    }

    // MARK: Revoking

    /// Optimistic, like the memory toggle: the row shows "Revoked" immediately
    /// and the timestamp is put back with an alert if the DELETE fails.
    ///
    /// The local stamp is only ever read as "is this revoked" - the server owns
    /// the real `revokedAt` and the next load brings it back.
    func revoke(_ share: SharedAnswerRow) async {
        guard let api, !pendingRevokeIDs.contains(share.id), !share.isRevoked else { return }
        guard let index = shares.firstIndex(where: { $0.id == share.id }) else { return }

        let previous = shares[index].revokedAt
        shares[index].revokedAt = Self.timestamp()
        pendingRevokeIDs.insert(share.id)
        defer { pendingRevokeIDs.remove(share.id) }

        do {
            try await api.revokeShare(id: share.id)
        } catch {
            restore(previous, on: share.id)
            errorAlert = ErrorAlert(
                title: "Could not revoke that link",
                message: Self.message(error, fallback: "The link is still live. Try again in a moment.")
            )
        }
    }

    /// Re-finds the row by id: a reload may have moved it while the DELETE was
    /// in flight, and a stale index would un-revoke somebody else's link.
    private func restore(_ revokedAt: String?, on id: String) {
        guard let index = shares.firstIndex(where: { $0.id == id }) else { return }
        shares[index].revokedAt = revokedAt
    }

    private static func timestamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// Surfaces the server's own `{ "error": ... }` text when there is one, the
    /// way every other model on this screen does.
    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? fallback : described
    }
}
