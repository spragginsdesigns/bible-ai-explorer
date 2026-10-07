import Foundation
import XCTest

@testable import SureWord

/// The Apple twin of `tests/analytics-event-mirror.test.mjs` (PRD B3).
///
/// A name that drifts between the server and a client fails nothing: it
/// quietly splits one funnel into two. So the Swift catalog is pinned to the
/// server's `ANALYTICS_EVENTS` and to Android's copy, by reading the source
/// files themselves, and the content rule is pinned by exercising the client
/// rather than trusting its comments.
final class AnalyticsMirrorTests: XCTestCase {
    // MARK: Event names

    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // SureWord-iOSTests
        .deletingLastPathComponent() // macos
        .deletingLastPathComponent() // repo

    private func source(_ relativePath: String) throws -> String {
        try String(contentsOf: Self.repoRoot.appending(path: relativePath), encoding: .utf8)
    }

    /// `key: "value"` pairs out of an `as const` object literal, the same
    /// extraction the Node test does.
    private func eventMap(_ source: String, _ objectName: String) throws -> [String: String] {
        let pattern = try Regex("\(objectName)\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as const")
        let block = try XCTUnwrap(source.firstMatch(of: pattern)?.output[1].substring, "\(objectName) not found")
        var names: [String: String] = [:]
        for match in block.matches(of: /(\w+):\s*"([^"]+)"/) {
            names[String(match.output.1)] = String(match.output.2)
        }
        return names
    }

    func testEverySwiftEventExistsInTheServerCatalogByKeyAndValue() throws {
        let server = try eventMap(source("src/lib/analytics/events.ts"), "ANALYTICS_EVENTS")
        XCTAssertGreaterThanOrEqual(server.count, 10, "expected a real catalog")
        for (key, value) in AnalyticsEvents.catalog {
            XCTAssertEqual(server[key], value, "Apple sends \"\(value)\" for \(key); the server calls it \(server[key] ?? "nothing")")
            XCTAssertNotNil(value.wholeMatch(of: /[a-z][a-z0-9_]*/), "\(value) is not snake_case")
        }
    }

    func testTheSwiftCatalogIsExactlyAndroids() throws {
        let android = try eventMap(source("mobile/src/lib/analytics.ts"), "ANALYTICS_EVENTS")
        XCTAssertEqual(AnalyticsEvents.catalog, android, "the Apple client and Android must send the same events")
    }

    // MARK: Content rule

    func testThePropertyAllowlistIsShapeOnly() {
        XCTAssertEqual(
            AnalyticsRules.allowedPropertyKeys,
            [
                "platform", "source", "environment", "is_test_client",
                "screen",
                "method", "reason", "step",
                "route", "kind", "status", "app_state",
                "version", "build", "previous_version", "previous_build", "from_background",
            ]
        )
        // No key that could hold study content may ever be allowlisted.
        for forbidden in ["question", "answer", "note", "text", "title", "highlight", "church", "testimony", "verse", "message", "email", "identifier", "query", "url", "path"] {
            XCTAssertFalse(AnalyticsRules.allowedPropertyKeys.contains(forbidden), forbidden)
        }
    }

    @MainActor
    func testContentNeverReachesAPayloadEvenWhenACallerPassesIt() throws {
        let analytics = makeClient()
        analytics.track(
            AnalyticsEvents.screenViewed,
            [
                "screen": "/notes/[id]",
                "question": "Is the Bible really the Word of God?",
                "note": "My private prayer",
                "verse": "John 3:16",
                "church": "First Baptist",
                "testimony": "How I was saved",
                "highlight": "In the beginning",
            ]
        )
        let event = try XCTUnwrap(analytics.pending.last)
        let properties = try XCTUnwrap(event["properties"] as? [String: Any])
        XCTAssertEqual(properties["screen"] as? String, "/notes/[id]")
        for key in ["question", "note", "verse", "church", "testimony", "highlight"] {
            XCTAssertNil(properties[key], key)
        }
        let serialized = String(decoding: try JSONSerialization.data(withJSONObject: analytics.pending), as: UTF8.self)
        for content in ["Word of God", "prayer", "John 3:16", "Baptist", "saved", "beginning"] {
            XCTAssertFalse(serialized.contains(content), content)
        }
    }

    @MainActor
    func testEveryEventCarriesTheBaseProperties() throws {
        let analytics = makeClient()
        analytics.screen(AnalyticsScreen.bible)
        let event = try XCTUnwrap(analytics.pending.last)
        XCTAssertEqual(event["event"] as? String, "screen_viewed")
        let properties = try XCTUnwrap(event["properties"] as? [String: Any])
        XCTAssertEqual(properties["platform"] as? String, "ios")
        XCTAssertEqual(properties["source"] as? String, "client")
        XCTAssertEqual(properties["environment"] as? String, "development")
        // A simulator / debug build is test traffic (Android: `!Device.isDevice || __DEV__`).
        XCTAssertEqual(properties["is_test_client"] as? Bool, true)
        // identified_only: an anonymous launch does not create a person.
        XCTAssertEqual(properties["$process_person_profile"] as? Bool, false)
    }

    // MARK: Screens

    func testScreenPatternsAreAndroidsRoutePatternsWithNoIDs() {
        let patterns = [
            AnalyticsScreen.chat, AnalyticsScreen.signIn, AnalyticsScreen.bible, AnalyticsScreen.chapter,
            AnalyticsScreen.chapters, AnalyticsScreen.search, AnalyticsScreen.atlas, AnalyticsScreen.learn,
            AnalyticsScreen.plan, AnalyticsScreen.sermons, AnalyticsScreen.cross, AnalyticsScreen.notes,
            AnalyticsScreen.note, AnalyticsScreen.memories, AnalyticsScreen.settings, AnalyticsScreen.feedback,
            AnalyticsScreen.settingsAccount, AnalyticsScreen.settingsAppearance,
            AnalyticsScreen.settingsHighlights, AnalyticsScreen.settingsChurch, AnalyticsScreen.settingsMemory,
            AnalyticsScreen.settingsAI, AnalyticsScreen.settingsShared, AnalyticsScreen.settingsNotifications,
            AnalyticsScreen.settingsAbout,
        ]
        let routes = Self.androidRoutes()
        for pattern in patterns {
            XCTAssertTrue(routes.contains(pattern), "\(pattern) is not a route Android reports")
        }
    }

    /// Every expo-router screen under `mobile/app`, as `useScreenTracking`
    /// names it: groups dropped, `index` dropped.
    private static func androidRoutes() -> Set<String> {
        let app = repoRoot.appending(path: "mobile/app")
        guard let walker = FileManager.default.enumerator(at: app, includingPropertiesForKeys: nil) else { return [] }
        var routes: Set<String> = []
        for case let url as URL in walker where url.pathExtension == "tsx" {
            let relative = url.path.replacingOccurrences(of: app.path + "/", with: "")
            let segments = relative.dropLast(4).split(separator: "/")
                .filter { !$0.hasPrefix("(") && $0 != "index" && !$0.hasPrefix("_") }
            if relative.split(separator: "/").last?.hasPrefix("_") == true { continue }
            routes.insert("/" + segments.joined(separator: "/"))
        }
        return routes
    }

    @MainActor
    func testARepeatedScreenIsReportedOnce() {
        let analytics = makeClient()
        analytics.screen(AnalyticsScreen.notes)
        analytics.screen(AnalyticsScreen.notes)
        analytics.screen(AnalyticsScreen.note)
        analytics.screen(AnalyticsScreen.notes)
        XCTAssertEqual(screens(analytics), ["/notes", "/notes/[id]", "/notes"])
    }

    // MARK: Identity

    func testNoResetOnTheBareSignedOutState() {
        // The 2026-09-20 regression: Clerk reports nobody signed in for a beat on
        // every cold start, and resetting there minted a new person per launch.
        XCTAssertEqual(AnalyticsRules.identityAction(previousUserID: nil, userID: nil), .none)
        XCTAssertEqual(AnalyticsRules.identityAction(previousUserID: nil, userID: "user_1"), .identify("user_1"))
        XCTAssertEqual(AnalyticsRules.identityAction(previousUserID: "user_1", userID: nil), .reset)
    }

    @MainActor
    func testAnonymousTrailSurvivesToTheAccount() throws {
        let analytics = makeClient()
        let anonymous = analytics.anonymousID
        analytics.sessionChanged(userID: nil) // cold start, Clerk not restored yet
        XCTAssertEqual(analytics.anonymousID, anonymous, "the launch's anonymous id must survive")
        analytics.screen(AnalyticsScreen.signIn)
        analytics.sessionChanged(userID: "user_1")

        let identify = try XCTUnwrap(analytics.pending.last)
        XCTAssertEqual(identify["event"] as? String, "$identify")
        XCTAssertEqual(identify["distinct_id"] as? String, "user_1")
        let properties = try XCTUnwrap(identify["properties"] as? [String: Any])
        XCTAssertEqual(properties["$anon_distinct_id"] as? String, anonymous)
        // A test client that signs in flags the person (Android's identify()).
        XCTAssertEqual((properties["$set"] as? [String: Any])?["$internal_or_test_user"] as? Bool, true)

        analytics.screen(AnalyticsScreen.chat)
        let after = try XCTUnwrap(analytics.pending.last?["properties"] as? [String: Any])
        XCTAssertEqual(after["distinct_id"] as? String, "user_1")
        XCTAssertNil(after["$process_person_profile"], "an identified event builds the person")

        // A real sign-out does reset, so the next person on this device does
        // not inherit the trail.
        analytics.sessionChanged(userID: nil)
        XCTAssertNotEqual(analytics.anonymousID, anonymous)
        XCTAssertFalse(analytics.isIdentified)
    }

    // MARK: Lifecycle

    func testLaunchEvents() {
        XCTAssertEqual(
            AnalyticsRules.launchEvent(storedVersion: nil, storedBuild: nil, version: "1.10.0", build: "11")?.name,
            "Application Installed"
        )
        let update = AnalyticsRules.launchEvent(storedVersion: "1.9.0", storedBuild: "10", version: "1.10.0", build: "11")
        XCTAssertEqual(update?.name, "Application Updated")
        XCTAssertEqual(update?.properties["previous_version"], "1.9.0")
        XCTAssertNil(AnalyticsRules.launchEvent(storedVersion: "1.10.0", storedBuild: "11", version: "1.10.0", build: "11"))
    }

    @MainActor
    func testStartThenBackgroundThenReturn() {
        let analytics = makeClient()
        analytics.start()
        analytics.phaseChanged(to: "inactive")
        analytics.phaseChanged(to: "background")
        analytics.phaseChanged(to: "active")
        XCTAssertEqual(
            analytics.pending.map { $0["event"] as? String },
            ["Application Installed", "Application Opened", "Application Backgrounded", "Application Opened"]
        )
        let reopened = analytics.pending.last?["properties"] as? [String: Any]
        XCTAssertEqual(reopened?["from_background"] as? Bool, true)
    }

    // MARK: Failed requests

    func testRouteShapeMatchesTheTypeScriptImplementation() throws {
        let url = Self.repoRoot.appending(path: "macos/SureWord-iOSTests/Fixtures/route-shape.json")
        let cases = try JSONDecoder().decode([[String]].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(cases.count, 10)
        for pair in cases {
            XCTAssertEqual(AnalyticsRules.routeShape(pair[0]), pair[1], pair[0])
        }
    }

    @MainActor
    func testRequestFailuresAreThrottledPerRouteAndCause() throws {
        var clock = Date(timeIntervalSince1970: 1_000)
        let analytics = makeClient(now: { clock })
        analytics.trackRequestFailure(path: "/api/notes/cm1234567890abcdef?summary=1", kind: "offline", status: nil)
        analytics.trackRequestFailure(path: "/api/notes/cm0987654321abcdef", kind: "offline", status: nil)
        analytics.trackRequestFailure(path: "/api/notes/cm0987654321abcdef", kind: "http", status: 500)
        clock = clock.addingTimeInterval(31)
        analytics.trackRequestFailure(path: "/api/notes/cm1234567890abcdef", kind: "offline", status: nil)

        let failures = analytics.pending.compactMap { $0["properties"] as? [String: Any] }
        XCTAssertEqual(failures.count, 3)
        XCTAssertEqual(failures.map { $0["route"] as? String }, ["/api/notes/[id]", "/api/notes/[id]", "/api/notes/[id]"])
        XCTAssertEqual(failures.map { $0["kind"] as? String }, ["offline", "http", "offline"])
        XCTAssertEqual(failures[1]["status"] as? Int, 500)
        XCTAssertTrue(failures[0]["status"] is NSNull)
        XCTAssertEqual(failures[0]["app_state"] as? String, "active")
    }

    // MARK: Helpers

    @MainActor
    private func makeClient(now: @escaping () -> Date = Date.init) -> Analytics {
        let suite = "analytics-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return Analytics(transport: NullTransport(), defaults: defaults, now: now)
    }

    @MainActor
    private func screens(_ analytics: Analytics) -> [String] {
        analytics.pending.compactMap { ($0["properties"] as? [String: Any])?["screen"] as? String }
    }
}

/// Never sends; the tests read the queue instead.
private struct NullTransport: AnalyticsTransport {
    func send(_ body: Data) async -> Bool { false }
}
