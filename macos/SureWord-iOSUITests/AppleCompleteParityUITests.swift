import UIKit
import XCTest

/// Bounded acceptance journeys through the shipping signed-in app. No evidence
/// launch arguments, API response fixtures, direct API mutations or profile
/// captures. Root schedules SW-C1 exclusively and supplies the private review
/// identity with TEST_RUNNER_SW_DEMO_EMAIL / TEST_RUNNER_SW_DEMO_PASSWORD.
///
/// Run exact methods/classes, never the unfiltered UI scheme (it also contains
/// a physical-device App Review purchase utility). A skipped precondition is
/// outstanding coverage, never a passing capability claim.
@MainActor
final class AppleCompleteParityUITests: AppleShippingUITestCase {
    private enum JourneyStop: Error { case missingControl, unsafeState }
    private let qaPrefix = "QA Apple parity "
    private var pendingOwnedNotes = Set<String>()
    private var ownsPreset = false
    private var pendingChatTitles = Set<String>()
    private var ownedChatMarker: String?
    private var pendingSettingsBaseline: SettingsBaseline?
    private var diagnosesOriginalLanguages = false
    private var linkedNoteDiagnosticPhase: String?
    private var lastNotesLibraryState: String?

    override func tearDown() async throws {
        // The inherited teardown hook is empty. Stay on the class's
        // MainActor while reading ownership state and operating native UI.
        cleanupOwnedState()
    }

