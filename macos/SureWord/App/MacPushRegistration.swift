import AppKit
import ClerkKit
import Foundation
import UserNotifications
import Security

extension Notification.Name {
    /// Posted on the main actor when APNs delivers (or refreshes) this Mac's
    /// token, so the window can re-run its notification sync.
    static let macPushTokenDidChange = Notification.Name("sureword.macPushTokenDidChange")
}

/// Remote push for the morning verse and "Your answer is ready" on the Mac:
/// the macOS half of `usePushNotifications.ts` / `registerPushToken` in
/// `mobile/src/features/notifications/`, and the Mac's `PushRegistration`.
///
/// Unlike the phones, the Mac registers its raw APNs token: Expo has no Mac
/// tokens, so the server sends to Apple directly (`src/lib/apns.ts`). The body
/// is Android's plus `apnsEnvironment` (`APNsRegistration`), with the same
/// device proof echoed back so another account cannot take the token by
/// knowing it.
///
/// Off unless the build was signed with `com.apple.developer.aps-environment`,
/// which only a build with a Push-enabled provisioning profile can carry
/// (`macos/project.yml`, `SureWordPush.entitlements`). The default Apple
/// Development build has no profile, so it never asks APNs for a token and
/// keeps the local morning reminder and the local answer notice, exactly as
/// before. To turn it on (Austin, once, in the Apple Developer portal):
///
/// 1. Keys → + → "SureWord APNs", Apple Push Notifications service, Sandbox &
///    Production; download the .p8 once, note the Key ID. Set APNS_KEY_ID,
///    APNS_TEAM_ID (389LLKGY3Y) and APNS_PRIVATE_KEY on Vercel.
/// 2. Identifiers → `com.spragginsdesigns.sureword`: Push Notifications is
///    already on for iOS; make sure the App ID also lists macOS.
/// 3. Profiles → + → Developer ID (or macOS App Development for a local
///    build) for that App ID, download it, and select that profile and
///    SureWordPush.entitlements in the main app target's build settings.
///    Keep the embedded Share extension's signing settings separate. A
///    Development profile on a Release build needs
///    `SUREWORD_APS_ENVIRONMENT=development`.
///
/// Everything is best-effort, as on the phones: a denial, a missing
/// entitlement, a server without the APNs key or an offline launch are all
/// swallowed, and `PushDeliveryPlan` (Android's rule, shared with iOS) decides
/// whether the local daily reminder covers for it.
@MainActor
enum MacPushRegistration {
    /// The last APNs token, per environment: a Debug build and the installed
    /// app share this defaults domain but not their tokens.
    private static let tokenKeyPrefix = "push.mac.apnsDeviceToken."
    /// An old bool cannot establish who registered. Only a complete matching
    /// identity can suppress the local fallback after an offline launch.
    private static let remoteIdentityKey = "push.mac.remoteIdentity"
    private typealias SessionIdentity = APNsRegistration.AuthSession
    private static var operation: Task<Void, Never>?
    private static var revision = 0
    private static var activeAPI: ObjectIdentifier?
    /// Prevent a delayed window callback from re-registering during sign-out.
    private static var signingOutSession: SessionIdentity?
    /// The device proof the server returned, and the stored token it belongs
    /// to (`APNsRegistration.proofOwner`). Derived from the token, not the
    /// account, so sign-out keeps it.
    private static let proofKey = "push.mac.tokenProof"
    private static let proofOwnerKey = "push.mac.tokenProofOwner"

    /// The APNs environment this build was signed for, or nil when it carries
    /// no `aps-environment` entitlement and remote push is off. Read from the
    /// signature rather than `#if DEBUG`, because the profile decides: a
    /// Release build signed with a Development profile gets sandbox tokens.
    static let environment: APNsRegistration.Environment? = {
        guard let task = SecTaskCreateFromSelf(nil) else { return nil }
        let value = SecTaskCopyValueForEntitlement(task, APNsRegistration.entitlementKey as CFString, nil)
        return APNsRegistration.Environment(entitlement: value)
    }()

    static var isAvailable: Bool { environment != nil }

    static var storedToken: String? {
        guard let environment else { return nil }
        return UserDefaults.standard.string(forKey: tokenKeyPrefix + environment.rawValue)
    }

    static var isRemoteLive: Bool {
        guard let session = currentSession, signingOutSession != session else { return false }
        return APNsRegistration.isRemoteLive(registered: registeredIdentity, current: identity(for: session))
    }

    private static var currentSession: SessionIdentity? {
        guard let accountID = Clerk.shared.user?.id, let sessionID = Clerk.shared.session?.id else { return nil }
        return SessionIdentity(accountID: accountID, sessionID: sessionID)
    }

    private static var registeredIdentity: APNsRegistration.DeliveryIdentity? {
        guard let data = UserDefaults.standard.data(forKey: remoteIdentityKey) else { return nil }
        return try? JSONDecoder().decode(APNsRegistration.DeliveryIdentity.self, from: data)
    }

