import XCTest

/// Real Clerk password authentication and synced translation choices. No
/// evidence arguments, fixtures, account creation, AI requests or purchases.
/// The private runner forwards SW_DEMO_EMAIL/SW_DEMO_PASSWORD through
/// TEST_RUNNER_ variables; never put their values in arguments or attachments.
@MainActor
class AppleShippingUITestCase: XCTestCase {
    private enum AcceptanceStop: Error { case manualStep, missingControl }
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private var email: String { ProcessInfo.processInfo.environment["SW_DEMO_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SW_DEMO_PASSWORD"] ?? "" }

    override func setUp() async throws {
        // XCTestCase's default hook is empty. Keep this async override on
        // the class's MainActor instead of sending self through a nonisolated
        // superclass hook and then capturing it in another executor.
        continueAfterFailure = false
        // A surviving simulator session needs only its expected owner identity.
        // Keep a locked vault from blocking read-only QA, without substituting
        // a placeholder password or attempting an uncredentialed sign-in.
        guard !email.isEmpty else {
            XCTFail("Private review-account identity is missing")
            throw AcceptanceStop.manualStep
        }
    }

    private func redacted(_ text: String) -> String {
        [email, password].filter { !$0.isEmpty }.reduce(text) {
            $0.replacingOccurrences(of: $1, with: "[private review credential]")
        }
    }

    private func stop(_ message: String) throws {
        XCTFail("AUTH_PARITY_STOP: \(redacted(message))")
        throw AcceptanceStop.manualStep
    }