    private func cleanupOwnedState() {
        if let phase = linkedNoteDiagnosticPhase,
           (testRun?.failureCount ?? 0) > 0 || (testRun?.unexpectedExceptionCount ?? 0) > 0 {
            reportOwnedLinkedNoteFailure(XCUIApplication(), phase: phase)
        }
        linkedNoteDiagnosticPhase = nil
        if diagnosesOriginalLanguages {
            reportOriginalLanguageState(XCUIApplication())
            diagnosesOriginalLanguages = false
        }
        guard pendingSettingsBaseline != nil || !pendingOwnedNotes.isEmpty || ownsPreset || !pendingChatTitles.isEmpty else { return }
        if pendingSettingsBaseline != nil {
            do { try restoreSettingsBaseline() }
            catch { print("QA_SETTINGS_RESTORE_REQUIRED: appearance, parchment, app text size, language and translation") }
        }
        // Failure recovery only visits the exact records created in this test.
        // If ownership cannot be re-established, leave a named cleanup receipt
        // for root instead of deleting a neighboring account record.
        do {
            let app = try shippingApp()
            for title in Array(pendingOwnedNotes) {
                try openOwnedNote(title, app: app)
                try deleteOwnedNote(title, app: app)
            }
            if ownsPreset {
                try openPlan(app, title: "The Gospels in 30 days")
                try archiveOwnedPreset(app)
            }
            if let marker = ownedChatMarker, !pendingChatTitles.isEmpty {
                try openHistory(app)
                for title in Array(pendingChatTitles) where app.buttons[title].exists {
                    try tapVisible(app.buttons[title], in: app)
                    try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch.waitForExistence(timeout: 15),
                                "Cleanup conversation does not contain the question created by this run")
                    try deleteOwnedChat(title, app: app)
                    break
                }
                try require(pendingChatTitles.isEmpty, "Owned QA conversation still needs cleanup")
            }
        } catch {
            print("QA_CLEANUP_REQUIRED: owned notes=\(pendingOwnedNotes.sorted().joined(separator: ", ")); owned preset=\(ownsPreset); owned chat=\(pendingChatTitles.sorted().joined(separator: ", "))")
        }
    }

    private func uniqueName(_ kind: String) -> String {
        qaPrefix + kind + " " + String(UUID().uuidString.prefix(8))
    }

    private func require(_ condition: Bool, _ step: String) throws {
        guard condition else {
            XCTFail("APPLE_COMPLETE_PARITY_STOP: " + step)
            throw JourneyStop.missingControl
        }
    }

    private func button(_ app: XCUIApplication, startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func waitUntil(_ app: XCUIApplication, timeout: TimeInterval = 30,
                           _ condition: () -> Bool) throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            try checkManualStep(app)
            if condition() { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        try require(condition(), "Expected shipping state did not settle")
    }

    /// Scroll the actual content surface; keep navigation and tab controls out
    /// of the gesture. Never use a guessed coordinate to activate a control.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication,
                        attempts: Int = 14) throws {
        for _ in 0..<attempts {
            try checkManualStep(app)
            if element.exists,
               app.frame.contains(element.frame),
               element.isHittable { return }
            try scrollObservedContent(toward: element, in: app)
        }
        try require(element.exists && element.isHittable, "Shipping control could not be revealed")
    }

    private func tapVisible(_ element: XCUIElement, in app: XCUIApplication) throws {
        try reveal(element, in: app)
        try tap(element, in: app)
    }

    private func back(_ app: XCUIApplication, to title: String) throws {
        try tap(app.navigationBars.buttons.element(boundBy: 0), in: app)
        try require(app.navigationBars[title].waitForExistence(timeout: 15), "Back did not return to expected page")
    }

    private func notesLibraryVisible(_ app: XCUIApplication) -> Bool {
        let create = app.buttons["New note"].exists
        let editor = app.buttons["Back to notes"].exists
        let search = app.searchFields["Search notes"].exists
        let notesBar = app.navigationBars["Notes"].exists
        let state = "create=\(create),editor=\(editor),search=\(search),notesBar=\(notesBar)"
        if lastNotesLibraryState != state {
            print("QA_NOTES_LIBRARY_PRESENTATION: " + state)
            lastNotesLibraryState = state
        }
        // Native search presentation hides the creation toolbar while the
        // same Notes library remains on screen with its filtered results.
        return !editor && (create || (search && app.buttons["New Folder"].exists))
    }

    private func openNotes(_ app: XCUIApplication) throws {
        if !app.tabBars.buttons["Study"].isSelected {
            try tap(app.tabBars.buttons["Study"], in: app)
        }
        // Linked notes can leave two editors on the Study stack. Pop only
        // exact titles created by this run, and wait for each real destination.
        for _ in 0..<(pendingOwnedNotes.count + 1) {
            guard app.buttons["Back to notes"].exists else { break }
            let titleField = app.textFields["Untitled Note"]
            try require(titleField.exists, "A preserved editor has no title field")
            let currentTitle = titleField.value as? String ?? ""
            try require(pendingOwnedNotes.contains(currentTitle), "A preserved editor is not an owned QA note")
            try tap(app.buttons["Back to notes"], in: app)
            try waitUntil(app) {
                let nextField = app.textFields["Untitled Note"]
                let nextTitle = nextField.exists ? nextField.value as? String ?? "" : ""
                return notesLibraryVisible(app)
                    || (nextTitle != currentTitle && pendingOwnedNotes.contains(nextTitle))
            }
        }
        if !notesLibraryVisible(app) {
            try require(app.navigationBars["Study"].waitForExistence(timeout: 15), "Study root is unavailable")
            try tapVisible(button(app, startingWith: "Notes"), in: app)
            try waitUntil(app) { notesLibraryVisible(app) }
        }
        let search = app.searchFields["Search notes"]
        if search.exists {
            // Empty native search fields expose their prompt as value. This
            // is a search query, not a note title/reference or a creation.
            let current = search.value as? String ?? ""
            if !current.isEmpty && current != search.placeholderValue {
                try n3Replace(search, with: "", app: app)
                if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
            }
        }
    }

    private func createOwnedNote(_ title: String, app: XCUIApplication) throws {
        try require(title.hasPrefix(qaPrefix), "New note must have this run's QA prefix")
        try openNotes(app)
        // iOS 27 replaces the Notes toolbar with a native Close button while
        // search is active, even after its query is cleared. Dismiss that
        // observed library search presentation before requesting creation.
        if !app.buttons["New note"].exists && app.searchFields["Search notes"].exists {
            let closeSearch = app.navigationBars["Notes"].buttons["Close"]
            try require(closeSearch.exists && closeSearch.isHittable,
                        "Active Notes search has no observed native dismissal control")
            try tap(closeSearch, in: app)
            try require(app.buttons["New note"].waitForExistence(timeout: 10),
                        "Notes creation toolbar did not return after closing search")
        }
        try tap(app.buttons["New note"], in: app)
        try require(app.navigationBars["Start a note"].waitForExistence(timeout: 15), "Template picker is unavailable")
        try tap(app.buttons["Blank note"], in: app)
        let field = app.textFields["Untitled Note"]
        try require(field.waitForExistence(timeout: 30), "Created blank note editor is unavailable")
        // Blank-note creation seeds a real title of "Untitled Note", which
        // happens to equal the placeholder. Clear the observed value first.
        try replaceReference(field, with: title, app: app)
        try require((field.value as? String) == title, "New note did not receive its unique title")
        pendingOwnedNotes.insert(title)
        try require(app.textViews.count == 1, "Note body is not uniquely identified")
    }

    private func visibleNoteTitleFields(_ app: XCUIApplication) -> [XCUIElement] {
        app.textFields.allElementsBoundByIndex.filter {
            $0.placeholderValue == "Untitled Note" && $0.isHittable
        }
    }

    private func visibleNoteBodies(_ app: XCUIApplication) -> [XCUIElement] {
        app.textViews.allElementsBoundByIndex.filter { $0.isHittable }
    }

    private func hasVisibleOwnedEditor(_ title: String, app: XCUIApplication) -> Bool {
        let fields = visibleNoteTitleFields(app)
        return fields.count == 1 && (fields[0].value as? String) == title
    }

    private func ownedEditorControl(_ label: String, app: XCUIApplication) throws -> XCUIElement {
        let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
        try waitUntil(app, timeout: 20) {
            matches.allElementsBoundByIndex.filter { $0.isHittable }.count == 1
        }
        let visible = matches.allElementsBoundByIndex.filter { $0.isHittable }
        try require(visible.count == 1, "Owned editor control is not uniquely visible: " + label)
        return visible[0]
    }

    private func noteBody(_ app: XCUIApplication) throws -> XCUIElement {
        try waitUntil(app, timeout: 20) { visibleNoteBodies(app).count == 1 }
        let visible = visibleNoteBodies(app)
        try require(visible.count == 1, "Expected exactly one visible rich note body")
        return visible[0]
    }

    private func assertOwnedEditor(_ title: String, app: XCUIApplication) throws {
        try require(pendingOwnedNotes.contains(title) && title.contains(qaPrefix), "Refusing an operation on an unowned note title")
        try waitUntil(app, timeout: 20) { hasVisibleOwnedEditor(title, app: app) }
        try require(hasVisibleOwnedEditor(title, app: app),
                    "Current editor is not the note created by this run")
    }

    private func closeOwnedEditor(_ title: String, app: XCUIApplication) throws {
        try assertOwnedEditor(title, app: app)
        // This shipping action awaits model.flush(), so a successful pop is a
        // durable-save gate rather than a sleep after the autosave debounce.
        try tap(try ownedEditorControl("Back to notes", app: app), in: app)
        try waitUntil(app) { notesLibraryVisible(app) }
        try require(app.buttons[title].waitForExistence(timeout: 20), "Saved note title is missing from library")
    }

    private func openOwnedNote(_ title: String, app: XCUIApplication) throws {
        try require(pendingOwnedNotes.contains(title) && title.contains(qaPrefix), "Refusing to select an unowned note")
        try openNotes(app)
        let search = app.searchFields["Search notes"]
        if search.exists && search.isHittable {
            search.tap()
            search.typeText(title)
            if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
        }
        try tapVisible(app.buttons[title], in: app)
        try waitUntil(app) {
            hasVisibleOwnedEditor(title, app: app)
        }
    }

    /// Opening an app-owned confirmation may itself produce an alert, so
    /// the generic tap helper cannot run its post-tap unknown-alert guard.
    /// Immediately validate the exact expected dialog before its next action.
    private func presentOwnedDialog(_ action: XCUIElement, app: XCUIApplication) throws {
        try checkManualStep(app)
        try require(action.waitForExistence(timeout: 15) && action.isHittable,
                    "Owned-record confirmation action is unavailable")
        action.tap()
    }

    /// This is deliberately narrower than checkManualStep: only one exact
    /// app dialog with its owned-record wording is allowed. System alerts,
    /// authentication/legal prompts and any other app alert still stop us.
    private func tapOwnedConfirmation(app: XCUIApplication, title: String,
                                      message: String? = nil, button: String) throws {
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        try require(!system.alerts.firstMatch.exists, "Unexpected system alert during owned-record confirmation")
        for label in ["Save Password", "Update Password", "Allow Notifications"] {
            let systemStep = system.buttons[label]
            try require(!(systemStep.exists && systemStep.isHittable),
                        "Unexpected system step during owned-record confirmation")
        }
        let end = Date().addingTimeInterval(10)
        var expected: XCUIElement?
        while Date() < end {
            let dialogs = app.alerts.allElementsBoundByIndex + app.sheets.allElementsBoundByIndex
            expected = dialogs.first { candidate in
                candidate.staticTexts[title].exists
                    && (message == nil || candidate.staticTexts[message!].exists)
            }
            if expected != nil { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let expected else {
            try require(false, "Expected owned-record dialog and exact wording are unavailable")
            return
        }
        try require(app.alerts.allElementsBoundByIndex.allSatisfy {
            $0.staticTexts[title].exists && (message == nil || $0.staticTexts[message!].exists)
        }, "An unrelated app alert covers the owned-record dialog")
        let intended = expected.buttons[button]
        if intended.waitForExistence(timeout: 5) && intended.isHittable {
            intended.tap()
        } else if button == "Cancel", expected.elementType == .sheet {
            // iOS 27 can present confirmationDialog as a popover, omitting
            // its explicit role: .cancel button. UIKit exposes dismissal as
            // this native AX region. The exact owned title/message and the
            // system/unrelated-alert guards above must already have passed.
            let dismissRegions = app.otherElements.matching(identifier: "PopoverDismissRegion")
                .allElementsBoundByIndex.filter {
                    $0.label == "dismiss popup" && app.frame.contains($0.frame) && $0.isHittable
                }
            try require(dismissRegions.count == 1,
                        "Owned popover has neither Cancel nor a unique native dismissal region")
            dismissRegions[0].tap()
            print("QA_OWNED_CONFIRMATION_CANCEL: native popover dismissal region")
        } else {
            try require(false, "Expected owned-record confirmation button is unavailable")
        }
        let dismissalDeadline = Date().addingTimeInterval(15)
        while Date() < dismissalDeadline {
            let remains = (app.alerts.allElementsBoundByIndex + app.sheets.allElementsBoundByIndex)
                .contains { $0.staticTexts[title].exists }
            if !remains { break }
            try require(!system.alerts.firstMatch.exists,
                        "Unexpected system alert while owned-record dialog closes")
            Thread.sleep(forTimeInterval: 0.1)
        }
        try require(!(app.alerts.allElementsBoundByIndex + app.sheets.allElementsBoundByIndex)
            .contains { $0.staticTexts[title].exists }, "Owned-record confirmation did not close")
        try checkManualStep(app)
    }

    private func deleteOwnedNote(_ title: String, app: XCUIApplication) throws {
        try assertOwnedEditor(title, app: app)
        try tap(try ownedEditorControl("Note menu", app: app), in: app)
        try presentOwnedDialog(app.buttons["Delete note"], app: app)
        // The dialog names the same unique QA note before the destructive tap.
        let prompt = "Delete \u{201C}\(title)\u{201D}? This cannot be undone."
        try tapOwnedConfirmation(app: app, title: prompt, button: "Delete Note")
        try waitUntil(app) { notesLibraryVisible(app) }
        try waitUntil(app) { !app.buttons[title].exists }
        pendingOwnedNotes.remove(title)
    }

    /// Copy is a shipping user action and copies only the note this test made.
    /// Inspect its exported Markdown without attaching/logging any note text.
    private func assertOwnedHeadingExport(_ title: String, markers: [Int: String],
                                         app: XCUIApplication) throws {
        try assertOwnedEditor(title, app: app)
        try tap(try ownedEditorControl("Note menu", app: app), in: app)
        // Read metadata only until this exact owned Copy action completes.
        // Its 1.2-second toast expires during native tap-idle/safety checks.
        let previousCopy = UIPasteboard.general.changeCount
        try tap(app.buttons["Copy as Markdown"], in: app)
        try waitUntil(app, timeout: 5) { UIPasteboard.general.changeCount != previousCopy }
        // Reading another app's clipboard from the runner opens iOS's paste
        // permission dialog and blocks XCTest. The host instead reads this
        // simulator's actual clipboard with simctl, checks exact heading lines,
        // and saves the owned export as independent evidence. No app fixture or
        // permission override is involved; require a fresh nonce receipt.
        let nonce = UUID().uuidString
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let receiptURL = documents.appendingPathComponent("qa-heading-copy-" + nonce + ".json")
        defer { try? FileManager.default.removeItem(at: receiptURL) }
        let expectedLines = try [4, 5, 6].map { level in
            String(repeating: "#", count: level) + " " + (try XCTUnwrap(markers[level]))
        }
        let request: [String: Any] = ["nonce": nonce, "title": title,
            "expectedLines": expectedLines, "runnerBundleID": try XCTUnwrap(Bundle.main.bundleIdentifier)]
        let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
        FileHandle.standardOutput.write(Data("QA_HEADING_COPY_REQUEST: ".utf8) + data + Data("\n".utf8))
        try waitUntil(app, timeout: 40) { FileManager.default.fileExists(atPath: receiptURL.path) }
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as? [String: Any])
        try require(receipt["nonce"] as? String == nonce && receipt["title"] as? String == title
                    && receipt["passed"] as? Bool == true,
                    "Host did not verify this owned Markdown copy and all exact heading levels")
    }

    private func revealFormatting(_ label: String, in app: XCUIApplication) throws {
        let control = app.buttons[label]
        for _ in 0..<12 {
            try checkManualStep(app)
            // Off-screen SwiftUI accessory buttons can throw an XCTest
            // activation-point failure when queried for isHittable. First
            // check their observed frame, then ask only while on screen.
            let frame = control.exists ? control.frame : .zero
            if frame.width > 0 && frame.height > 0,
               frame.minX >= app.frame.minX && frame.maxX <= app.frame.maxX,
               frame.minY >= app.frame.minY && frame.maxY <= app.frame.maxY,
               control.isHittable { return }
            // The accessory's horizontal ScrollView is above the keyboard;
            // use the element's observed frame to identify its scroll container.
            guard let strip = app.scrollViews.allElementsBoundByIndex.first(where: {
                $0.frame.height > 25 && $0.frame.height < 80 && $0.frame.width > 200
            }) else {
                try require(false, "Formatting accessory scroll surface is unavailable")
                return
            }
            // A full native swipe can fling past a32pt target and oscillate
            // between both ends. Move a short measured distance on the actual
            // strip; these are scroll gestures, never guessed button taps.
            let targetX = control.exists ? control.frame.midX : strip.frame.maxX
            let delta = targetX - strip.frame.midX
            let fraction = min(0.34, max(0.12, abs(delta) / strip.frame.width))
            let startX: CGFloat = delta >= 0 ? 0.75 : 0.25
            let endX = startX + (delta >= 0 ? -fraction : fraction)
            strip.coordinate(withNormalizedOffset: CGVector(dx: startX, dy: 0.5))
                .press(forDuration: 0.1, thenDragTo:
                    strip.coordinate(withNormalizedOffset: CGVector(dx: endX, dy: 0.5)))
        }
        try require(false, "Formatting control is not reachable through the real accessory scroll surface")
    }

    /// Only this journey's exact owned editor may contribute note text. A
    /// failed Back can leave the editor, info sheet, library or Study root;
    /// record those states before teardown changes the navigation stack.
    private func reportOwnedLinkedNoteFailure(_ app: XCUIApplication, phase: String) {
        let fields = visibleNoteTitleFields(app)
        let field = fields.count == 1 ? fields[0] : nil
        let title = field?.value as? String ?? ""
        let isOwned = pendingOwnedNotes.contains(title) && title.hasPrefix(qaPrefix)
        let publicErrors = [
            "Changes could not be saved.", "Could not open this note.",
            "Could not load links.", "You appear to be offline. Reconnect and try again.",
            "The request timed out. Check your connection and try again.",
            "This note is being edited in another window. Close that editor, then reopen this note to edit here.",
            "Your AI request may still be finishing. Editing is paused to protect this note. Check again, or copy/share your retained draft as Markdown from the note menu.",
            "The AI may have changed this note, but its saved copy could not be loaded. Editing is paused. Check again, or copy/share your retained draft as Markdown."
        ]
        let bodies = visibleNoteBodies(app)
        let body = bodies.count == 1 ? bodies[0] : nil
        let state: [String: Any] = [
            "phase": phase,
            "notesLibrary": notesLibraryVisible(app),
            "studyRoot": app.navigationBars["Study"].exists,
            "noteInfo": app.navigationBars["Note info"].exists,
            "backToNotes": app.buttons["Back to notes"].exists,
            "newNote": app.buttons["New note"].exists,
            "saving": app.staticTexts["Saving…"].exists,
            "checkSavedNote": app.buttons["Check saved note"].exists,
            "titleIsOwned": isOwned,
            "ownedTitle": isOwned ? title : "[not an owned editor]",
            "visibleTitleFieldCount": fields.count,
            "titleEnabled": isOwned && field?.isEnabled == true,
            "uniqueBody": bodies.count == 1,
            "bodyEnabled": isOwned && bodies.count == 1 && body?.isEnabled == true,
            "ownedBody": isOwned && bodies.count == 1
                ? String((body?.value as? String ?? "").prefix(16_384)) : "[not captured]",
            "publicErrorMessages": publicErrors.filter { app.staticTexts[$0].exists },
            "ownedTitlesStillVisible": pendingOwnedNotes.sorted().filter { app.buttons[$0].exists }
        ]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_LINKED_NOTE_FAILURE_STATE: " + text)
        }
    }

    func testOwnedLinkedNotePushPopRetainsOriginalBodyAndNextEdit() throws {
        continueAfterFailure = true
        var app = try shippingApp()
        let titleB = uniqueName("linked target")
        let titleA = uniqueName("linked source")
        let targetBody = "QA owned linked target body " + titleB
        let originalBody = "QA owned source original " + titleA
            + "\n[[" + titleB + "]]\nQA owned source tail"
        let nextEdit = "QA owned manual edit after linked-note pop " + titleA

        linkedNoteDiagnosticPhase = "create target B"
        try createOwnedNote(titleB, app: app)
        try tap(try noteBody(app), in: app)
        try noteBody(app).typeText(targetBody)
        linkedNoteDiagnosticPhase = "flush target B to library"
        try closeOwnedEditor(titleB, app: app)

        linkedNoteDiagnosticPhase = "create source A with wikilink"
        try createOwnedNote(titleA, app: app)
        try tap(try noteBody(app), in: app)
        try noteBody(app).typeText(originalBody)
        linkedNoteDiagnosticPhase = "flush source A to library"
        try closeOwnedEditor(titleA, app: app)
        try openOwnedNote(titleA, app: app)
        try require((try noteBody(app).value as? String)?.contains(originalBody) == true,
                    "Source A did not retain its original body before linked navigation")

        // NoteActionMenu calls this “Note info”. Opening the sheet flushes
        // the editor, then loadLinks fetches the graph from the saved text.
        linkedNoteDiagnosticPhase = "open source A outbound links"
        try tap(try ownedEditorControl("Note menu", app: app), in: app)
        try tap(app.buttons["Note info"], in: app)
        try require(app.navigationBars["Note info"].waitForExistence(timeout: 30),
                    "Owned source note info did not open")
        let outbound = app.buttons["Open " + titleB]
        linkedNoteDiagnosticPhase = "push linked target B"
        try tapVisible(outbound, in: app)
        try waitUntil(app) {
            hasVisibleOwnedEditor(titleB, app: app)
        }
        try assertOwnedEditor(titleB, app: app)
        try require((try noteBody(app).value as? String)?.contains(targetBody) == true,
                    "Linked navigation did not open the owned target body")

        linkedNoteDiagnosticPhase = "pop linked B back to A"
        try tap(try ownedEditorControl("Back to notes", app: app), in: app)
        try waitUntil(app) {
            hasVisibleOwnedEditor(titleA, app: app)
        }
        try assertOwnedEditor(titleA, app: app)
        let returnedBody = try noteBody(app)
        try require((returnedBody.value as? String)?.contains(originalBody) == true,
                    "Linked-note pop replaced the source's original body")
        try require(visibleNoteTitleFields(app).count == 1
                    && visibleNoteTitleFields(app)[0].isEnabled && returnedBody.isEnabled,
                    "Source editor did not regain editing after the linked-note pop")

        linkedNoteDiagnosticPhase = "append owned manual edit to restored A"
        try tap(returnedBody, in: app)
        // The short owned document leaves blank space beneath its final line.
        // Tap the actual text surface there to place the caret at its end.
        returnedBody.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
        returnedBody.typeText("\n" + nextEdit)
        try require((returnedBody.value as? String)?.contains(originalBody) == true
                    && (returnedBody.value as? String)?.contains(nextEdit) == true,
                    "Manual edit did not preserve the original owned body")
        linkedNoteDiagnosticPhase = "flush edited A with normal Back"
        try closeOwnedEditor(titleA, app: app)

        linkedNoteDiagnosticPhase = "normal relaunch and reopen A"
        app = try shippingApp()
        try openOwnedNote(titleA, app: app)
        let persisted = try noteBody(app)
        try waitUntil(app) {
            let text = persisted.value as? String ?? ""
            return text.contains(originalBody) && text.contains(nextEdit)
        }
        try require(persisted.isEnabled, "Persisted source note is not editable")
        linkedNoteDiagnosticPhase = "delete exact owned source A"
        try deleteOwnedNote(titleA, app: app)
        linkedNoteDiagnosticPhase = "verify target B and delete exact owned target"
        try openOwnedNote(titleB, app: app)
        try require((try noteBody(app).value as? String)?.contains(targetBody) == true,
                    "Editing source A changed the owned linked target B")
        try deleteOwnedNote(titleB, app: app)
        linkedNoteDiagnosticPhase = nil
    }

    func testOwnedNoteHeading456SurvivesNormalRelaunchReaderAppendAndDelete() throws {
        guard ProcessInfo.processInfo.environment["SW_QA_HOST_CLIPBOARD"] == "1" else {
            throw XCTSkip("Run with the owned simulator clipboard verifier; never grant the runner paste access")
        }
        var app = try shippingApp()
        let title = uniqueName("note")
        let markers = [4: "QA fourth heading", 5: "QA fifth heading", 6: "QA sixth heading"]
        try createOwnedNote(title, app: app)
        try tap(try noteBody(app), in: app)
        for level in [4, 5, 6] {
            try revealFormatting("Heading \(level)", in: app)
            try tap(app.buttons["Heading \(level)"], in: app)
            try noteBody(app).typeText(markers[level]! + "\n")
        }
        try closeOwnedEditor(title, app: app)
        app = try shippingApp()
        try openOwnedNote(title, app: app)
        let body = try noteBody(app)
        try waitUntil(app) { markers.values.allSatisfy { (body.value as? String)?.contains($0) == true } }
        try assertOwnedHeadingExport(title, markers: markers, app: app)
        try closeOwnedEditor(title, app: app)

        try openGenesis(app)
        let verse = button(app, startingWith: "Genesis 1:1")
        try tapVisible(verse, in: app)
        try tap(app.buttons["Note"], in: app)
        try require(app.navigationBars["Add to notes"].waitForExistence(timeout: 15), "Reader note picker did not open")
        try tapVisible(app.buttons["Append to " + title], in: app)
        try tap(app.buttons["Open note " + title], in: app)
        try waitUntil(app) {
            let field = app.textFields["Untitled Note"]
            return field.exists && (field.value as? String) == title
        }
        let appended = try noteBody(app)
        try waitUntil(app) {
            guard let text = appended.value as? String else { return false }
            return text.contains("Genesis 1:1") && text.contains("In the beginning God created")
                && markers.values.allSatisfy { text.contains($0) }
        }
        try closeOwnedEditor(title, app: app)
        app = try shippingApp()
        try openOwnedNote(title, app: app)
        let persisted = try noteBody(app)
        try waitUntil(app) { (persisted.value as? String)?.contains("Genesis 1:1") == true }
        try assertOwnedHeadingExport(title, markers: markers, app: app)
        try deleteOwnedNote(title, app: app)
        app = try shippingApp()
        try openNotes(app)
        try require(!app.buttons[title].exists, "Deleted QA note reappeared after normal relaunch")
    }

    /// One append in a newly created note, followed by an ordinary manual edit.
    /// Source-derived AI-sheet selectors must be confirmed by the first run;
    /// missing/ambiguous controls stop without a retry or another AI request.
    func testOwnedNoteAIAppendThenManualEditPersistsAcrossNormalRelaunchAndDelete() throws {
        // Every acceptance guard throws after recording its failure, allowing
        // this journey's exact ownership receipt and cleanup to run as well.
        continueAfterFailure = true
        let title = uniqueName("AI append note")
        let seed = "QA preserved seed " + UUID().uuidString
        let manual = "QA manual follow-up " + UUID().uuidString
        let verse = "The LORD is my shepherd; I shall not want."
        let appendReceipt = "Added to " + title + ". Opens the note."
        let prompt = "In this currently open note only, use addToNote once, omitting noteId, to append Psalm 23:1 (KJV) exactly once with its reference and these exact words: "
            + verse + " Preserve the existing title and every existing character unchanged. Do not repeat the seed, rewrite, create another note, or change any other note. Reply briefly after the append."
        var phase = "before creation"
        var createAttempted = false
        var titleObserved = false
        var sendAttempted = false
        var deleted = false
        func receipt(_ outcome: String) {
            let metadata: [String: Any] = [
                "phase": phase, "outcome": outcome, "requestedTitle": title,
                "createAttempted": createAttempted, "ownedTitleObserved": titleObserved,
                "singleSendAttempted": sendAttempted, "deletedAfterNormalRelaunch": deleted,
                "cleanupRequired": createAttempted && !deleted,
                "unidentifiedBlankPossible": createAttempted && !titleObserved
            ]
            if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                print("QA_NOTE_AI_OWNERSHIP: " + text)
            }
        }
        func assertContents(_ app: XCUIApplication, manualExpected: Bool,
                            exact: String? = nil) throws -> String {
            try assertOwnedEditor(title, app: app)
            let body = try noteBody(app)
            let text = (body.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            func count(_ marker: String) -> Int { text.components(separatedBy: marker).count - 1 }
            try require(count(seed) == 1 && text.hasPrefix(seed), "AI append lost or repeated the owned seed")
            try require(count(verse) == 1 && count("23:1") == 1,
                        "Owned note does not contain exactly one requested Psalm 23:1 KJV quotation")
            try require(count(manual) == (manualExpected ? 1 : 0), "Owned manual follow-up was lost or duplicated")
            if let exact { try require(text == exact, "The complete owned body changed during reopen/relaunch") }
            try require(app.textFields["Untitled Note"].isEnabled && body.isEnabled
                        && !app.buttons["Check saved note"].exists,
                        "Owned editor did not finish canonical reconciliation and regain editing")
            return text
        }
        do {
            var app = try shippingApp()
            try openNotes(app)
            try require(!app.buttons[title].exists, "Unique AI note title already exists before creation")
            // Register before Blank note's POST or any other creation write.
            // If naming fails, cleanup may use only an observed exact QA title;
            // this receipt never authorizes deleting a generic Untitled Note.
            pendingOwnedNotes.insert(title)
            createAttempted = true
            receipt("before-create")
            try createOwnedNote(title, app: app)
            titleObserved = true
            phase = "seed exact owned note"
            receipt("owned-title-observed")
            try assertOwnedEditor(title, app: app)
            try tap(try noteBody(app), in: app)
            try noteBody(app).typeText(seed)
            try closeOwnedEditor(title, app: app)
            try n3OpenOwned(title, app: app)
            try require((try noteBody(app).value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) == seed,
                        "Seed was not saved before opening the owned AI panel")

            phase = "one owned AI append request"
            try tap(app.buttons["AI assistant"], in: app)
            try require(app.navigationBars["AI Assistant"].waitForExistence(timeout: 20), "Note AI sheet did not open")
            try require(app.staticTexts["Ask about your note"].waitForExistence(timeout: 20),
                        "Newly created note did not expose its empty AI conversation")
            // UIKit changes its vertical input's AX type while it wraps.
            // The stable native identifier must survive that transition.
            let composers = app.descendants(matching: .any).matching(identifier: "note-ai.composer")
            try require(composers.count == 1, "Note AI composer AX type/label is unavailable or ambiguous")
            let composer = composers.element(boundBy: 0)
            try tap(composer, in: app)
            composer.typeText(prompt) // Single line: never triggers onSubmit.
            try require((composer.value as? String) == prompt, "Owned AI composer differs from the one intended request")
            let send = app.buttons["Send"]
            try waitUntil(app, timeout: 20) { send.exists && send.isEnabled && send.isHittable }
            try require(app.buttons.matching(identifier: "Send").count == 1, "Note AI Send is ambiguous")
            sendAttempted = true // The post-tap guard can throw after dispatch.
            receipt("before-single-send")
            try tap(send, in: app) // The only AI submission in this journey.
            try waitUntil(app, timeout: 240) {
                app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Something went wrong:")).firstMatch.exists
                    || (app.buttons[appendReceipt].exists
                    && app.buttons["Suggest Verses"].exists && app.buttons["Suggest Verses"].isEnabled
                    && !app.buttons["Stop"].exists && !app.buttons["Check note"].exists
                    && !app.buttons["Try again"].exists && !app.staticTexts["Checking the saved note…"].exists)
            }
            try require(!app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved to ")).firstMatch.exists,
                        "The owned append unexpectedly reported creation of another note")
            try require(!app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Something went wrong:")).firstMatch.exists,
                        "Note AI reported an error; no retry is authorized by this journey")
            try tap(app.buttons["Close AI assistant"], in: app)
            try waitUntil(app, timeout: 30) { !app.navigationBars["AI Assistant"].exists }
            let canonical = try assertContents(app, manualExpected: false)
            receipt("one-append-canonical-editor-observed")

            phase = "manual edit after canonical AI refresh"
            let body = try noteBody(app)
            try tap(body, in: app)
            // Like the linked-note journey, this short document has blank
            // space below its final line. Use only its observed text surface.
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
            body.typeText("\n" + manual)
            let finalBody = try assertContents(app, manualExpected: true)
            try require(finalBody.hasPrefix(canonical), "Manual follow-up replaced part of the canonical AI document")
            try closeOwnedEditor(title, app: app) // Shipping Back awaits the save.
            phase = "library reopen after manual save"
            try n3OpenOwned(title, app: app)
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            try closeOwnedEditor(title, app: app)

            phase = "normal relaunch canonical readback"
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            receipt("full-owned-body-once-after-normal-relaunch")

            phase = "restore AI history without replaying its mutation"
            try tap(app.buttons["AI assistant"], in: app)
            try waitUntil(app, timeout: 45) {
                app.navigationBars["AI Assistant"].exists
                    && app.buttons[appendReceipt].exists
                    && app.buttons["Suggest Verses"].exists && app.buttons["Suggest Verses"].isEnabled
                    && !app.buttons["Stop"].exists && !app.buttons["Check note"].exists
            }
            try tap(app.buttons["Close AI assistant"], in: app)
            try waitUntil(app) { !app.navigationBars["AI Assistant"].exists }
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            receipt("restored-AI-history-did-not-repeat-append")
            phase = "delete exact owned note"
            try deleteOwnedNote(title, app: app)
            // Keep cleanup ownership until absence survives another normal launch.
            pendingOwnedNotes.insert(title)
            app = try shippingApp()
            try n3OpenLibrary(app)
            try n3Search(title, app: app)
            try require(!app.buttons[title].exists, "Deleted owned AI note returned after normal relaunch")
            pendingOwnedNotes.remove(title)
            deleted = true
            receipt("complete")
            try n3Search("", app: app)
        } catch {
            receipt("failed-see-exact-owned-cleanup-receipt")
            throw error
        }
    }

    /// Paste into AppleCompleteParityUITests in its existing source file so its
    /// private ownership, editor, library and cleanup helpers remain available.
    /// Requires the pending NoteAISheet shared ReceiptLineView product change.
    /// Source contract: updateNote -> "Updated <title>" (ChatViewMessage.swift
    /// 512-519); ReceiptLineView.swift183 adds ". Opens the note." to Button AX.
    func testOwnedNoteAIRewriteThenManualEditPersistsAcrossNormalRelaunchAndDelete() throws {
        continueAfterFailure = true
        let title = uniqueName("AI rewrite note")
        let seed = "QA immutable rewrite seed " + UUID().uuidString
        let oldMarker = "QA_REWRITE_OLD_" + UUID().uuidString
        let newMarker = "QA_REWRITE_NEW_" + UUID().uuidString
        let manual = "QA manual follow-up after rewrite " + UUID().uuidString
        let initialBody = seed + "\n" + oldMarker
        let expectedRewrite = seed + "\n" + newMarker
        let rewriteReceipt = "Updated " + title + ". Opens the note."
        let acceptedRewriteReceiptLabels = Set([rewriteReceipt, "Updated your note. Opens the note."])
        let prompt = "In this currently open note only, first call readNote once with noteId omitted, then call updateNote exactly once with noteId and title omitted to replace the complete note body. Change only the exact marker "
            + oldMarker + " to " + newMarker
            + ". Preserve the existing title and the immutable seed " + seed
            + " exactly once, and preserve every other character and line break unchanged. Do not append, use addToNote, create a note, rename or organize a note, write to any other note, or make any other write. Read the current note before rewriting it. Reply briefly after the update succeeds."
        var phase = "before creation"
        var createAttempted = false
        var titleObserved = false
        var sendAttempted = false
        var deleted = false

        func receipt(_ outcome: String) {
            let metadata: [String: Any] = [
                "journey": "one-current-note-updateNote", "phase": phase, "outcome": outcome,
                "requestedTitle": title, "expectedSharedReceiptAX": rewriteReceipt,
                "acceptedSharedReceiptAX": acceptedRewriteReceiptLabels.sorted(),
                "createAttempted": createAttempted, "ownedTitleObserved": titleObserved,
                "singleSendAttempted": sendAttempted, "deletedAfterNormalRelaunch": deleted,
                "cleanupRequired": createAttempted && !deleted,
                "unidentifiedBlankPossible": createAttempted && !titleObserved
            ]
            if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                print("QA_NOTE_AI_REWRITE_OWNERSHIP: " + text)
            }
        }

        func assertContents(_ app: XCUIApplication, manualExpected: Bool,
                            exact: String? = nil) throws -> String {
            try assertOwnedEditor(title, app: app)
            let body = try noteBody(app)
            let text = (body.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            func count(_ marker: String) -> Int { text.components(separatedBy: marker).count - 1 }
            try require(count(seed) == 1 && text.hasPrefix(seed), "AI rewrite lost or repeated the immutable owned seed")
            try require(count(newMarker) == 1 && count(oldMarker) == 0,
                        "AI rewrite did not replace exactly one owned marker")
            try require(count(manual) == (manualExpected ? 1 : 0), "Owned manual follow-up was lost or duplicated")
            if let exact { try require(text == exact, "The entire owned body changed during reopen/relaunch/history restore") }
            try require(app.textFields["Untitled Note"].isEnabled && body.isEnabled
                        && !app.buttons["Check saved note"].exists,
                        "Owned rewritten editor has not reconciled or regained editing")
            return text
        }

        func acceptedRewriteReceipt(_ app: XCUIApplication) -> XCUIElement? {
            let updates = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Updated "))
                .allElementsBoundByIndex
            guard updates.count == 1, acceptedRewriteReceiptLabels.contains(updates[0].label) else { return nil }
            return updates[0]
        }

        func noAIErrorOrWrongWrite(_ app: XCUIApplication) throws {
            try require(!app.staticTexts["Created note"].exists && !app.staticTexts["Added to note"].exists,
                        "Rewrite unexpectedly exposed a create/append note action")
            let updates = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Updated "))
                .allElementsBoundByIndex
            try require(updates.count == 1,
                        "Current-note rewrite did not produce exactly one successful update receipt")
            try require(updates.allSatisfy { acceptedRewriteReceiptLabels.contains($0.label) },
                        "Rewrite exposed another note's update receipt")
            for prefix in ["Added to ", "Saved to "] {
                try require(!app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch.exists,
                            "Rewrite unexpectedly exposed a shared create/append receipt")
            }
            try require(!app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Something went wrong:")).firstMatch.exists,
                        "Note AI reported an error; this journey authorizes zero retries")
            try require(!app.buttons["Try again"].exists && !app.buttons["Check note"].exists,
                        "The one rewrite attempt did not settle successfully; no recovery request is authorized")
        }

        func settledRewriteHistory(_ app: XCUIApplication) -> Bool {
            return app.navigationBars["AI Assistant"].exists
                && acceptedRewriteReceipt(app) != nil
                && app.buttons["Suggest Verses"].exists && app.buttons["Suggest Verses"].isEnabled
                && !app.buttons["Stop"].exists && !app.buttons["Check note"].exists
                && !app.buttons["Try again"].exists && !app.staticTexts["Checking the saved note…"].exists
        }

        do {
            var app = try shippingApp()
            try n3OpenLibrary(app)
            try n3Search(title, app: app)
            try require(!app.buttons[title].exists, "Unique rewrite note title already exists before creation")
            try n3Search("", app: app)
            // Register before Blank note's POST. This owns only the exact QA
            // title, never a generic Untitled Note if naming becomes ambiguous.
            pendingOwnedNotes.insert(title)
            createAttempted = true
            receipt("before-create")
            try createOwnedNote(title, app: app)
            titleObserved = true
            phase = "seed exact owned note"
            receipt("owned-title-observed")
            try assertOwnedEditor(title, app: app)
            try tap(try noteBody(app), in: app)
            try noteBody(app).typeText(initialBody)
            try closeOwnedEditor(title, app: app)
            try n3OpenOwned(title, app: app)
            try require((try noteBody(app).value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) == initialBody,
                        "Seed and old marker were not saved exactly before the AI rewrite")

            phase = "one owned current-note read and rewrite request"
            try tap(app.buttons["AI assistant"], in: app)
            try require(app.navigationBars["AI Assistant"].waitForExistence(timeout: 20), "Note AI sheet did not open")
            try require(app.staticTexts["Ask about your note"].waitForExistence(timeout: 20),
                        "Newly created rewrite note has unexpected AI history")
            let composers = app.descendants(matching: .any).matching(identifier: "note-ai.composer")
            try require(composers.count == 1, "Note AI composer AX identifier is missing or ambiguous")
            let composer = composers.element(boundBy: 0)
            try tap(composer, in: app)
            composer.typeText(prompt) // One line: never triggers onSubmit.
            try require((composer.value as? String) == prompt, "Rewrite composer differs from the single intended request")
            let send = app.buttons["Send"]
            try waitUntil(app, timeout: 20) { send.exists && send.isEnabled && send.isHittable }
            try require(app.buttons.matching(identifier: "Send").count == 1, "Note AI Send is ambiguous")
            sendAttempted = true // Mark before dispatch; the post-tap guard can throw.
            receipt("before-single-send")
            try tap(send, in: app) // The only AI submission in this journey.
            var observedBusyRewrite = false
            try waitUntil(app, timeout: 240) {
                let suggest = app.buttons["Suggest Verses"]
                let stopped = app.buttons["Stop"].exists
                if stopped || (suggest.exists && !suggest.isEnabled) { observedBusyRewrite = true }
                // A completed refusal is terminal too. Once the turn has
                // visibly run, fail on a missing success receipt immediately
                // instead of waiting four minutes for an already idle model.
                let completedWithoutReceipt = observedBusyRewrite && !stopped
                    && suggest.exists && suggest.isEnabled
                    && !app.staticTexts["Checking the saved note…"].exists
                return settledRewriteHistory(app)
                    || app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Something went wrong:")).firstMatch.exists
                    || completedWithoutReceipt
            }
            try noAIErrorOrWrongWrite(app)
            // This is the completed tool receipt, not assistant prose claiming a
            // rewrite. Before NoteAISheet renders shared receipts this must fail.
            try require(acceptedRewriteReceipt(app) != nil,
                        "The completed current-note updateNote receipt is missing or duplicated")
            let completedReceipt = try XCTUnwrap(acceptedRewriteReceipt(app), "Expected one owned-title or generic rewrite receipt")
            print("QA_NOTE_AI_REWRITE_RECEIPT_LABEL: " + completedReceipt.label)
            try tapVisible(completedReceipt, in: app)
            try waitUntil(app, timeout: 30) {
                !app.navigationBars["AI Assistant"].exists
                    && app.textViews.count == 1
                    && app.textViews.firstMatch.isEnabled
                    && app.textFields["Untitled Note"].isEnabled
                    && !app.buttons["Check saved note"].exists
            }
            let canonical = try assertContents(app, manualExpected: false, exact: expectedRewrite)
            receipt("one-rewrite-canonical-editor-observed")

            phase = "ordinary manual edit after canonical rewrite"
            let body = try noteBody(app)
            try tap(body, in: app)
            // Short owned body: put the caret in blank space at its actual end,
            // matching the existing append/linked-note acceptance journeys.
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
            body.typeText("\n" + manual)
            let finalBody = try assertContents(app, manualExpected: true)
            try require(finalBody.hasPrefix(canonical), "Manual follow-up replaced canonical rewritten content")
            try closeOwnedEditor(title, app: app) // Shipping Back awaits flush.
            phase = "complete body after library reopen"
            try n3OpenOwned(title, app: app)
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            try closeOwnedEditor(title, app: app)

            phase = "complete body after normal relaunch"
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            receipt("full-rewritten-body-once-after-normal-relaunch")

            phase = "restore AI history without replaying rewrite"
            try tap(app.buttons["AI assistant"], in: app)
            try waitUntil(app, timeout: 45) { settledRewriteHistory(app) }
            try noAIErrorOrWrongWrite(app)
            let restoredReceipt = try XCTUnwrap(acceptedRewriteReceipt(app), "Expected one persisted owned-title or generic rewrite receipt")
            print("QA_NOTE_AI_REWRITE_RESTORED_RECEIPT_LABEL: " + restoredReceipt.label)
            try tapVisible(restoredReceipt, in: app)
            try waitUntil(app) { !app.navigationBars["AI Assistant"].exists }
            _ = try assertContents(app, manualExpected: true, exact: finalBody)
            receipt("restored-rewrite-receipt-history-did-not-replay-mutation")

            phase = "delete exact owned rewritten note"
            try deleteOwnedNote(title, app: app)
            pendingOwnedNotes.insert(title) // Retain ownership until durable absence.
            app = try shippingApp()
            try n3OpenLibrary(app)
            try n3Search(title, app: app)
            try require(!app.buttons[title].exists, "Deleted owned rewrite note returned after normal relaunch")
            pendingOwnedNotes.remove(title)
            deleted = true
            receipt("complete")
            try n3Search("", app: app)
        } catch {
            receipt("failed-see-exact-owned-cleanup-receipt")
            throw error
        }
    }

    private func openPlan(_ app: XCUIApplication, title: String = "Reading plan") throws {
        try tap(app.tabBars.buttons["Today"], in: app)
        if app.navigationBars["Reading plan"].exists { return }
        try tapVisible(button(app, startingWith: title), in: app)
        try require(app.navigationBars["Reading plan"].waitForExistence(timeout: 20), "Reading-plan page did not open")
    }

    func testOwnedPresetReaderManualProgressUnmarkRelaunchAndArchive() throws {
        var app = try shippingApp()
        try openPlan(app)
        let preset = app.buttons["Start The Gospels in 30 days, 30 days"]
        // Root restored the no-plan baseline before this class runs. If it
        // drifted, fail safely; never archive a pre-existing plan for room.
        try require(preset.waitForExistence(timeout: 25), "The owned no-plan baseline is not available")
        try tapVisible(preset, in: app)
        try require(app.buttons["Plan options"].waitForExistence(timeout: 30), "Preset was not created")
        ownsPreset = true
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "The Gospels in 30 days")).firstMatch.exists,
                    "Created plan has an unexpected title")
        try tapVisible(app.buttons["Read Matthew 1"], in: app)
        try require(app.navigationBars["Matthew 1"].waitForExistence(timeout: 20), "Plan chapter did not reach reader")
        try require(button(app, startingWith: "Matthew 1:1").waitForExistence(timeout: 20), "Reader did not display the plan's chapter")
        try back(app, to: "Reading plan")
        // This bounded journey proves manual marking. Completing every verse
        // with the reader's eight-second dwell is a separate acceptance case.
        try tapVisible(app.buttons["Mark day 1 read"].firstMatch, in: app)
        try require(app.buttons["Mark day 1 unread"].firstMatch.waitForExistence(timeout: 20), "Day marking did not update")
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "1 of 30 days read")).firstMatch.waitForExistence(timeout: 10),
                    "Plan progress did not reflect the marked day")
        app = try shippingApp()
        try openPlan(app, title: "The Gospels in 30 days")
        try require(app.buttons["Mark day 1 unread"].firstMatch.waitForExistence(timeout: 20), "Read day did not persist after relaunch")
        try tapVisible(app.buttons["Mark day 1 unread"].firstMatch, in: app)
        try require(app.buttons["Mark day 1 read"].firstMatch.waitForExistence(timeout: 20), "Day did not return to unread")
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "0 of 30 days read")).firstMatch.waitForExistence(timeout: 10),
                    "Plan progress did not reflect unmarking the day")
        try archiveOwnedPreset(app)
        app = try shippingApp()
        try openPlan(app)
        try require(app.buttons["Start The Gospels in 30 days, 30 days"].waitForExistence(timeout: 25), "Archived plan returned after relaunch")
    }

    private func archiveOwnedPreset(_ app: XCUIApplication) throws {
        try require(ownsPreset, "Refusing to archive a plan not created by this test")
        try tap(app.buttons["Plan options"], in: app)
        try presentOwnedDialog(app.buttons["Archive plan…"], app: app)
        let prompt = "“The Gospels in 30 days” stops showing on the Bible screen. Your progress is kept, and you can start another plan."
        try tapOwnedConfirmation(app: app, title: "Put this plan away?", message: prompt, button: "Archive plan")
        try require(app.buttons["Start The Gospels in 30 days, 30 days"].waitForExistence(timeout: 25),
                    "Archiving did not return to preset chooser")
        ownsPreset = false
    }

    private func openHistory(_ app: XCUIApplication) throws {
        if app.navigationBars["History"].exists { return }
        // A sent chat can keep its composer keyboard open. Its selected tab
        // is then covered; the visible Chat options button still opens history.
        if !app.tabBars.buttons["Chat"].isSelected {
            try tap(app.tabBars.buttons["Chat"], in: app)
        }
        try tap(app.buttons["Chat options"], in: app)
        try tap(app.buttons["Conversation history"], in: app)
        try require(app.navigationBars["History"].waitForExistence(timeout: 15), "History did not open")
    }

    private func tapChatMessageAction(_ action: XCUIElement, in app: XCUIApplication) throws {
        let messages = app.scrollViews["chat.messages"]
        try require(messages.waitForExistence(timeout: 15), "Chat message scroller is unavailable")
        // The composer may legitimately retain its keyboard after history
        // closes. A screen-relative drag then lands on keys. Native scroll-view
        // gestures use the actual resized message viewport above the composer.
        for _ in 0..<10 {
            try checkManualStep(app)
            if action.exists && action.isHittable {
                try tap(action, in: app)
                return
            }
            print("QA_CHAT_SCROLL_GEOMETRY: viewport=\(messages.frame); keyboard=\(app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame : .zero); actionExists=\(action.exists)")
            if action.exists && action.frame.maxY < messages.frame.minY {
                messages.swipeDown()
            } else {
                messages.swipeUp()
            }
        }
        try require(false, "Chat message action could not be revealed inside its scroll view")
    }

    func testNewQAChatRenameScriptureCardReaderRelaunchAndOwnedDelete() throws {
        guard ProcessInfo.processInfo.environment["SW_QA_HOST_CLIPBOARD"] == "1" else {
            throw XCTSkip("Run with the owned simulator clipboard verifier")
        }
        var app = try shippingApp()
        let title = uniqueName("chat")
        let prompt = title + ": quote only Psalm 23:1 in KJV, with no other passages."
        try tap(app.tabBars.buttons["Chat"], in: app)
        try tap(app.buttons["New chat"], in: app)
        let composer = app.textFields["Ask a Bible question..."]
        try tap(composer, in: app)
        composer.typeText(prompt)
        // Register before Send: its post-tap safety check can throw after the
        // server creates the record. Cleanup still owns only this unique marker.
        ownedChatMarker = title
        pendingChatTitles = [String(prompt.prefix(60)), title]
        print("QA_CHAT_OWNERSHIP: before Send; marker=" + title)
        try tap(app.buttons["Send"], in: app)
        try waitUntil(app, timeout: 120) {
            !app.buttons["Stop generating"].exists && app.buttons["Copy this answer"].exists
        }
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch.exists,
                    "The new QA conversation does not show its owned question")
        // The server may replace the seed title after the first answer. Bind
        // the current history row to the exact question just verified above;
        // never assume a generated title still contains its QA marker.
        try openHistory(app)
        let currentRows = app.buttons.matching(NSPredicate(format: "value == %@", "Current conversation"))
        try require(currentRows.element(boundBy: 0).waitForExistence(timeout: 20) && currentRows.count == 1,
                    "History must expose one current conversation for the owned question")
        let row = currentRows.element(boundBy: 0)
        let originalTitle = row.label
        try require(!originalTitle.isEmpty, "Current conversation has no accessible title")
        pendingChatTitles.insert(originalTitle)
        print("QA_CHAT_OWNERSHIP: marker=" + title + "; observed active title=" + originalTitle)
        try reveal(row, in: app)
        row.press(forDuration: 1.1)
        // Rename is an expected app alert; the general manual-step guard
        // intentionally stops on unknown alerts, so handle this exact one.
        try require(app.buttons["Rename"].waitForExistence(timeout: 10), "QA row rename action is missing")
        app.buttons["Rename"].tap()
        let rename = app.alerts["Rename conversation"]
        try require(rename.waitForExistence(timeout: 10), "Expected rename dialog is missing")
        let field = rename.textFields.firstMatch
        field.tap()
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: originalTitle.count + 8))
        let paddedTitle = "  " + title.replacingOccurrences(of: "Apple parity", with: "Apple   parity") + "  "
        field.typeText(paddedTitle)
        try require((field.value as? String) == paddedTitle, "QA conversation rename field is incorrect")
        rename.buttons["Save"].tap()
        try require(app.buttons[title].waitForExistence(timeout: 20), "Renamed QA conversation is missing")
        let search = app.searchFields["Search conversations"]
        try tap(search, in: app)
        let mixedCaseQuery = title.lowercased()
        search.typeText(mixedCaseQuery)
        try require(app.buttons[title].waitForExistence(timeout: 15), "Mixed-case history search missed the owned conversation")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: mixedCaseQuery.count + 4))
        let noMatch = "QA-no-history-match-" + UUID().uuidString
        search.typeText(noMatch)
        try require(app.staticTexts["No conversations match “\(noMatch)”."].waitForExistence(timeout: 15)
                    && !app.buttons[title].exists, "History no-match state is incorrect")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: noMatch.count + 4))
        try require(app.buttons[title].waitForExistence(timeout: 15), "Clearing history search did not restore the owned row")
        if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
        try tap(app.buttons[title], in: app)
        let scripture = button(app, startingWith: "Scripture in this answer,")
        try tapChatMessageAction(scripture, in: app)
        try require(app.navigationBars["Scripture in this answer"].waitForExistence(timeout: 15), "Inline Scripture did not open")
        // This bounded prompt requests one passage. Refuse an ambiguous first
        // action if the answer included several, rather than opening a neighbor.
        try require(app.buttons.matching(identifier: "Copy").count == 1
                    && app.buttons.matching(identifier: "Read in context").count == 1,
                    "Expected one unambiguous Scripture passage for this owned question")
        let sourceWords = "The LORD is my shepherd; I shall not want."
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", sourceWords)).firstMatch.exists,
                    "Scripture sheet does not contain the requested KJV words")
        let previousCopy = UIPasteboard.general.changeCount
        try tapVisible(app.buttons["Copy"].firstMatch, in: app)
        try waitUntil(app, timeout: 5) { UIPasteboard.general.changeCount != previousCopy }
        try assertOwnedChatPassageCopy(title, app: app)
        try tapVisible(app.buttons["Read in context"].firstMatch, in: app)
        try waitUntil(app) { app.tabBars.buttons["Bible"].isSelected }
        try require(app.navigationBars["Psalms 23"].waitForExistence(timeout: 20), "Read in context opened the wrong chapter")
        app = try shippingApp()
        try openHistory(app)
        try tapVisible(app.buttons[title], in: app)
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch.waitForExistence(timeout: 20),
                    "QA chat question did not persist after normal relaunch")
        try require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", sourceWords)).firstMatch.exists,
                    "The restored answer lost its requested KJV wording")
        try openHistory(app)
        let cancelDeleteRow = app.buttons[title]
        try reveal(cancelDeleteRow, in: app)
        cancelDeleteRow.press(forDuration: 1.1)
        try presentOwnedDialog(app.buttons["Delete"], app: app)
        try tapOwnedConfirmation(app: app, title: "Delete this conversation?",
            message: "“\(title)” will be deleted. This cannot be undone.", button: "Cancel")
        try require(app.buttons[title].exists, "Cancel deleted the owned conversation")
        try deleteOwnedChat(title, app: app)
    }

    private func assertOwnedChatPassageCopy(_ title: String, app: XCUIApplication) throws {
        try require(ownedChatMarker == title, "Passage copy must belong to this run's conversation")
        let nonce = UUID().uuidString
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let receiptURL = documents.appendingPathComponent("qa-chat-copy-" + nonce + ".json")
        defer { try? FileManager.default.removeItem(at: receiptURL) }
        let request: [String: Any] = ["nonce": nonce, "title": title,
            "runnerBundleID": try XCTUnwrap(Bundle.main.bundleIdentifier)]
        let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
        FileHandle.standardOutput.write(Data("QA_CHAT_COPY_REQUEST: ".utf8) + data + Data("\n".utf8))
        try waitUntil(app, timeout: 40) { FileManager.default.fileExists(atPath: receiptURL.path) }
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as? [String: Any])
        try require(receipt["nonce"] as? String == nonce && receipt["title"] as? String == title
                    && receipt["passed"] as? Bool == true,
                    "Host did not verify the actual copied Psalm 23:1 KJV passage")
    }

    private func deleteOwnedChat(_ title: String, app: XCUIApplication) throws {
        try require(pendingChatTitles.contains(title) && ownedChatMarker != nil,
                    "Refusing to delete an unowned conversation")
        try openHistory(app)
        let ownedRow = app.buttons[title]
        try reveal(ownedRow, in: app)
        ownedRow.press(forDuration: 1.1)
        try presentOwnedDialog(app.buttons["Delete"], app: app)
        let namedPrompt = "“\(title)” will be deleted. This cannot be undone."
        try tapOwnedConfirmation(app: app, title: "Delete this conversation?", message: namedPrompt, button: "Delete")
        try waitUntil(app) { !app.buttons[title].exists }
        let relaunched = try shippingApp()
        try openHistory(relaunched)
        try require(!relaunched.buttons[title].exists, "Deleted QA conversation returned after normal relaunch")
        pendingChatTitles.removeAll()
        ownedChatMarker = nil
        try tap(relaunched.navigationBars["History"].buttons["Done"], in: relaunched)
    }

    private func openReleaseNotes(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Today"], in: app)
        try require(app.navigationBars["Today"].waitForExistence(timeout: 15), "Today root is unavailable before Settings")
        try tap(app.navigationBars["Today"].buttons["Settings"], in: app)
        try tapVisible(app.descendants(matching: .any).matching(identifier: "settings.row.What's new").firstMatch, in: app)
        try require(app.navigationBars["What's new"].waitForExistence(timeout: 20), "Release notes did not open")
    }

    func testReleaseNotesSearchTryItBackAndSeenStateAcrossRelaunch() throws {
        var app = try shippingApp()
        try openReleaseNotes(app)
        let search = app.textFields["Search release notes"]
        try tap(search, in: app)
        search.typeText("Meet the creator")
        try require(app.staticTexts["Meet the creator"].waitForExistence(timeout: 20), "Release-note search missed a known release")
        // This known release has target=chat; the action should close Settings
        // before switching to Chat, even though Today owns the current stack.
        try tapVisible(app.buttons["Try Meet the creator"], in: app)
        try waitUntil(app) { app.tabBars.buttons["Chat"].isSelected }
        try require(!app.navigationBars["What's new"].exists, "Try it left release notes covering its destination")
        try openReleaseNotes(app)
        try back(app, to: "Settings")
        try back(app, to: "Today")
        app = try shippingApp()
        // This verifies the real existing seen-state does not re-present.
        // It does not reset the account or invent an unseen-release response.
        let observed = Date().addingTimeInterval(5)
        while Date() < observed {
            try checkManualStep(app)
            try require(!app.staticTexts["Since you were last here"].exists,
                        "Release catch-up reappeared after it was dismissed")
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private func tryReleaseCard(_ title: String, app: XCUIApplication) throws {
        let search = app.textFields["Search release notes"]
        try tap(search, in: app)
        try require((search.value as? String ?? "").isEmpty
                    || (search.value as? String) == search.placeholderValue,
                    "A newly opened release journal retained an unrelated search")
        search.typeText(title)
        try require(app.staticTexts[title].waitForExistence(timeout: 20),
                    "Release-note search missed its source-defined card")
        try tapVisible(app.buttons["Try " + title], in: app)
    }

    /// Covers the two pushed Settings owners without resetting either tab's
    /// independent navigation stack or sending a chat message.
    func testReleaseNotesSameTabAndChatSettingsOwnersCloseTheirEntireSubtree() throws {
        let app = try shippingApp()
        try openReleaseNotes(app)
        // Editorial 1.106.0 has target=today. The tab selection stays equal,
        // so a tab switch cannot hide a retained journal and fake success.
        try tryReleaseCard("Ways to Serve", app: app)
        try waitUntil(app) {
            app.tabBars.buttons["Today"].isSelected && app.navigationBars["Today"].exists
                && !app.navigationBars["Settings"].exists && !app.navigationBars["What's new"].exists
        }
        try tap(app.tabBars.buttons["Chat"], in: app)
        try tap(app.buttons["Chat options"], in: app)
        let settings = app.buttons.matching(identifier: "Settings").allElementsBoundByIndex
            .filter { $0.isHittable }
        try require(settings.count == 1, "Chat options must expose one Settings action")
        try tap(settings[0], in: app)
        try require(app.navigationBars["Settings"].waitForExistence(timeout: 20),
                    "Chat's own Settings destination did not open")
        try tapVisible(app.descendants(matching: .any).matching(identifier: "settings.row.What's new").firstMatch, in: app)
        try require(app.navigationBars["What's new"].waitForExistence(timeout: 20),
                    "Chat Settings release journal did not open")
        try tryReleaseCard("Meet the creator", app: app)
        try waitUntil(app) {
            app.tabBars.buttons["Chat"].isSelected && app.buttons["Chat options"].isHittable
                && !app.navigationBars["Settings"].exists && !app.navigationBars["What's new"].exists
        }
        try tap(app.tabBars.buttons["Today"], in: app)
        try require(app.navigationBars["Today"].waitForExistence(timeout: 20)
                    && !app.navigationBars["What's new"].exists,
                    "Returning to Today resurrected a closed Settings subtree")
    }
}

// Additional source-derived journeys below are intentionally kept in this
// shipping class; selectors are verified by the first authorized runtime run.
extension AppleCompleteParityUITests {
    private func replaceReference(_ field: XCUIElement, with text: String,
                                  app: XCUIApplication) throws {
        try tap(field, in: app)
        for _ in 0..<3 {
            let existing = (field.value as? String) ?? ""
            if existing.isEmpty { break }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count + 4))
        }
        field.typeText(text)
        if text.hasPrefix(qaPrefix), let observed = field.value as? String, observed.contains(text) {
            // Record this newly created row before equality validation. A
            // seed/caret mismatch can add a prefix while retaining our exact
            // unique marker; cleanup must still target only this observed row.
            pendingOwnedNotes.insert(observed)
            print("QA_OWNED_NOTE_TITLE: " + observed)
        }
        try require((field.value as? String) == text, "The reference field did not contain the submitted value")
    }

    private func reportOriginalLanguageState(_ app: XCUIApplication) {
        let value = app.textFields["John 3:16"].value as? String ?? ""
        let allowed = ["John 3:16", "John 3:999", "Genesis 1:1", ""]
        let state: [String: Any] = [
            "originalLanguagesPage": app.navigationBars["Original languages"].exists,
            "studyRoot": app.navigationBars["Study"].exists,
            "query": allowed.contains(value) ? value : "[unrecognized public-reference field]",
            "john316Target": app.staticTexts["John 3:16"].exists,
            "john3999Target": app.staticTexts["John 3:999"].exists,
            "genesis11Target": app.staticTexts["Genesis 1:1"].exists,
            "invalidReferenceError": app.staticTexts["Enter a single verse such as John 3:16."].exists,
            "hebrewMetadata": app.staticTexts["Hebrew · Westminster Leningrad Codex · in reading order"].exists,
            "greekLoading": app.staticTexts["Reading the Greek…"].exists,
            "hebrewLoading": app.staticTexts["Reading the Hebrew…"].exists,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_ORIGINAL_LANGUAGE_STATE: " + text)
        }
    }

    func testOriginalLanguagesRejectsInvalidVerseAndKeepsLatestValidTarget() throws {
        let app = try shippingApp()
        try tap(app.tabBars.buttons["Study"], in: app)
        try tapVisible(button(app, startingWith: "Original languages"), in: app)
        diagnosesOriginalLanguages = true
        try require(app.navigationBars["Original languages"].waitForExistence(timeout: 20),
                    "Original-languages page did not open")
        let query = app.textFields["John 3:16"]
        try require(query.waitForExistence(timeout: 15), "Original-languages reference field is unavailable")
        try require(app.staticTexts["John 3:16"].exists, "Original-languages initial target is not John 3:16")

        try replaceReference(query, with: "John 3:999", app: app)
        try tap(app.scrollViews.buttons["Study"], in: app)
        try require(app.staticTexts["Enter a single verse such as John 3:16."].waitForExistence(timeout: 20),
                    "Out-of-range verse did not show its validation error")
        try require(app.staticTexts["John 3:16"].exists && !app.staticTexts["John 3:999"].exists,
                    "Invalid verse replaced the previous valid target")

        try replaceReference(query, with: "Genesis 1:1", app: app)
        try tap(app.scrollViews.buttons["Study"], in: app)
        try require(app.staticTexts["Genesis 1:1"].waitForExistence(timeout: 20), "Valid Genesis target did not open")
        try require(!app.staticTexts["Enter a single verse such as John 3:16."].exists,
                    "Valid verse left the validation error on screen")
        let hebrew = app.staticTexts["Hebrew · Westminster Leningrad Codex · in reading order"]
        try require(hebrew.waitForExistence(timeout: 120),
                    "Genesis word-study metadata did not identify the Hebrew source")

        // Submit then edit/submit again without deliberately waiting for the
        // first validation. Native AX round trips may outlast this bundled
        // lookup: this proves latest-result stability, not deterministic
        // observation of a suspended validation task.
        try replaceReference(query, with: "John 3:16", app: app)
        try tap(app.scrollViews.buttons["Study"], in: app)
        try replaceReference(query, with: "Genesis 1:1", app: app)
        try tap(app.scrollViews.buttons["Study"], in: app)
        try waitUntil(app) { app.staticTexts["Genesis 1:1"].exists }
        let settle = Date().addingTimeInterval(5)
        while Date() < settle {
            try checkManualStep(app)
            try require(app.staticTexts["Genesis 1:1"].exists && !app.staticTexts["John 3:16"].exists,
                        "A stale validation changed the latest requested target")
            Thread.sleep(forTimeInterval: 0.25)
        }
        try back(app, to: "Study")
        diagnosesOriginalLanguages = false
    }
}

