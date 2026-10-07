import Foundation

/// Product analytics, Apple half: a port of `mobile/src/lib/analytics.ts`
/// (Android 1.72.1 to 1.73.0) for the iOS and macOS clients.
///
/// The server already reports what it can see for every client at once (an
/// answer finished, a rating arrived, an account appeared). This half exists
/// only for what the server cannot see, exactly as on Android:
///
/// - **Screens opened** (`screen_viewed`, route patterns only, never an id).
/// - **App opened and backgrounded**, the spine of any retention question,
///   under the same four names the PostHog mobile SDKs use, so an iPhone's
///   `Application Opened` lands in the same row as an Android one.
/// - **The sign-in funnel** (`SignInAnalytics.swift`): method and Clerk's
///   error code only.
/// - **Failed requests** from `APIClient`: route shape only.
///
/// There is no PostHog SDK in this project (`project.yml` carries Clerk
/// alone), so this speaks PostHog's public capture API directly: one `POST
/// /batch/` with the project's public key, the same key `mobile/app.json`
/// ships inside the APK. That also means nothing is captured that this file
/// does not name: no autocapture, no session replay, no screenshots.
///
/// **The content rule** (`src/lib/analytics/events.ts`, `docs/PARITY.md`
/// "Usage analytics") is enforced by mechanism rather than by care: every
/// event property is filtered through `allowedPropertyKeys` on the way in, so
/// a question, answer, note, highlight, church, testimony or verse text cannot
/// reach a payload even if a caller passes one. `AnalyticsMirrorTests` pins
/// the event names to the server catalog and Android's copy, and pins this
/// allowlist.
enum AnalyticsEvents {
    static let screenViewed = "screen_viewed"
    static let feedbackSubmitted = "feedback_submitted"
    static let signInStarted = "sign_in_started"
    static let signInCompleted = "sign_in_completed"
    static let signInFailed = "sign_in_failed"
    static let requestFailed = "request_failed"

    /// Key to name, exactly as `ANALYTICS_EVENTS` in `mobile/src/lib/analytics.ts`
    /// spells it. The mirror test compares this table against both TS files.
    static let catalog: [String: String] = [
        "screenViewed": screenViewed,
        "feedbackSubmitted": feedbackSubmitted,
        "signInStarted": signInStarted,
        "signInCompleted": signInCompleted,
        "signInFailed": signInFailed,
        "requestFailed": requestFailed,
    ]

    /// The PostHog mobile SDKs' lifecycle names (`captureAppLifecycleEvents`
    /// on Android). Not snake_case because they are PostHog's, not ours.
    static let applicationInstalled = "Application Installed"
    static let applicationUpdated = "Application Updated"
    static let applicationOpened = "Application Opened"
    static let applicationBackgrounded = "Application Backgrounded"
}

/// One property value, restricted to what a shape-only event ever needs.
enum AnalyticsValue: Sendable, Equatable {
    case string(String)
    case int(Int)
    case bool(Bool)
    case null

    var json: Any {
        switch self {
        case .string(let value): value
        case .int(let value): value
        case .bool(let value): value
        case .null: NSNull()
        }
    }
}

extension AnalyticsValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral {
    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .int(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
}

typealias AnalyticsProperties = [String: AnalyticsValue]

/// The rules that do not need a network, a clock or a device: kept apart from
/// `Analytics` so the tests can exercise them directly.
enum AnalyticsRules {
    /// Every key an event may carry. Anything else is dropped before the event
    /// is queued - the content rule as a whitelist, not a promise.
    ///
    /// - base: `platform`, `source`, `environment`, `is_test_client`
    /// - screens: `screen` (a route pattern)
    /// - sign-in: `method`, `reason` (Clerk error code), `step`
    /// - failures: `route` (a route shape), `kind`, `status`, `app_state`
    /// - lifecycle: `version`, `build`, `previous_version`, `previous_build`,
    ///   `from_background`
    static let allowedPropertyKeys: Set<String> = [
        "platform", "source", "environment", "is_test_client",
        "screen",
        "method", "reason", "step",
        "route", "kind", "status", "app_state",
        "version", "build", "previous_version", "previous_build", "from_background",
    ]

