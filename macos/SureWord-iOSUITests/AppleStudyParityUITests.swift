import Foundation
import UIKit
import XCTest

/// Source-integrated after root review; compile and runtime acceptance pending.
/// Root runs ONE exact method before expanding this cohort. Inherits the real-account, no-fixture
/// shipping launch and manual/auth/legal stop rules. Never run the whole scheme.
/// These tests exercise native buttons; an Open-reference card is never reported
/// as an inline Markdown-link test. No purchases, messages to people, or direct HTTP account mutations.
@MainActor
final class AppleStudyParityUITests: AppleShippingUITestCase {
    private enum Stop: Error { case missing, unsafeState }
    private let ownedLearnReference = "Jonah 2:8"
    private let ownedLearnText = "They that observe lying vanities forsake their own mercy."
    private var publicJourney = "not started"
    private var capturedFailureState = false
    private var pendingListenRateBaseline: String?
    private var pendingTransportNonce: String?
    private let listenRateLabels = ["0.75x", "1x", "1.25x", "1.5x", "2x"]
        .map { "Playback speed " + $0 + ", press to change" }

    override func tearDown() async throws {
        if (testRun?.failureCount ?? 0) > 0 || (testRun?.unexpectedExceptionCount ?? 0) > 0 {
            reportScopedPublicState()
        }
        if let nonce = pendingTransportNonce {
            do {
                try await restoreAppTransport(nonce: nonce)
            } catch {
                print("QA_ATLAS_TRANSPORT_RESTORE_REQUIRED: " + nonce)
                XCTFail("App-process transport failure cleanup could not be verified")
                throw error
            }
        }
        if let baseline = pendingListenRateBaseline {
            do {
                try restorePendingListenRate()
            } catch {
                print("QA_LISTEN_RATE_CLEANUP_REQUIRED: " + baseline)
                XCTFail("Listen rate cleanup could not be verified through the normal shipping UI")
                throw error
            }
        }
    }

    /// Failure-only flags and whitelisted public Scripture inputs. Never dump
    /// the account/profile, arbitrary UI text, auth fields, or environment values.
    private func reportScopedPublicState() {
        guard !capturedFailureState else { return }
        capturedFailureState = true
        let app = XCUIApplication()
        let allowedPages = ["Today", "Bible", "Search", "Study", "Connections", "Why these connect",
                            "Genesis 1", "Genesis 2", "Genesis 50", "Exodus 1", "Revelation 22", "John 1",
                            "Learn a verse", "Learn", "People", "Moses", "Immediate family", "Jerusalem",
                            "Timeline, People & Places"]
        let pages = allowedPages.filter { app.navigationBars[$0].exists }
        let allowedInputs = ["", "John 3:16", "John 1:1", "Genesis 1", "Genesis 2", "Genesis 50",
                             "Revelation 22", "Jonah 2:8", "In the beginning God created", "En el principio",
                             "Am Anfang schuf Gott", "Moses", "Aaron", "Jerusalem", "They observe vanities.", ownedLearnText]
        func publicValue(_ field: XCUIElement) -> String {
            guard field.exists else { return "[absent]" }
            let value = field.value as? String ?? ""
            return allowedInputs.contains(value) ? value : "[outside public test allowlist]"
        }
        let editions = ["KJV", "NKJV", "BSB", "ASV", "RV1909", "LUT1912"]
            .filter { app.buttons["Search " + $0].exists && app.buttons["Search " + $0].isSelected }
        let flags: [String: Any] = [
            "journey": publicJourney,
            "pages": pages,
            "bibleSearch": publicValue(app.searchFields.firstMatch),
            "connectionsInput": publicValue(app.textFields["Go to a verse or chapter"]),
            "atlasInput": publicValue(app.textFields["Search the Bible atlas"]),
            "traceInput": publicValue(app.textFields["Search a person to trace"]),
            "selectedSearchEditions": editions,
            "wordsTabSelected": app.segmentedControls.buttons["Words"].exists && app.segmentedControls.buttons["Words"].isSelected,
            "seeAlsoTabSelected": app.segmentedControls.buttons["See also"].exists && app.segmentedControls.buttons["See also"].isSelected,
            "strongsVisible": app.staticTexts["STRONG'S"].exists,
            "explanationCompleted": app.buttons["Keep studying this in chat"].exists,
            "ownedLearnReferenceVisible": app.staticTexts[ownedLearnReference + " · KJV"].exists,
            "learnStageZeroVisible": app.staticTexts["Read the verse, then continue."].exists,
            "learnEmptyDueQueueVisible": app.staticTexts["No verses are due right now."].exists,
            "offlineGuardRequested": ProcessInfo.processInfo.environment["SW_QA_NETWORK_MODE"] == "offline",
            "offlineReceiptPresent": !(ProcessInfo.processInfo.environment["SW_QA_NETWORK_RECEIPT"] ?? "").isEmpty,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: flags, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_STUDY_PUBLIC_FAILURE_STATE: " + text)
        }
    }

    private func require(_ value: Bool, _ message: String) throws {
        guard value else {
            reportScopedPublicState()
            XCTFail("STUDY_PARITY_STOP: " + message)
            throw Stop.missing
        }
    }

    private func wait(_ app: XCUIApplication, seconds: TimeInterval = 30,
                      _ condition: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            try checkManualStep(app)
            if condition() { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        try require(condition(), "Expected source-backed state did not settle")
    }

    private func prefixButton(_ prefix: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func replace(_ field: XCUIElement, text: String, app: XCUIApplication) throws {
        try tap(field, in: app)
        for _ in 0..<3 {
            let current = (field.value as? String) ?? ""
            // A real value may equal the placeholder (e.g. John3:16).
            // Clear every observed nonempty value before entering new input.
            if current.isEmpty { break }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 4))
        }
        field.typeText(text)
        try require((field.value as? String) == text, "Observed input differs from intended test value")
    }

    /// Coordinates only scroll the observed app content; activation uses AX.
    private func reveal(_ item: XCUIElement, app: XCUIApplication) throws {
        for _ in 0..<24 {
            try checkManualStep(app)
            if item.exists, item.frame.width > 0, item.frame.height > 0,
               app.frame.contains(item.frame), item.isHittable { return }
            try scrollObservedContent(toward: item, in: app)
        }
        try require(false, "Content control cannot be revealed through real scrolling")
    }

    private func tapContent(_ item: XCUIElement, app: XCUIApplication) throws {
        try reveal(item, app: app)
        try tap(item, in: app)
    }

