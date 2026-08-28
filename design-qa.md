# SureWord AI Guide Design QA

## Findings

- No actionable P0, P1, or P2 differences remain. The implementation preserves the selected character identity at the approved smaller scale and passes dark, light, compact, streaming, settled, accessibility, and Reduce Motion checks.

## Comparison target

- Source visual truth: `C:\Users\Owner\.codex\generated_images\01a04963-caf7-7c33-8f77-36112e288b47\exec-4ee401c0-be78-47cf-9b89-acde65d5188f.png`
- Implemented welcome capture: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\qa-welcome-dark.png`
- Implemented chat capture: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\qa-chat-static.png`
- Implemented Notes capture: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\qa-notes-dark.png`
- Light-theme capture: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\qa-welcome-light.png`
- Full comparison: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\comparison-full.png`
- Focused hero comparison: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\comparison-hero.png`
- Focused compact-avatar comparison: `C:\Users\Owner\AppData\Local\Temp\sureword-avatar-qa\comparison-avatar.png`

## Viewport and normalization

- Source pixels: 853 x 1844, generated for a 390 x 844 logical mobile viewport.
- Implementation pixels: 1080 x 2400 on an Android 15 emulator at 420 dpi, approximately 411 x 914 dp including system bars.
- Full-view comparison: both images normalized to 1200 px high and appended horizontally.
- Focused hero comparison: source and implementation character regions normalized to 500 x 500 px.
- Focused compact-avatar comparison: source and implementation assistant-avatar regions normalized to 240 x 240 px.
- State: dark welcome, settled answer, active answer, Notes AI, light welcome, motion enabled, and Reduce Motion enabled.
- The source is a conceptual chat composition while the shipped welcome screen retains SureWord's existing Scripture/composer/suggested-question flow. Full-view comparison therefore evaluates character identity, scale, palette, and hierarchy; the focused comparisons are the fidelity authority for the avatar itself.

## Fidelity review

- Fonts and typography: the implementation preserves the existing Pirata One wordmark, Cormorant Garamond Scripture treatment, and system UI font. No product copy or text hierarchy was replaced by image content.
- Spacing and layout rhythm: the hero is 154 dp inside the existing 214 dp stained-glass panel, matching the approved 150-170 dp range without consuming the first viewport. Compact chat and Notes avatars are 32 dp and 26 dp respectively.
- Colors and visual tokens: parchment-gold pages, amber day-star, midnight blue, oxblood, and near-black surfaces match the selected direction in dark mode. The same RGBA asset remains legible without a dark rectangle in light mode.
- Image quality and asset fidelity: `mobile/assets/sureword-guide.png` is a 768 x 768 truecolor RGBA PNG. Dark, light, hero, and compact captures show clean transparency, sharp star geometry, readable page edges, and no compression or alpha halos.
- Copy and content: existing welcome Scripture, composer, suggested questions, chat markdown, and Notes AI content remain unchanged. Only the previous icon/glyph artwork was replaced.
- Interaction states: the hero uses a slow breathing motion; only the currently streaming assistant avatar pulses; settled historical messages remain static. Two active-state captures differed visually. With Android Reduce Motion enabled, the same avatar crop was pixel-identical across captures (`0 (0)` comparison result).
- Accessibility: Android's UI tree exposes `SureWord AI guide, a golden day star held by folded pages` for the hero and `SureWord AI assistant` for compact avatars.
- Runtime: the normal credential-free release APK contains no QA marker, launches through the production auth route, and produced no app-process fatal, script-load, or React Native error matches. The emulator's Google Play Services image reports `SERVICE_NOT_AVAILABLE` for Firebase token retrieval; this is an AVD service issue outside the avatar path and did not crash SureWord.

## Comparison history

1. Initial concept feedback: the selected guide consumed too much vertical space.
2. Approved visual revision: the guide was reduced to roughly two-thirds of the original concept size.
3. Implementation pass: the real hero was fixed at 154 dp, compact avatars were added to chat and Notes AI, and animation was gated by streaming state and Reduce Motion.
4. Post-fix visual evidence: dark welcome, light welcome, settled answer, active answer, and Notes AI captures showed no remaining P0/P1/P2 issue.

## Primary interactions tested

- Switched between welcome, chat, and Notes AI states using UI-tree-derived tap coordinates.
- Switched dark and light themes.
- Verified active avatar motion with two timed captures.
- Verified Reduce Motion by disabling Android animations and obtaining an identical two-capture avatar crop.
- Verified settled avatars remain static and readable.

## Cross-platform assistant-turn regression

- Reported source: `C:\Users\Owner\Documents\Github_Repositories\bible-ai-explorer\.codex-remote-attachments\01a04963-caf7-7c33-8f77-36112e288b47\cb8079f4-ff71-4626-8e6f-b0b2bfca830c\1-Photo-1.jpg`.
- Android reproduction capture after the fix: `C:\Users\Owner\AppData\Local\Temp\sureword-duplicate-avatar-qa\assistant-turn-qa.png`.
- Confirmed cause: `data-status` arrived before the response `start`, so the AI SDK appended a temporary-id assistant row and then appended the persisted-id row when the model stream opened.
- Server fix: chat and Notes streams now open the persisted assistant id before the first status and suppress the model stream's later start chunk.
- Client guard: web, Android, macOS, and iOS discard settled assistant shells with no content, activity, attachment, card, or action. Only a trailing assistant message can be marked streaming.
- Label behavior: tool/status activity remains inside the single assistant turn as visible text such as `Thinking...` or `Searching the Scriptures...`; it is not presented as a second avatar.
- Android UI-tree proof: one `SureWord AI assistant` node, one `Thinking...` label, and one visible assistant row for the exact orphan-plus-active input shape. App-process error matches: zero.
- Web proof: optimized Next.js production build passed after the cross-platform change.
- Apple proof available on Windows: Swift source contracts, shared asset catalogs, 1x/2x/3x RGBA images, and mirrored macOS/iOS view wiring passed static regression tests. Xcode compilation remains the Mac-only shipping gate.

## Follow-up polish

- P3: the compact illustration necessarily loses some orbit-line detail at 26 dp, but the day-star and folded-page silhouette remain recognizable. No change is recommended unless a future round introduces a separately simplified micro-avatar asset.

final result: passed
