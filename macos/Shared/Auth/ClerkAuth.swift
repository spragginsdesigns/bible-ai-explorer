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
    /// Local voice controls must work with the installed production API too.
    /// Identity comes from Clerk's verified primary address, never app settings.
    static func isVoiceOwner(for account: String) -> Bool {
        guard Clerk.shared.session != nil, let user = Clerk.shared.user,
              let email = user.primaryEmailAddress else { return false }
        return NativeVoiceRules.ownerIdentity(account: account, profileID: user.id,
            email: email.emailAddress, verified: email.verification?.status == .verified)
    }

    static func refreshVoiceOwner(for account: String) async -> Bool {
        guard let user = Clerk.shared.user, user.id == account,
              let sessionID = Clerk.shared.session?.id else { return false }
        do {
            let fresh = try await user.reload()
            guard Clerk.shared.session?.id == sessionID, Clerk.shared.user?.id == account,
                  let email = fresh.primaryEmailAddress else { return false }
            return NativeVoiceRules.ownerIdentity(account: account, profileID: fresh.id,
                email: email.emailAddress, verified: email.verification?.status == .verified)
        } catch { return false }
    }

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
        let ownerID = Clerk.shared.user?.id
        let sessionID = Clerk.shared.session?.id
        #if os(macOS)
        if Clerk.shared.user != nil {
            // Remove the device while its owning session can authenticate.
            // Push cleanup never recursively invokes this auth-failure path.
            let api = APIClient(token: tokenProvider, onAuthFailure: {})
            _ = await MacPushRegistration.unregister(api: api)
        }
        #elseif os(iOS)
        if Clerk.shared.user != nil {
            let api = APIClient(token: tokenProvider, onAuthFailure: {})
            _ = await PushRegistration.unregister(api: api)
        }
        #endif
        // Cleanup awaited the network. It must never sign out an account or
        // replacement session that became active while that work was pending.
        guard Clerk.shared.user?.id == ownerID, Clerk.shared.session?.id == sessionID else { return }
        do {
            try await Clerk.shared.auth.signOut()
        } catch {
            // Unlike an SDK-owned profile action, this wrapper owns the full
            // request lifetime, so a terminal failure is safe to recover.
            guard let ownerID, let sessionID,
                  Clerk.shared.user?.id == ownerID, Clerk.shared.session?.id == sessionID else { return }
            #if os(macOS)
            MacPushRegistration.resumeAfterFailedSignOut(accountID: ownerID, sessionID: sessionID)
            #elseif os(iOS)
            PushRegistration.resumeAfterFailedSignOut(accountID: ownerID, sessionID: sessionID)
            #endif
        }
    }

    /// An old request must not sign out a different account that signed in
    /// while its response was in flight.
    static func signOut(ifAccount account: String?) async {
        guard let account, Clerk.shared.user?.id == account else { return }
        await signOut()
    }

    /// Sign-out once `DELETE /api/account` has removed the Clerk user. The
    /// server already ended every session with the user, so the sign-out call
    /// itself can fail; re-reading the client from Clerk then drops the dead
    /// session locally, which is what flips both app roots to sign-in.
    static func signOutAfterAccountDeletion() async {
        await signOut()
        if Clerk.shared.user != nil {
            _ = try? await Clerk.shared.refreshClient()
        }
    }
}