extension AppleCompleteParityUITests {
    private struct SettingsBaseline {
        let theme: String
        let parchment: Bool
        let textSize: String
        let language: String
        let translation: String
    }

    private var languageLabels: [String] {
        ["Follow my device (English)", "Follow my device (Español)", "Follow my device (Deutsch)",
         "English", "Español", "Deutsch"]
    }

    private var translationLabels: [String] {
        ["KJV", "NKJV", "BSB", "ASV", "Reina-Valera 1909 · Español", "Lutherbibel 1912 · Deutsch"]
    }

    private func openSettings(_ app: XCUIApplication) throws {
        try tap(app.tabBars.buttons["Today"], in: app)
        try require(app.navigationBars["Today"].waitForExistence(timeout: 15), "Today root is unavailable for Settings")
        try tap(app.navigationBars["Today"].buttons["Settings"], in: app)
        try require(app.navigationBars["Settings"].waitForExistence(timeout: 15), "Settings hub did not open")
    }

    private func openSettingsPage(_ label: String, app: XCUIApplication) throws {
        let row = app.descendants(matching: .any).matching(identifier: "settings.row." + label).firstMatch
        try tapVisible(row, in: app)
        try require(app.navigationBars[label].waitForExistence(timeout: 15), "Settings page did not open")
    }