    func checkManualStep(_ app: XCUIApplication) throws {
        let systemPrompts = ["Save Password", "Update Password", "Allow Notifications"]
        func matchingPrompt(_ element: XCUIElement, labels: [String]) -> String {
            labels.first { $0 == element.label || $0 == element.identifier } ?? "unexpected manual step"
        }
        for host in [app, springboard] {
            let alert = host.alerts.firstMatch
            if alert.exists {
                let prompt = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " · ")
                try stop("Unexpected alert: \(prompt)")
            }
            let buttons = host.buttons.matching(NSPredicate(
                format: "label IN %@ OR identifier IN %@", systemPrompts, systemPrompts))
            for button in buttons.allElementsBoundByIndex where button.isHittable {
                try stop("Unexpected system step: " + matchingPrompt(button, labels: systemPrompts))
            }
        }
        let manualPrompts = [
            "How SureWord answers you", "Agree and continue", "Allow AI",
            "Check your email", "Enter verification code", "Verification code",
            "Verify your identity", "Two-step verification", "Security verification",
            "Verify you are human", "I'm not a robot", "Agree to terms"
        ]
        // Keep exactly the same label/identifier and hittability guards,
        // batching absent prompts instead of issuing dozens of AX queries
        // before every shipping action.
        let predicate = NSPredicate(format: "label IN %@ OR identifier IN %@", manualPrompts, manualPrompts)
        let candidates = app.staticTexts.matching(predicate).allElementsBoundByIndex
            + app.buttons.matching(predicate).allElementsBoundByIndex
        for candidate in candidates where candidate.isHittable {
            try stop("Manual authentication, consent or legal step: " + matchingPrompt(candidate, labels: manualPrompts))
        }
    }

    func dismissOrdinaryReleaseNotes(_ app: XCUIApplication) throws {
        try checkManualStep(app)
        let gotIt = app.buttons["Got it"]
        let releaseNotes = app.staticTexts["Since you were last here"].exists || app.navigationBars["What's new"].exists
        if releaseNotes && gotIt.exists && gotIt.isHittable { gotIt.tap() }
    }

    func tap(_ element: XCUIElement, in app: XCUIApplication, step: String = "shipping control") throws {
        try checkManualStep(app)
        guard element.waitForExistence(timeout: 20), element.isHittable else {
            try checkManualStep(app)
            let selected = ["Today", "Bible", "Chat", "Connections", "Study"]
                .filter { app.tabBars.buttons[$0].isSelected }.joined(separator: ",")
            XCTFail("Missing \(step); selected tab: \(selected); exists: \(element.exists); hittable: \(element.isHittable)")
            throw AcceptanceStop.missingControl
        }
        element.tap()
        try checkManualStep(app)
    }

    /// Scroll only a real content viewport. A full-screen percentage can land
    /// on the software keyboard; clip the observed scroller to the visible
    /// area above it and below navigation before sending a drag.
    func scrollObservedContent(toward element: XCUIElement, in app: XCUIApplication) throws {
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
        let scrollers = app.scrollViews.allElementsBoundByIndex
            + app.tables.allElementsBoundByIndex + app.collectionViews.allElementsBoundByIndex
        let viewports = scrollers.filter { $0.exists && $0.frame.height > 110 }
            .map { $0.frame.intersection(clip) }
            .filter { !$0.isNull && $0.width > 100 && $0.height > 90 }
        guard let viewport = viewports.max(by: { $0.width * $0.height < $1.width * $1.height }) else {
            XCTFail("No observed content viewport is available above the keyboard")
            throw AcceptanceStop.missingControl
        }
        let down = element.exists && element.frame.maxY <= viewport.minY + 8
        func point(_ fraction: CGFloat) -> XCUICoordinate {
            app.coordinate(withNormalizedOffset: CGVector(
                dx: (viewport.midX - frame.minX) / frame.width,
                dy: (viewport.minY + viewport.height * fraction - frame.minY) / frame.height))
        }
        point(down ? 0.25 : 0.78).press(forDuration: 0.1,
            thenDragTo: point(down ? 0.78 : 0.25))
    }

    func shellExists(_ app: XCUIApplication) -> Bool {
        ["Today", "Bible", "Chat", "Connections", "Study"].allSatisfy { app.tabBars.buttons[$0].exists }
    }

    func waitForShell(_ app: XCUIApplication) throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            try dismissOrdinaryReleaseNotes(app)
            if shellExists(app) { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        try stop("The shipping authenticated five-tab shell did not appear")
    }

    func signInIfNeeded(_ app: XCUIApplication) throws {
        let signIn = app.buttons["auth-sign-in"]
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !signIn.exists, !shellExists(app) {
            try dismissOrdinaryReleaseNotes(app)
            Thread.sleep(forTimeInterval: 0.5)
        }
        if shellExists(app) { return }
        guard !password.isEmpty else {
            try stop("The saved simulator session is unavailable; private review credentials are required before sign-in")
            return
        }
        try tap(signIn, in: app)
        let identifier = app.descendants(matching: .any)
            .matching(identifier: "clerk.auth.start.identifier").firstMatch
        guard identifier.waitForExistence(timeout: 20) else {
            try checkManualStep(app)
            try stop("The native Clerk identifier step did not appear")
            return
        }
        let field = app.textFields["clerk.auth.start.identifier"]
        if !field.exists { try tap(identifier, in: app) }
        guard field.waitForExistence(timeout: 20) else {
            try stop("The native Clerk identifier field did not appear")
            return
        }
        if field.isHittable { field.tap() }
        // Clerk's empty floating-label field can expose a nonhittable AX
        // TextField while its native email keyboard already has focus.
        // Type through that real keyboard, then verify the exact identifier
        // before allowing the shipping Continue action.
        guard app.keyboards.firstMatch.waitForExistence(timeout: 10) else {
            try checkManualStep(app)
            try stop("The native identifier keyboard is not focused")
            return
        }
        for _ in 0..<3 {
            guard let existing = field.value as? String, !existing.isEmpty,
                  existing != field.placeholderValue else { break }
            guard field.isHittable else {
                try stop("A nonempty identifier cannot be safely focused for replacement")
                return
            }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
            app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 4))
        }
        app.typeText(email)
        let intendedIdentifier = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (field.value as? String) == self.email
        }, object: nil)
        guard XCTWaiter.wait(for: [intendedIdentifier], timeout: 5) == .completed else {
            try stop("The native identifier field does not contain the intended review account")
            return
        }
        try tap(app.buttons["clerk.auth.start.continue"], in: app)
        // A specific sign-in identifier prevents an unexpected sign-up
        // branch from receiving a password or creating an account.
        let secure = app.secureTextFields["clerk.auth.signIn.password"]
        let passwordDeadline = Date().addingTimeInterval(25)
        while Date() < passwordDeadline, !secure.exists {
            try checkManualStep(app)
            Thread.sleep(forTimeInterval: 0.5)
        }
        guard secure.exists else {
            try stop("A manual authentication step replaced the password form")
            return
        }
        try tap(secure, in: app)
        secure.typeText(password)
        let submit = app.buttons["clerk.auth.signIn.continue"]
        try tap(submit, in: app)
        try waitForShell(app)
    }

    func verifyReviewOwner(_ app: XCUIApplication) throws {
        // First-run onboarding opens Chat, whose Settings action belongs to
        // Chat options. Today provides the direct gear on every normal launch.
        try tap(app.tabBars.buttons["Today"], in: app, step: "Today tab before owner verification")
        let todayBar = app.navigationBars["Today"]
        guard todayBar.waitForExistence(timeout: 15) else {
            try stop("Today did not settle before owner verification")
            return
        }
        try tap(todayBar.buttons["Settings"], in: app, step: "Today settings gear")
        guard app.navigationBars["Settings"].waitForExistence(timeout: 15) else {
            try stop("The account identity could not be checked before changing preferences")
            return
        }
        let profile = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label ==[c] %@", email)).firstMatch
        guard profile.waitForExistence(timeout: 15) else {
            try stop("The signed-in owner is not the designated review account; no preferences changed")
            return
        }
        // No profile screenshot: the email is a private review credential.
        let settingsBar = app.navigationBars["Settings"]
        let back = settingsBar.buttons["Today"].exists
            ? settingsBar.buttons["Today"] : settingsBar.buttons["Back"]
        try tap(back, in: app, step: "Settings back to Today")
        guard todayBar.waitForExistence(timeout: 15),
              app.tabBars.buttons["Today"].isSelected, !settingsBar.exists else {
            try stop("Owner verification did not return to the authenticated Today root")
            return
        }
    }

    func openGenesis(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Bible"], in: app)
        if app.navigationBars["Genesis 1"].exists { return }
        let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Genesis")).firstMatch
        try tap(book, in: app)
        try tap(app.buttons["Genesis chapter 1"], in: app)
        XCTAssertTrue(app.navigationBars["Genesis 1"].waitForExistence(timeout: 20))
    }

    func translation(_ label: String, in app: XCUIApplication) throws -> XCUIElement {
        let chip = app.buttons[label]
        guard chip.waitForExistence(timeout: 15) else {
            XCTFail("The reader translation chip did not appear")
            throw AcceptanceStop.missingControl
        }
        for _ in 0..<4 where !chip.isHittable {
            guard let row = app.scrollViews.allElementsBoundByIndex.first(where: {
                $0.frame.height < 100 && $0.frame.intersects(chip.frame)
            }) else { break }
            if chip.frame.midX < app.frame.minX { row.swipeRight() }
            else { row.swipeLeft() }
        }
        return chip
    }

    func assertTranslation(_ label: String, text: String, in app: XCUIApplication) throws {
        try checkManualStep(app)
        let chip = try translation(label, in: app)
        XCTAssertTrue(chip.isSelected)
        let verse = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        XCTAssertTrue(verse.waitForExistence(timeout: 20))
    }

    func capture(_ app: XCUIApplication, _ name: String) throws {
        try checkManualStep(app)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Normal shipping launch and verified owner, with no evidence arguments.
    /// Deliberately does not capture the profile or credential entry screens.
    func shippingApp() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        try signInIfNeeded(app)
        try waitForShell(app)
        try verifyReviewOwner(app)
        return app
    }
}