    private func tapChip(_ item: XCUIElement, app: XCUIApplication) throws {
        // Chips can be horizontally present but vertically hidden behind the
        // keyboard/tab bar. Reveal the owning strip before horizontal panning.
        let publicChip = NSPredicate(format: "SELF MATCHES %@",
            "Search (KJV|NKJV|BSB|ASV|RV1909|LUT1912)|All [0-9]+|(Law|History|Poetry & Wisdom|Major Prophets|Minor Prophets|Gospels|Acts|Pauline Epistles|General Epistles|Revelation), [0-9]+|All eras|Creation & the Patriarchs|Egypt & the Exodus|Conquest & Judges|United Kingdom|Divided Kingdom|Exile & Return|Between the Testaments|Life of Christ|The Early Church")
        var observations: [[String: Any]] = []
        var reportedFailure = false
        func bounds(_ frame: CGRect) -> [String: Double] {
            ["x": Double(frame.minX), "y": Double(frame.minY),
             "width": Double(frame.width), "height": Double(frame.height)]
        }
        func exposed(_ element: XCUIElement) -> [String: Any] {
            guard element.exists else { return ["exists": false] }
            let raw = element.label
            return ["exists": true, "label": publicChip.evaluate(with: raw) ? raw : "[outside public chip allowlist]",
                    "frame": bounds(element.frame), "hittable": element.isHittable,
                    "enabled": element.isEnabled, "selected": element.isSelected]
        }
        func visibleClip() -> CGRect {
            let frame = app.frame
            let navigationBottom = app.navigationBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.maxY }.max() ?? frame.minY
            let keyboardTop = app.keyboards.allElementsBoundByIndex
                .filter { $0.exists }.map { $0.frame.minY }.min() ?? frame.maxY
            let tabTop = app.tabBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.minY }.min() ?? frame.maxY
            let top = max(frame.minY + 8, navigationBottom + 8)
            let bottom = min(frame.maxY - 8, keyboardTop - 8, tabTop - 8)
            return CGRect(x: frame.minX + 8, y: top,
                          width: max(0, frame.width - 16), height: max(0, bottom - top))
        }
        func horizontalStrips() -> [XCUIElement] {
            app.scrollViews.allElementsBoundByIndex.filter {
                $0.exists && $0.frame.height > 20 && $0.frame.height < 110 && $0.frame.width > 200
            }
        }
        func reportFailure(_ reason: String) {
            guard !reportedFailure else { return }
            reportedFailure = true
            let labels = app.buttons.allElementsBoundByIndex.filter {
                $0.exists && publicChip.evaluate(with: $0.label)
            }.prefix(20).map { exposed($0) }
            let strips = horizontalStrips().prefix(8).map { strip -> [String: Any] in
                let children = strip.descendants(matching: .button).allElementsBoundByIndex.filter {
                    $0.exists && publicChip.evaluate(with: $0.label)
                }.prefix(16).map { exposed($0) }
                return ["frame": bounds(strip.frame), "hittable": strip.isHittable,
                        "publicChipChildren": children]
            }
            let metadata: [String: Any] = [
                "reason": reason, "target": exposed(item), "visibleClip": bounds(visibleClip()),
                "appFrame": bounds(app.frame), "publicChips": labels, "strips": strips,
                "keyboardFrames": app.keyboards.allElementsBoundByIndex.filter { $0.exists }.map { bounds($0.frame) },
                "tabBarFrames": app.tabBars.allElementsBoundByIndex.filter { $0.exists }.map { bounds($0.frame) },
                "navigationBarFrames": app.navigationBars.allElementsBoundByIndex.filter { $0.exists }.map { bounds($0.frame) },
                "attempts": observations
            ]
            if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                print("QA_CHIP_VISIBILITY_FAILURE: " + text)
            }
            // Explicit attachment survives collect-test-diagnostics=never.
            // Capture only the public Connections page, never a manual alert.
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let page = app.navigationBars["Connections"]
            if page.exists && page.isHittable && app.alerts.count == 0 && springboard.alerts.count == 0 {
                let attachment = XCTAttachment(screenshot: app.screenshot())
                attachment.name = "connections-chip-visibility-failure"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
        func stop(_ reason: String) throws {
            reportFailure(reason)
            try require(false, reason)
        }
        var completed = false
        defer {
            if !completed { reportFailure("Chip helper stopped before successful activation") }
        }
        for attempt in 0..<16 {
            try checkManualStep(app)
            guard item.exists else { try stop("Requested chip is absent; no strip will be guessed"); return }
            let label = item.label
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
            guard matches.count == 1 else { try stop("Requested chip label is ambiguous; refusing a guessed match"); return }
            let target = matches[0] // Count above establishes uniqueness.
            let owners = horizontalStrips().filter { strip in
                strip.descendants(matching: .button).matching(NSPredicate(format: "label == %@", label)).count == 1
            }
            guard owners.count == 1 else { try stop("Chip must belong to exactly one observed horizontal strip"); return }
            let strip = owners[0] // Real AX descendant membership, not a Y-only guess.
            let clip = visibleClip()
            guard clip.width > 100 && clip.height > 90 else {
                try stop("No usable content viewport exists above keyboard and tab bar"); return
            }
            let frame = target.frame
            var observation: [String: Any] = ["attempt": attempt, "target": exposed(target),
                                               "stripFrame": bounds(strip.frame), "clip": bounds(clip)]
            if strip.frame.minY < clip.minY || strip.frame.maxY > clip.maxY {
                observation["action"] = "vertical reveal of unique owning strip"
                observations.append(observation)
                try scrollObservedContent(toward: strip, in: app)
                continue
            }
            let viewport = strip.frame.intersection(clip)
            guard !viewport.isNull && viewport.width > 100 && viewport.height > 20 else {
                observations.append(observation)
                try stop("Observed owning strip has no usable visible intersection"); return
            }
            if viewport.contains(frame) {
                if target.isHittable && target.isEnabled {
                    try tap(target, in: app)
                    completed = true
                    return
                }
                observation["action"] = "wait for fully visible chip to become hittable"
                observations.append(observation)
                continue // Never pan a chip that is already horizontally visible.
            }
            guard frame.width > 0 && frame.height > 0 && frame.width <= viewport.width
                    && frame.minY >= viewport.minY && frame.maxY <= viewport.maxY else {
                observations.append(observation)
                try stop("Chip geometry cannot fit the revealed owning strip"); return
            }
            let delta = frame.midX - viewport.midX
            let fraction = min(0.34, max(0.12, abs(delta) / viewport.width))
            let startX: CGFloat = delta >= 0 ? 0.75 : 0.25
            let endX = startX + (delta >= 0 ? -fraction : fraction)
            observation["action"] = "horizontal pan inside revealed owning strip"
            observation["startX"] = Double(startX)
            observation["endX"] = Double(endX)
            observations.append(observation)
            func point(_ x: CGFloat) -> XCUICoordinate {
                app.coordinate(withNormalizedOffset: CGVector(
                    dx: (viewport.minX + viewport.width * x - app.frame.minX) / app.frame.width,
                    dy: (viewport.midY - app.frame.minY) / app.frame.height))
            }
            point(startX).press(forDuration: 0.1, thenDragTo: point(endX))
        }
        try stop("Chip did not become fully visible and hittable within 16 bounded attempts")
    }

    private func back(_ app: XCUIApplication, to title: String) throws {
        try tap(app.navigationBars.buttons.element(boundBy: 0), in: app)
        try require(app.navigationBars[title].waitForExistence(timeout: 20), "Back did not return to " + title)
    }

    private func openSearch(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Bible"], in: app)
        try require(app.navigationBars["Bible"].waitForExistence(timeout: 20),
                    "A cold normal launch must expose the Bible root before this journey")
        try tap(app.buttons["Search the Bible"], in: app)
        try require(app.navigationBars["Search"].waitForExistence(timeout: 15), "Bible Search did not open")
    }

    private func searchField(_ app: XCUIApplication) throws -> XCUIElement {
        let field = app.searchFields.firstMatch
        try require(app.searchFields.count == 1 && field.waitForExistence(timeout: 15),
                    "Bible Search must expose exactly one search field")
        return field
    }

    private func jump(_ reference: String, translation: String = "KJV", app: XCUIApplication) throws {
        try tapChip(app.buttons["Search " + translation], app: app)
        try replace(try searchField(app), text: reference, app: app)
        try tapContent(app.buttons["Go to " + reference], app: app)
        let chapter = String(reference.split(separator: ":")[0])
        try require(app.navigationBars[chapter].waitForExistence(timeout: 20), "Reference jump opened wrong chapter")
    }

    private func verseRow(_ reference: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@",
            reference + ".", reference + ", has a study note.")).firstMatch
    }

    private func assertVerse(_ reference: String, text: String? = nil, app: XCUIApplication) throws {
        // The optional note marker precedes '.', and verse 10 is not verse 1.
        let row = verseRow(reference, app: app)
        try require(row.waitForExistence(timeout: 25), "Actual verse row is missing: " + reference)
        if let text { try require(row.label.contains(text), "Reader has the wrong translation wording") }
    }

    // reader.canon, reader.translations, search.reference, search.phrase.
    // Search chips are local choices; the account's Bible preference is untouched.
    func testSixTranslationPhraseHitsOpenTheirOwnWordingAndCanonNavigationStopsAtEdges() throws {
        publicJourney = "reader-search-canon"
        let app = try shippingApp()
        try openSearch(app)
        let editions: [(String, String, String)] = [
            ("KJV", "In the beginning God created", "In the beginning God created the heaven and the earth."),
            ("NKJV", "In the beginning God created", "In the beginning God created the heavens and the earth."),
            ("BSB", "In the beginning God created", "In the beginning God created the heavens and the earth."),
            ("ASV", "In the beginning God created", "In the beginning God created the heavens and the earth."),
            ("RV1909", "En el principio", "En el principio crió Dios los cielos y la tierra."),
            ("LUT1912", "Am Anfang schuf Gott", "Am Anfang schuf Gott Himmel und Erde."),
        ]
        for (id, query, text) in editions {
            try tapChip(app.buttons["Search " + id], app: app)
            try require(app.buttons["Search " + id].isSelected, "Search edition chip did not select")
            try replace(try searchField(app), text: query, app: app)
            let hit = prefixButton("Genesis 1:1 " + id, app: app)
            try require(hit.waitForExistence(timeout: 45), "Requested translation returned no known phrase hit")
            try tapContent(hit, app: app)
            try require(app.navigationBars["Genesis 1"].waitForExistence(timeout: 20), "Hit did not open Genesis 1")
            try wait(app) { app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists }
            try assertVerse("Genesis 1:1", text: text, app: app)
            try back(app, to: "Search")
        }
        try jump("Genesis 1", app: app)
        try reveal(app.buttons["Previous"], app: app)
        try require(!app.buttons["Previous"].isEnabled, "Previous at Genesis 1 must be disabled")
        try back(app, to: "Search")
        try jump("Genesis 50", app: app)
        try tapContent(app.buttons["Next"], app: app)
        try require(app.navigationBars["Exodus 1"].waitForExistence(timeout: 20), "Genesis 50 did not advance to Exodus 1")
        try tapContent(app.buttons["Previous"], app: app)
        try require(app.navigationBars["Genesis 50"].waitForExistence(timeout: 20), "Exodus 1 did not return to Genesis 50")
        try back(app, to: "Search")
        try jump("Revelation 22", app: app)
        try reveal(app.buttons["Next"], app: app)
        try require(!app.buttons["Next"].isEnabled, "Next at Revelation 22 must be disabled")
    }

    // words.rows, verse.crossrefs; this is a cross-reference BUTTON journey.
    func testReaderGreekWordStrongDefinitionAndSeeAlsoReferenceOpenTheCorrectReader() throws {
        publicJourney = "reader-words-crossrefs"
        let app = try shippingApp()
        try openSearch(app)
        try jump("John 1:1", app: app)
        try tapContent(verseRow("John 1:1", app: app), app: app)
        try tap(app.buttons["Expand details"], in: app)
        try tap(app.segmentedControls.buttons["Words"], in: app)
        let greek = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS 'Greek' AND label CONTAINS 'Textus Receptus' AND label CONTAINS 'in reading order'")).firstMatch
        try require(greek.waitForExistence(timeout: 120), "Words did not identify the Greek source")
        // Interlinear rows have their actual KJV wording as the AX label.
        try tapContent(app.buttons["God"], app: app)
        try require(app.staticTexts["STRONG'S"].waitForExistence(timeout: 45), "Opening the God row did not expose Strong's")
        try wait(app, seconds: 45) {
            let labels = app.staticTexts.allElementsBoundByIndex.map(\.label)
            guard let at = labels.firstIndex(of: "STRONG'S"), at + 1 < labels.count else { return false }
            return !labels[at + 1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && labels[at + 1] != "…"
        }
        try require(app.buttons["Ask about this word"].exists, "Word-specific Ask action is absent")
        let occurrences = app.buttons.matching(NSPredicate(
            format: "label == 'Find occurrences' OR label BEGINSWITH 'Original verse'")).firstMatch
        try require(occurrences.exists && !prefixButton("Every verse", app: app).exists,
                    "Word search action must identify the original-edition count scope or omit its count")
        try reveal(occurrences, app: app)
        try require(occurrences.isHittable, "Occurrence action is not visible and usable in the word detail")
        print("QA_WORD_OCCURRENCE_ACTION: " + occurrences.label)
        let countScope = XCTAttachment(screenshot: app.screenshot())
        countScope.name = "word-concordance-count-scope"
        countScope.lifetime = .keepAlways
        add(countScope)
        try tapContent(app.segmentedControls.buttons["See also"], app: app)
        let related = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open '")).firstMatch
        try require(related.waitForExistence(timeout: 45), "See also produced no navigable reference")
        let raw = String(related.label.dropFirst("Open ".count))
        let first = raw.components(separatedBy: CharacterSet(charactersIn: "-–—"))[0]
        try require(first.contains(":"), "Cross-reference button did not contain a verse target")
        try tapContent(related, app: app)
        let chapter = first.components(separatedBy: ":")[0]
        try require(app.navigationBars[chapter].waitForExistence(timeout: 20), "See also opened the wrong chapter")
        try assertVerse(first, app: app)
        try back(app, to: "John 1")
        // Both clients close the verse overlay before pushing a reference
        // (Android openCrossReference and iOS openCrossReference). Back must
        // restore the source reader, rather than reopen a dismissed overlay.
        try assertVerse("John 1:1", app: app)
        try require(!app.segmentedControls.firstMatch.exists,
                    "Reader return resurrected the closed verse overlay")
    }

    // connections.ring, connections.explain; no Chat message is sent.
    func testConnectionsCanonFilterCompletedExplanationAndCitedReferenceReaderHandoff() throws {
        publicJourney = "connections-explanation"
        let app = try shippingApp()
        try tap(app.tabBars.buttons["Connections"], in: app)
        try replace(app.textFields["Go to a verse or chapter"], text: "John 3:16", app: app)
        try tap(app.buttons["Go"], in: app)
        let all = app.buttons.matching(NSPredicate(format: "label MATCHES 'All [1-9][0-9]*'")).firstMatch
        try require(all.waitForExistence(timeout: 45), "Connections did not load a nonempty focus")
        let filter = app.buttons.matching(NSPredicate(format:
            "label MATCHES '(Law|History|Poetry & Wisdom|Major Prophets|Minor Prophets|Gospels|Acts|Pauline Epistles|General Epistles|Revelation), [1-9][0-9]*'")).firstMatch
        try require(filter.exists, "No source-defined nonempty canon filter appeared")
        let count = try XCTUnwrap(Int(filter.label.components(separatedBy: ", ").last ?? ""))
        try tapChip(filter, app: app)
        try require(filter.isSelected, "Canon filter did not become selected")
        try require(app.staticTexts["CONNECTED VERSES  \(count)"].waitForExistence(timeout: 15), "Filtered passage count disagrees with chip")
        try tapContent(app.buttons["Ask why these connect"], app: app)
        try require(app.navigationBars["Why these connect"].waitForExistence(timeout: 20), "Explanation sheet did not open")
        try require(app.buttons["Keep studying this in chat"].waitForExistence(timeout: 120),
                    "Explanation did not reach its completed state")
        let citation = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Open '")).firstMatch
        try require(citation.exists, "Completed explanation has no navigable citation")
        let raw = String(citation.label.dropFirst("Open ".count))
        let first = raw.components(separatedBy: CharacterSet(charactersIn: "-–—"))[0]
        try tapContent(citation, app: app)
        try require(app.tabBars.buttons["Bible"].isSelected, "Cited reference did not switch to Bible")
        try require(app.navigationBars[first.components(separatedBy: ":")[0]].waitForExistence(timeout: 20), "Wrong cited chapter opened")
        try assertVerse(first, app: app)
    }

    // learn.queue/mask/modes/typed. Mutates ONLY the reserved new QA verse.
    // Root must reserve Jonah 2:8 in its ownership ledger and confirm it is NOT
    // an existing user's Learn card. A due-empty queue alone does not prove that.
    // No Learn delete UI exists: retain the named QA card and report it for cleanup.
    func testReservedNewLearnVerseFourModesTypedGradeAndAllMaskStages() throws {
        publicJourney = "reserved-learn-card"
        guard ProcessInfo.processInfo.environment["SW_QA_LEARN_FRESH_REFERENCE"] == ownedLearnReference,
              ProcessInfo.processInfo.environment["SW_QA_LEARN_FRESH_CONFIRMED"] == "YES" else {
            throw XCTSkip("Root must reserve a new test-owned Jonah 2:8 Learn card before this mutating journey")
        }
        var app = try shippingApp()
        try tap(app.tabBars.buttons["Today"], in: app)
        try tapContent(prefixButton("Learn a verse", app: app), app: app)
        guard app.staticTexts["No verses are due right now."].waitForExistence(timeout: 30) else {
            throw XCTSkip("Existing queue or suggestions require inspection; do not review another user's card")
        }
        app = try shippingApp()
        try openSearch(app)
        try jump(ownedLearnReference, app: app)
        try tapContent(verseRow(ownedLearnReference, app: app), app: app)
        try tapChip(app.buttons["Learn"], app: app)
        try require(app.buttons["Added"].waitForExistence(timeout: 30), "Learn add did not acknowledge the reserved verse")
        print("QA_OWNED_LEARN_RETAINED: Jonah 2:8 KJV; this test has no delete affordance")
        try tap(app.buttons["Added"], in: app)
        try require(app.staticTexts[ownedLearnReference + " · KJV"].waitForExistence(timeout: 30), "Learn opened on a different card; no review permitted")
        try require(app.staticTexts["Read the verse, then continue."].exists,
                    "Reserved card is not new at stage zero; no review permitted")
        let known = app.staticTexts.matching(NSPredicate(format: "label MATCHES '[0-9]+ verses you know'")).firstMatch
        try require(known.waitForExistence(timeout: 15), "Learn known-count header is unavailable")
        let beforeKnown = try XCTUnwrap(Int(known.label.components(separatedBy: " ").first ?? ""))
        func mode(_ title: String) throws { try tapContent(app.buttons["Practice mode: " + title], app: app) }
        try mode("First letters")
        try require(app.buttons["See word 1"].exists, "First-letter reveal control is absent")
        try tapContent(app.buttons["See word 1"], app: app)
        try require(app.staticTexts["They"].exists, "First-letter reveal did not expose its word")
        try mode("Tap the next word")
        try tapContent(app.buttons["Place mercy."], app: app)
        try require(app.staticTexts["That word comes later. The next one is marked."].exists,
                    "Wrong ordered-word tap was not identified")
        for word in ownedLearnText.split(separator: " ").map(String.init) {
            try tapContent(app.buttons["Place " + word], app: app)
        }
        try require(app.staticTexts["That is the verse."].exists, "Correct word order did not finish")
        try mode("Type it out")
        let typed = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Type the verse'")).firstMatch
        try reveal(typed, app: app)
        try replace(typed, text: "They observe vanities.", app: app)
        try tapContent(app.buttons["Check the verse"], app: app)
        try require(app.staticTexts["The marked words are the ones to mend."].exists && !app.buttons["Continue"].isEnabled,
                    "Imperfect typed recall was permitted to advance")
        try replace(typed, text: ownedLearnText, app: app)
        try tapContent(app.buttons["Check the verse"], app: app)
        try require(app.staticTexts["Word for word."].exists && app.buttons["Continue"].isEnabled,
                    "Exact typed recall did not permit advancement")
        try mode("Fill the blanks")
        let expectedHidden = [2, 4, 9] // Nine-word Jonah 2:8: fourths, half, all.
        for hidden in expectedHidden {
            try tapContent(app.buttons["Continue"], app: app)
            if hidden == 4 {
                try wait(app) { app.buttons["Practice mode: First letters"].isSelected || app.buttons["Practice mode: Tap the next word"].isSelected }
                try mode("Fill the blanks")
            } else if hidden == 9 {
                try wait(app) { app.buttons["Practice mode: Type it out"].isSelected }
                try mode("Fill the blanks")
            }
            try wait(app) {
                app.buttons.matching(NSPredicate(format: "label MATCHES 'Reveal word [0-9]+' ")).count == hidden
            }
            try require(app.staticTexts[ownedLearnReference + " · KJV"].exists, "A review advanced an unowned card")
        }
        try tapContent(app.buttons["I remembered"], app: app)
        try wait(app) { !app.staticTexts[self.ownedLearnReference + " · KJV"].exists }
        try require(app.staticTexts["\(beforeKnown + 1) verses you know"].exists, "Known count did not advance exactly once")
    }

    private func requireOwnedJourney(_ key: String) throws {
        try require(ProcessInfo.processInfo.environment[key] == "1",
                    "Root must reserve this QA journey and forward " + key + "=1 to the TEST RUNNER only")
    }

    private func openCross(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Today"], in: app)
        try tapContent(app.buttons["Read today's word"], app: app)
        try require(app.navigationBars["Pick Up Your Cross"].waitForExistence(timeout: 30),
                    "Today's word did not open its shipping Cross sheet")
    }

    private func devotionalSeconds(_ app: XCUIApplication) -> Int? {
        let value = app.sliders["Devotional position"].value as? String ?? ""
        let clock = value.components(separatedBy: " of ").first ?? ""
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }

    /// Both the success path and teardown use the actually observed current
    /// speed. A failed assertion can leave the cycle at any point; four blind
    /// taps are only correct when exactly one initial change succeeded.
    private func restorePendingListenRate() throws {
        guard let baseline = pendingListenRateBaseline else { return }
        try require(listenRateLabels.contains(baseline), "Pending Listen baseline is outside the source-defined speed cycle")
        var app = try shippingApp() // Also stops playback left running by a failed assertion.
        try openCross(app)
        try wait(app, seconds: 45) { app.buttons["Play devotional"].exists }
        let speed = prefixButton("Playback speed ", app: app)
        var current = speed.label
        try require(listenRateLabels.contains(current), "Listen cleanup cannot identify the actual starting playback speed")
        for _ in 0..<4 where current != baseline {
            let observed = current
            let index = try XCTUnwrap(listenRateLabels.firstIndex(of: observed))
            let expected = listenRateLabels[(index + 1) % listenRateLabels.count]
            try tapContent(speed, app: app)
            try wait(app) { speed.label == expected }
            current = speed.label
        }
        try require(current == baseline, "Observed Listen speed cycle did not restore its reserved baseline")
        app = try shippingApp()
        try openCross(app)
        try wait(app, seconds: 45) { app.buttons["Play devotional"].exists }
        try require(prefixButton("Playback speed ", app: app).label == baseline,
                    "Restored playback speed did not survive a normal cold reopen")
        try tap(app.navigationBars["Pick Up Your Cross"].buttons["Close"], in: app)
        pendingListenRateBaseline = nil
        print("QA_LISTEN_RATE_CLEANUP_UI_CONFIRMED: " + baseline)
    }

    // T3 bounded Pro journey only. Root reserves the reviewer's current idle
    // Cross day for ONE explicit paid narration request. No replacement/retry.
    // Snapshot sureword.narrationOptions before running: commit saves the same
    // observed narrator/style, but may materialize a previously absent default.
    // Free lock, unavailable server, replacement and failure recovery remain
    // separate gates. A ready/preparing baseline is a failure, never a skip.
    func testOwnedProListenIdleSetupSingleGenerationPlaybackTranscriptAndReopen() throws {
        publicJourney = "owned-pro-listen"
        try requireOwnedJourney("SW_QA_LISTEN_OWNED_IDLE_DAY")
        var app = try shippingApp()
        try openCross(app)
        let generate = app.buttons["Generate audio narrative"]
        try require(generate.waitForExistence(timeout: 45),
                    "Reserved Pro day must expose idle narration setup; ready/locked/unavailable is a different gate")
        try require(!app.staticTexts["Listen is part of SureWord Pro"].exists && !app.buttons["Play devotional"].exists,
                    "Idle Pro baseline disagrees with the expected Listen gate")
        let narrator = prefixButton("Narrator: ", app: app)
        try tapContent(narrator, app: app)
        try wait(app, seconds: 45) {
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Preview '")).count >= 2
        }
        let narratorBaseline = narrator.label
        let narratorName = String(narratorBaseline.dropFirst("Narrator: ".count))
        let styles = ["Calm", "Natural", "Expressive"]
        let selectedStyles = styles.filter { app.buttons[$0].isSelected }
        try require(selectedStyles.count == 1, "Narration must expose exactly one selected delivery")
        let styleBaseline = selectedStyles[0]
        let previews = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Preview '"))
            .allElementsBoundByIndex.map(\.label)
        let firstName = String(previews[0].dropFirst("Preview ".count))
        let secondName = String(previews[1].dropFirst("Preview ".count))
        try tapContent(app.buttons[previews[0]], app: app)
        try require(app.buttons["Stop " + firstName].waitForExistence(timeout: 10), "First preview did not enter playing/loading state")
        try tapContent(app.buttons[previews[1]], app: app)
        try require(app.buttons["Stop " + secondName].waitForExistence(timeout: 10)
                    && !app.buttons["Stop " + firstName].exists, "Starting another preview did not stop the first")
        // Samples can finish while the generic tap helper performs its
        // safety checks. Do not wait for a vanished Stop control or restart
        // a sample just to stop it. The transition above already observed
        // the second sample and the first sample's exclusion.
        try checkManualStep(app)
        let stopSecond = app.buttons["Stop " + secondName]
        if stopSecond.exists && stopSecond.isHittable {
            stopSecond.tap()
            print("QA_LISTEN_PREVIEW_EXIT: explicitly stopped second sample")
        } else {
            try require(app.buttons["Preview " + secondName].exists
                        && !app.staticTexts["This preview couldn't play. Try another voice."].exists,
                        "Second preview disappeared without returning to an error-free idle control")
            print("QA_LISTEN_PREVIEW_EXIT: second sample naturally completed before stop")
        }
        let alternateName = [firstName, secondName].first { $0 != narratorName }!
        try tapContent(prefixButton(alternateName + ", ", app: app), app: app)
        try require(narrator.label == "Narrator: " + alternateName, "Choosing another narrator did not change the setup selection")
        let baselineVoice = prefixButton(narratorName + ", ", app: app)
        try tapContent(baselineVoice, app: app)
        try require(baselineVoice.isSelected && narrator.label == narratorBaseline,
                    "Selected narrator disagrees with the original narrator")
        try tapContent(narrator, app: app)
        try tapContent(app.buttons[styles.first { $0 != styleBaseline }!], app: app)
        try tapContent(app.buttons[styleBaseline], app: app)
        try require(app.buttons[styleBaseline].isSelected, "Delivery baseline was not restored before generation")
        try tapContent(generate, app: app) // The ONLY generation tap in this method.
        try wait(app, seconds: 180) { app.buttons["Play devotional"].exists }
        try require(!generate.exists, "Ready narration still offers generation")
        try tapContent(app.buttons["Play devotional"], app: app)
        try require(app.buttons["Pause devotional"].waitForExistence(timeout: 15), "Devotional did not enter playback")
        let started = try XCTUnwrap(devotionalSeconds(app), "Devotional position must expose real clocks")
        try wait(app, seconds: 25) { (self.devotionalSeconds(app) ?? started) > started }
        try tapContent(app.buttons["Pause devotional"], app: app)
        let slider = app.sliders["Devotional position"]
        try require(slider.isEnabled, "Ready audio has no usable duration")
        slider.adjust(toNormalizedSliderPosition: 0.3)
        try wait(app) { (self.devotionalSeconds(app) ?? 0) > started + 1 }
        let speed = prefixButton("Playback speed ", app: app)
        let rateBaseline = speed.label
        try require(listenRateLabels.contains(rateBaseline),
                    "Playback speed baseline is outside the source-defined cycle")
        print("QA_LISTEN_RATE_BASELINE: " + rateBaseline)
        pendingListenRateBaseline = rateBaseline // Register BEFORE any synced speed mutation.
        try tapContent(speed, app: app)
        let changedRate = speed.label
        try require(changedRate != rateBaseline, "Playback speed did not advance")
        let before = Set(app.staticTexts.allElementsBoundByIndex.map(\.label))
        try tapContent(app.buttons["Read along"], app: app)
        let scripts = app.staticTexts.allElementsBoundByIndex.map(\.label).filter { !before.contains($0) && $0.count > 100 }
        try require(scripts.count == 1, "Read along did not expose one nonempty stored transcript")
        let script = scripts[0] // Compare in memory only; a devotional may contain private personalization.
        try tapContent(app.buttons["Hide transcript"], app: app)
        try require(!app.staticTexts.allElementsBoundByIndex.contains { $0.label == script },
                    "Hide transcript left the script exposed")
        app = try shippingApp()
        try openCross(app)
        try require(app.buttons["Play devotional"].waitForExistence(timeout: 45) && !app.buttons["Generate audio narrative"].exists,
                    "Cold reopen did not reuse saved narration")
        try require(prefixButton("Playback speed ", app: app).label == changedRate, "Playback speed did not persist on reopen")
        try tapContent(app.buttons["Read along"], app: app)
        try require(app.staticTexts.allElementsBoundByIndex.contains { $0.label == script },
                    "Saved transcript changed across a normal cold reopen")
        try tapContent(app.buttons["Hide transcript"], app: app)
        try tap(app.navigationBars["Pick Up Your Cross"].buttons["Close"], in: app)
        try restorePendingListenRate()
        print("QA_OWNED_LISTEN_RETAINED: one narration on the reserved reviewer day; narrator/style preserved; rate restored")
    }

    // P4: new QA run, one completed attempt, no Learn/note mutation. Root must
    // confirm offerQuiz is enabled and Jonah 2 was not locally dismissed.
    // Completed attempts have no delete UI and are retained as reviewer QA data.
    func testOwnedChapterQuizDepthCheckedAnswersScoreAndNextChapter() throws {
        publicJourney = "owned-chapter-quiz"
        try requireOwnedJourney("SW_QA_QUIZ_OWNED_ATTEMPT")
        let app = try shippingApp()
        try openSearch(app)
        try jump("Jonah 2", app: app)
        try tapContent(app.buttons["Start quiz"], app: app)
        let options = app.buttons.matching(NSPredicate(format: "label MATCHES 'Option [A-D]: .+'"))
        try wait(app, seconds: 120) { options.count == 4 }
        try require(app.staticTexts["Jonah 2 quiz"].exists, "Quiz header does not match the requested chapter")
        try tap(app.buttons["Close quiz"], in: app)
        try require(app.navigationBars["Jonah 2"].waitForExistence(timeout: 20) && !app.buttons["Close quiz"].exists,
                    "Canceling an unanswered quiz did not return to its chapter")
        try tapContent(app.buttons["Start quiz"], app: app)
        try wait(app, seconds: 120) { options.count == 4 }
        for depth in ["Going deeper", "Foundations"] {
            try tapContent(app.segmentedControls.buttons[depth], app: app)
            try wait(app, seconds: 120) { options.count == 4 && app.segmentedControls.buttons[depth].isSelected }
        }
        let progress = app.descendants(matching: .any).matching(NSPredicate(format:
            "label MATCHES 'Question 1 of [0-9]+'")).firstMatch
        try require(progress.waitForExistence(timeout: 15), "Quiz did not expose its actual initial question total")
        let total = try XCTUnwrap(Int(progress.label.components(separatedBy: " ").last ?? ""))
        // src/lib/quiz.ts accepts 3...5 grounded questions after validation;
        // QuizContract.length=5 is the request target, not a minimum response.
        try require((3...5).contains(total), "Observed quiz total is outside the server's supported 3...5 range")
        var correct = 0
        for question in 1...total {
            try require(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Question \(question) of \(total)")).firstMatch.exists,
                        "Quiz progress does not match the answered-question count")
            try require(!app.buttons["Check answer"].isEnabled, "An unselected question can be checked")
            try tapContent(app.buttons["Show me the verse first"], app: app)
            try require(app.buttons["Read in context"].waitForExistence(timeout: 15), "Show verse did not expose its contextual reader action")
            let option = options.element(boundBy: (question - 1) % 4)
            try tapContent(option, app: app)
            try require((option.value as? String) == "Selected", "Quiz choice did not become selected")
            try tap(app.buttons["Check answer"], in: app)
            let outcome = option.value as? String ?? ""
            try require(["Selected, correct", "Selected, incorrect"].contains(outcome), "Checked choice has no explicit result")
            if outcome == "Selected, correct" { correct += 1 }
            let answers = options.allElementsBoundByIndex.filter {
                ["Selected, correct", "Correct answer"].contains($0.value as? String ?? "")
            }
            try require(answers.count == 1 && options.allElementsBoundByIndex.allSatisfy { !$0.isEnabled },
                        "Checked question must identify exactly one correct answer and lock its options")
            try tap(app.buttons[question == total ? "See how you did" : "Next question"], in: app)
            if question < total { try wait(app) { app.buttons["Check answer"].exists && options.count == 4 } }
        }
        try require(app.staticTexts["You remembered \(correct) of \(total)"].waitForExistence(timeout: 20),
                    "Results score disagrees with the observed checked answers and question total")
        try require(app.buttons["Continue to Jonah 3"].exists && app.buttons["Done"].exists,
                    "Results omitted its chapter/close exits")
        try tap(app.buttons["Continue to Jonah 3"], in: app)
        try require(app.navigationBars["Jonah 3"].waitForExistence(timeout: 20), "Continue opened the wrong next chapter")
        try assertVerse("Jonah 3:1", app: app)
        print("QA_OWNED_QUIZ_ATTEMPT_RETAINED: Jonah 2 Foundations; one completed reviewer QA attempt")
    }

    private func openServeThroughSettings(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Today"], in: app)
        try tap(app.navigationBars["Today"].buttons["Settings"], in: app)
        try tapContent(prefixButton("Ways to Serve", app: app), app: app)
        try tapContent(app.buttons["Open Ways to Serve"], app: app)
        try require(app.textViews["What I did"].waitForExistence(timeout: 30), "Serve journal did not load")
    }

    private func serveDeleteCount(_ app: XCUIApplication) -> Int {
        app.buttons.matching(NSPredicate(format: "label == 'Delete entry'")).count
    }

    private func confirmOwnedServeDelete(_ action: String, app: XCUIApplication) throws {
        let deletion = app.buttons["Delete entry"]
        try reveal(deletion, app: app)
        try checkManualStep(app)
        try require(serveDeleteCount(app) == 1 && deletion.isHittable,
                    "Cleanup must target the sole independently reserved QA journal entry")
        // Base tap intentionally rejects all alerts after activation. This
        // button opens a known confirmation, inspected before any dialog tap.
        deletion.tap()
        try waitForServeDeleteDialog(action, app: app)
        try checkManualStep(app)
    }

    private func waitForServeDeleteDialog(_ action: String, app: XCUIApplication) throws {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            let dialog = app.sheets.firstMatch.exists ? app.sheets.firstMatch : app.alerts.firstMatch
            if dialog.exists {
                try require(dialog.staticTexts["Delete this entry?"].exists,
                            "Unexpected dialog instead of the source-defined journal delete confirmation")
                if dialog.buttons[action].exists && dialog.buttons[action].isHittable {
                    dialog.buttons[action].tap()
                } else if action == "Cancel", dialog.elementType == .sheet {
                    // The same iOS 27 native confirmation popover observed in
                    // Chat can omit its role-cancel button. Only the top,
                    // visible native dismissal region can cancel this exact
                    // reserved journal entry's source-defined dialog.
                    let dismiss = app.otherElements.matching(identifier: "PopoverDismissRegion")
                        .allElementsBoundByIndex.filter {
                            $0.label == "dismiss popup" && app.frame.contains($0.frame) && $0.isHittable
                        }
                    try require(dismiss.count == 1, "Journal confirmation has no unique native cancel path")
                    dismiss[0].tap()
                } else {
                    try require(false, "Expected journal confirmation action is unavailable")
                }
                return
            }
            try checkManualStep(app)
            Thread.sleep(forTimeInterval: 0.2)
        }
        try require(false, "Serve delete confirmation did not appear")
    }

    // P5 bounded journal persistence/cancel/delete. No serving preference,
    // church, contact, location, giving, Chat or public-share mutation.
    // Empty server journal + empty draft must be independently confirmed by
    // root: each entry's delete button currently has the same AX label.
    func testOwnedServeJournalColdReopenDeleteCancelAndConfirmedCleanup() throws {
        publicJourney = "owned-serve-journal"
        try requireOwnedJourney("SW_QA_SERVE_OWNED_EMPTY_JOURNAL")
        var app = try shippingApp()
        try openServeThroughSettings(app)
        let editor = app.textViews["What I did"]
        try reveal(editor, app: app)
        try require((editor.value as? String ?? "").isEmpty && serveDeleteCount(app) == 0,
                    "Journal baseline is not empty; no draft or existing entry may be changed")
        try require(!app.buttons["Save"].isEnabled, "Empty journal draft can be saved")
        let owned = "QA SureWord Serve acceptance " + UUID().uuidString
        var retained = false
        defer { if retained { print("QA_OWNED_SERVE_CLEANUP_REQUIRED: " + owned) } }
        try replace(editor, text: owned, app: app)
        retained = true // Even an ambiguous save response needs a root cleanup inspection.
        try tapContent(app.buttons["Save"], app: app)
        try require(app.staticTexts[owned].waitForExistence(timeout: 30), "Owned journal entry was not acknowledged")
        try require((editor.value as? String ?? "").isEmpty && serveDeleteCount(app) == 1,
                    "Save did not clear its own draft and create exactly one entry")
        app = try shippingApp()
        try openServeThroughSettings(app)
        try require(app.staticTexts[owned].waitForExistence(timeout: 30) && serveDeleteCount(app) == 1,
                    "Owned entry did not persist across normal cold launch")
        try confirmOwnedServeDelete("Cancel", app: app)
        try require(app.staticTexts[owned].exists, "Cancel removed the owned journal entry")
        try confirmOwnedServeDelete("Delete", app: app)
        try wait(app) { !app.staticTexts[owned].exists && self.serveDeleteCount(app) == 0 }
        app = try shippingApp()
        try openServeThroughSettings(app)
        try require(!app.staticTexts[owned].exists && serveDeleteCount(app) == 0,
                    "Deleted QA entry returned after a normal cold reopen")
        retained = false
        print("QA_OWNED_SERVE_CLEANUP_CONFIRMED: " + owned)
    }

    /// Root disconnects the WHOLE simulator before this exact method, preserving
    /// the existing signed-in app and restoring networking afterward. Require an
    /// external receipt id AND independent uncached transport failures. The env
    /// marker by itself is never offline proof. No server fixtures are injected.
    private func requireRealOfflineSetup() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["SW_QA_NETWORK_MODE"] == "offline",
              let receipt = env["SW_QA_NETWORK_RECEIPT"], !receipt.isEmpty else {
            throw XCTSkip("Root must provide a verified simulator-wide network cutoff and restoration receipt")
        }
        for origin in ["https://sureword.app/api/native-releases", "https://example.com/"] {
            let url = try XCTUnwrap(URL(string: origin + (origin.contains("?") ? "&" : "?") + "qa=" + UUID().uuidString))
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 12)
            request.httpMethod = "GET" // Read-only, no credentials or account endpoint.
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            do {
                _ = try await session.data(for: request)
                XCTFail("An uncached public request succeeded; this is not an offline run")
                throw Stop.unsafeState
            } catch let failure as URLError {
                try require([URLError.notConnectedToInternet, .timedOut, .networkConnectionLost,
                             .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed].contains(failure.code),
                            "Public probe failed for a reason that does not establish network isolation")
            }
        }
    }

    // search.phrase + atlas.offline/directories/search/entityevent/family/journey/
    // trace/chapter/timeline. Root must combine this with AtlasOfflineTests' zero
    // authentication-call assertion; signed-in UI alone cannot prove unauth access.
    func testActualOfflineColdLaunchBundledSearchAndAtlasQueries() async throws {
        // These guards throw after recording a failure. XCTest's immediate
        // interruption path synchronously waits for async teardown on the
        // same actor, so let the thrown error unwind into teardown instead.
        continueAfterFailure = true
        publicJourney = "actual-offline-search-atlas"
        try await requireRealOfflineSetup()
        let app = try shippingApp() // No evidence arguments; cached review session required.
        try exerciseBundledSearchAndAtlas(app)
    }

    /// Distinct from the whole-Simulator offline test above. Only the app's
    /// URLSession/POSIX transport is faulted; Runner and host stay online. No
    /// product fixtures, authentication entry, or connectivity state is faked.
    func testAppTransportFailureColdLaunchBundledSearchAndAtlasQueries() async throws {
        continueAfterFailure = true // Explicit throwing guards still stop immediately.
        publicJourney = "app-transport-failure-search-atlas"
        let environment = ProcessInfo.processInfo.environment
        guard environment["SW_QA_ATLAS_TRANSPORT"] == "1",
              let dylib = environment["SW_QA_ATLAS_DYLIB"],
              dylib == "/Users/spragginsdesigns/.codex/qa/sureword-apple-parity/offline-atlas-recovery/current/OfflineAtlasAppInjection.dylib" else {
            throw XCTSkip("Root must provide the reviewed app-process transport artifact and private host receipt bridge")
        }
        try await requireRunnerPublicNetwork(phase: "before-app-failure")
        let app = XCUIApplication()
        app.terminate()
        // XCTest can install/migrate its target on its first launch, after
        // xcodebuild has started Runner. Complete that normal cached-only
        // launch before the host binds the immutable installed containers.
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        try waitForShell(app)
        try verifyReviewOwner(app)
        app.terminate()
        let nonce = UUID().uuidString
        try transportHostAcknowledgment(marker: "PREPARE", phase: "prepare", nonce: nonce)
        // Set this before launch: teardown restores a normal app even when
        // startup, receipt attestation, or a later assertion fails.
        pendingTransportNonce = nonce
        app.launchArguments = []
        app.launchEnvironment = ["DYLD_INSERT_LIBRARIES": dylib,
                                 "SW_QA_INJECTION_ENABLE": "1",
                                 "SW_QA_TRANSPORT_NONCE": nonce]
        app.launch()
        try transportHostAcknowledgment(marker: "REQUEST", phase: "verify", nonce: nonce)
        // Cached authentication only. Unlike shippingApp(), this must never
        // enter credentials or attempt sign-in under injected failures.
        try waitForShell(app)
        try verifyReviewOwner(app)
        try exerciseBundledSearchAndAtlas(app)
        try transportHostAcknowledgment(marker: "CHECKPOINT", phase: "checkpoint", nonce: nonce)
        try await restoreAppTransport(nonce: nonce)
        print("QA_ATLAS_APP_TRANSPORT_ACCEPTED: bundled five-translation search and Atlas UI; bounded app-process failure only")
    }

    private func transportHostAcknowledgment(marker: String, phase: String, nonce: String,
                                               normalLaunch: Bool = false) throws {
        let runnerID = try XCTUnwrap(Bundle.main.bundleIdentifier)
        try require(runnerID == "com.spragginsdesigns.sureword.ios-uitests.xctrunner",
                    "Unexpected UI Runner identity for app-process transport QA")
        var request: [String: Any] = ["nonce": nonce,
            "appBundleID": "com.spragginsdesigns.sureword", "runnerBundleID": runnerID]
        if normalLaunch {
            request["normalLaunch"] = ["requested": true, "launchArgumentsEmpty": true,
                                       "launchEnvironmentEmpty": true]
        }
        let bytes = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
        FileHandle.standardOutput.write(Data(("QA_ATLAS_TRANSPORT_" + marker + ": ").utf8)
            + bytes + Data("\n".utf8))
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let acknowledgment = documents.appendingPathComponent("qa-atlas-transport-" + phase + "-" + nonce + ".json")
        // The host bounds each phase to forty seconds, including process,
        // signature, file and transport checks. Leave delivery margin here.
        let deadline = Date().addingTimeInterval(55)
        while Date() < deadline {
            if let data = try? Data(contentsOf: acknowledgment),
               let receipt = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                try require(receipt["nonce"] as? String == nonce && receipt["phase"] as? String == phase,
                            "App-process transport receipt identity differs from this request")
                try require(receipt["passed"] as? Bool == true,
                            "Private host rejected app-process transport " + phase + " attestation")
                return
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        try require(false, "Private host did not acknowledge app-process transport " + phase)
    }

    private func requireRunnerPublicNetwork(phase: String) async throws {
        for origin in ["https://sureword.app/api/native-releases", "https://example.com/"] {
            let url = try XCTUnwrap(URL(string: origin + "?qa=" + UUID().uuidString))
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 20)
            request.httpMethod = "GET"
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let (data, response) = try await session.data(for: request)
            try require((response as? HTTPURLResponse)?.statusCode == 200 && !data.isEmpty,
                        "Runner public positive control did not return uncached HTTP 200")
        }
        print("QA_ATLAS_RUNNER_PUBLIC_CONTROLS: " + phase + " two uncached HTTP 200 responses")
    }

    private func restoreAppTransport(nonce: String) async throws {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        try transportHostAcknowledgment(marker: "RESTORE", phase: "restore", nonce: nonce, normalLaunch: true)
        // The normal process and owned artifact cleanup are now attested.
        // A subsequent recovery assertion must not replay this phase against
        // a different process during teardown.
        pendingTransportNonce = nil
        try waitForShell(app)
        try verifyReviewOwner(app)
        try await requireRunnerPublicNetwork(phase: "after-normal-app-launch")
        // NKJV lexical search has no bundled implementation. First exercise
        // its normal result UI, then use a fresh query to avoid accepting a
        // Foundation disk-cache hit as fresh transport recovery.
        try openSearch(app)
        try tapChip(app.buttons["Search NKJV"], app: app)
        try replace(try searchField(app), text: "In the beginning God created", app: app)
        let networkHit = prefixButton("Genesis 1:1 NKJV", app: app)
        try require(networkHit.waitForExistence(timeout: 30),
                    "Normal app transport did not recover its network-only NKJV search")
        let uncachedQuery = "surewordqa" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        try replace(try searchField(app), text: uncachedQuery, app: app)
        try require(app.staticTexts["No phrase matches in KJV or NKJV. Try fewer words or a reference like Job 1:8."].waitForExistence(timeout: 30),
                    "Fresh nonce NKJV request did not complete its real network search")
        try require(!app.buttons["Retry search"].exists,
                    "Search showed a transport error after normal app restoration")
        try tapChip(app.buttons["Search KJV"], app: app)
        try require(app.buttons["Search KJV"].isSelected, "KJV search chip was not restored")
        print("QA_ATLAS_APP_TRANSPORT_RESTORED: normal launch, cached reviewer, fresh nonce NKJV search completed, KJV search restored")
    }

    private func exerciseBundledSearchAndAtlas(_ app: XCUIApplication) throws {
        try openSearch(app)
        let bundled: [(String, String)] = [("KJV", "In the beginning God created"),
            ("BSB", "In the beginning God created"), ("ASV", "In the beginning God created"),
            ("RV1909", "En el principio"), ("LUT1912", "Am Anfang schuf Gott")]
        for (id, phrase) in bundled {
            try tapChip(app.buttons["Search " + id], app: app)
            try replace(try searchField(app), text: phrase, app: app)
            let hit = prefixButton("Genesis 1:1 " + id, app: app)
            try require(hit.waitForExistence(timeout: 25), "Bundled phrase search required network: " + id)
            try tapContent(hit, app: app)
            try require(app.navigationBars["Genesis 1"].waitForExistence(timeout: 15), "Offline phrase hit did not open")
            try assertVerse("Genesis 1:1", app: app)
            try back(app, to: "Search")
        }
        try jump("Genesis 2", app: app)
        try tap(app.buttons["Who's in this chapter"], in: app)
        try require(app.navigationBars["Genesis 2"].waitForExistence(timeout: 20), "Chapter-scoped Atlas did not open offline")
        try require(app.segmentedControls.buttons["Timeline"].exists, "Chapter-scoped Atlas controls are absent")
        try require(app.buttons["Adam, person"].waitForExistence(timeout: 20), "Offline chapter query did not return its reviewed Adam reference")
        try back(app, to: "Genesis 2")
        try tap(app.tabBars.buttons["Study"], in: app)
        try tapContent(prefixButton("People of the Bible", app: app), app: app)
        try require(app.segmentedControls.buttons["People"].isSelected, "People directory did not open offline")
        try require(app.buttons.matching(NSPredicate(format: "label ENDSWITH ', person'")).firstMatch.waitForExistence(timeout: 20),
                    "Offline people directory did not return any reviewed people")
        let query = app.textFields["Search the Bible atlas"]
        try replace(query, text: "Moses", app: app)
        try tapContent(app.buttons["Moses, Person"], app: app)
        try require(app.navigationBars["Moses"].waitForExistence(timeout: 20), "Offline entity detail failed")
        try tapContent(app.buttons["Immediate family"], app: app)
        try require(app.navigationBars["Immediate family"].waitForExistence(timeout: 15), "Offline family failed")
        try require(app.buttons["Sibling Aaron"].exists, "Reviewed Moses/Aaron relation is absent")
        try back(app, to: "Moses")
        try tapContent(app.buttons["View journey"], app: app)
        try require(app.navigationBars["Timeline, People & Places"].waitForExistence(timeout: 15), "Offline journey failed")
        let event = prefixButton("Israel goes out of Egypt,", app: app)
        try tapContent(event, app: app)
        try require(app.navigationBars["Israel goes out of Egypt"].waitForExistence(timeout: 15), "Offline event detail failed")
        try require(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read Exodus '")).firstMatch.exists,
                    "Offline event has no Scripture references")
        try back(app, to: "Timeline, People & Places")
        try back(app, to: "Moses")
        try tapContent(app.buttons["Trace connection"], app: app)
        try replace(app.textFields["Search a person to trace"], text: "Aaron", app: app)
        try tapContent(app.buttons["Trace to Aaron"], app: app)
        try require(app.staticTexts["SHORTEST CITED PATH"].waitForExistence(timeout: 20), "Offline cited path failed")
        try require(app.buttons["Open Moses"].exists && app.buttons["Open Aaron"].exists, "Trace returned wrong people")
        try back(app, to: "Moses")
        try back(app, to: "People")
        // Opening a person's journey intentionally clears the shared query.
        // The conditional inline clear button can therefore be absent here;
        // use the explorer's always-present native reset action instead.
        try tap(app.buttons["Reset atlas search"], in: app)
        try require((query.value as? String ?? "").isEmpty
                    || (query.value as? String) == query.placeholderValue,
                    "Atlas reset did not clear its visible search")
        try tap(app.segmentedControls.buttons["Places"], in: app)
        try require(app.segmentedControls.buttons["Places"].isSelected, "Places directory did not select offline")
        try require(app.buttons.matching(NSPredicate(format: "label ENDSWITH ', place'")).firstMatch.waitForExistence(timeout: 20),
                    "Offline places directory did not return any reviewed places")
        try replace(query, text: "Jerusalem", app: app)
        try tapContent(app.buttons["Jerusalem, Place"], app: app)
        try require(app.navigationBars["Jerusalem"].waitForExistence(timeout: 15), "Global place search failed offline")
        let reference = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read '")).firstMatch
        let raw = String(reference.label.dropFirst("Read ".count))
        try require(raw.contains(":"), "Place has no readable Scripture reference")
        let first = raw.components(separatedBy: CharacterSet(charactersIn: "-–—"))[0]
        try tapContent(reference, app: app)
        try require(app.navigationBars[first.components(separatedBy: ":")[0]].waitForExistence(timeout: 15),
                    "Offline place reference opened wrong reader")
        try assertVerse(first, app: app)
    }
}

