# SureWord dawn launch splash

The launch artwork follows an olive-hill path into a warm sunrise. The existing Pirata One wordmark stays recognizable. The message is "Your walk with God. One step at a time." It welcomes people wherever they are in their relationship with God without assuming a denomination, profession, or stage of belief.

## Scope and incumbent design

This is a refinement of the existing launch surface. The visual sources of truth remain `mobile/src/theme/index.ts` and its Apple port, `macos/Shared/DesignSystem/Theme.swift`: monochrome glass surfaces, dark/light appearance palettes, amber accents, and separate parchment reader ink. Their dark accent is `#fbbf24`; the light accent is `#d97706`. Both reserve Pirata One for the SureWord brand title. Android retains Atkinson Hyperlegible for the message; Apple uses native SwiftUI text styles.

The dawn illustration adds ink-teal shadows, honey light and ivory text only to this launch surface. It does not redefine global theme tokens or the reader's parchment. `PRODUCT.md`, `DESIGN.md` and the Impeccable design sidecar were absent before this task. The scoped handoff records observed launch behavior here without inventing a global visual identity or repairing missing global documentation.

## Visual composition

The original portrait artwork fills the frame with a path from the lower foreground through olive-covered hills toward dawn. There are no baked-in words. The native text wordmark and message stay crisp over the image. The overlay ground and reveal veil use ink teal (`#06141b`); the wordmark and headline use warm ivory (`#fff8e8`), with softer ivory (`#efdec0`) for the second line.

Portrait layout centers the wordmark near 15% of frame height and the message above the lower 16%, with 24-unit horizontal insets. Android's full-frame image is absolutely positioned on all four sides; Apple's image is explicitly framed and clipped to the geometry. These bounds keep the artwork centered rather than allowing an oversized intrinsic image to shift the composition.

Wide web layouts, selected by a minimum aspect ratio of 4:3, move the title to 7% and increase the upper shade from 0.58 to 0.82 opacity. The shade becomes transparent at 60% instead of 48%; the lower shade remains 0.84. Portrait layout retains its existing shade and title position. The reviewer follow-up measured desktop title contrast from 4.82:1 to 9.51:1 after this correction. That range describes the measured desktop title area, not every pixel, platform or animation frame.

## Behavior

- A fresh app process shows the reveal once. Navigation, sign-in state changes, root recreation, and temporary inactive states do not restart it.
- A real background-to-foreground return shows it again, following Austin's explicit background-return request on 2026-10-09. On web, returning to the signed-in app tab uses document visibility. Public marketing pages do not show it.
- Artwork reveals over 1.65 seconds, followed by a 220 ms dismissal. Tap/click or Android Back skips it. Web keyboard input skips it.
- Web consumes the dismissing key in a capture listener with `preventDefault()` and `stopImmediatePropagation()`. A focused composer cannot receive that key and submit a draft hidden beneath the splash.
- Android and web have a three-second failsafe and dismiss on image failure. Android's dismissal completion uses its own timer so backgrounding cannot strand it on an animation callback. The main application mounts underneath, so the splash does not hold auth, navigation, or data loading.
- Reduce Motion skips the reveal. Android and Apple also skip it for screen readers. There is no audio or replay on a loop.

## Assets and implementation

Original artwork was generated with the built-in image generation tool. No LineCrush asset is included. Generated art has no baked-in text, so native text stays crisp and responds to screen size.

- Android: `mobile/src/components/AnimatedSplash.tsx`, session lifecycle in `launchAnimationSession.ts`, local JPEG in `mobile/assets/splash/`.
- Web: `src/components/LaunchSplash.tsx` and scoped CSS, WebP in `public/splash/`.
- iOS/macOS: shared SwiftUI `macos/Shared/DesignSystem/LaunchSplash.swift`, local JPEG in `macos/Shared/Resources/LaunchSplash/`.
- The old Remotion composition and MP4 remain historical source; app startup now uses native image animation.

