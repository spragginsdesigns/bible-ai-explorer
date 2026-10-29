import XCTest

/// Real Clerk password authentication and synced translation choices. No
/// evidence arguments, fixtures, account creation, AI requests or purchases.
/// The private runner forwards SW_DEMO_EMAIL/SW_DEMO_PASSWORD through
/// TEST_RUNNER_ variables; never put their values in arguments or attachments.
@MainActor
final class AppleAuthenticatedParityUITests: XCTestCase {
    private enum AcceptanceStop: Error { case manualStep, missingControl }
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private var email: String { ProcessInfo.processInfo.environment["SW_DEMO_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SW_DEMO_PASSWORD"] ?? "" }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard !email.isEmpty, !password.isEmpty else {
            XCTFail("Private review-account environment is missing")
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

    private func checkManualStep(_ app: XCUIApplication) throws {
        for host in [app, springboard] {
            let alert = host.alerts.firstMatch
            if alert.exists {
                let prompt = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " · ")
                try stop("Unexpected alert: \(prompt)")
            }
            for prompt in ["Save Password", "Update Password", "Allow Notifications"] {
                let button = host.buttons[prompt]
                if button.exists && button.isHittable { try stop("Unexpected system step: \(prompt)") }
            }
        }
        for prompt in [
            "How SureWord answers you", "Agree and continue", "Allow AI",
            "Check your email", "Enter verification code", "Verification code",
            "Verify your identity", "Two-step verification", "Security verification",
            "Verify you are human", "I'm not a robot", "Agree to terms"
        ] {
            let text = app.staticTexts[prompt]
            let button = app.buttons[prompt]
            if (text.exists && text.isHittable) || (button.exists && button.isHittable) {
                try stop("Manual authentication, consent or legal step: \(prompt)")
            }
        }
    }

    private func dismissOrdinaryReleaseNotes(_ app: XCUIApplication) throws {
        try checkManualStep(app)
        let gotIt = app.buttons["Got it"]
        let releaseNotes = app.staticTexts["Since you were last here"].exists || app.navigationBars["What's new"].exists
        if releaseNotes && gotIt.exists && gotIt.isHittable { gotIt.tap() }
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication, step: String = "shipping control") throws {
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

    private func shellExists(_ app: XCUIApplication) -> Bool {
        ["Today", "Bible", "Chat", "Connections", "Study"].allSatisfy { app.tabBars.buttons[$0].exists }
    }

    private func waitForShell(_ app: XCUIApplication) throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            try dismissOrdinaryReleaseNotes(app)
            if shellExists(app) { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        try stop("The shipping authenticated five-tab shell did not appear")
    }

    private func signInIfNeeded(_ app: XCUIApplication) throws {
        let signIn = app.buttons["auth-sign-in"]
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !signIn.exists, !shellExists(app) {
            try dismissOrdinaryReleaseNotes(app)
            Thread.sleep(forTimeInterval: 0.5)
        }
        if shellExists(app) { return }
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

    private func verifyReviewOwner(_ app: XCUIApplication) throws {
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
        XCTAssertTrue(todayBar.waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["Today"].isSelected)
        XCTAssertFalse(settingsBar.exists)
    }

    private func openGenesis(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Bible"], in: app)
        if app.navigationBars["Genesis 1"].exists { return }
        let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Genesis")).firstMatch
        try tap(book, in: app)
        try tap(app.buttons["Genesis chapter 1"], in: app)
        XCTAssertTrue(app.navigationBars["Genesis 1"].waitForExistence(timeout: 20))
    }

    private func translation(_ label: String, in app: XCUIApplication) throws -> XCUIElement {
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

    private func assertTranslation(_ label: String, text: String, in app: XCUIApplication) throws {
        try checkManualStep(app)
        let chip = try translation(label, in: app)
        XCTAssertTrue(chip.isSelected)
        let verse = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
        XCTAssertTrue(verse.waitForExistence(timeout: 20))
    }

    private func capture(_ app: XCUIApplication, _ name: String) throws {
        try checkManualStep(app)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

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
