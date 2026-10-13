> Historical Android design evidence from the local fixture pass on 2026-10-12. Austin subsequently authorized cross-platform release. Current integration and delivery evidence is tracked in `../docs/sureword-chat-home-release-2026-10-12.md`. Earlier no-release and Android-only statements describe the earlier design checkpoint.

# Android chat home

Approved on 2026-10-12. Scope: signed-in Android Chat welcome and the companion's conversation states.

## Visual authority

- Product constraints: [../../PRODUCT.md](../../PRODUCT.md).
- Approved exact comp: [../../../artifacts/chat-home-redesign/approved.png](../../../artifacts/chat-home-redesign/approved.png).
- Implemented tokens: [../../DESIGN.md](../../DESIGN.md), [../../src/features/chat/chatAppearance.ts](../../src/features/chat/chatAppearance.ts), and [../../src/theme/index.ts](../../src/theme/index.ts).
- Native default capture: [../../../artifacts/chat-home-redesign/native-dark-390.png](../../../artifacts/chat-home-redesign/native-dark-390.png).
- Native light capture: [../../../artifacts/chat-home-redesign/light-390.png](../../../artifacts/chat-home-redesign/light-390.png).
- Comp comparison: [../../../artifacts/chat-home-redesign/comparison-final.png](../../../artifacts/chat-home-redesign/comparison-final.png).
- Runtime motion result: [../../../artifacts/chat-home-redesign/motion-proof.json](../../../artifacts/chat-home-redesign/motion-proof.json).
- Native motion recording: [../../../artifacts/chat-home-redesign/guide-motion.mp4](../../../artifacts/chat-home-redesign/guide-motion.mp4), with [thinking](../../../artifacts/chat-home-redesign/motion-video-thinking.png) and [answering](../../../artifacts/chat-home-redesign/motion-video-answering.png) frames.

## Approved surface

Austin selected the folded-page companion with a four-question grid in charcoal, ivory, and gold. Preserve the SureWord wordmark and open-Bible day-star mark. The hero uses the quiet foliage backdrop and the headline "Come hungry for the Word." Study questions keep server order; four are initially visible with an action to reveal the remainder. Question text wraps and a missing reference label remains empty.

The header keeps New chat plus an options sheet for model selection, conversation history, and settings. The composer remains docked when welcome content becomes a conversation. Its existing send, stop, consent, auth, attachment, edit, and history paths stay in place. API/account behavior is outside this visual replacement.

The companion preserves its paper identity in every pose. Thinking reaches upward prayerfully; answering raises both page arms in praise. Shared SureWordGuideAvatar and guideMotion.ts implement phase selection, Reduce Motion, screen-reader, and foreground guards. All six assets in assets/chat-home have JSON provenance beside their PNG files, including the genuine RGBA light sanctuary layer.

## Layout contract

| Element | Implemented native measurement |
| --- | --- |
| Header | Minimum 56dp, horizontal padding 16dp, vertical padding 4dp, gap 8dp, targets 48dp |
| Hero | Companion width 190dp and box height 228dp; hero bottom padding 24dp; headline 28/33, maximum width 310dp |
| Backdrop | Absolute container height 344dp; child image explicitly 100% width/height with cover; dark opacity 0.65, separate RGBA light layer at 0.18 |
| Question grid | Two columns; 10dp gaps; tiles minimum 124dp with 14dp padding and 16dp radius |
| Adaptation | One column at width <350dp or Math.round(fontScale * 100) >=130, including native float 1.2999999523162842 at 130% |
| Composer | Strong surface, radius 24dp; 48dp controls; input maximum 140dp; wrapper horizontal 16dp, top 8dp |
| Navigation | Item minimum 72dp plus 8dp total vertical padding = 80dp visible bar before bottom inset |
| Clearance | Bar plus max(bottom inset, 8dp), then composer gap 12dp; zero while positive-height soft keyboard is visible |

Navigation sizing is shared by Android Chat, Bible, and Notes. The chat palette is applied to the bar only while Chat is selected. Other screen bodies retain their established themes; global colors, reader ink, and Scripture fonts remain unchanged by this surface contract.

## Evidence and limits

The final implementation handoff reported:

- The native visual reviewer closed all P2 findings and returned ship for the scoped native fixture visuals, including the tested edge states.
- The QA entry [../../scripts/chat-home-qa-entry.tsx](../../scripts/chat-home-qa-entry.tsx) renders the actual header, welcome, composer, tab bar, and avatar with synthetic fixtures. It does not exercise live authenticated transport.
- UI-only TypeScript and all 165 scoped tests passed after the final source fixes. The two contrast tests are included in that total. Full mobile TypeScript still fails only at already-modified useSureWordChat.ts line 493 (expected one argument, got two) and line 866 (stale_thread outside the accepted union). This is not a full mobile-green result.
- Native compilation passed in the isolated C:/Users/Owner/Documents/SureWordQA/chat-home-20261012 source copy with JDK 21.

The tested native fixture states passed:

- **Keyboard and edited question:** the full edited question and Send remain above the IME.
- **Question selection and Stop:** tapping a tile preserves its exact fixture question; Stop settles the generation state.
- **Question reveal and menu:** all six fixture questions are reachable; all three menu choices are visible.
- **130% text:** the rounded breakpoint produces full-width single-column tiles. Recorded screen-pixel bounds are [48,1238][1122,1610] for a tile and [48,1966][1122,2110] for the scrolled reveal action.
- **Light appearance:** the separate transparent sanctuary layer fills its 344dp container at 0.18 opacity without a gray seam.
- **Motion and active poses:** motion-proof.json records avatar region [315,926,855,1574], with 0 changed pixels under Reduce Motion and 83,289 with motion enabled. The 6.9-second cropped native recording demonstrates upward reaching followed by both-arm praise.

No tested fixture-state checks remain pending. Screen-reader and foreground guards remain documented from source inspection. The documentation refresh inspected source, provenance, result JSON, and captures; it did not run new tests.

Live authenticated AI transport, physical-device performance, release delivery, and the full source TypeScript gate remain outside this evidence. There is no release, production deployment, store upload, physical-phone installation, web redesign, Apple redesign, or app-wide visual approval in this record. Native fixture captures and the recording prove the reviewed presentation and interactions only.
