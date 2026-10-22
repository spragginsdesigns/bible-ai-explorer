import XCTest

/// The signed-out welcome card (Android 1.99.0 parity): Create an account and
/// Sign in each open the matching ClerkKitUI flow against the production
/// instance, and an email with no account carries on into creating one.
///
/// Needs a signed-out app on the simulator and the network. Nothing is
/// created: the unknown-email check stops at the sign-up step before any
/// account exists. Run with
/// `-only-testing:SureWord-iOSUITests/SignInWelcomeUITests`.
final class SignInWelcomeUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func anyText(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", text))
            .firstMatch
    }

    @MainActor
    func testWelcomeCardOpensSignUpAndSignIn() throws {
        let app = XCUIApplication()
        app.launch()

        // A new release note opens "Since you were last here" over the
        // welcome card; set it aside first.
        let gotIt = app.buttons["Got it"]
        if gotIt.waitForExistence(timeout: 8) { gotIt.tap() }

        let create = app.buttons["auth-create-account"]
        XCTAssertTrue(create.waitForExistence(timeout: 30), "the welcome card is the signed-out screen")
        XCTAssertTrue(app.buttons["auth-sign-in"].exists)
        XCTAssertTrue(app.buttons["auth-apple"].exists)
        XCTAssertTrue(app.buttons["auth-google"].exists)
        capture(app, "welcome")

        create.tap()
        XCTAssertTrue(anyText(app, containing: "Create your account").waitForExistence(timeout: 20))
        capture(app, "create-account-sheet")
        app.swipeDown(velocity: .fast)
        if app.buttons["auth-sign-in"].waitForExistence(timeout: 3) == false || !app.buttons["auth-sign-in"].isHittable {
            // AuthView refuses interactive dismissal; use its close button.
            app.buttons.matching(NSPredicate(format: "label ==[c] 'Close' OR label ==[c] 'Dismiss'")).firstMatch.tap()
        }

        let signIn = app.buttons["auth-sign-in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 10))
        signIn.tap()
        // An empty identifier field is exposed as static text until it takes
        // focus; a prefilled one is a text field (with the label beside it).
        let identifier = app.descendants(matching: .any)
            .matching(identifier: "clerk.auth.start.identifier").firstMatch
        XCTAssertTrue(identifier.waitForExistence(timeout: 20))
        capture(app, "sign-in-sheet")

        // An address with no account must not dead-end at "Couldn't find
        // your account": sign-in-or-up moves it on into creating one.
        let email = app.textFields["clerk.auth.start.identifier"]
        if !email.exists { identifier.tap() }
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap()
        // Clerk prefills the last-used address; clear it first. A plain tap
        // drops the cursor mid-text, so deletes would only eat what sits
        // before it. Park the cursor at the end, delete, and repeat until the
        // field is empty.
        for _ in 0..<3 {
            guard let existing = email.value as? String, !existing.isEmpty,
                  existing != email.placeholderValue else { break }
            email.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
            email.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 4))
        }
        let address = "swqanobody\(Int(Date().timeIntervalSince1970))@maxxspace.com"
        email.typeText(address)
        XCTAssertEqual(email.value as? String, address, "the field holds exactly the typed address")
        app.buttons["clerk.auth.start.continue"].tap()
        // Clerk's sign-up continues with a password or, as the instance does
        // today, an emailed code ("Sign up" / "Check your email").
        let movedOn = anyText(app, containing: "Check your email").waitForExistence(timeout: 20)
            || anyText(app, containing: "password").exists
            || anyText(app, containing: "Create your account").exists
            || anyText(app, containing: "verification").exists
        capture(app, "unknown-email-result")
        XCTAssertFalse(anyText(app, containing: "Couldn't find your account").exists)
        XCTAssertTrue(movedOn, "unknown email continued into sign-up\n\(app.debugDescription)")
    }
}