@MainActor
final class AppleAuthenticatedParityUITests: AppleShippingUITestCase {
    func testReviewAccountASVPersistsAcrossTabReturnAndNormalRelaunchThenRestoresKJV() throws {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        try signInIfNeeded(app)
        try waitForShell(app)
        try verifyReviewOwner(app)
        try capture(app, "authenticated-shipping-shell")
        try openGenesis(app)

        let asvLabel = "Read in the American Standard Version"
        let kjvLabel = "Read in the KJV"
        let asv = try translation(asvLabel, in: app)
        let kjv = try translation(kjvLabel, in: app)
        print("AUTH_PARITY_INITIAL_TRANSLATION: \(asv.isSelected ? "ASV" : (kjv.isSelected ? "KJV" : "another public translation"))")
        try tap(asv, in: app)
        try assertTranslation(asvLabel, text: "In the beginning God created the heavens and the earth.", in: app)
        try capture(app, "authenticated-genesis-asv-selected")
        try tap(app.tabBars.buttons["Today"], in: app)
        try openGenesis(app)
        try assertTranslation(asvLabel, text: "In the beginning God created the heavens and the earth.", in: app)
        try capture(app, "authenticated-asv-after-tab-return")

        app.terminate()
        app.launch()
        try waitForShell(app)
        try openGenesis(app)
        try assertTranslation(asvLabel, text: "In the beginning God created the heavens and the earth.", in: app)
        // Allow the normal signed-in preference refresh to settle, then check
        // again rather than proving only the first cached reader frame.
        Thread.sleep(forTimeInterval: 5)
        try assertTranslation(asvLabel, text: "In the beginning God created the heavens and the earth.", in: app)
        try capture(app, "authenticated-asv-after-normal-relaunch")

        try tap(try translation(kjvLabel, in: app), in: app)
        try assertTranslation(kjvLabel, text: "In the beginning God created the heaven and the earth.", in: app)
        try tap(app.tabBars.buttons["Today"], in: app)
        try openGenesis(app)
        try assertTranslation(kjvLabel, text: "In the beginning God created the heaven and the earth.", in: app)
        try capture(app, "authenticated-kjv-restored-after-tab-return")
    }
}
