# Chat composer spacing design QA

## Evidence

- Source visual truth: `.codex-remote-attachments/01a04a83-7d67-7663-a631-89435d2b5964/5d30eefa-55f7-4e8c-8aa8-3bf835542406/1-Photo-1.jpg`
- Final implementation screenshot: `artifacts/chat-composer-qa/implementation-1.40.0-dark-pass2.png`
- Full-view comparison: `artifacts/chat-composer-qa/comparison-full.png`
- Focused composer comparison: `artifacts/chat-composer-qa/comparison-composer-focus.png`
- Source pixels: 656 x 1280. Its original device density and CSS viewport are not encoded in the attachment.
- Implementation pixels: 1080 x 2400 on `emulator-5554`, Android density 420 (2.625), approximately 411 x 914 dp.
- Full-view normalization: each image was fit without distortion inside 656 x 1280 and centered on black before horizontal comparison.
- Focused normalization: each image was scaled to 656 px wide, then the bottom 400 px was cropped before horizontal comparison.
- State: Android dark theme, keyboard closed, standard populated-conversation composer treatment, Chat tab selected.

The source contains a populated conversation. Authentication was unavailable on the disposable emulator, so a temporary local-only auth/state bypass rendered the real Chat screen, real tab bar, and real standard `ChatInputBar` component. The bypass was removed after capture and is absent from the release source. The content region differs, but the scoped composer and navigation state are equivalent.

## Full-view comparison

The implementation preserves the existing header, black canvas, composer width, bottom navigation hierarchy, typography, and amber/neutral palette. The taller Pixel emulator viewport and empty QA content explain the extra vertical space; neither changes the bottom composer/nav relationship under review. No overflow or clipped persistent control is visible.

## Focused comparison

The source composer visually touches the navigation divider. The final implementation has a clear, even separation above the divider, a slightly lighter unified surface, a 1 px outline, and a restrained theme-aware halo. The composer remains aligned to the same horizontal screen margins and its controls retain their existing size and rhythm.

## Required fidelity surfaces

- Fonts and typography: unchanged existing SureWord system typography; placeholder size, weight, line height, truncation, and optical hierarchy remain consistent with the source.
- Spacing and layout rhythm: passed. The tab item is 52 dp and the bar adds 4 dp top plus 4 dp bottom padding, so the reserved tab-bar metric is now 60 dp. The existing 8 dp composer inset is therefore visible instead of being consumed by uncounted nav padding.
- Colors and visual tokens: passed. The composer uses `surfaceStrong`, `borderStrong`, and a `borderStrong` 10 dp box shadow. The dark field is visibly lighter without competing with the amber actions.
- Image quality and asset fidelity: passed for the scoped component. It contains no custom raster imagery; existing Ionicons and brand assets are unchanged, sharp, and not replaced.
- Copy and content: unchanged. The placeholder remains `Ask a question about the Bible...`.

## Comparison history

1. First dark render: `artifacts/chat-composer-qa/implementation-1.40.0-dark.png`.
   - P2: the lighter outer shell exposed the native paste input's black rectangular background, breaking the requested uniform surface.
   - P2: Android elevation produced a broader, brighter white wash than the requested subtle halo.
2. Fixes applied:
   - Set the paste input background to transparent.
   - Replaced elevation/shadow props with a controlled `borderStrong` box shadow at 10 dp blur.
3. Post-fix render: `artifacts/chat-composer-qa/implementation-1.40.0-dark-pass2.png`.
   - The input surface is uniform, the nav gap is visible and balanced, and the halo is restrained.
   - No actionable P0, P1, or P2 difference remains in the scoped component.

## Interaction and runtime checks

- Reinstalled and launched the final signed release 1.40.0/versionCode 38 successfully after QA harness work.
- Focused the real paste input using UI-tree-derived coordinates and entered `Spacing looks good`; the native UI tree returned that exact value.
- Confirmed attachment, input, Send, and all three tab controls remain accessible in the UI tree.
- Checked app-process logcat after launch and input; no app fatal exception, unhandled JavaScript error, invariant violation, or crash was present.

## Follow-up polish

No P3 follow-up is required for this scoped change.

final result: passed
