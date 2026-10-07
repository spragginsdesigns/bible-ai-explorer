# Share into SureWord (PRD D8), simulator evidence, 2026-10-07

iPhone 18 Pro simulator, iOS 27.0, Debug build signed by Xcode for the
simulator, the share extension embedded. Driven by
`macos/SureWord-iOSUITests/ShareSheetUITests.swift` through the real system
share sheet (scheme `SureWord-iOS-ShareUITests`): Files and Safari hand the
share to the SureWord extension, which writes it to the App Group inbox, and
the app then opens it. The app runs in the Debug evidence shell
(`-SureWordEvidence YES -evidence.screen shell`), the real signed-in tab shell
without a Clerk session, because no test account exists on this simulator.

| File | What it shows |
|------|---------------|
| 01 | Files, Quick Look of an M4A voice message: SureWord in the share sheet |
| 02 | The extension card after saving: "Saved to SureWord · A voice message" |
| 03 | The app opened the share as a new chat; the upload was attempted and the server answered Unauthorized (no session), so no chip and no actions |
| 04-06 | Safari, sureword.app/support: share sheet, saved card, then a new chat with the page title and URL in the composer and both actions, Check against Scripture and Help me reply |
| 07-09 | Files, a JPEG: share sheet, saved card ("A picture"), chat with the upload refused for lack of a session |
| 10-11 | Files, a PDF: saved card ("A file"), chat with the upload refused for lack of a session |

Not exercised here: a signed-in upload of the shared files (chip, voice
transcription) and sending `/check` or `/reply`; Photos (`simctl addmedia`
failed on this runtime, so the photo came from Files); Voice Memos and Discord
(not on the simulator). `NSExtensionContext.open` returned false, as expected
for a share extension, so the card's "open SureWord" text is the hand-off.