    private func selectedLanguage(_ app: XCUIApplication) throws -> String {
        for label in languageLabels {
            let candidates = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
            if candidates.contains(where: { $0.isSelected }) { return label }
        }
        try require(false, "Native language picker did not expose its selected value; no settings changed")
        throw JourneyStop.unsafeState
    }

    private func chooseLanguage(_ label: String, app: XCUIApplication) throws {
        try require(languageLabels.contains(label), "Language label was not derived from the shipping picker")
        if try selectedLanguage(app) == label { return }
        let candidates = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
        guard let option = candidates.first(where: { $0.isHittable }) else {
            try require(false, "Requested shipping language option is unavailable")
            return
        }
        try tapVisible(option, in: app)
        try waitUntil(app) {
            app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
                .allElementsBoundByIndex.contains(where: { $0.isSelected })
        }
    }

    private func currentTheme(_ app: XCUIApplication) throws -> String {
        for label in ["System", "Dark", "Light"] {
            if app.segmentedControls.buttons[label].isSelected { return label }
        }
        try require(false, "Appearance picker did not expose its selected theme; no settings changed")
        throw JourneyStop.unsafeState
    }

    private func parchmentEnabled(_ app: XCUIApplication) throws -> Bool {
        let toggle = app.switches["Parchment reader"]
        try require(toggle.waitForExistence(timeout: 10), "Parchment switch is unavailable")
        guard let value = toggle.value as? String, value == "1" || value == "0" else {
            try require(false, "Parchment switch did not expose a boolean; no settings changed")
            throw JourneyStop.unsafeState
        }
        return value == "1"
    }

