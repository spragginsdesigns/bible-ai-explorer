# Native parity release, 2026-10-08

Austin authorized completing parity and shipping. He reported an iPhone test
working before this pass, without specifying its binary version or a path list.

## What changed

- Android and both Apple readers gain the narrated KJV chapter player: verse
  skips, seeking, shared speed, read-along, automatic chapter continuation,
  media controls, background playback, and the idle listening check.
- AI consent copy version 2 names the included OpenRouter route. Web and
  Android presenters, Apple cache/version handling, custom plans, suggestions
  and Daily Cross now follow the same consent choices. Requests waiting on
  consent cancel on Stop, and account switches cannot borrow another token.
- iPad gets adaptable tab/sidebar navigation, a Notes library/detail split and
  a bounded chat column. Failed note deletion keeps the editor and error open.

## Verification

- Final combined web source: 1,412 logic tests pass, 16 existing skips; lint,
  TypeScript and production build pass. Android: 985 tests and TypeScript pass.
- Android release 1.84.1 (95) is installed in the emulator. John 6 finishes in
  the background and starts John 7 once at 1.25x. Returning to the reader shows
  John 7 and the new duration, without a SureWord JS/native crash. This exposed
  and fixed stale scroll callbacks addressing the shorter next chapter.
- With emulator connectivity disabled, fresh John 8 narration fails with Retry.
  Restoring connectivity and Retry starts the same chapter successfully. Native
  media state is PLAYING and read-along advances. Test playback was stopped and
  the shared speed returned to 1x afterward.
- Final iOS source: 249 Swift Testing cases pass. XCTest executes 324 cases with
  one existing skip. A route-mirror test initially failed 25 assertions because
  the temporary source path did not resolve consistently; its 13-test suite
  passes from a normal Mac source directory. The other suites passed in the
  full run. Two signed reader UI tests against public recordings passed earlier
  in this parity pass, including unsupported-source and pending-close controls.
- Note deletion positive/rejected responses run through APIClient and the
  editor/store. Only successful deletion removes the cached note.
- Local Chrome network evidence: zero guest AI requests after Not now and one
  after Agree. Production smoke repeats decline/retry/agree and returns the
  Bethlehem answer with Matthew 2:1 and Luke 2:7 citations. Screenshot:
  local `artifacts/parity-2026-10-08/production-guest.png`.
- iPad split geometry was observed in the simulator. The session-less harness
  proves layout, not authenticated note persistence. Austin's reported iPhone
  test predates these final binaries; no new physical-device pass is claimed.

## Delivery state

| Surface | State |
|---|---|
| Android 1.84.1, code 95 | Play internal readback: completed; GitHub APK published, SHA-256 matches tested artifact |
| iOS 1.13.0, build 2 | Uploaded, processing VALID; App Review WAITING_FOR_REVIEW, with Pro subscription and group attached |
| Web/backend | Commit 7dd5d8754c73bf8c71251678df8d5e80d02ac4c9 READY in Vercel production, sureword.app alias attached; guest answer verified |
| Mac | Native sources compile; a new signed Mac install/DMG is blocked by existing keychain access. Latest Android release preserves the prior Mac DMG |
| Remote iOS push | Disabled; authenticated Expo inventory has no Apple push key. Apple Developer sign-in requested; local reminders remain available |

Release: https://github.com/spragginsdesigns/bible-ai-explorer/releases/tag/android-v1.84.1

App Review ID: `6241da08-60e5-4128-a470-743a31bde77e`.
Attached iOS build ID: `88c99b0b-8e92-405a-ac2b-47229db4e4b1`.
Apple review and Google Play production rollout are not completed by an internal
track release or a waiting review. The source also preserves the other agent's
completed message actions and reasoning controls from 1.84.0 / 1.13.0.

`AI_CONSENT_ENFORCE_MORNING=1` is active in Vercel production. Users without
current consent receive the no-personal-context morning path. No additional
API keys were introduced.

iOS signing reused the existing Distribution certificate, verified by its
fingerprint, in a temporary keychain. The original search list was restored and
the temporary keychain and P12 material removed. No Apple certificate was revoked.

Proof files stay under `artifacts/parity-2026-10-08/` locally. Private diagnostics
are not added to the repository or public releases. Remaining credential and
signing work stays open in TickTick; no full runtime parity claim is made.
