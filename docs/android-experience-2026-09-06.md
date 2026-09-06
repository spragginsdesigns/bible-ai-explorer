# Android experience pass — 2026-09-06

## Scope

Android-first review of Bible / Pick Up Your Cross navigation, highlights,
note saving, devotional lifecycle, and Settings touch targets. Existing artwork,
brand typography, and theme tokens are preserved. Web, Apple, and Windows work
is deferred to the separately tracked follow-up tasks requested by Austin.

## Findings and changes

1. **Daily Cross polluted tab history.** On Android 1.49.0, the actual Bible →
   Cross → Matthew 6 → verse sheet → Back path eventually returned to Bible home,
   then reopened Cross, then returned to Chat. The installed TabRouter independently
   reproduced the same history deduplication. Cross now belongs to the Bible stack;
   legacy `/cross` redirects into that stack with Bible home anchored underneath.
2. **Rapid highlight writes could finish out of order.** Each verse now has an
   ordered write queue. Stale chapter reads and failed older writes cannot replace
   a newer local choice. Account-cache clearing invalidates reads and queued writes.
3. **Note autosave and explicit flush could overlap.** Capture and PATCH now run
   in order, and HTML is marked saved only after success. Back, info, AI, and primary
   tab departure wait for a flush; a failed save keeps the editor available to retry.
   The shared tab bar runs the guard before emitting destination-scoped tab events;
   a listener attached only to Notes does not receive Bible-tab presses. A missing
   WebView capture reports an error instead of authorizing departure with stale HTML.
4. **Devotional teardown could blank the entire app.** On the original release,
   changing Android font scale after opening Cross reproduced
   `ERR_USING_RELEASED_SHARED_OBJECT` from `AudioPlayer.pause` and a blank React
   surface. Listen cleanup now tolerates that specific already-released-player
   condition while preserving other playback errors.
5. **Small Settings controls.** Notification-hour and provider-action targets now
   use 48dp minimum dimensions; provider edit actions wrap on narrow layouts.

## Verification record

Original reproduction captured on the signed-in Android emulator using release
1.49.0 (48). Screenshots and UI trees are kept locally in
`artifacts/android-experience-2026-09-06/`; private app content is not published.
The separate emulator briefly launched during a shared-device collision was closed;
the signed-in emulator remains the proof surface.

Final source review passed independently. Support checks: mobile TypeScript,
568 tests across 41 files, Expo Android export, signed all-ABI AAB/APK build,
and `git diff --check`. The final APK was installed and identified as 1.50.0 (49)
on the Android API 31 emulator at 1125 × 2436, density 480 (375dp width).

| Product path | Observed result | Local evidence |
| --- | --- | --- |
| Cross → Matthew 6 → verse sheet → Back | Sheet closes, then Cross, then Bible home | `37-highlight-back-cross`, `38-highlight-back-bible` |
| Cold legacy `/cross` and chapter links | Correct screen opens with Bible home underneath | `39-cold-reader`, `42-cold-back-bible`, `81-final-cross`, `83-final-bible` |
| Rapid Yellow → Blue highlight, process restart | Blue remains selected; removal restores the original unhighlighted state | `36-blue-selected`, `40-persisted-blue`, `41-highlight-restored` |
| Type → hide keyboard → Bible within the debounce → reopen note | New `FINAL-TAB-SAVED` text survives | `69-final-preview`, `70-final-ready` |
| Offline edit → attempt tab departure → reconnect → retry | Error stays visible in editor; `OFFLINE-RETRY` survives reopening | `72-offline-result`, `75-current-note`, `76-retry-reopened` |
| Notes tab reselection | Flushes and returns to the Notes hub | `77-notes-reselection` |
| Cross recreation, idle and while playing | Screen remains usable; playback was observed advancing before recreation | `21-recreated-after`, `22-audio-playing`, `23-audio-recreate-playing`, `82-final-recreation` |
| Settings light theme, notification hour and provider edit controls | 48dp targets, edit actions wrap without overlap; Cancel preserves keys | `56-settings-controls`, `57-providers-light`, `60-provider-edit-controls` |

The last app process produced no ReactNativeJS error lines. The QA note was
deleted through its confirmation sheet (library returned to 15 notes), the
temporary highlight was removed, and theme, font scale, Wi-Fi and mobile data
were restored. No account keys or existing notes were changed.

Final artifact SHA-256:

- APK: `eb5ebe98ba48b1b3e90559f10130dd124649fb261e4197f3d3e599a64adf9748`
- AAB: `cbefffe274fdde662cbce3c22cb90deed7c8c9854854c29086f7cb358d838691`

Phone installation is separate from emulator proof and Play/GitHub publication.

## Remaining audit limits

This is a bounded experience pass, not a claim that every app path is perfect.
Long-list performance, TalkBack traversal, all font scales, every provider setup,
and cross-client runtime parity need separate coverage. Concurrent Notes-library
refreshes can still apply an older list snapshot; that read-ordering concern is
separate from the body-save ordering repair above and remains follow-up work.
