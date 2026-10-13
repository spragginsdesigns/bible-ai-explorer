# SureWord chat home redesign, 2026-10-12

Austin approved the friendly folded-page companion and question grid with the charcoal, ivory, and gold palette, then authorized Android internal and closed testing, web production, and Apple delivery after verification.

The home keeps all suggested questions in server order, showing four initially and revealing the rest. New chat remains direct; model selection, history, and settings remain available. The composer stays docked. Thinking selects the upward-reaching pose, visible streamed text selects the praising pose, and completion, cancellation, or failure returns to idle. Motion stops for reduced motion and background state; native clients also stop for screen readers.

The design uses six matching raster assets across clients. Chat colors remain scoped so the Bible reader retains its ink. Android and web consumers derive tab clearance from the actual bar height and safe area, including Notes and the web Bible's audio, Ask AI, and sermon controls.

## Verification

- Android: full TypeScript check and 1,026 tests passed. The signed all-ABI AAB and APK are 1.88.0 (100), with the pinned upload certificate. The normal APK was installed on the task's emulator and reached the normal sign-in screen. Its source map contains the actual chat route and avatar, and excludes the developer fixture entry. Native design fixtures exercised all questions, menus, keyboard clearance, large text, light appearance, thinking/praise/settled poses, and reduced motion. The physical phone was not connected; authenticated chat on that phone is not claimed.
- Web: 1,507 logic tests passed with 16 existing skips. TypeScript, lint, and production build passed. Local captures at 390px and 1280px exercised the actual presentation components, suggestion reveal, history, draft entry, attachment choices, dark/light appearance, and reduced motion. A question tap without a session returned the existing unauthorized recovery message. A Notes frame using the shipping workspace class and the actual audio/nav components was measured with 0px and 34px insets: clearance was 81px and 107px respectively, and the audio bar stayed 8px above navigation. Temporary local QA routes were removed before the final build.
- iOS/iPadOS: the full simulator suite passed 272 Swift Testing cases and 331 XCTest cases, with one existing skip. Focused native UI tests passed for all six questions, companion accessibility, light keyboard/Send, and options. The final readable placeholder passed its affected UI test. Real iPhone and iPad simulator captures use the shipping views through the existing debug evidence harness. A Distribution-signed archive and IPA were exported; signing used the existing certificate in a temporary keychain, with the original search list restored and temporary material removed. Physical iPhone/iPad authentication and installation are not claimed.
- macOS: the matching native source is included. Fresh build, installed-app verification, and distribution receipts are separate gates.

Independent source review found and resolved Notes clearance, held Send contrast, native image loading/accessibility, active-title visibility, keyboard dismissal, and web navigation overlap regressions. The final source review passed. Prompts, API routes, account boundaries, streaming transport, and persistence contracts were not changed.

## Android artifact binding

- AAB SHA-256: `4000f3effe492142ee945c09be3104c6c52bf0ad36794ecc914ea5f9f5bbf18c`.
- APK SHA-256: `96ef420d52b4ea9fbbd8bd9e92bb7d8efdf68f0d227710e343446c52001002ea`.
- Upload signer SHA-256: `5f7f48390a7486eb3b2ecd4a81b106e38ce5d9d21cf84743f88ba9b1c51fca6a`.
- Mobile source digest: `08eb34377bea2dad25eaba51659d1c1cbaa3fb7467e1e211ca82214b4b072167`.

The final build records commit `b97c50fff9a77084791846c17e2c2a4b02c1a423` with zero uncommitted mobile files. The AAB and APK hashes stayed identical after the final source refresh. Publishing verifies the source bytes still match. The release copy preserves current remote main features and leaves the shared checkout's unrelated work intact.

## Delivery receipts

Delivery verified on 2026-10-12:

- Web production deployment `dpl_HbtdaGbjwWhudLJbnk9x1MoWAadL` is READY for `b97c50fff9a77084791846c17e2c2a4b02c1a423`, assigned to sureword.app and the legacy host. Live mark, thinking, and answering PNG requests returned 200 with hashes matching source.
- Play internal and alpha readback both report 1.88.0 (100), status completed, with the same release notes. Closed-testing availability remains subject to Play review.
- GitHub release [android-v1.88.0](https://github.com/spragginsdesigns/bible-ai-explorer/releases/tag/android-v1.88.0) serves SureWord.apk with the exact signed-build SHA-256 above and carries forward SureWord.dmg.
- iOS 1.15.0 (1) upload succeeded. Processing and TestFlight availability were not yet verified when Austin narrowed the remaining work to web and Android. The existing 1.13.0 App Store review remains queued at his explicit request.
- Mac signing still failed in the SSH session. Austin asked to skip Mac for now; the interactive signing prompt was closed and the existing installed app and DMG were preserved.

The previous iOS 1.13.0 review was still waiting when this release started. The repository records Austin's earlier preference to keep that review queued. Uploading this version to TestFlight can proceed while the older App Store submission remains in review; replacing that queue entry is a separate decision.

Raw local evidence is under `artifacts/chat-home-redesign/` in the shared workspace. Private diagnostics and generated build outputs are not committed.
