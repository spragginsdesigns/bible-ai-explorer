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

- Web: 1,401 logic tests in a clean HEAD plus parity source copy pass, 16 existing skips; lint and production build pass.
- Android: 976 tests and TypeScript pass. Signed emulator playback showed the
  native media session PLAYING, read-along, verse skips, speed changes and close.
  Final source-identity transition and offline recovery checks are pending the
  last build. The release source map is compared to the final hook before upload.
- iOS: 236 Swift Testing cases and 322 XCTest cases (one existing skip) pass; two signed UI tests
  exercise the real reader against public production recordings. Their negative
  controls cover BSB, Genesis and closing a pending playback start.
- Note deletion has positive and rejected-response tests through APIClient and
  the editor/store. Only successful deletion removes the cached note.
- Web consent: Chrome network events show zero `/api/guest/ask` requests after
  Not now and exactly one after Agree. The local guest route then hit its existing
  Vercel-only response-header dependency; production answer smoke is a release
  step, not claimed from that local response.
- iPad split geometry was observed in the simulator. Its screenshot uses the
  session-less harness and is layout evidence, not authenticated persistence proof.

## Delivery state

| Surface | State |
|---|---|
| Android 1.83.0, code 93 | Prepared; Play/GitHub upload and readback pending |
| iOS 1.12.0 | Build 2 VALID in TestFlight; replacement review is being prepared |
| Existing App Review | 1.10.1 review cancellation requested after replacement build 2 became VALID |
| Web/backend | Main push and deployment readback pending |
| Mac 1.12.0, build 14 | Sources compile; stable signing/install blocked by existing keychain access |
| Remote iOS push | Disabled; Expo has no Apple push key, Apple Developer sign-in requested |

`AI_CONSENT_ENFORCE_MORNING=1` is configured in Vercel for production, preview and
development. The next deployment uses it; users without current consent receive
the no-personal-context morning path. No additional API keys were introduced.

iOS signing reused the existing Distribution certificate, verified by its
fingerprint, in a temporary keychain. The original search list was restored and
the temporary keychain and P12 material removed. No Apple certificate was revoked.

Proof files stay under `artifacts/parity-2026-10-08/` locally. Private diagnostics
are not added to the repository or public releases.