    static func filtered(_ properties: AnalyticsProperties) -> AnalyticsProperties {
        properties.filter { allowedPropertyKeys.contains($0.key) }
    }

    /// Reduce an API path to its route shape. A line-for-line port of
    /// `routeShape` in `mobile/src/lib/analytics.ts` (itself a mirror of the
    /// server's copy): numeric, UUID-shaped and long digit-bearing segments
    /// become `[id]`, the query and fragment go, and a shared-answer path
    /// always loses its tail because that id is the credential that opens it.
    static func routeShape(_ path: String) -> String {
        var rest = Substring(path)
        if let scheme = rest.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*", options: .regularExpression) {
            rest = rest[scheme.upperBound...]
        }
        let withoutQuery = rest.split(maxSplits: 1, omittingEmptySubsequences: false, whereSeparator: { $0 == "?" || $0 == "#" })
            .first.map(String.init) ?? ""
        var segments = withoutQuery
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)
            .map { looksLikeIdentifier($0) ? "[id]" : $0 }

        if let sharedAt = segments.firstIndex(of: "shared"), segments.count > sharedAt + 1 {
            segments.replaceSubrange((sharedAt + 1)..., with: ["[id]"])
        }
        return "/" + segments.joined(separator: "/")
    }

    private static func looksLikeIdentifier(_ segment: String) -> Bool {
        if segment.range(of: "^[0-9]+$", options: .regularExpression) != nil { return true }
        if segment.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-", options: .regularExpression) != nil {
            return true
        }
        return segment.count >= 12
            && segment.contains(where: \.isNumber)
            && segment.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }

    /// How long one route+cause pair stays quiet after reporting itself.
    static let failureQuietInterval: TimeInterval = 30

    /// Android's identity rule (`AnalyticsIdentityBridge` in
    /// `mobile/app/_layout.tsx`): a reset needs a PREVIOUS user. Clerk reports
    /// nobody signed in for a beat on every cold start, and resetting there
    /// minted a new anonymous id per launch, which is how six app opens
    /// became six "new users" on 2026-09-20.
    enum IdentityAction: Equatable {
        case none
        case identify(String)
        case reset
    }

    static func identityAction(previousUserID: String?, userID: String?) -> IdentityAction {
        if let userID { return .identify(userID) }
        return previousUserID != nil ? .reset : .none
    }

    /// Which lifecycle event a launch is, from the version and build stored by
    /// the previous launch.
    static func launchEvent(
        storedVersion: String?,
        storedBuild: String?,
        version: String,
        build: String
    ) -> (name: String, properties: AnalyticsProperties)? {
        guard let storedVersion, let storedBuild else {
            return (AnalyticsEvents.applicationInstalled, ["version": .string(version), "build": .string(build)])
        }
        guard storedVersion != version || storedBuild != build else { return nil }
        return (
            AnalyticsEvents.applicationUpdated,
            [
                "version": .string(version),
                "build": .string(build),
                "previous_version": .string(storedVersion),
                "previous_build": .string(storedBuild),
            ]
        )
    }
}

/// Where a batch goes. A protocol so the tests can hold on to what would have
/// been sent instead of sending it.
protocol AnalyticsTransport: Sendable {
    /// True when the batch was accepted and can be dropped from the queue.
    func send(_ body: Data) async -> Bool
}

struct PostHogTransport: AnalyticsTransport {
    let host: URL

