# Bounded text sizing, 2026-10-27

Austin requested text sizing for older readers on Android, web, macOS and iOS,
with limits and layouts that remain usable when text grows or shrinks.

## Contract

The current product already has the account preference `User.textScale`.
Keep its three validated values: Standard (1), Large (1.15), Largest (1.3).
Decrease and increase move one stop and disable at the endpoints. Reset
returns to Standard. Repeated taps cannot grow text beyond Largest or shrink
it below Standard. Unknown values fall back to Standard.

This reuses the preference chosen during Walk with me, its existing local
cache and account synchronization. It introduces no second multiplier and
needs no database migration. Browser zoom and operating-system accessibility
text sizes remain independent of the app's bounded adjustment.

The Bible's separate 17 / 20 / 24 / 28 reading sizes remain available. Each
baseline receives the app factor once. Notes display sizing must not rewrite
the note's content, markup or saved formatting.

## Layout requirements

- The text-size control is reachable in Appearance & reading, with a live
  Scripture preview and labeled decrease, increase and reset controls.
- Chat offers a direct Text size route. Native Apple entry points follow
  the existing settings and menu patterns.
- Navigation labels may wrap. Navigation height must reserve matching space
  for content and the composer.
- The composer grows with its contents and responds to size and width changes.
- Verse previews fit within the viewport, have a reachable close control and
  keep the full passage available by scrolling.
- No scaling through transforms, repeated multiplication of nested spans,
  shrinking labels to hide clipping or view-identity resets.

## Source and release isolation

The original Windows main checkout diverged from current origin/main and
contained unrelated authentication edits. Implementation and verification use
`C:/Users/Owner/Documents/SureWordQA/text-size-20261027`, a clean checkout of
current main. The original edits remain owned by their existing agent.

## Verification ledger

These results cover the text-sizing release commit `a24e58b`. The receipts
were later rebased over a concurrent Ways to Serve feature without changing
that feature; no extra runtime or release proof is claimed for its changes.

Android typecheck and all 1,163 tests in 89 files pass. The upload-signed
1.105.0 (122) APK is installed on the sole emulator, emulator-5554. The real
Chat options, Text size route opens Appearance & reading. Standard, Large and
Largest were observed, the decrease and reset controls disable at Standard,
increase disables at Largest, repeated endpoint taps stay bounded, restart
retains the chosen size and Reset restores Standard. At 2x Android system
text, navigation wraps whole targets, the composer stays above navigation,
and the rebuilt theme choices wrap whole chips instead of breaking System
and Light. The system setting was restored to 1.0. The device initially had
a launcher ANR; it was recovered by restarting the same AVD, without changing
its configuration, creating another device or clearing app data.

Web TypeScript, ESLint and the final optimized production build pass. Logic
tests pass 1,747 cases with 17 existing skips. The temporary, uncommitted UI
harness used the shipping text control, Markdown renderer, composer and
navigation. At 320x640 with Largest plus doubled base text, the root was
41.6px, document scrollWidth and clientWidth were both 305px, navigation was
174px high, and Send remained above it with the draft unchanged. All four
attachment choices were reached with arrows; Tab focused Send, Shift+Tab
focused the model trigger, and Escape restored Attach. The menu stayed inside
the viewport and scrolled focused choices into view. The harness was removed
before the final build. Local account API calls were not used as account
proof because the inherited local database environment lacked User tables.

macOS compiles against the existing macOS 15 minimum, and the four native
text-sizing tests pass. iOS compiles for arm64 and x86_64 simulator and its
focused text-sizing plus onboarding suites pass 25 tests. Native editor tests
exercise real NSTextView/UITextView objects, preserving HTML, selection,
pending Bold and list geometry while recalculating display fonts. Real iOS
debug screens were captured at Largest, at the largest system accessibility
category, and with the separate reader at step 3. Maximum-system sizing
exposed a squeezed value/button row; the final layout gives the value its own
row and moves whole buttons to additional rows. The system category was
restored to Large. These captures use the existing DEBUG evidence harness,
which is excluded from release behavior. The separate XCUITest interaction
run stalled in the simulator accessibility query and was interrupted; it is
not counted as passing. A full TalkBack/VoiceOver or WCAG audit was not run.

Independent source reviews passed after correcting the identified toolbar,
keyboard-focus, native pending-format and layout findings. Raw captures and
logs remain in this QA checkout's ignored `artifacts/text-size/` directory.

## Follow-up: keep web drafts mounted

A final route trace found the quick Text size links could leave the chat page
while `useChat` keeps its unsent input in page state. Both chat and reading
menus now open the same in-place `TextSizeDialog` instead. Settings navigation
remains available separately. The dialog reuses the bounded preference control
and the shared modal focus helper, and gives scrolling and fixed-size chrome
room at narrow widths.

The real local chat page was exercised with an unsent draft. Opening the quick
dialog, choosing Large, and closing with Escape left both the URL and draft
unchanged. Focus returned to Chat options. At 320x640 with Largest, the panel
was 304px wide and 564px high, entirely within the viewport; document scroll
width equaled client width. This is UI/state proof, not local account-save
proof, because of the local database limitation above. The follow-up passed
independent source review, TypeScript and targeted ESLint; the full integrated
web logic suite passed 1,765 tests with 17 existing skips.

## Release status

Android 1.105.0 (122): matching signed AAB/APK built and emulator verification
complete. `push-phone.sh --skip-build` published the bundle to Play internal
and closed testing and the APK to GitHub. A separate Publisher API readback
returned `completed`, versionCodes `[122]`, name `1.105.0` on both `internal`
and `alpha`; closed testers remain subject to Google's review timing. The
Play listing was applied and a separate check matched the text-sizing copy
from `a24e58b`, before the concurrent Ways to Serve listing update.
GitHub release `android-v1.105.0` carries `SureWord.apk` and the existing Mac
DMG unchanged. GitHub's APK digest matches the local build manifest:
`006db69e7f4b5ce13d1e1a7e3faa351cb38960e8f527866e66bf8db6cceace8a`.
The corresponding mobile source digest is
`351186d251b3f7a2d4bd6e15d80362ffaa85f4e7df4d6739a4d601cce8b996fa`.
Code is committed and pushed as `a24e58ba2ea009e5ae8eb0831d4e77e219ea8682`.
Web: final build and local UI proof complete. Production deployment
`dpl_2nx2U2BtmqswWcqaGP44nBLccXG1` is READY for that exact commit and owns the
`sureword.app` alias. A fresh signed-in browser tab at
`https://sureword.app/settings#text-size` rendered the deployed decrease,
increase, Reset, three preset choices and live Scripture preview. The live
Standard state had decrease and Reset disabled. A production capture is saved
as `artifacts/text-size/web-production-controls.jpg`. Android was left at its
original Standard app size and 1.0 system size, and the emulator remains
running. The iOS simulator system text category was restored to Large.
Apple 1.28.0 (macOS build 37): source, builds and the scoped native tests above
complete. Signed delivery is blocked. `install-mac.sh --no-launch` failed at
CodeSign with `errSecInternalComponent`; the Apple Distribution key dry-run
failed with the same error. A one-shot GUI-context retry could not access the
Documents checkout under macOS privacy controls and was unloaded. No keychain
password, ACL or privacy setting was changed. The installed Mac app/DMG was
not replaced, and no iOS archive or TestFlight upload is claimed.
