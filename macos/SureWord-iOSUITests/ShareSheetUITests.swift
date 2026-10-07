import XCTest

/// "Share into SureWord" through the real system share sheet: Safari, Photos
/// and Files hand a share to the SureWord extension, and the app (in the
/// Debug evidence shell, since a simulator has no signed-in account) opens it
/// as a new chat with the two actions.
///
/// Not part of the default test plan: these drive other apps and need media
/// staged on the simulator (a photo via `simctl addmedia`, files in Files' On
/// My iPhone). Run one with `-only-testing:SureWord-iOSUITests/...`.
final class ShareSheetUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func snapshot(_ name: String, _ app: XCUIApplication? = nil) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The share sheet lists SureWord in the app row; if it is not visible,
    /// it is under "More" / "Edit Actions".
    private func pickSureWord(in host: XCUIApplication) {
        // The sheet may be drawn by the host or by a system service.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(20)
        var swipes = 0
        while Date() < deadline {
            for app in [host, springboard] {
                let hit = app.descendants(matching: .any)
                    .matching(NSPredicate(format: "label == 'SureWord' OR identifier == 'SureWord'"))
                    .firstMatch
                if hit.exists, hit.isHittable {
                    snapshot("share-sheet")
                    hit.tap()
                    return
                }
            }
            if swipes == 2 { snapshot("share-sheet-open") }
            swipes += 1
            sleep(1)
        }
        snapshot("share-sheet-missing")
        print("SHARE-SHEET-HIERARCHY\n\(host.debugDescription)\nSPRINGBOARD\n\(springboard.debugDescription)")
        XCTFail("SureWord is not in the share sheet")
    }

    /// The extension's card renders inside the host app's hierarchy.
    private func confirmSaved(in host: XCUIApplication, name: String) {
        let saved = host.staticTexts["Saved to SureWord"]
        XCTAssertTrue(saved.waitForExistence(timeout: 20), "the extension saved the share")
        sleep(1) // let the sheet finish sliding up before the capture
        snapshot("\(name)-extension-saved")
        host.buttons["share-done"].tap()
    }

    /// Open SureWord as it would be after sign-in: the share opens as a chat.
    private func openInSureWord(name: String) {
        let app = XCUIApplication()
        app.launchArguments = ["-SureWordEvidence", "YES", "-evidence.screen", "shell"]
        app.launch()
        let check = app.buttons["share-action-check"]
        let dismiss = app.buttons["Dismiss share actions"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 20), "the share opened as a chat with its actions")
        // Uploads need a session the evidence shell does not have; give the
        // attempt a moment so the capture shows what happened to the files.
        sleep(4)
        // The morning-reminder permission prompt (unrelated to sharing).
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let dontAllow = springboard.buttons["Don’t Allow"]
        if dontAllow.waitForExistence(timeout: 2) { dontAllow.tap() }
        sleep(1)
        snapshot("\(name)-chat")
        if check.exists { XCTAssertTrue(app.buttons["share-action-reply"].exists) }
        app.terminate()
    }

    func testShareLinkFromSafari() {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        let address = safari.textFields.firstMatch
        if address.waitForExistence(timeout: 10) {
            address.tap()
        } else {
            safari.buttons["Address"].tap()
        }
        safari.typeText("https://sureword.app/support\n")
        sleep(5)
        // iOS 27 Safari keeps Share in the page menu.
        let pageMenu = safari.buttons["MoreMenuButton"]
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 15))
        pageMenu.tap()
        let share = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Share'")).firstMatch
        XCTAssertTrue(share.waitForExistence(timeout: 10), "the page menu has Share")
        share.tap()
        pickSureWord(in: safari)
        confirmSaved(in: safari, name: "safari")
        openInSureWord(name: "safari")
    }

    func testSharePhotoFromPhotos() {
        let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
        photos.launch()
        for label in ["Continue", "Not Now", "OK"] where photos.buttons[label].waitForExistence(timeout: 2) {
            photos.buttons[label].tap()
        }
        let photo = photos.images.firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 15))
        photo.tap()
        let share = photos.buttons["Share"]
        XCTAssertTrue(share.waitForExistence(timeout: 10))
        share.tap()
        pickSureWord(in: photos)
        confirmSaved(in: photos, name: "photos")
        openInSureWord(name: "photos")
    }

    func testShareVoiceMessageFromFiles() {
        shareFromFiles(named: "Voice message", tag: "files-audio")
    }

    /// `simctl addmedia` can fail on a fresh simulator; a photo in Files goes
    /// through the same image path (provider type public.jpeg, re-encoded).
    func testSharePhotoFromFiles() {
        shareFromFiles(named: "Photo from Photos", tag: "files-photo")
    }

    func testSharePDFFromFiles() {
        shareFromFiles(named: "Sermon notes", tag: "files-pdf")
    }

    private func shareFromFiles(named file: String, tag: String) {
        let files = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")
        files.launch()
        // Files restores the last screen; close a Quick Look left open.
        let close = files.buttons["QLOverlayDoneButtonAccessibilityIdentifier"]
        if close.waitForExistence(timeout: 3) { close.tap() }
        let browse = files.buttons["Browse"]
        if browse.waitForExistence(timeout: 5) { browse.tap() }
        let onDevice = files.staticTexts["On My iPhone"]
        if onDevice.waitForExistence(timeout: 5) { onDevice.tap() }
        // A fresh simulator shows the slide-to-type keyboard tip over Files.
        if files.buttons["Continue"].waitForExistence(timeout: 3) { files.buttons["Continue"].tap() }
        if files.keyboards.firstMatch.exists {
            let cancel = files.buttons["Cancel"].firstMatch
            let done = files.keyboards.buttons["done"].firstMatch
            if cancel.exists { cancel.tap() } else if done.exists { done.tap() }
        }
        if files.buttons["Continue"].exists { files.buttons["Continue"].tap() }
        let item = files.staticTexts[file]
        XCTAssertTrue(item.waitForExistence(timeout: 10), "\(file) is in On My iPhone")
        snapshot("\(tag)-files")
        // Select mode, then the toolbar's Share: the grid's long-press menu
        // does not come up under XCUITest, and a tap opens PDFs and photos
        // in Preview rather than Quick Look.
        files.buttons["OverflowBarButtonItem"].tap()
        let select = files.descendants(matching: .any).matching(NSPredicate(format: "label == 'Select'")).firstMatch
        XCTAssertTrue(select.waitForExistence(timeout: 5), "the More menu has Select")
        select.tap()
        let cell = files.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", file + ",")).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        cell.tap()
        let share = files.buttons.matching(NSPredicate(format: "label == 'Share'")).firstMatch
        XCTAssertTrue(share.waitForExistence(timeout: 5), "the selection toolbar has Share")
        share.tap()
        pickSureWord(in: files)
        confirmSaved(in: files, name: tag)
        openInSureWord(name: tag)
    }
}