    func send(_ body: Data) async -> Bool {
        var request = URLRequest(url: host.appending(path: "batch/"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // A 4xx will never succeed on retry (a malformed batch, a revoked key),
        // so it is dropped rather than retried forever.
        return status < 500 && status != 0
    }
}

/// The client. Main-actor isolated because every caller (views, the app
/// root, Clerk's auth stream) already is, and the state is tiny.
@MainActor
final class Analytics {
    static let shared = Analytics()

    /// The same public project key as `mobile/app.json` -> `extra.posthogKey`.
    static let projectKey = "phc_xLtcCctBYWKDLUGXhErbLF4g6VbcjXYGrE4uPraJ9YC9"
    static let host = URL(string: "https://us.i.posthog.com")!

    #if os(iOS)
    static let platform = "ios"
    #elseif os(macOS)
    static let platform = "macos"
    #endif

    /// Is this build incapable of producing product signal? The mirror of
    /// Android's `!Device.isDevice || __DEV__`: a simulator is this machine's
    /// test loop and a debug build is a developer. A shipped build on a real
    /// device is never caught by either. App Review devices are real hardware;
    /// the reviewer demo account is on the server's `INTERNAL_USER_IDS`.
    static var isTestClient: Bool {
        #if DEBUG || targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    static var environment: String {
        #if DEBUG
        "development"
        #else
        "production"
        #endif
    }

    /// PostHog's own internal-traffic flag; the project's test-user cohort is
    /// defined on it.
    static let internalPersonProperty = "$internal_or_test_user"

    private enum Keys {
        static let anonymousID = "sureword.analytics.anonymousId"
        static let distinctID = "sureword.analytics.distinctId"
        static let version = "sureword.analytics.version"
        static let build = "sureword.analytics.build"
        static let queue = "sureword.analytics.queue"
    }

    /// Nil turns every call into a no-op: unit test hosts, where the app
    /// launches under XCTest and must not report itself to production.
    private let transport: (any AnalyticsTransport)?
    private let defaults: UserDefaults
    private let now: () -> Date

    private var queue: [[String: Any]] = []
    private var isFlushing = false
    private var flushTask: Task<Void, Never>?
    private var lastScreen: String?
    private var lastFailureAt: [String: Date] = [:]
    /// Who was signed in last time the session changed, so a sign-OUT can be
    /// told apart from merely being signed out (see `AnalyticsRules`).
    private var previousUserID: String?
    private var hasStarted = false
    private var wasBackgrounded = false
    /// `active`, `inactive` or `background`, for `request_failed.app_state`.
    private(set) var appState = "active"
    /// The method the open sign-in attempt started with, so a completion that
    /// Clerk reports without a strategy (a sign-up transfer) is filed under it.
    var openSignInMethod: String?

    /// Flush once this many events are waiting, or every 30 seconds
    /// (Android's `flushInterval: 30`).
    static let flushAt = 20
    static let flushInterval: Duration = .seconds(30)
    /// Bounded so an offline week cannot grow the store without limit.
    static let maxQueued = 500

    static var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    init(
        transport: (any AnalyticsTransport)? = isRunningTests ? nil : PostHogTransport(host: host),
        defaults: UserDefaults = .standard,
        now: @escaping () -> Date = Date.init
    ) {
        self.transport = transport
        self.defaults = defaults
        self.now = now
        if transport != nil,
           let data = defaults.data(forKey: Keys.queue),
           let saved = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            queue = saved
        }
    }

    var isEnabled: Bool { transport != nil }

    // MARK: Identity

    var anonymousID: String {
        if let existing = defaults.string(forKey: Keys.anonymousID) { return existing }
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: Keys.anonymousID)
        return fresh
    }

    var distinctID: String { defaults.string(forKey: Keys.distinctID) ?? anonymousID }

    var isIdentified: Bool { distinctID != anonymousID }

    /// Clerk's user changed. Identify on a session, reset only on a real
    /// sign-out - never on the bare signed-out state a cold start reports.
    func sessionChanged(userID: String?) {
        switch AnalyticsRules.identityAction(previousUserID: previousUserID, userID: userID) {
        case .identify(let id):
            previousUserID = id
            identify(id)
        case .reset:
            previousUserID = nil
            reset()
        case .none:
            break
        }
    }