    private func currentTextSize(_ app: XCUIApplication) throws -> String {
        let value = app.staticTexts["text-size-value"]
        try require(value.waitForExistence(timeout: 10), "App text-size value is unavailable")
        for label in ["Largest", "Large", "Standard"] {
            if value.value as? String == label || value.label.hasPrefix(label + " · ") { return label }
        }
        try require(false, "App text size did not expose a known value; no settings changed")
        throw JourneyStop.unsafeState
    }

    private func translationPicker(_ app: XCUIApplication) throws -> XCUIElement {
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Default translation")).firstMatch
        try require(picker.waitForExistence(timeout: 15), "Default-translation picker is unavailable")
        return picker
    }

    private func currentTranslation(_ app: XCUIApplication) throws -> String {
        let picker = try translationPicker(app)
        let value = (picker.value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let label = picker.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let observations = [value, label].filter { !$0.isEmpty }
        let aliases = [("LUT1912", "Lutherbibel 1912 · Deutsch"), ("RV1909", "Reina-Valera 1909 · Español")]
        var selections = Set<String>()
        for raw in observations {
            for knownLabel in translationLabels where raw == knownLabel || raw.hasSuffix(", " + knownLabel) {
                selections.insert(knownLabel)
            }
            for (alias, knownLabel) in aliases where raw == alias || raw.hasSuffix(", " + alias) {
                selections.insert(knownLabel)
            }
        }
        let resolved = selections.count == 1 ? selections.first : nil
        // Only this picker metadata is logged, bounded and JSON-escaped. A
        // nonempty native value must not hide a selected label on the button.
        let metadata = ["value": String(value.prefix(240)), "label": String(label.prefix(240)),
                        "resolvedTranslation": resolved ?? (selections.isEmpty ? "<unknown>" : "<ambiguous>")]
        if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_TRANSLATION_PICKER_METADATA: " + text)
        }
        guard let resolved else {
            try require(false, "Translation picker did not expose exactly one known selected value; no settings changed")
            throw JourneyStop.unsafeState
        }
        return resolved
    }