    private static func identity(for session: SessionIdentity) -> APNsRegistration.DeliveryIdentity? {
        APNsRegistration.DeliveryIdentity(
            accountID: session.accountID,
            sessionID: session.sessionID,
            environment: environment,
            token: storedToken
        )
    }

    private static func saveIdentity(_ identity: APNsRegistration.DeliveryIdentity?) {
        let defaults = UserDefaults.standard
        if let identity, let data = try? JSONEncoder().encode(identity) {
            defaults.set(data, forKey: remoteIdentityKey)
        } else {
            defaults.removeObject(forKey: remoteIdentityKey)
        }
        defaults.removeObject(forKey: "push.mac.remoteLive")
    }

    /// A 401 here must not await Clerk sign-out, which itself waits for token
    /// removal. Keep the shared API behavior but omit its auth-failure hook,
    /// and refuse to borrow a replacement account or session's bearer token.
    private static func client(for owner: SessionIdentity) -> APIClient {
        APIClient(token: { fresh in
            guard await MainActor.run(body: { currentSession == owner }) else {
                throw APIError(message: "The notification account changed.", status: 401)
            }
            let token = try await ClerkAuth.token(for: owner.accountID, fresh: fresh)
            guard await MainActor.run(body: { currentSession == owner }) else {
                throw APIError(message: "The notification account changed.", status: 401)
            }
            return token
        }, onAuthFailure: {})
    }

    private static func isCurrent(_ owner: SessionIdentity, apiID: ObjectIdentifier, revision expected: Int) -> Bool {
        currentSession == owner && signingOutSession != owner && activeAPI == apiID && revision == expected
    }

    /// Ask macOS for a token; the answer arrives on the app delegate. Never
    /// prompts, and only called once notifications are authorized. A build
    /// without the entitlement never asks: AppKit would only fail it.
    static func begin() {
        guard isAvailable else { return }
        NSApplication.shared.registerForRemoteNotifications()
    }

    /// App delegate entry point for `didRegisterForRemoteNotificationsWithDeviceToken`.
    static func store(_ deviceToken: Data) {
        guard let environment else { return }
        let hex = APNsRegistration.hex(deviceToken)
        let key = tokenKeyPrefix + environment.rawValue
        guard APNsRegistration.isDeviceToken(hex), hex != UserDefaults.standard.string(forKey: key) else { return }
        UserDefaults.standard.set(hex, forKey: key)
        NotificationCenter.default.post(name: .macPushTokenDidChange, object: nil)
    }

    /// Launch and preference/grant changes only read permission. The owning
    /// AppModel's account ID prevents an old window applying its preferences
    /// to a newly signed-in account. Network operations run in order, so a
    /// sign-out DELETE always follows any already-started registration.
    static func syncAll(api: APIClient, settings: SettingsStore, accountID: String?) async {
        guard !Task.isCancelled, let owner = currentSession,
              accountID == owner.accountID, signingOutSession != owner else { return }
        let apiID = ObjectIdentifier(api)
        activeAPI = apiID
        revision += 1
        let expected = revision
        let previous = operation
        let verseEnabled = settings.verseOfDayEnabled
        let repliesEnabled = settings.notifyChatReplies
        let hour = settings.verseOfDayHour
        let pushAPI = client(for: owner)
        let work = Task {
            await previous?.value
            guard isCurrent(owner, apiID: apiID, revision: expected) else { return }
            let authorized = await DailyCrossNotifications.isAuthorized()
            guard isCurrent(owner, apiID: apiID, revision: expected) else { return }
            let current = identity(for: owner)
            let (outcome, serverUnconfigured) = await register(
                api: pushAPI,
                owner: owner,
                current: current,
                authorized: authorized,
                verseOfDayEnabled: verseEnabled,
                chatReplies: repliesEnabled,
                hour: hour
            )
            guard isCurrent(owner, apiID: apiID, revision: expected), identity(for: owner) == current else { return }
            let plan = APNsRegistration.deliveryPlan(
                verseOfDayEnabled: verseEnabled,
                authorized: authorized,
                outcome: outcome,
                registered: registeredIdentity,
                current: current,
                serverUnconfigured: serverUnconfigured
            )
            saveIdentity(plan.remoteLive ? current : nil)
            if plan.scheduleLocalReminder {
                await DailyCrossNotifications.sync(enabled: true, hour: hour, mayRequestAuthorization: false)
            } else {
                DailyCrossNotifications.cancel()
            }
        }
        operation = work
        await work.value
    }

