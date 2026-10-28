import ClerkKit
import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    /// APNs delivered or refreshed this device's token; the shell re-syncs.
    static let pushTokenDidChange = Notification.Name("sureword.pushTokenDidChange")
}

/// Direct APNs delivery for the morning verse and answer-ready notices.
/// The server accepts platform ios plus the raw token and signed environment;
/// its APNs sender dynamically returns 503 when that environment has no key.
/// Registration is scoped to the current account, session, environment and
/// token, and local reminders cover builds or servers that cannot deliver.
@MainActor
enum PushRegistration {
    /// The last APNs token, per environment: a Debug build and the installed
    /// app share this defaults domain but not their tokens.
    private static let tokenKeyPrefix = "push.ios.apnsDeviceToken."
    /// An old bool cannot establish who registered. Only a complete matching
    /// identity can suppress the local fallback after an offline launch.
    private static let remoteIdentityKey = "push.ios.remoteIdentity"
    private typealias SessionIdentity = APNsRegistration.AuthSession
    private static var operation: Task<Void, Never>?
    private static var revision = 0
    private static var activeAPI: ObjectIdentifier?
    /// Prevent a delayed shell callback from re-registering during sign-out.
    private static var signingOutSession: SessionIdentity?
    /// The device proof the server returned, and the stored token it belongs
    /// to (`APNsRegistration.proofOwner`). Derived from the token, not the
    /// account, so sign-out keeps it.
    private static let proofKey = "push.ios.tokenProof"
    private static let proofOwnerKey = "push.ios.tokenProofOwner"

    /// This signed Info.plist value and the iOS aps-environment entitlement
    /// share SUREWORD_APS_ENVIRONMENT in project.yml. Missing or unknown
    /// metadata disables remote registration; there is no DEBUG fallback.
    static let environment = APNsRegistration.iosEnvironment(infoDictionary: Bundle.main.infoDictionary)

    static var isAvailable: Bool { environment != nil }

    static var storedToken: String? {
        guard let environment else { return nil }
        return UserDefaults.standard.string(forKey: tokenKeyPrefix + environment.rawValue)
    }

    static var isRemoteLive: Bool {
        guard let session = currentSession, signingOutSession != session else { return false }
        return legacyRemoteLive || APNsRegistration.isRemoteLive(registered: registeredIdentity, current: identity(for: session))
    }

    private static var legacyToken: String? {
        guard let token = UserDefaults.standard.string(forKey: "push.expoToken"), ExpoPushTokenExchange.isExpoToken(token) else { return nil }
        return token
    }