    private func chooseTheme(_ label: String, app: XCUIApplication) throws {
        if try currentTheme(app) == label { return }
        try tapVisible(app.segmentedControls.buttons[label], in: app)
        try waitUntil(app) { app.segmentedControls.buttons[label].isSelected }
    }

    private func chooseParchment(_ enabled: Bool, app: XCUIApplication) throws {
        if try parchmentEnabled(app) == enabled { return }
        let toggle = app.switches["Parchment reader"]
        try reveal(toggle, in: app)
        try checkManualStep(app)
        try require(toggle.waitForExistence(timeout: 20) && toggle.isHittable,
                    "Parchment switch is unavailable for a native tap")
        // The observed SwiftUI switch is a whole form row. Its native switch
        // child occupies only the trailing track, so target that exact child.
        let nativeSwitches = toggle.descendants(matching: .switch).allElementsBoundByIndex
        try require(nativeSwitches.count == 1, "Parchment row did not expose exactly one native switch")
        guard let nativeSwitch = nativeSwitches.first else { throw JourneyStop.unsafeState }
        let nativeFrame = nativeSwitch.frame
        try require(!nativeFrame.isEmpty && toggle.frame.contains(nativeFrame)
                    && nativeSwitch.isEnabled && nativeSwitch.isHittable,
                    "Parchment native switch is not contained, enabled and hittable")
        reportParchment(toggle, phase: "before-tap", target: enabled)
        nativeSwitch.tap()
        reportParchment(toggle, phase: "after-tap", target: enabled)
        try checkManualStep(app)
        do {
            try waitUntil(app) { (app.switches["Parchment reader"].value as? String) == (enabled ? "1" : "0") }
        } catch {
            reportParchment(toggle, phase: "wait-error", target: enabled)
            throw error
        }
    }