    /// Tie this device's events to the account, so an iPhone session and the
    /// server events for the same person land on one profile.
    func identify(_ userID: String) {
        guard isEnabled, !userID.isEmpty, distinctID != userID else { return }
        let anonymous = distinctID
        var set: [String: Any] = [:]
        // A test client that signs in flags the person outright. A real device
        // leaves the flag to the server, which owns INTERNAL_USER_IDS and must
        // not have it overwritten from a client.
        if Self.isTestClient { set[Self.internalPersonProperty] = true }
        defaults.set(userID, forKey: Keys.distinctID)
        var extra: [String: Any] = ["$anon_distinct_id": anonymous]
        if !set.isEmpty { extra["$set"] = set }
        enqueue("$identify", properties: [:], extra: extra)
        flushSoon()
    }

    /// Signing out breaks the link between this device and the account, or the
    /// next person to sign in here inherits the previous one's trail.
    func reset() {
        guard isEnabled else { return }
        flushSoon()
        let fresh = UUID().uuidString.lowercased()
        defaults.set(fresh, forKey: Keys.anonymousID)
        defaults.removeObject(forKey: Keys.distinctID)
        lastScreen = nil
    }

    // MARK: Events

    /// Record one event. Never throws: analytics must not be able to break a
    /// screen.
    func track(_ event: String, _ properties: AnalyticsProperties = [:]) {
        guard isEnabled else { return }
        enqueue(event, properties: properties, extra: [:])
        if queue.count >= Self.flushAt { flushSoon() }
    }

    /// `screen_viewed` for a route pattern (`/notes/[id]`, never the id). A
    /// repeat of the screen already showing is dropped, as Android's
    /// `useScreenTracking` drops it, or a view that redraws would look like the
    /// most used screen in the app.
    func screen(_ pattern: String) {
        guard pattern != lastScreen else { return }
        lastScreen = pattern
        track(AnalyticsEvents.screenViewed, ["screen": .string(pattern)])
    }

    /// Report a failed API call, at most once per route and cause per 30
    /// seconds - going offline fails every request in flight, and an
    /// unthrottled event would bury the one broken endpoint.
    func trackRequestFailure(path: String, kind: String, status: Int?) {
        guard isEnabled else { return }
        let route = AnalyticsRules.routeShape(path)
        let key = "\(route):\(kind)"
        let moment = now()
        if let previous = lastFailureAt[key], moment.timeIntervalSince(previous) < AnalyticsRules.failureQuietInterval {
            return
        }
        lastFailureAt[key] = moment
        track(
            AnalyticsEvents.requestFailed,
            [
                "route": .string(route),
                "kind": .string(kind),
                "status": status.map(AnalyticsValue.int) ?? .null,
                // Whether the app was on screen when it died: a suspended app
                // loses its sockets, and that is not a broken product.
                "app_state": .string(appState),
            ]
        )
    }

    // MARK: Lifecycle

    /// Called once from each app's `init`: `Application Installed` or
    /// `Application Updated` when the build changed, then `Application Opened`.
    func start() {
        guard isEnabled, !hasStarted else { return }
        hasStarted = true
        let version = Config.appVersion
        let build = Config.appBuild
        if let launch = AnalyticsRules.launchEvent(
            storedVersion: defaults.string(forKey: Keys.version),
            storedBuild: defaults.string(forKey: Keys.build),
            version: version,
            build: build
        ) {
            track(launch.name, launch.properties)
        }
        defaults.set(version, forKey: Keys.version)
        defaults.set(build, forKey: Keys.build)
        track(
            AnalyticsEvents.applicationOpened,
            ["from_background": false, "version": .string(version), "build": .string(build)]
        )
        scheduleFlushLoop()
    }

