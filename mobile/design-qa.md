> Historical Android design evidence from the local fixture pass on 2026-10-12. Austin subsequently authorized cross-platform release. Current integration and delivery evidence is tracked in `../docs/sureword-chat-home-release-2026-10-12.md`. Earlier no-release and Android-only statements describe the earlier design checkpoint.

# Android chat home design QA, 2026-10-12

Final result: passed

This result covers the Android presentation and companion behavior exercised with native fixture components. It is not a whole-app, authenticated AI, physical-device, or release result.

## Visual truth and evidence

- Approved comp: `../artifacts/chat-home-redesign/approved.png`, 853x1844 pixels, normalized to 390x844.
- Final native default: `../artifacts/chat-home-redesign/native-dark-390.png`.
- Combined comparison: `../artifacts/chat-home-redesign/comparison-final.png`, source left and native implementation right.
- Native full frame: `../artifacts/chat-home-redesign/native-postfix-full.png`, 1170x2751 pixels, Android density 480 (3 pixels per dp).
- App content crop: top 147-pixel status/cutout inset and bottom 72-pixel system navigation inset removed, producing 1170x2532, then normalized to 390x844.
- Native host: dedicated `SureWord_Chat_UI_20261012` emulator on `emulator-5556`, Android API 35. The other emulator was not modified.
- Native entry: a temporary harness (`scripts/chat-home-qa-entry.tsx`, since deleted), built in `C:/Users/Owner/Documents/SureWordQA/chat-home-20261012`. It renders the actual header, welcome, composer, tab bar, and avatar with synthetic questions and callback handlers. The production package keeps `expo-router/entry`.

## Comparison history

1. The first native render exposed a clipped reveal on a shorter app viewport. Compact header targets, 124dp question tiles, 22sp question line height, and an exact app-content viewport made the complete reveal visible. Header artwork was moved to a shared backdrop to remove its upper seam.
2. Independent review identified P2 footer proportions and a misplaced grounding pool. The visible navigation became 80dp using a shared 72dp item constant plus padding. Icons are 24dp and labels 14sp. The composer is about 64dp tall with a 12dp navigation gap. The backdrop's aspect-preserving crop at 344dp aligns its pool with the visible companion tip. Review scored both findings resolved.
3. The 130% system setting arrived as `1.2999999523162842`, so direct comparison against `1.3` did not select one column. The breakpoint now compares a rounded percentage against 130. Native question bounds became full width, `[48,1238][1122,1610]`. The scrolled reveal remains reachable at `[48,1966][1122,2110]`. Review scored this P2 resolved.
4. Light appearance exposed the dark image's rectangular backing. A separately generated RGBA extraction preserves the foliage and light pool with genuine clear negative space. Its native image is explicitly constrained to its container and uses 0.18 opacity. The final light capture has a continuous cream surface. Independent review scored the P2 resolved and reconfirmed the default dark frame.

## Required fidelity surfaces

| Surface | Evidence and result |
| --- | --- |
| Typography | Bundled Pirata One stays on the wordmark; Atkinson Hyperlegible renders the headline, questions, references, and controls. Default questions wrap fully. The 130% variant uses full-width tiles and scrolling. |
| Layout | Combined default comparison preserves the approved hero and question grid. Corrected composer starts about y688 vs y685 in the comp, navigation about y764 vs y762. Shared clearance keeps persistent controls aligned. |
| Colors | Chat colors are scoped in `chatAppearance.ts`. Dark text against tiles is 14.34:1, references 8.83:1, placeholder 6.46:1. Light question text is 11.09:1, references 5.52:1, placeholder 5.80:1. |
| Imagery | Six original raster assets have JSON provenance. Companion poses have verified RGBA alpha and consistent framing. Backgrounds preserve aspect ratio; light uses true transparency. No screenshot was used as a flattened interface. |
| Copy | Approved headline and all original fixture questions are retained. Every server item remains in order; four show initially and the remaining count is derived. References normalize without inventing labels. |

The combined comparison is legible at native logical scale. Dedicated keyboard, large-type, light, and pose captures make their controls and differences readable without relying on a full-screen thumbnail alone.

## Native interactions and states

| Check | Evidence | Result |
| --- | --- | --- |
| Six suggestions | `more-full.png`, `more-ui.xml` | Reveal exposes the extra two and scrolling reaches them. |
| Options menu | `menu-full.png`, `menu-ui.xml` | Model, history, and settings choices are visible and remain wired to the existing screen callbacks. |
| Question tap | `thinking-full.png`, `thinking-ui.xml` | Exact fixture question reaches the selection handler and activates thinking. No AI request is sent by the harness. |
| Keyboard | `keyboard-390.png`, `keyboard-ui.xml` | Complete edited question and enabled Send stay above IME; navigation remains under the keyboard. |
| Stop | `settled-ui.xml` | Stop returns the fixture to settled, with idle pose. |
| Large text | `large-type-390.png`, `large-type-scrolled-390.png` | Rounded 130% breakpoint selects one column; full questions and reveal remain reachable. |
| Light appearance | `light-390.png` | Readable controls and continuous cream backdrop. |
| Thinking and answering | `thinking-390.png`, `answering-390.png` | Upward prayerful reaching and two-arm praise render as requested. These enlarged demonstrations are not the live answer layout. |
| Reduced motion | `motion-proof.json` | Avatar region has zero changed pixels in two still captures, versus 83,289 with motion enabled. |
| Native motion clip | `guide-motion.mp4` | Actual native recording of reaching followed by praising. Crop accounts for screen-recording letterboxing and preserves the whole companion. |

Evidence files above live in `../artifacts/chat-home-redesign/`. Expected development-only Reanimated warnings when reduced motion was enabled were diagnosed and dismissed through their UI before accepted captures. Blank, loading, wrong-route, and warning-covered frames were rejected.

## Source verification and limits

- Native `:app:assembleDebug` passed with JDK 21. The installed Android Studio runtime was verified as JDK 25; the repository build script's existing JDK 21 selection was reused in the isolated native build.
- Final focused test run: 165 passing across six files, including question preservation, stream-cut Markdown regression fixtures, phase transitions, and palette contrast.
- UI-only TypeScript passed after all corrections: `npx tsc --noEmit -p ../artifacts/chat-home-redesign/tsconfig.ui.json` from `mobile/`.
- Full `npm run typecheck` remains blocked by the previously modified chat hook: `useSureWordChat.ts:493` passes two arguments where one is expected, and line 866 compares against `stale_thread` outside the current error-code union. Those files were preserved.
- React checklist: hooks remain unconditional; subscriptions, loops, and menu timers clean up; historical avatars do not attach active listeners; phases are derived from delivery state; images are statically analyzable local assets with native resizing.
- No live authenticated send, AI delivery, physical-device animation/performance test, web or Apple redesign, production deployment, store upload, or release installation was performed.

Independent review disposition: ship for the reviewed native visual scope. All material findings raised in that review were scored resolved. Native headline weight and small underline-position differences remain acceptable P3 differences; the approved visual direction is preserved.