import Foundation
import UIKit
import XCTest

// Scratch proposal only. Append this extension to AppleStudyParityUITests.swift
// so its existing private helpers remain accessible in the SAME source file.
// Derived from the current bundled bridge AND canonical atlas-core.ts; see
// design-receipt.json. No fixture/injection/API write is used.
// Normal shipping cold launch; one bounded 14-person directory plus five searches.
extension AppleStudyParityUITests {
    func testAtlasPeopleEraDirectoryAndGlobalRankedSearchCountsRestoreBrowseState() throws {
        continueAfterFailure = true
        executionTimeAllowance = 400
        publicJourney = "atlas-directory-and-ranked-search"
        let app = try shippingApp()
        let startingTab = ["Today", "Bible", "Chat", "Connections", "Study"]
            .first { app.tabBars.buttons[$0].isSelected }
        let query = app.textFields["Search the Bible atlas"]
        let exodus = app.buttons["Egypt & the Exodus"]
        let silence = app.buttons["Between the Testaments"]
        let allEras = app.buttons["All eras"]
        let bodyDeadline = Date().addingTimeInterval(340)
        var openedPeople = false

        func budget() throws {
            try require(Date() < bodyDeadline, "Bounded Atlas body exceeded 340 seconds; stop and restore ephemeral browse state")
        }
        func actualQueryIsEmpty() -> Bool {
            let value = query.value as? String ?? ""
            return value.isEmpty || value == query.placeholderValue
        }
        // Match the base helper's measured content clipping. This top-only
        // gesture handles a LazyVStack removing its off-screen search field;
        // an absent target must never cause an accidental downward search.
        func scrollObservedAtlasTowardTop() throws {
            try checkManualStep(app)
            let frame = app.frame
            let navigationBottom = app.navigationBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.maxY }.max() ?? frame.minY
            let keyboardTop = app.keyboards.allElementsBoundByIndex
                .filter { $0.exists }.map { $0.frame.minY }.min() ?? frame.maxY
            let tabTop = app.tabBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.minY }.min() ?? frame.maxY
            let top = max(frame.minY + 12, navigationBottom + 8)
            let bottom = min(frame.maxY - 12, keyboardTop - 12, tabTop - 8)
            let clip = CGRect(x: frame.minX + 12, y: top,
                              width: frame.width - 24, height: max(0, bottom - top))
            let viewports = app.scrollViews.allElementsBoundByIndex
                .filter { $0.exists && $0.frame.height > 110 }
                .map { $0.frame.intersection(clip) }
                .filter { !$0.isNull && $0.width > 100 && $0.height > 90 }
            guard let viewport = viewports.max(by: { $0.width * $0.height < $1.width * $1.height }) else {
                try require(false, "No observed Atlas viewport is available above the keyboard")
                return
            }
            func point(_ fraction: CGFloat) -> XCUICoordinate {
                app.coordinate(withNormalizedOffset: CGVector(
                    dx: (viewport.midX - frame.minX) / frame.width,
                    dy: (viewport.minY + viewport.height * fraction - frame.minY) / frame.height))
            }
            point(0.25).press(forDuration: 0.1, thenDragTo: point(0.78))
        }
        func header() throws {
            for _ in 0..<12 {
                try checkManualStep(app)
                if query.exists && query.isHittable && app.frame.contains(query.frame) { return }
                try scrollObservedAtlasTowardTop()
            }
            try require(false, "Atlas header did not return through measured scrolling")
        }
        func visibleInContent(_ item: XCUIElement) -> Bool {
            guard item.exists && item.isHittable && item.frame.width > 0 && item.frame.height > 0 else { return false }
            let top = app.navigationBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.maxY }.max() ?? app.frame.minY
            let keyboardTop = app.keyboards.allElementsBoundByIndex
                .filter { $0.exists }.map { $0.frame.minY }.min() ?? app.frame.maxY
            let tabTop = app.tabBars.allElementsBoundByIndex
                .filter { $0.exists && $0.isHittable }.map { $0.frame.minY }.min() ?? app.frame.maxY
            return item.frame.midY > top && item.frame.midY < min(keyboardTop, tabTop)
                && item.frame.minX >= app.frame.minX && item.frame.maxX <= app.frame.maxX
        }
        // Count only rows actually brought into the visible content viewport.
        // Source has no directory-total AX label. Seeing fourteen rows is NOT
        // represented as reading a native total label or auditing all 186 people.
        func collectVisibleRows(_ expected: [String], headings: [String], search: Bool) throws {
            let predicate = search
                ? NSPredicate(format: "label ENDSWITH ', Person' OR label ENDSWITH ', Place' OR label ENDSWITH ', Event'")
                : NSPredicate(format: "label ENDSWITH ', person'")
            var observed: [String] = []
            var seenHeadings = Set<String>()
            func observe() throws {
                let rows = app.buttons.matching(predicate).allElementsBoundByIndex
                    .filter { visibleInContent($0) }.sorted { $0.frame.minY < $1.frame.minY }
                for row in rows {
                    let label = row.label
                    try require(expected.contains(label), "Atlas exposed a row outside this source-derived bounded result set")
                    if !observed.contains(label) { observed.append(label) }
                }
                for title in headings where visibleInContent(app.staticTexts[title]) { seenHeadings.insert(title) }
            }
            if expected.isEmpty {
                try require(app.buttons.matching(predicate).count == 0,
                            "Unknown Atlas query retained stale result rows")
                return
            }
            let terminal = app.buttons[expected.last!]
            for _ in 0..<20 {
                try budget()
                try checkManualStep(app)
                try observe()
                if observed.count == expected.count && visibleInContent(terminal) {
                    try require(observed == expected, "Visible Atlas row order disagrees with the source ranking/grouping")
                    try require(seenHeadings == Set(headings), "Visible grouped headings did not show their actual per-kind totals")
                    try require(!app.buttons["Load more"].exists,
                                "Bounded directory still exposes a partial-page recovery action")
                    return
                }
                try scrollObservedContent(toward: terminal, in: app)
            }
            try require(false, "Bounded visible Atlas traversal did not reach every expected row")
        }
        func restoreBrowse() throws {
            guard openedPeople else { return }
            try checkManualStep(app)
            try require(app.navigationBars["People"].exists,
                        "Cleanup will not guess a navigation path outside its own People explorer")
            // Toolbar reset clears search only; era restoration is explicit.
            try tap(app.buttons["Reset atlas search"], in: app)
            try header()
            try require(actualQueryIsEmpty(), "Atlas query did not clear during restoration")
            if !allEras.isSelected { try tapChip(allEras, app: app) }
            try require(allEras.isSelected && app.segmentedControls.buttons["People"].isSelected,
                        "Atlas local mode/era baseline did not restore")
            try back(app, to: "Study")
            openedPeople = false
            if let startingTab, startingTab != "Study" {
                try tap(app.tabBars.buttons[startingTab], in: app)
            }
        }

        do {
            try tap(app.tabBars.buttons["Study"], in: app)
            try require(app.navigationBars["Study"].waitForExistence(timeout: 15), "Normal launch did not expose Study root")
            try tapContent(prefixButton("People of the Bible", app: app), app: app)
            openedPeople = true
            try require(app.navigationBars["People"].waitForExistence(timeout: 15)
                        && app.segmentedControls.buttons["People"].isSelected,
                        "People row did not open the ordinary directory")
            try header()
            try require(actualQueryIsEmpty() && allEras.isSelected,
                        "Cold directory must have an empty query and All eras before this bounded journey")
            try tapChip(exodus, app: app)
            try require(exodus.isSelected, "Exodus chip did not select its source-defined era")
            try require(app.buttons["Aaron, person"].waitForExistence(timeout: 15), "Exodus People did not begin with Aaron")
            let exodusRows = ["Aaron, person", "Balaam, person", "Balak, person", "Caleb, person", "Eleazar, person", "Jethro, person", "Joshua, person", "Korah, person", "Miriam, person", "Moses, person", "Nadab, person", "Pharaoh, person", "Phinehas, person", "Zipporah, person"]
            try collectVisibleRows(exodusRows, headings: [], search: false)
            print("QA_ATLAS_DIRECTORY_EXODUS: 14 source-derived rows visibly observed from Aaron through Zipporah; no directory-total label claimed")

            try header()
            try tapChip(silence, app: app)
            try require(silence.isSelected, "Silence chip did not select Between the Testaments")
            try require(app.staticTexts["No people entries match this filter."].waitForExistence(timeout: 15),
                        "Silence directory did not settle to its source-defined empty state")
            try require(app.buttons.matching(NSPredicate(format: "label ENDSWITH ', person'")).count == 0,
                        "Silence empty directory retained stale person rows")
            try tapChip(exodus, app: app)
            try require(exodus.isSelected && app.buttons["Aaron, person"].waitForExistence(timeout: 15),
                        "Returning from Silence did not restore Exodus browse")

            let searches: [(query: String, summary: String, rows: [String], headings: [String])] = [
            (query: "Saul", summary: "8 results shown · capped at 12 · 2 people · 0 places · 6 events",
             rows: ["Saul, Saul, first king of Israel, Person", "Paul, Paul, formerly called Saul, Person", "Saul hunts David, Event", "Saul and the woman of Endor, Event", "Saul anointed the first king, Event", "Saul rejected from being king, Event", "Saul and Jonathan fall at Gilboa, Event", "Saul struck down on the road to Damascus, Event"], headings: ["People (2)", "Events (6)"]),
            (query: "John", summary: "5 results shown · capped at 12 · 3 people · 0 places · 2 events",
             rows: ["John, John, son of Zebedee, Person", "John the Baptist, John the Baptist, Person", "Mark, Person", "Three men named in 3 John, Event", "The birth of John the Baptist, Event"], headings: ["People (3)", "Events (2)"]),
            (query: "James", summary: "2 results shown · capped at 12 · 2 people · 0 places · 0 events",
             rows: ["James, James, son of Zebedee, Person", "James the Lord's brother, James, the Lord's brother, Person"], headings: ["People (2)"]),
            (query: "surewordqaunknownatlas", summary: "0 results shown · capped at 12 · 0 people · 0 places · 0 events",
             rows: [], headings: []),
            (query: "the", summary: "12 results shown · capped at 12 · 14 people · 4 places · 119 events",
             rows: ["The flood, Event", "The burial, Event", "The passover, Event", "The ascension, Event", "The crucifixion, Event", "The golden calf, Event", "The last supper, Event", "The burning bush, Event", "The resurrection, Event", "The call of Abram, Event", "The seventy weeks, Event", "The birth of Isaac, Event"], headings: ["Events (119)"])
            ]
            for item in searches {
                try budget()
                try header()
                try replace(query, text: item.query, app: app)
                try require(app.staticTexts[item.summary].waitForExistence(timeout: 15),
                            "Atlas visible cap/per-kind summary disagrees with current bundled query")
                try require(exodus.isSelected,
                            "Global search changed the underlying People-era selection")
                try collectVisibleRows(item.rows, headings: item.headings, search: true)
                print("QA_ATLAS_DIRECTORY_SEARCH: " + item.query + " | " + item.summary)
            }
            // Search is global despite the retained Exodus browse filter.
            // Native source exposes Events(119) as STATIC TEXT only. There is
            // no Events-only search refinement control, so none is invented.
            try header()
            try tap(app.buttons["Clear search"], in: app)
            try require(actualQueryIsEmpty() && exodus.isSelected,
                        "Inline clear did not restore empty-query Exodus browse")
            try require(app.buttons["Aaron, person"].waitForExistence(timeout: 15),
                        "Cleared search did not restore its source-era directory")
            try tapChip(allEras, app: app)
            try require(allEras.isSelected, "All eras did not clear the local era filter")
            try require(app.buttons["Abel, person"].waitForExistence(timeout: 15),
                        "Clearing era did not restore an entry outside Exodus")
            try restoreBrowse()
            print("QA_ATLAS_DIRECTORY_COMPLETE: normal shipping browse, bounded 14-person and empty eras, five global searches, cap/group counts, query/era/navigation restored")
        } catch {
            do { try restoreBrowse() }
            catch { print("QA_ATLAS_DIRECTORY_RESTORE_REQUIRED: ephemeral People query/era/navigation; no account record mutation attempted") }
            throw error
        }
    }
}
