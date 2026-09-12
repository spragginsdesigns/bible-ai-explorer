import ClerkKit
import Foundation

/// Bridge between Clerk's session and the API layer.
///
/// `fresh` maps to Clerk's `skipCache`, matching the Android client's
/// `getToken({ skipCache: true })` in `mobile/src/features/chat/useSureWordChat.ts`.
/// The API layer uses it for the one-shot retry after a 401, so an expired cached
/// token never surfaces to the user as an error.
@MainActor
enum ClerkAuth {
    static func token(fresh: Bool = false) async throws -> String? {
        guard let session = Clerk.shared.session else { return nil }
        return try await session.getToken(.init(skipCache: fresh))
    }

    /// Durable work must never borrow a newly signed-in account's token.
    static func token(for account: String, fresh: Bool) async throws -> String? {
        guard Clerk.shared.user?.id == account else { throw APIError(message: "The reading account changed.", status: 401) }
        let value = try await token(fresh: fresh)
        guard Clerk.shared.user?.id == account else { throw APIError(message: "The reading account changed.", status: 401) }
        return value
    }

    /// A token provider the networking layer can hold without importing ClerkKit.
    static var tokenProvider: TokenProvider {
        { fresh in try await ClerkAuth.token(fresh: fresh) }
    }

    static func signOut() async {
        try? await Clerk.shared.auth.signOut()
    }
}