    /// Called after an actual account/session transition. Clerk's server-side
    /// session binding blocks old-account pushes; this only clears local OS/UI
    /// delivery state, without borrowing the replacement account's bearer.
    static func clearLocalDeliveryForAccountChange() {
        revision += 1
        activeAPI = nil
        signingOutSession = nil
        operation?.cancel()
        // Keep the operation chain: a new owner's POST must follow any old
        // request already in flight. Its result is fenced by the revision.
        NSApplication.shared.unregisterForRemoteNotifications()
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        saveIdentity(nil)
        // Device tokens and their ownership proofs survive for the next bind.
    }

    /// Only the caller that observed the SDK's terminal failure may release
    /// this fence. The live shell then registers with its current settings.
    static func resumeAfterFailedSignOut(accountID: String, sessionID: String) {
        let expected = SessionIdentity(accountID: accountID, sessionID: sessionID)
        guard APNsRegistration.canResumeAfterFailedSignOut(
            current: currentSession, signingOut: signingOutSession, expected: expected
        ) else { return }
        signingOutSession = nil
        activeAPI = nil
        revision += 1
        NotificationCenter.default.post(name: .macPushTokenDidChange, object: nil)
    }

    /// Call before Clerk invalidates the current session. Remote registration
    /// is stopped locally immediately even when the server is unreachable;
    /// server-row retirement remains best-effort. Keep the proof, so the same
    /// installation can move a surviving row to its next account safely.
    @discardableResult
    static func unregister(api: APIClient) async -> Bool {
        NSApplication.shared.unregisterForRemoteNotifications()
        DailyCrossNotifications.cancel()
        guard let owner = currentSession else { return false }
        signingOutSession = owner
        activeAPI = ObjectIdentifier(api)
        revision += 1
        let previous = operation
        let tokens = Set([APNsRegistration.Environment.production, .development].compactMap {
            UserDefaults.standard.string(forKey: tokenKeyPrefix + $0.rawValue)
        }.filter(APNsRegistration.isDeviceToken))
        let pushAPI = client(for: owner)
        let removal = Task {
            await previous?.value
            guard currentSession == owner else { return false }
            // A previous scheduling call may have been awaiting system
            // permission settings when sign-out began.
            DailyCrossNotifications.cancel()
            var succeeded = true
            for token in tokens {
                do {
                    try await pushAPI.data("/api/push-tokens", method: "DELETE", body: APNsRegistration.UnregisterBody(token: token))
                } catch {
                    succeeded = false
                }
            }
            if succeeded, currentSession == owner { saveIdentity(nil) }
            return succeeded
        }
        operation = Task { _ = await removal.value }
        return await removal.value
    }

    private static func register(
        api: APIClient,
        owner: SessionIdentity,
        current: APNsRegistration.DeliveryIdentity?,
        authorized: Bool,
        verseOfDayEnabled: Bool,
        chatReplies: Bool,
        hour: Int
    ) async -> (PushRegistrationOutcome, serverUnconfigured: Bool) {
        guard authorized, environment != nil else { return (.unavailable, false) }
        begin()
        guard let current else { return (.unavailable, false) }
        guard verseOfDayEnabled || chatReplies else {
            do {
                try await api.data("/api/push-tokens", method: "DELETE", body: APNsRegistration.UnregisterBody(token: current.token))
                return (APNsRegistration.unregisterOutcome(succeeded: true), false)
            } catch {
                return (APNsRegistration.unregisterOutcome(succeeded: false), false)
            }
        }

        let proofOwner = APNsRegistration.proofOwner(token: current.token, environment: current.environment)
        func send(proof: String?) async throws -> String? {
            let data = try await api.data(
                "/api/push-tokens",
                method: "POST",
                body: APNsRegistration.RegisterBody(
                    token: current.token,
                    environment: current.environment,
                    timezone: TimeZone.current.identifier,
                    notifyHour: hour,
                    verseOfDayEnabled: verseOfDayEnabled,
                    chatReplies: chatReplies,
                    proof: proof
                )
            )
            return (try? JSONDecoder().decode(APNsRegistration.RegisterResponse.self, from: data))?.proof
        }
        do {
            let returned = try await send(proof: storedProof(for: proofOwner))
            guard currentSession == owner, signingOutSession != owner else { return (.unavailable, false) }
            if let returned, storeProof(returned, for: proofOwner) {
                _ = try? await send(proof: returned)
            }
            return (.registered, false)
        } catch let error as APIError {
            return (.unavailable, APNsRegistration.isServerUnconfigured(status: error.status))
        } catch {
            return (.unavailable, false)
        }
    }

    private static func storedProof(for owner: String) -> String? {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: proofOwnerKey) == owner else { return nil }
        return defaults.string(forKey: proofKey)
    }

    /// Returns true when `proof` is new for this token and was stored.
    private static func storeProof(_ proof: String, for owner: String) -> Bool {
        guard !proof.isEmpty, storedProof(for: owner) != proof else { return false }
        let defaults = UserDefaults.standard
        defaults.set(proof, forKey: proofKey)
        defaults.set(owner, forKey: proofOwnerKey)
        return true
    }
}