    private static var legacyRemoteLive: Bool {
        legacyToken != nil && UserDefaults.standard.bool(forKey: "push.remoteLive")
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

    private static func saveIdentity(_ identity: APNsRegistration.DeliveryIdentity?, preserveLegacyLive: Bool = false) {
        let defaults = UserDefaults.standard
        if let identity, let data = try? JSONEncoder().encode(identity) {
            defaults.set(data, forKey: remoteIdentityKey)
        } else {
            defaults.removeObject(forKey: remoteIdentityKey)
        }
        if !preserveLegacyLive { defaults.removeObject(forKey: "push.remoteLive") }
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

    /// Ask iOS for a token; the answer arrives on the app delegate. Never
    /// prompts, and only called once notifications are authorized. A build
    /// without the entitlement never asks: UIKit would only fail it.
    static func begin() {
        guard isAvailable else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// App delegate entry point for `didRegisterForRemoteNotificationsWithDeviceToken`.
    static func store(_ deviceToken: Data) {
        guard let environment else { return }
        let hex = APNsRegistration.hex(deviceToken)
        let key = tokenKeyPrefix + environment.rawValue
        guard APNsRegistration.isDeviceToken(hex), hex != UserDefaults.standard.string(forKey: key) else { return }
        UserDefaults.standard.set(hex, forKey: key)
        NotificationCenter.default.post(name: .pushTokenDidChange, object: nil)
    }

    /// Launch and preference/grant changes only read permission. The owning
    /// AppModel's account ID prevents an old shell applying its preferences
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
            let result = await register(
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
                outcome: result.outcome,
                registered: registeredIdentity,
                current: current,
                serverUnconfigured: result.serverUnconfigured,
                legacyRemoteLive: result.legacyRemoteLive
            )
            let rawPlan = APNsRegistration.deliveryPlan(
                verseOfDayEnabled: verseEnabled, authorized: authorized,
                outcome: result.outcome, registered: registeredIdentity, current: current,
                serverUnconfigured: result.serverUnconfigured
            )
            saveIdentity(rawPlan.remoteLive ? current : nil, preserveLegacyLive: result.legacyRemoteLive)
            if plan.scheduleLocalReminder {
                await DailyCrossNotifications.sync(enabled: true, hour: hour, mayRequestAuthorization: false)
            } else {
                DailyCrossNotifications.cancel()
            }
        }
        operation = work
        await work.value
    }

    /// Clear only this app's local delivery state after an account/session
    /// transition. Server authorization retires the old session's audience;
    /// no DELETE is sent using a replacement account's bearer.
    static func clearLocalDeliveryForAccountChange() {
        revision += 1
        activeAPI = nil
        signingOutSession = nil
        operation?.cancel()
        // Preserve ordering against an old POST that was already in flight.
        UIApplication.shared.unregisterForRemoteNotifications()
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        saveIdentity(nil)
        // Preserve raw/legacy tokens and device proofs for cleanup/rebinding.
    }

    /// Called after an awaited SDK sign-out failure, never on a timer or
    /// while the transition is still in flight.
    static func resumeAfterFailedSignOut(accountID: String, sessionID: String) {
        let expected = SessionIdentity(accountID: accountID, sessionID: sessionID)
        guard APNsRegistration.canResumeAfterFailedSignOut(
            current: currentSession, signingOut: signingOutSession, expected: expected
        ) else { return }
        signingOutSession = nil
        activeAPI = nil
        revision += 1
        NotificationCenter.default.post(name: .pushTokenDidChange, object: nil)
    }

    /// Call before Clerk invalidates the current session. Remote registration
    /// is stopped locally immediately even when the server is unreachable;
    /// server-row retirement remains best-effort. Keep the proof, so the same
    /// installation can move a surviving row to its next account safely.
    @discardableResult
    static func unregister(api: APIClient) async -> Bool {
        UIApplication.shared.unregisterForRemoteNotifications()
        DailyCrossNotifications.cancel()
        guard let owner = currentSession else { return false }
        signingOutSession = owner
        activeAPI = ObjectIdentifier(api)
        revision += 1
        let previous = operation
        var tokens = Set([APNsRegistration.Environment.production, .development].compactMap {
            UserDefaults.standard.string(forKey: tokenKeyPrefix + $0.rawValue)
        }.filter(APNsRegistration.isDeviceToken))
        // Retire a legacy Expo row too if this installation has one. The
        // exchange itself is no longer part of current registration.
        if let legacy = UserDefaults.standard.string(forKey: "push.expoToken"),
           ExpoPushTokenExchange.isExpoToken(legacy) {
            tokens.insert(legacy)
        }
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
                    try await pushAPI.data("/api/push-tokens", method: "DELETE", body: APNsRegistration.UnregisterBody(token: token, platform: "ios"))
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
    ) async -> APNsRegistration.IOSSyncResult {
        let defaults = UserDefaults.standard
        let legacy = legacyToken.map { token in
            APNsRegistration.IOSLegacyToken(
                token: token,
                proof: defaults.string(forKey: "push.tokenProofToken") == token ? defaults.string(forKey: "push.tokenProof") : nil,
                remoteLive: legacyRemoteLive
            )
        }
        return await APNsRegistration.syncIOSLegacyMigration(
            legacy: legacy, timezone: TimeZone.current.identifier, hour: hour,
            transport: { method, body in
                try await api.data("/api/push-tokens", method: method, body: body)
            },
            didDisable: { defaults.removeObject(forKey: "push.remoteLive") },
            rememberProof: { proof in
                guard let legacy else { return }
                defaults.set(proof, forKey: "push.tokenProof")
                defaults.set(legacy.token, forKey: "push.tokenProofToken")
            },
            didRemove: {
                guard let legacy, defaults.string(forKey: "push.expoToken") == legacy.token else { return }
                defaults.removeObject(forKey: "push.expoToken")
                defaults.removeObject(forKey: "push.expoTokenSource")
            },
            rawOperation: {
                await registerRaw(api: api, owner: owner, current: current, authorized: authorized,
                                  verseOfDayEnabled: verseOfDayEnabled, chatReplies: chatReplies, hour: hour)
            }
        )
    }

    private static func registerRaw(
        api: APIClient,
        owner: SessionIdentity,
        current: APNsRegistration.DeliveryIdentity?,
        authorized: Bool,
        verseOfDayEnabled: Bool,
        chatReplies: Bool,
        hour: Int
    ) async -> (PushRegistrationOutcome, serverUnconfigured: Bool) {
        // Legacy cleanup awaited the network. Sign-out may have started in
        // that time; it must not be followed by a new UIKit registration.
        guard currentSession == owner, signingOutSession != owner else { return (.unavailable, false) }
        // Both-off still retires legacy and cached raw rows when this build
        // has no current APNs token or environment metadata.
        guard verseOfDayEnabled || chatReplies else {
            let tokens = Set([APNsRegistration.Environment.production, .development].compactMap {
                UserDefaults.standard.string(forKey: tokenKeyPrefix + $0.rawValue)
            }.filter(APNsRegistration.isDeviceToken))
            var removed = true
            for token in tokens {
                do {
                    try await api.data("/api/push-tokens", method: "DELETE", body: APNsRegistration.UnregisterBody(token: token, platform: "ios"))
                } catch { removed = false }
            }
            return (APNsRegistration.unregisterOutcome(succeeded: removed), false)
        }
        guard authorized, environment != nil else { return (.unavailable, false) }
        begin()
        guard let current else { return (.unavailable, false) }
        let proofOwner = APNsRegistration.proofOwner(token: current.token, environment: current.environment)
        func send(proof: String?) async throws -> String? {
            let data = try await api.data(
                "/api/push-tokens",
                method: "POST",
                body: APNsRegistration.RegisterBody(
                    token: current.token,
                    platform: "ios",
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

/// The deferred permission dialog (PRD B6a), owned by the signed-in shell.
/// Launch only ever reads the status; the dialog opens at a moment reported to
/// `NotificationPermissionMoments`, and a grant re-runs the sync so the
/// reminder and the push token arrive straight away.
@MainActor
enum NotificationPermissionCoordinator {
    private static var isAsking = false

    /// Returns true when the dialog was shown and granted.
    static func handle(_ trigger: NotificationPermissionTrigger, settings: SettingsStore) async -> Bool {
        // One dialog at a time: an answer settling while the Cross sheet's
        // trigger is mid-check must not queue a second prompt behind it.
        guard !isAsking else { return false }
        isAsking = true
        defer { isAsking = false }
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings().authorizationStatus
        let status = NotificationPermissionStatus(
            granted: current == .authorized || current == .provisional || current == .ephemeral,
            canAskAgain: current == .notDetermined
        )
        guard NotificationPermissionPrompt.shouldRequest(
            verseOfDayEnabled: settings.verseOfDayEnabled,
            chatReplies: settings.notifyChatReplies,
            asked: NotificationPermissionPrompt.hasAsked(),
            status: status,
            trigger: trigger
        ) else { return false }
        NotificationPermissionPrompt.markAsked()
        return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }
}
