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
                "style", "format",
                "outcome", "stage", "stops_seen", "stops",
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

    /// Every key Android's call sites send must survive this allowlist, or the
    /// Apple half of a chart is missing a column. `share_card_shared` lost
    /// `style` and `format` that way until LC-16619.
    func testEveryPropertyAndroidSendsIsAllowlisted() throws {
        var keysByEvent: [String: Set<String>] = [:]
        let blockComment = try Regex(#"/\*[\s\S]*?\*/"#)
        let lineComment = try Regex(#"//[^\n]*"#)
        for file in Self.androidSources() {
            let source = try String(contentsOf: file, encoding: .utf8)
                .replacing(blockComment, with: "")
                .replacing(lineComment, with: "")
            for call in source.matches(of: /track\(ANALYTICS_EVENTS\.(\w+),\s*\{([^}]*)\}/) {
                for piece in call.output.2.split(separator: ",") {
                    let entry = piece.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let key = entry.prefixMatch(of: /(\w+)\s*(?::|$)/)?.output.1 else { continue }
                    keysByEvent[String(call.output.1), default: []].insert(String(key))
                }
            }
        }
        // The parse found the calls this test exists for.
        XCTAssertTrue(keysByEvent["shareCardShared", default: []].isSuperset(of: ["kind", "method", "style", "format"]), "\(keysByEvent)")
        XCTAssertTrue(keysByEvent["signInFailed", default: []].isSuperset(of: ["method", "reason", "step"]), "\(keysByEvent)")
        XCTAssertEqual(keysByEvent["screenViewed"], ["screen"])
        for (event, keys) in keysByEvent {
            for key in keys {
                XCTAssertTrue(AnalyticsRules.allowedPropertyKeys.contains(key), "Android sends \(key) on \(event); the Apple allowlist drops it")
            }
        }
    }

    /// Android's TypeScript under `mobile/app` and `mobile/src`, tests excluded.
    private static func androidSources() -> [URL] {
        ["mobile/app", "mobile/src"].flatMap { folder -> [URL] in
            guard let walker = FileManager.default.enumerator(at: repoRoot.appending(path: folder), includingPropertiesForKeys: nil)
            else { return [] }
            return walker.compactMap { $0 as? URL }.filter { url in
                ["ts", "tsx"].contains(url.pathExtension) && !url.lastPathComponent.contains(".test.")
            }
        }
    }

    // MARK: Shares

    func testShareCardSharedCarriesStyleAndFormatOnlyForAnImage() {
        // Android: `{ kind, style, format, method: "image" }` for the card
        // image, `{ kind, method }` for text and links.
        XCTAssertEqual(
            AnalyticsRules.shareCardShared(kind: "verse", method: "image", style: "parchment", format: "square"),
            ["kind": "verse", "method": "image", "style": "parchment", "format": "square"]
        )
        XCTAssertEqual(
            AnalyticsRules.shareCardShared(kind: "cross", method: "text", style: "parchment", format: "square"),
            ["kind": "cross", "method": "text"]
        )
        XCTAssertEqual(
            AnalyticsRules.shareCardShared(kind: "word", method: "link", style: "dawn", format: "story"),
            ["kind": "word", "method": "link"]
        )
    }

    @MainActor
    func testAShareEventKeepsItsCardOptionsAndNothingElse() throws {
        let analytics = makeClient()
        var properties = AnalyticsRules.shareCardShared(kind: "word", method: "image", style: "sanctuary", format: "story")
        properties["recipient"] = "Mom"
        properties["reference"] = "John 3:16"
        analytics.track(AnalyticsEvents.shareCardShared, properties)
        let sent = try XCTUnwrap(analytics.pending.last?["properties"] as? [String: Any])
        XCTAssertEqual(sent["kind"] as? String, "word")
        XCTAssertEqual(sent["method"] as? String, "image")
        XCTAssertEqual(sent["style"] as? String, "sanctuary")
        XCTAssertEqual(sent["format"] as? String, "story")
        XCTAssertNil(sent["recipient"])
        XCTAssertNil(sent["reference"])
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
            AnalyticsScreen.chapters, AnalyticsScreen.search, AnalyticsScreen.timeline, AnalyticsScreen.atlas,
            AnalyticsScreen.atlasEvent, AnalyticsScreen.atlasFamily, AnalyticsScreen.atlasTrace,
            AnalyticsScreen.history, AnalyticsScreen.learn,
            AnalyticsScreen.plan, AnalyticsScreen.sermons, AnalyticsScreen.sermon, AnalyticsScreen.cross, AnalyticsScreen.notes,
            AnalyticsScreen.note, AnalyticsScreen.memories, AnalyticsScreen.settings, AnalyticsScreen.feedback,
            AnalyticsScreen.settingsAccount, AnalyticsScreen.settingsAppearance, AnalyticsScreen.settingsLanguage,
            AnalyticsScreen.settingsHighlights, AnalyticsScreen.settingsChurch, AnalyticsScreen.settingsMemory,
            AnalyticsScreen.settingsAI, AnalyticsScreen.settingsShared, AnalyticsScreen.settingsNotifications,
            AnalyticsScreen.settingsAbout, AnalyticsScreen.settingsWhatsNew,
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

    @MainActor
    func testClosingASheetReportsTheScreenUnderItOnlyIfNothingElseDid() {
        let analytics = makeClient()
        analytics.screen(AnalyticsScreen.bible)
        analytics.screen(AnalyticsScreen.history)
        analytics.screenReturned(from: AnalyticsScreen.history, to: AnalyticsScreen.bible)
        // Opening the log again after closing it is a second visit, not a redraw.
        analytics.screen(AnalyticsScreen.history)
        // A reading opened from the log reports itself before the sheet is gone.
        analytics.screen(AnalyticsScreen.chapter)
        analytics.screenReturned(from: AnalyticsScreen.history, to: AnalyticsScreen.bible)
        XCTAssertEqual(screens(analytics), ["/bible", "/bible/history", "/bible", "/bible/history", "/bible/chapter"])
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

    @MainActor
    func testACardCapabilityIDNeverReachesAFailureEvent() throws {
        // A personal card's random id opens the card, and need not hold a digit.
        let analytics = makeClient()
        analytics.trackRequestFailure(
            path: "/api/cards/personal/abcdefghijklmnop/image?style=dawn&format=story&size=full",
            kind: "http",
            status: 404
        )
        analytics.trackRequestFailure(path: "https://sureword.app/api/cards/c/QwErTyUiOpAsDfGh/image", kind: "offline", status: nil)
        let routes = analytics.pending.compactMap { ($0["properties"] as? [String: Any])?["route"] as? String }
        XCTAssertEqual(routes, ["/api/cards/personal/[id]/image", "/api/cards/c/[id]/image"])
        let serialized = String(decoding: try JSONSerialization.data(withJSONObject: analytics.pending), as: UTF8.self)
        XCTAssertFalse(serialized.contains("abcdefghijklmnop"))
        XCTAssertFalse(serialized.contains("QwErTyUiOpAsDfGh"))
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