    private func reportParchment(_ toggle: XCUIElement, phase: String, target: Bool) {
        let raw = toggle.value
        let value = raw as? String
        let frame = toggle.frame
        var metadata: [String: Any] = [
            "phase": phase, "value": String(String(describing: raw ?? "<nil>").prefix(120)),
            "valueType": raw.map { String(reflecting: type(of: $0)) } ?? "<nil>",
            "label": String(toggle.label.prefix(120)), "target": target,
            "expectedValue": target ? "1" : "0", "enabled": toggle.isEnabled,
            "hittable": toggle.isHittable,
            "frame": ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
        ]
        if value == "1" || value == "0" { metadata["boolean"] = value == "1" }
        else { metadata["boolean"] = NSNull() }
        metadata["nativeChildren"] = toggle.descendants(matching: .any).allElementsBoundByIndex.prefix(8).map { child in
            let bounds = child.frame
            return ["type": String(describing: child.elementType), "label": String(child.label.prefix(120)),
                    "enabled": child.isEnabled, "hittable": child.isHittable,
                    "frame": ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height]] as [String: Any]
        }
        if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_PARCHMENT_CONTROL_METADATA: " + text)
        }
        let attachment = XCTAttachment(image: toggle.screenshot().image)
        attachment.name = "Parchment control " + phase
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func reportSettingsBaseline(_ baseline: SettingsBaseline, phase: String) {
        let metadata: [String: Any] = ["phase": phase, "theme": baseline.theme,
                                       "parchment": baseline.parchment, "textSize": baseline.textSize,
                                       "language": baseline.language, "translation": baseline.translation]
        if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_SETTINGS_BASELINE_METADATA: " + text)
        }
    }

    private func chooseTextSize(_ label: String, app: XCUIApplication) throws {
        let sizes = ["Standard", "Large", "Largest"]
        guard let target = sizes.firstIndex(of: label) else { throw JourneyStop.unsafeState }
        for _ in 0..<3 {
            let current = try currentTextSize(app)
            if current == label { return }
            guard let index = sizes.firstIndex(of: current) else { throw JourneyStop.unsafeState }
            let control = app.buttons[target > index ? "text-size-increase" : "text-size-decrease"]
            try tapVisible(control, in: app)
            try waitUntil(app) {
                let value = app.staticTexts["text-size-value"]
                return value.label.hasPrefix(sizes[index + (target > index ? 1 : -1)] + " · ")
            }
        }
        try require(try currentTextSize(app) == label, "App text-size control did not settle")
    }

    private func chooseTranslation(_ label: String, app: XCUIApplication) throws {
        try require(translationLabels.contains(label), "Unknown baseline translation")
        if try currentTranslation(app) == label { return }
        try tapVisible(try translationPicker(app), in: app)
        try tap(app.buttons[label], in: app)
        try require(try currentTranslation(app) == label, "Baseline translation was not restored")
    }

    private func settlePreferences(_ app: XCUIApplication) throws {
        // These toggles write asynchronously and expose failures as alerts.
        // Let the normal write/foreground hydrate settle before force quitting;
        // the subsequent fresh launch remains the persistence assertion.
        let end = Date().addingTimeInterval(5)
        while Date() < end {
            try checkManualStep(app)
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private func restoreSettingsBaseline() throws {
        guard let baseline = pendingSettingsBaseline else { return }
        var app = try shippingApp()
        try openSettings(app)
        try openSettingsPage("Language", app: app)
        try chooseLanguage(baseline.language, app: app)
        try back(app, to: "Settings")
        try openSettingsPage("Appearance & reading", app: app)
        try chooseTheme(baseline.theme, app: app)
        try chooseParchment(baseline.parchment, app: app)
        try chooseTextSize(baseline.textSize, app: app)
        // Language deliberately chooses its Bible. Restore this *after* the
        // original language, so that side effect cannot overwrite the baseline.
        try chooseTranslation(baseline.translation, app: app)
        try settlePreferences(app)
        try back(app, to: "Settings")
        try back(app, to: "Today")
        app = try shippingApp()
        try openSettings(app)
        try openSettingsPage("Language", app: app)
        try settlePreferences(app)
        try require(try selectedLanguage(app) == baseline.language, "Original language did not persist after restoration")
        try back(app, to: "Settings")
        try openSettingsPage("Appearance & reading", app: app)
        try require(try currentTheme(app) == baseline.theme, "Original theme did not persist after restoration")
        try require(try parchmentEnabled(app) == baseline.parchment, "Original parchment choice did not persist after restoration")
        try require(try currentTextSize(app) == baseline.textSize, "Original text size did not persist after restoration")
        try require(try currentTranslation(app) == baseline.translation, "Original translation did not persist after restoration")
        reportSettingsBaseline(baseline, phase: "restored-after-relaunch")
        pendingSettingsBaseline = nil
        try back(app, to: "Settings")
        try back(app, to: "Today")
    }

    func testSettingsAppearanceTextSizeParchmentLanguagePersistAndRestoreOriginalValues() throws {
        var app = try shippingApp()
        try openSettings(app)
        try openSettingsPage("Language", app: app)
        try settlePreferences(app)
        let originalLanguage = try selectedLanguage(app)
        try back(app, to: "Settings")
        try openSettingsPage("Appearance & reading", app: app)
        let baseline = try SettingsBaseline(theme: currentTheme(app), parchment: parchmentEnabled(app),
                                            textSize: currentTextSize(app), language: originalLanguage,
                                            translation: currentTranslation(app))
        reportSettingsBaseline(baseline, phase: "captured-before-writes")
        // Everything needed for restoration is known before the first write.
        pendingSettingsBaseline = baseline
        let nextTheme = baseline.theme == "Dark" ? "Light" : "Dark"
        let nextSize = baseline.textSize == "Standard" ? "Large" : "Standard"
        let nextLanguage = baseline.language == "Español" ? "English" : "Español"
        let nextTranslation = nextLanguage == "Español" ? "Reina-Valera 1909 · Español" : "KJV"
        try chooseTheme(nextTheme, app: app)
        try chooseParchment(!baseline.parchment, app: app)
        try chooseTextSize(nextSize, app: app)
        try back(app, to: "Settings")
        try openSettingsPage("Language", app: app)
        try chooseLanguage(nextLanguage, app: app)
        try settlePreferences(app)
        try back(app, to: "Settings")
        try back(app, to: "Today")

        app = try shippingApp()
        try openSettings(app)
        try openSettingsPage("Language", app: app)
        try settlePreferences(app)
        try require(try selectedLanguage(app) == nextLanguage, "Changed language did not survive normal relaunch")
        try back(app, to: "Settings")
        try openSettingsPage("Appearance & reading", app: app)
        try require(try currentTheme(app) == nextTheme, "Changed appearance did not survive normal relaunch")
        try require(try parchmentEnabled(app) == !baseline.parchment, "Changed parchment choice did not survive normal relaunch")
        try require(try currentTextSize(app) == nextSize, "Changed app text size did not survive normal relaunch")
        try require(try currentTranslation(app) == nextTranslation, "Language did not select its corresponding Bible")
        try restoreSettingsBaseline()
    }
}

// N3 is deliberately one owned blank-note/folder slice. It does not cover
// every template, tag/filter combination, offline account isolation or refused
// server writes. The first authorized run must validate these source labels.
extension AppleCompleteParityUITests {
    private struct N3Ownership {
        let requestedTitle: String
        let folderName: String
        var noteCreateAttempted = false
        var observedTitle: String?
        var noteDeleted = false
        var folderCreateAttempted = false
        var folderObserved = false
        var folderDeleted = false
        var searchBaseline: String?
    }

    private func n3Receipt(_ ownership: N3Ownership, phase: String) {
        let metadata: [String: Any] = [
            "phase": phase, "requestedTitle": ownership.requestedTitle,
            "observedTitle": ownership.observedTitle ?? "<not observed>",
            "folderName": ownership.folderName,
            "noteCreateAttempted": ownership.noteCreateAttempted,
            "noteDeleted": ownership.noteDeleted,
            "folderCreateAttempted": ownership.folderCreateAttempted,
            "folderObserved": ownership.folderObserved,
            "folderDeleted": ownership.folderDeleted,
            "searchBaselineCaptured": ownership.searchBaseline != nil
        ]
        if let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("QA_N3_OWNERSHIP: " + text)
        }
    }

    /// Unlike openNotes, this preserves search long enough to capture its
    /// baseline. Folder/tag/sort controls are never changed by this journey.
    private func n3OpenLibrary(_ app: XCUIApplication) throws {
        if !app.tabBars.buttons["Study"].isSelected {
            try tap(app.tabBars.buttons["Study"], in: app)
        }
        if app.buttons["Back to notes"].exists {
            let title = app.textFields["Untitled Note"].value as? String ?? ""
            try require(pendingOwnedNotes.contains(title), "N3 refuses to leave an unowned editor")
            try closeOwnedEditor(title, app: app)
        }
        if !notesLibraryVisible(app) {
            try require(app.navigationBars["Study"].waitForExistence(timeout: 15), "N3 Study root unavailable")
            let links = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Notes"))
            try require(links.count == 1, "N3 Notes destination is not uniquely exposed")
            try tapVisible(links.element(boundBy: 0), in: app)
            try waitUntil(app) { notesLibraryVisible(app) }
        }
    }

    /// Do not use replaceReference here: its QA-title ownership hook must not
    /// mistake an entered search query for a newly created note title.
    private func n3Replace(_ field: XCUIElement, with text: String, app: XCUIApplication) throws {
        let existing = field.value as? String ?? ""
        if existing == text || (text.isEmpty && (existing.isEmpty || existing == field.placeholderValue)) {
            return
        }
        try tap(field, in: app)
        for _ in 0..<3 {
            let current = field.value as? String ?? ""
            if current.isEmpty || current == field.placeholderValue { break }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 4))
        }
        if !text.isEmpty { field.typeText(text) }
        let value = field.value as? String ?? ""
        try require(value == text || (text.isEmpty && value == field.placeholderValue),
                    "N3 field did not expose the exact submitted value")
    }

    private func n3Search(_ query: String, app: XCUIApplication) throws {
        try require(notesLibraryVisible(app), "N3 search requires the library")
        // SwiftUI's prompt is not necessarily the native AX label. Scope to
        // the proven Notes library and require its one actual search field.
        let fields = app.searchFields
        _ = fields.firstMatch.waitForExistence(timeout: 5)
        print("QA_NOTES_SEARCH_FIELD_COUNT: \(fields.count)")
        if fields.count != 1 {
            let searchSurface = XCTAttachment(screenshot: app.screenshot())
            searchSurface.name = "notes-search-surface-missing-explicit-drawer"
            searchSurface.lifetime = .keepAlways
            add(searchSurface)
        }
        try require(fields.count == 1, "N3 Notes library must expose one native search field")
        let field = fields.element(boundBy: 0)
        try reveal(field, in: app)
        try n3Replace(field, with: query, app: app)
        if app.keyboards.buttons["Search"].exists { try tap(app.keyboards.buttons["Search"], in: app) }
    }

    private func n3OpenOwned(_ title: String, app: XCUIApplication) throws {
        try require(pendingOwnedNotes.contains(title), "N3 refuses to open an unowned note")
        try n3OpenLibrary(app)
        try n3Search(title, app: app)
        let rows = app.buttons.matching(NSPredicate(format: "label == %@", title))
        try require(rows.element(boundBy: 0).waitForExistence(timeout: 20) && rows.count == 1,
                    "N3 exact owned note row is missing or ambiguous")
        try tapVisible(rows.element(boundBy: 0), in: app)
        try waitUntil(app) {
            (app.textFields["Untitled Note"].value as? String) == title
        }
        try assertOwnedEditor(title, app: app)
    }

    /// Locate the horizontal folder strip by its source-defined New Folder
    /// descendant. Stop if native accessibility does not expose one strip;
    /// never guess a coordinate or tap a neighboring chip.
    private func n3RevealFolderChip(_ name: String, app: XCUIApplication) throws -> XCUIElement {
        let target = app.buttons[name]
        for _ in 0..<12 {
            try checkManualStep(app)
            if target.exists && target.isHittable { return target }
            let strips = app.scrollViews.containing(.button, identifier: "New Folder")
            try require(strips.count == 1, "N3 folder strip is not uniquely exposed; no guessed horizontal gesture")
            strips.element(boundBy: 0).swipeLeft()
        }
        try require(false, "N3 exact named folder chip is not reachable")
        throw JourneyStop.missingControl
    }

    private func n3LongPressOwned(_ title: String, app: XCUIApplication) throws {
        try require(pendingOwnedNotes.contains(title) && title.hasPrefix(qaPrefix), "N3 refuses unowned context menu")
        try n3OpenLibrary(app)
        try n3Search(title, app: app)
        let rows = app.buttons.matching(NSPredicate(format: "label == %@", title))
        try require(rows.element(boundBy: 0).waitForExistence(timeout: 15) && rows.count == 1,
                    "N3 owned context-menu row is missing or ambiguous")
        try reveal(rows.element(boundBy: 0), in: app)
        try checkManualStep(app)
        rows.element(boundBy: 0).press(forDuration: 1.1)
        try checkManualStep(app)
    }

    private func n3TapUniqueVisibleButton(_ label: String, app: XCUIApplication) throws {
        var visible: [XCUIElement] = []
        try waitUntil(app) {
            visible = app.buttons.matching(NSPredicate(format: "label == %@", label))
                .allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            return visible.count == 1
        }
        try require(visible.count == 1, "N3 named menu action is missing or ambiguous")
        try tap(visible[0], in: app)
    }

    private func n3AssertEditor(_ title: String, body: String, pinned: Bool,
                                folder: String, app: XCUIApplication) throws {
        try assertOwnedEditor(title, app: app)
        try require((try noteBody(app).value as? String)?.contains(body) == true, "N3 owned body was lost")
        try tap(try ownedEditorControl("Note menu", app: app), in: app)
        try require(app.buttons[pinned ? "Unpin note" : "Pin note"].waitForExistence(timeout: 15),
                    "N3 menu does not expose the expected pin state")
        // A read-only menu destination dismisses the menu without another
        // pin/move write. Require the exact Folder value inside its native
        // list row; a same-named library chip behind the sheet is no evidence.
        try tap(app.buttons["Note info"], in: app)
        try require(app.navigationBars["Note info"].waitForExistence(timeout: 15), "N3 Note info did not open")
        let folderRows = app.cells.containing(.staticText, identifier: "Folder")
        try require(folderRows.count == 1 && folderRows.element(boundBy: 0).staticTexts[folder].exists,
                    "N3 Note info does not expose one Folder row with the exact expected value")
        try tap(app.navigationBars["Note info"].buttons["Done"], in: app)
        try assertOwnedEditor(title, app: app)
    }

    private func n3SettleMutation(_ app: XCUIApplication) throws {
        // Pin/move writes are optimistic and expose no completion identifier.
        // This is a bounded error-observation window, not an acceptance gate:
        // the next normal launch and canonical editor read are the assertions.
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline {
            try checkManualStep(app)
            for text in ["The pin could not be saved.", "The move could not be saved.", "Changes could not be saved."] {
                try require(!app.staticTexts[text].exists, "N3 shipping mutation reported a save failure")
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private func n3DeleteNote(_ title: String, app: XCUIApplication, cancel: Bool,
                               ownership: N3Ownership) throws {
        try assertOwnedEditor(title, app: app)
        try require(ownership.observedTitle == title, "N3 delete title does not match its creation receipt")
        n3Receipt(ownership, phase: cancel ? "before-owned-delete-cancel" : "before-owned-delete-confirm")
        try tap(try ownedEditorControl("Note menu", app: app), in: app)
        try presentOwnedDialog(app.buttons["Delete note"], app: app)
        try tapOwnedConfirmation(app: app,
            title: "Delete \u{201C}\(title)\u{201D}? This cannot be undone.",
            button: cancel ? "Cancel" : "Delete Note")
        if cancel { try assertOwnedEditor(title, app: app) }
        else {
            try waitUntil(app) { notesLibraryVisible(app) && !app.buttons[title].exists }
        }
    }

    /// Keep all cleanup attempts independent and retain any earlier journey
    /// failure. An interrupted create with no unique observed title is named
    /// explicitly; it never authorizes a generic Untitled Note deletion.
    private func n3Cleanup(_ ownership: inout N3Ownership) throws {
        var cleanupError: Error?
        if ownership.noteCreateAttempted && !ownership.noteDeleted {
            do {
                guard let title = ownership.observedTitle else {
                    try require(false, "N3 created-note outcome is ambiguous; inspect the ownership receipt, never delete a generic row")
                    throw JourneyStop.unsafeState
                }
                var app = try shippingApp()
                try n3OpenOwned(title, app: app)
                try n3DeleteNote(title, app: app, cancel: false, ownership: ownership)
                app = try shippingApp()
                try n3OpenLibrary(app)
                try n3Search(title, app: app)
                try require(!app.buttons[title].exists, "N3 cleanup note reappeared after normal relaunch")
                ownership.noteDeleted = true
                pendingOwnedNotes.remove(title)
            } catch { cleanupError = error }
        }
        if ownership.folderCreateAttempted && !ownership.folderDeleted {
            do {
                var app = try shippingApp()
                try n3OpenLibrary(app)
                try require(ownership.folderName.hasPrefix(qaPrefix), "N3 folder has no owned prefix")
                let chip = try n3RevealFolderChip(ownership.folderName, app: app)
                try require(app.buttons.matching(NSPredicate(format: "label == %@", ownership.folderName)).count == 1,
                            "N3 cleanup folder name is ambiguous")
                ownership.folderObserved = true
                n3Receipt(ownership, phase: "before-owned-folder-delete")
                try checkManualStep(app)
                chip.press(forDuration: 1.1)
                let actions = app.buttons.matching(NSPredicate(format: "label == %@", "Delete Folder"))
                try require(actions.count == 1, "N3 owned folder menu has no unique Delete Folder action")
                try tap(actions.element(boundBy: 0), in: app)
                try waitUntil(app) { !app.buttons[ownership.folderName].exists }
                try n3SettleMutation(app)
                app = try shippingApp()
                try n3OpenLibrary(app)
                try require(!app.buttons[ownership.folderName].exists, "N3 cleanup folder reappeared after normal relaunch")
                ownership.folderDeleted = true
            } catch { if cleanupError == nil { cleanupError = error } }
        }
        if let baseline = ownership.searchBaseline {
            do {
                let app = XCUIApplication()
                try n3OpenLibrary(app)
                try n3Search(baseline, app: app)
            } catch { if cleanupError == nil { cleanupError = error } }
        }
        n3Receipt(ownership, phase: cleanupError == nil ? "cleanup-verified-search-restored" : "cleanup-required")
        if let cleanupError { throw cleanupError }
    }

    func testOwnedNotesTitleBodySearchPinFolderRelaunchAndDeleteCancelConfirm() throws {
        var ownership = N3Ownership(requestedTitle: uniqueName("organization note"),
                                    folderName: uniqueName("organization folder"))
        let body = "QA body-only marker " + UUID().uuidString
        var journeyError: Error?
        do {
            var app = try shippingApp() // Empty launch arguments/environment; real reviewer session.
            try n3OpenLibrary(app)
            let search = app.searchFields["Search notes"]
            try reveal(search, in: app)
            let initialQuery = search.value as? String ?? ""
            ownership.searchBaseline = initialQuery == search.placeholderValue ? "" : initialQuery
            try n3Search("", app: app)
            try require(!app.buttons[ownership.requestedTitle].exists && !app.buttons[ownership.folderName].exists,
                        "N3 unique ownership names already exist before creation")

            try tap(app.buttons["New note"], in: app)
            try require(app.navigationBars["Start a note"].waitForExistence(timeout: 15), "N3 template picker unavailable")
            ownership.noteCreateAttempted = true
            n3Receipt(ownership, phase: "before-blank-note-create")
            try tap(app.buttons["Blank note"], in: app)
            let titleField = app.textFields["Untitled Note"]
            try require(titleField.waitForExistence(timeout: 30), "N3 new blank-note editor unavailable")
            do { try n3Replace(titleField, with: ownership.requestedTitle, app: app) }
            catch {
                if let observed = titleField.value as? String, observed.contains(ownership.requestedTitle) {
                    ownership.observedTitle = observed
                    pendingOwnedNotes.insert(observed)
                    n3Receipt(ownership, phase: "observed-created-title-before-validation-failure")
                }
                throw error
            }
            ownership.observedTitle = ownership.requestedTitle
            pendingOwnedNotes.insert(ownership.requestedTitle)
            n3Receipt(ownership, phase: "observed-created-title")
            let title = ownership.requestedTitle
            try tap(try noteBody(app), in: app)
            try noteBody(app).typeText(body)
            try closeOwnedEditor(title, app: app)

            try n3Search(title.uppercased(), app: app)
            try require(app.buttons[title].waitForExistence(timeout: 15), "N3 mixed-case title search missed the owned note")
            try n3Search(body.uppercased(), app: app)
            try require(app.buttons[title].waitForExistence(timeout: 15), "N3 mixed-case body-only search missed the owned note")
            try n3Search("QA absent " + UUID().uuidString, app: app)
            try require(app.staticTexts["Nothing matches"].waitForExistence(timeout: 15)
                        && !app.staticTexts["No notes yet"].exists && !app.buttons[title].exists,
                        "N3 no-match search did not distinguish an existing library from no notes")
            try n3Search("", app: app)
            try require(app.buttons[title].exists, "N3 clearing search did not restore the owned row")
            print("QA_N3_EVIDENCE: notes.search owned mixed-case title/body hit, unique no-match, clear")

            try n3LongPressOwned(title, app: app)
            try tap(app.buttons["Pin note"], in: app)
            try n3SettleMutation(app)
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            try n3AssertEditor(title, body: body, pinned: true, folder: "None", app: app)
            try tap(try ownedEditorControl("Note menu", app: app), in: app)
            try tap(app.buttons["Unpin note"], in: app)
            try n3SettleMutation(app)
            try closeOwnedEditor(title, app: app)
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            try n3AssertEditor(title, body: body, pinned: false, folder: "None", app: app)
            try closeOwnedEditor(title, app: app)
            print("QA_N3_EVIDENCE: notes.pin list pin/editor unpin, both normal relaunch readbacks")

            try tap(try n3RevealFolderChip("New Folder", app: app), in: app)
            try require(app.navigationBars["New Folder"].waitForExistence(timeout: 15), "N3 folder create sheet unavailable")
            try n3Replace(app.textFields["Folder name"], with: ownership.folderName, app: app)
            ownership.folderCreateAttempted = true
            n3Receipt(ownership, phase: "before-owned-folder-create")
            try tap(app.navigationBars["New Folder"].buttons["Create"], in: app)
            try waitUntil(app) { !app.navigationBars["New Folder"].exists && app.buttons[ownership.folderName].exists }
            ownership.folderObserved = true
            n3Receipt(ownership, phase: "observed-created-folder")
            try n3LongPressOwned(title, app: app)
            try tap(app.buttons["Move to folder"], in: app)
            // The library chip has the same label as this submenu action.
            // Require one hittable exact match while the menu covers its list.
            try n3TapUniqueVisibleButton(ownership.folderName, app: app)
            try n3SettleMutation(app)
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            try n3AssertEditor(title, body: body, pinned: false, folder: ownership.folderName, app: app)
            try tap(try ownedEditorControl("Note menu", app: app), in: app)
            try tap(app.buttons["Move to folder"], in: app)
            try tap(app.buttons["No folder"], in: app)
            try n3SettleMutation(app)
            try closeOwnedEditor(title, app: app)
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            try n3AssertEditor(title, body: body, pinned: false, folder: "None", app: app)
            print("QA_N3_EVIDENCE: notes.move list-to-owned-folder/editor-to-No-folder, normal relaunch and body readbacks")

            try n3DeleteNote(title, app: app, cancel: true, ownership: ownership)
            try closeOwnedEditor(title, app: app)
            app = try shippingApp()
            try n3OpenOwned(title, app: app)
            try n3AssertEditor(title, body: body, pinned: false, folder: "None", app: app)
            try n3DeleteNote(title, app: app, cancel: false, ownership: ownership)
            app = try shippingApp()
            try n3OpenLibrary(app)
            try n3Search(title, app: app)
            try require(!app.buttons[title].exists, "N3 confirmed owned deletion reappeared after normal relaunch")
            ownership.noteDeleted = true
            pendingOwnedNotes.remove(title)
            print("QA_N3_EVIDENCE: notes.delete editor cancel preserved exact note/body; confirm absent after normal relaunch")
        } catch { journeyError = error }

        do { try n3Cleanup(&ownership) }
        catch {
            XCTFail("APPLE_COMPLETE_PARITY_STOP: N3 cleanup remains required; see exact ownership receipt")
            if journeyError == nil { journeyError = error }
        }
        if let journeyError { throw journeyError }
    }
}