    /// The scene phase changed: `active`, `inactive` or `background`.
    func phaseChanged(to phase: String) {
        appState = phase
        guard isEnabled else { return }
        switch phase {
        case "background":
            guard !wasBackgrounded else { return }
            wasBackgrounded = true
            track(AnalyticsEvents.applicationBackgrounded)
            persistQueue()
            flushSoon()
        case "active":
            guard wasBackgrounded else { return }
            wasBackgrounded = false
            track(
                AnalyticsEvents.applicationOpened,
                [
                    "from_background": true,
                    "version": .string(Config.appVersion),
                    "build": .string(Config.appBuild),
                ]
            )
        default:
            break
        }
    }

    // MARK: Queue

    /// The events waiting to be sent. Internal for the tests.
    var pending: [[String: Any]] { queue }

    private func enqueue(_ event: String, properties: AnalyticsProperties, extra: [String: Any]) {
        var props: [String: Any] = [
            "platform": Self.platform,
            "source": "client",
            "environment": Self.environment,
            // Event-level twin of the person flag, so the anonymous events a
            // simulator sends before anyone signs in can be filtered too.
            "is_test_client": Self.isTestClient,
        ]
        for (key, value) in AnalyticsRules.filtered(properties) { props[key] = value.json }
        props["$lib"] = "sureword-swift"
        props["$lib_version"] = Config.appVersion
        props["$app_version"] = Config.appVersion
        props["$app_build"] = Config.appBuild
        #if os(iOS)
        props["$os"] = "iOS"
        #elseif os(macOS)
        props["$os"] = "macOS"
        #endif
        let os = ProcessInfo.processInfo.operatingSystemVersion
        props["$os_version"] = "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
        // `personProfiles: "identified_only"`: an anonymous launch does not
        // create a person, so a first run that never signs in is not a user.
        if !isIdentified && event != "$identify" { props["$process_person_profile"] = false }
        for (key, value) in extra { props[key] = value }

        let distinct = distinctID
        props["distinct_id"] = distinct
        queue.append([
            "event": event,
            "distinct_id": distinct,
            "uuid": UUID().uuidString.lowercased(),
            "timestamp": ISO8601DateFormatter.analytics.string(from: now()),
            "properties": props,
        ])
        if queue.count > Self.maxQueued { queue.removeFirst(queue.count - Self.maxQueued) }
    }

    private func scheduleFlushLoop() {
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.flushInterval)
                await self?.flush()
            }
        }
    }

    private func flushSoon() {
        Task { [weak self] in await self?.flush() }
    }

    /// Send everything queued. Events stay queued (and persisted) until
    /// PostHog accepts them, so a phone offline in a church parking lot sends
    /// its morning when it reconnects.
    func flush() async {
        guard let transport, !isFlushing, !queue.isEmpty else { return }
        isFlushing = true
        defer { isFlushing = false }
        let batch = queue
        let body: [String: Any] = [
            "api_key": Self.projectKey,
            "batch": batch,
            "sent_at": ISO8601DateFormatter.analytics.string(from: now()),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            queue.removeAll()
            return
        }
        if await transport.send(data) {
            queue.removeFirst(min(batch.count, queue.count))
        }
        persistQueue()
    }

    private func persistQueue() {
        guard let data = try? JSONSerialization.data(withJSONObject: queue) else { return }
        defaults.set(data, forKey: Keys.queue)
    }
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let analytics: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

/// The non-isolated door into `Analytics` for code that is not on the main
/// actor (`APIClient`, Clerk's networking middleware).
enum AnalyticsReporter {
    static func requestFailed(path: String, kind: String, status: Int? = nil) {
        Task { @MainActor in Analytics.shared.trackRequestFailure(path: path, kind: kind, status: status) }
    }

    static func track(_ event: String, _ properties: AnalyticsProperties) {
        Task { @MainActor in Analytics.shared.track(event, properties) }
    }
}
