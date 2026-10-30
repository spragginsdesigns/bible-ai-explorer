import XCTest

/// The App Review 2.1(b) evidence recording (2026-10-22 rejection): on a
/// physical iPhone, start at the Home Screen, open SureWord, sign in with the
/// demo account, go to Settings > AI > SureWord Pro, Subscribe, finish the
/// Sandbox purchase sheet and show Pro active.
///
/// Device only, and only with a development build of the release source: a
/// development-signed build buys in Apple's Sandbox, which the production
/// server accepts. Never run it under the scheme's local `.storekit` file,
/// whose Xcode-signed transactions the server refuses. Credentials come from
/// the environment (xcodebuild forwards `TEST_RUNNER_<NAME>` as `<NAME>`) and
/// are never written to the repo:
///
///     TEST_RUNNER_SW_APP_REVIEW_PURCHASE=1 \
///     TEST_RUNNER_SW_DEMO_EMAIL=... TEST_RUNNER_SW_DEMO_PASSWORD=... \
///     TEST_RUNNER_SW_SANDBOX_PASSWORD=... xcodebuild test-without-building \
///       -only-testing:SureWord-iOSUITests/AppReviewPurchaseUITests/testA_PrepareSignedOut ...
///
/// Run `testA_PrepareSignedOut` first, start the screen recording, then run
/// `testB_RecordSandboxPurchase`. A sheet the test cannot drive is left for a
/// person to tap; the test waits up to five minutes for Pro to show active.
final class AppReviewPurchaseUITests: XCTestCase {
    private let bundleID = "com.spragginsdesigns.sureword"
    @MainActor private var springboard: XCUIApplication {
        XCUIApplication(bundleIdentifier: "com.apple.springboard")
    }
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        guard env["SW_APP_REVIEW_PURCHASE"] == "1" else {
            throw XCTSkip("App Review purchase recording requires explicit device-only opt-in.")
        }
        #if targetEnvironment(simulator)
        throw XCTSkip("App Review Sandbox recording must not alter simulator accounts.")
        #endif
    }

    private func anyText(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", text))
            .firstMatch
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func dismissReleaseNotes(_ app: XCUIApplication) {
        let gotIt = app.buttons["Got it"]
        if gotIt.waitForExistence(timeout: 4) { gotIt.tap() }
    }

    /// Leaves the app signed out and closed, so the recording can start from
    /// the Home Screen with nothing left over.
    @MainActor
    func testA_PrepareSignedOut() throws {
        let app = XCUIApplication(bundleIdentifier: bundleID)
        app.launch()
        dismissReleaseNotes(app)
        let signIn = app.buttons["auth-sign-in"]
        let gear = app.buttons["Settings"].firstMatch
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !signIn.exists, !gear.exists { sleep(1) }
        if gear.exists, !signIn.exists {
            gear.tap()
            // The account row is the first cell of the Settings hub.
            let account = app.cells.firstMatch
            XCTAssertTrue(account.waitForExistence(timeout: 10))
            account.tap()
            let signOut = app.buttons["Sign out"].firstMatch
            XCTAssertTrue(signOut.waitForExistence(timeout: 10))
            signOut.tap()
            let confirm = app.buttons.matching(NSPredicate(format: "label == 'Sign out'")).element(boundBy: 1)
            if confirm.waitForExistence(timeout: 5) { confirm.tap() } else { app.buttons["Sign out"].firstMatch.tap() }
            XCTAssertTrue(signIn.waitForExistence(timeout: 20), "signed out\n\(app.debugDescription)")
        }
        XCTAssertTrue(signIn.exists, "the welcome card shows")
        app.terminate()
        XCUIDevice.shared.press(.home)
    }

    /// Settings > Developer > Sandbox Apple Account must hold a sandbox
    /// tester, or the purchase sheet asks for a real Apple Account. Signs in
    /// `SW_SANDBOX_EMAIL` when the section shows Sign In.
    @MainActor
    func testA2_SandboxAccountSignedIn() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        let developer = settings.cells["Developer"].firstMatch
        for _ in 0..<12 where !(developer.exists && developer.isHittable) { settings.swipeUp() }
        XCTAssertTrue(developer.isHittable, "Developer settings exist\n\(settings.debugDescription)")
        developer.tap()
        let sandboxHeader = anyText(settings, containing: "Sandbox")
        for _ in 0..<12 where !(sandboxHeader.exists && sandboxHeader.isHittable) { settings.swipeUp() }
        capture(settings, "developer-sandbox")
        let signedIn = settings.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS '@' OR value CONTAINS '@'")).firstMatch
        if signedIn.exists {
            print("SANDBOX_ACCOUNT_PRESENT")
        } else {
            let email = try XCTUnwrap(env["SW_SANDBOX_EMAIL"], "SW_SANDBOX_EMAIL")
            let password = try XCTUnwrap(env["SW_SANDBOX_PASSWORD"], "SW_SANDBOX_PASSWORD")
            let signIn = settings.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Sign In'")).firstMatch
            XCTAssertTrue(signIn.exists, "Sandbox Sign In\n\(settings.debugDescription)")
            signIn.tap()
            for host in [settings, springboard] {
                let field = host.textFields.firstMatch
                guard field.waitForExistence(timeout: 8) else { continue }
                field.tap()
                field.typeText(email)
                let box = host.secureTextFields.firstMatch
                if !box.exists { host.buttons.matching(NSPredicate(format: "label ==[c] 'Continue' OR label ==[c] 'Next'")).firstMatch.tap() }
                XCTAssertTrue(box.waitForExistence(timeout: 10))
                box.tap()
                box.typeText(password + "\n")
                break
            }
            XCTAssertTrue(signedIn.waitForExistence(timeout: 30), "sandbox account signed in\n\(settings.debugDescription)")
            print("SANDBOX_ACCOUNT: signed in \(email)")
        }
        settings.terminate()
        XCUIDevice.shared.press(.home)
    }

    @MainActor
    func testB_RecordSandboxPurchase() throws {
        let email = try XCTUnwrap(env["SW_DEMO_EMAIL"], "SW_DEMO_EMAIL")
        let password = try XCTUnwrap(env["SW_DEMO_PASSWORD"], "SW_DEMO_PASSWORD")
        let sandboxPassword = env["SW_SANDBOX_PASSWORD"]

        // 1. Home Screen, then open SureWord from its icon.
        XCUIDevice.shared.press(.home)
        sleep(1)
        XCUIDevice.shared.press(.home)
        sleep(3)
        let icon = springboard.icons["SureWord"]
        for _ in 0..<6 where !(icon.exists && icon.isHittable) {
            springboard.swipeLeft()
            sleep(1)
        }
        XCTAssertTrue(icon.isHittable, "SureWord is on the Home Screen\n\(springboard.debugDescription)")
        sleep(2)
        icon.tap()
        let app = XCUIApplication(bundleIdentifier: bundleID)
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        dismissReleaseNotes(app)

        // 2. Sign in with the demo account (email, Continue, password).
        let signIn = app.buttons["auth-sign-in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 30), "the welcome card shows")
        sleep(1)
        signIn.tap()
        let identifier = app.descendants(matching: .any)
            .matching(identifier: "clerk.auth.start.identifier").firstMatch
        XCTAssertTrue(identifier.waitForExistence(timeout: 20))
        let field = app.textFields["clerk.auth.start.identifier"]
        if !field.exists { identifier.tap() }
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        for _ in 0..<3 {
            guard let existing = field.value as? String, !existing.isEmpty,
                  existing != field.placeholderValue else { break }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 4))
        }
        field.typeText(email)
        app.buttons["clerk.auth.start.continue"].tap()
        let secure = app.secureTextFields.firstMatch
        XCTAssertTrue(secure.waitForExistence(timeout: 20), "password step\n\(app.debugDescription)")
        secure.tap()
        secure.typeText(password)
        let next = app.buttons.matching(NSPredicate(format: "label ==[c] 'Continue' OR label ==[c] 'Sign in'")).firstMatch
        if next.exists { next.tap() } else { secure.typeText("\n") }

        // 3. Settings > AI > SureWord Pro.
        let gear = app.buttons["Settings"].firstMatch
        let signedIn = Date().addingTimeInterval(40)
        while Date() < signedIn, !gear.exists {
            if app.buttons["Got it"].exists { app.buttons["Got it"].tap() }
            // iOS may offer to save the password; not now.
            for label in ["Not Now", "Never for This Website"] where springboard.buttons[label].exists {
                springboard.buttons[label].tap()
            }
            sleep(1)
        }
        XCTAssertTrue(gear.exists, "signed in\n\(app.debugDescription)")
        sleep(2)
        capture(app, "signed-in")
        gear.tap()
        let ai = app.descendants(matching: .any).matching(identifier: "settings.row.AI").firstMatch
        XCTAssertTrue(ai.waitForExistence(timeout: 15))
        sleep(1)
        ai.tap()
        let pro = app.buttons["SureWord Pro"].firstMatch
        XCTAssertTrue(pro.waitForExistence(timeout: 15))
        sleep(1)
        pro.tap()
        let subscribe = app.buttons["Subscribe"].firstMatch
        XCTAssertTrue(subscribe.waitForExistence(timeout: 30), "the Subscribe button shows\n\(app.debugDescription)")
        let enabled = Date().addingTimeInterval(20)
        while Date() < enabled, !subscribe.isEnabled { sleep(1) }
        sleep(3)
        capture(app, "subscribe-screen")

        // 4. Subscribe and finish Apple's Sandbox sheet. The sheet is hosted
        // outside the app; try the usual buttons in both places, and leave
        // anything else to a person.
        subscribe.tap()
        let active = anyText(app, containing: "SureWord Pro is active")
        let activeElsewhere = anyText(app, containing: "Pro is active on your account")
        var typedSandboxPassword = false
        let finish = Date().addingTimeInterval(300)
        while Date() < finish, !active.exists, !activeElsewhere.exists {
            for host in [springboard, app] {
                if let sandboxPassword, !typedSandboxPassword, host.secureTextFields.firstMatch.exists {
                    let box = host.secureTextFields.firstMatch
                    box.tap()
                    box.typeText(sandboxPassword)
                    typedSandboxPassword = true
                    sleep(1)
                }
                for label in ["Subscribe", "Sign In", "Confirm", "Purchase", "Buy", "Continue", "OK"] {
                    let button = host.buttons[label].firstMatch
                    // The app's own Subscribe is the button that opened this.
                    if host === app && label == "Subscribe" { continue }
                    if button.exists && button.isHittable {
                        sleep(1)
                        button.tap()
                        sleep(2)
                    }
                }
            }
            sleep(2)
        }
        XCTAssertTrue(active.exists || activeElsewhere.exists, "Pro shows active\n\(app.debugDescription)")
        sleep(4)
        capture(app, "pro-active")
        sleep(3)
    }
}