Artwork generation prompt, original generated-image path, date and output paths are in `docs/sureword-splash-artwork.json`. The JPEG carries the embedded prompt; the WebP has a matching `public/splash/sureword-dawn.webp.json` sidecar. Preserve this provenance when copying or regenerating assets.

## Verification record, 2026-10-09

This ledger separates source and local verification from release delivery. The implementation was stable for the review and documentation handoff.

| Surface | Source and verification evidence | Limit of proof |
| --- | --- | --- |
| Android | Signed 1.86.0 (97) AAB and APK built from the independent clean source at `C:/Users/Owner/Documents/SureWordQA/splash-native-20261009`, with its own dependencies. That checkout's `splash-android-integrated-final.log` records signing and the version-bound outputs under `mobile/android/app/build/outputs/`. The APK was installed in an Android emulator; a cold-launch splash capture shows correctly centered full-frame artwork. Background session tests passed 4/4; a runtime diagnostic recorded background then active with replay true, accessibility bypasses false and the foreground dawn capture, the mobile suite passed 995/995, and typecheck passed. | Austin reported seeing and approving the new splash in his phone update on2026-10-09; this is user-reported physical-device visual acceptance. Emulator behavior checks and release receipts remain separate evidence. The initial build log in the implementation checkout records a shared-dependency file-lock failure and is not the successful artifact receipt. |
| Web | Local production build passed (`splash-web-integrated-final.log`). Logic tests passed 1454, with 16 existing skips and zero failures (`splash-web-tests.log`). Local still and held-controller harness captures exercised the exact visual layout at desktop 1280x720 and mobile 390x720. The desktop title correction was measured at 4.82:1 to 9.51:1. | Harness captures establish layout and contrast. They do not establish a live authenticated-browser session, live composer interaction or production deployment. |
| iOS/iPadOS | Apple 1.14.0 (16) built for iPhone 18 Pro and iPad 13 simulators; launch artwork was captured on both device classes. Both consume the shared `LaunchSplash.swift` implementation. | Simulator launch proof does not establish physical-device behavior, live authentication or App Store delivery. |
| macOS | The existing /Applications/SureWord.app was verified as1.14.0(16), with codesign --verify --deep --strict succeeding under Apple Development team389LLKGY3Y. Its dawn JPEG SHA256 is93d0569b2e5876300bc67c70b767d82077af02e50db6808dd11ce94be97a4329, matching the source asset. Austin reported opening this app and seeing the new splash. Fresh SSH signing still fails with errSecInternalComponent. | The installed signed app and user-reported splash launch are verified; this does not prove a new DMG or App Store distribution release. |

The independent visual review's full report initially had disposition `fix` for desktop title contrast only. Its follow-up measured that single finding resolved and returned disposition `ship` at that finding's scope. The code review reported no material findings. Neither review substitutes for the unverified runtime and release surfaces above.

Delivery verified: code commit b86a164f820f529c21b9dea610972a87ea7fd36e is live on sureword.app in a READY production deployment. Play internal testing accepted Android 1.86.0 (97). GitHub release android-v1.86.0 serves SureWord.apk with SHA256 a187fc8e6a38a8f6f3a8928682b50118eb4431b73d23673850781d6c906577be, matching the signed build manifest, and carries forward SureWord.dmg. The final APK, with diagnostic logging removed, was installed on the dedicated read-only VerseMind_Test emulator and its background-return reveal was captured. Signed Apple delivery remains blocked by the Mac keychain CodeSign error and is tracked separately in TickTick.

Apple distribution retry,2026-10-09: App Store Connect readback contains1.13.0 build2 as VALID, with no1.14.0 build uploaded. The1.14.0 build1 archive reused existing profiles but stopped at CodeSign for PhoneNumberKit_PhoneNumberKit.bundle. The SSH and console users match and the login keychain is the only searched keychain; a GUI audit-session switch was denied. No keychain access-control settings or signing credentials were changed. The installed Mac app was left working.
