> Historical Android design evidence from the local fixture pass on 2026-10-12. Austin subsequently authorized cross-platform release. Current integration and delivery evidence is tracked in `../docs/sureword-chat-home-release-2026-10-12.md`. Earlier no-release and Android-only statements describe the earlier design checkpoint.

---
name: SureWord Android chat
description: Implemented charcoal, ivory, and gold chat surface approved on 2026-10-12
colors:
  charcoal-bg: "#0d100d"
  charcoal-elevated: "#141713"
  charcoal-surface: "#1b201b"
  charcoal-composer: "#1d211b"
  charcoal-pressed: "#2b3027"
  gold-border: "rgba(229, 182, 100, 0.12)"
  gold-border-strong: "rgba(229, 182, 100, 0.20)"
  ivory: "#f6eedd"
  soft-ivory: "#eee7dc"
  warm-stone: "#bbb3a7"
  muted-stone: "#afa79a"
  dim-stone: "#aaa295"
  honey-gold: "#e5b664"
  aged-gold: "#d5b479"
  gold-wash: "rgba(229, 182, 100, 0.08)"
  gold-outline: "rgba(229, 182, 100, 0.28)"
  gold-pressed: "rgba(229, 182, 100, 0.14)"
  parchment-bg: "#f6f2e9"
  warm-paper: "#faf8f2"
  pale-parchment: "#eeeade"
  ivory-composer: "#fffdf7"
  pressed-parchment: "#e3dece"
  deep-olive: "#26322c"
  olive-ink: "#334239"
  olive-muted: "#5f6658"
  olive-faint: "#626658"
  bronze: "#79561f"
  bronze-wash: "rgba(121, 86, 31, 0.07)"
  bronze-outline: "rgba(121, 86, 31, 0.22)"
  bronze-pressed: "rgba(121, 86, 31, 0.12)"
typography:
  display:
    fontFamily: "PirataOne_400Regular"
    fontSize: "27px"
    lineHeight: "34px"
  headline:
    fontFamily: "AtkinsonHyperlegible_700Bold"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "33px"
  body:
    fontFamily: "AtkinsonHyperlegible_400Regular"
    fontSize: "16px"
    lineHeight: "22px"
  label:
    fontFamily: "AtkinsonHyperlegible_700Bold"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "18px"
    letterSpacing: "1.7px"
  micro:
    fontFamily: "AtkinsonHyperlegible_400Regular"
    fontSize: "12px"
    lineHeight: "16px"
  support:
    fontFamily: "AtkinsonHyperlegible_400Regular"
    fontSize: "14px"
    lineHeight: "20px"
  support-bold:
    fontFamily: "AtkinsonHyperlegible_700Bold"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: "20px"
  chip:
    fontFamily: "AtkinsonHyperlegible_700Bold"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
rounded:
  md: "12px"
  lg: "16px"
  composer: "24px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  grid-gap: "10px"
  tile-padding: "14px"
components:
  button-send:
    backgroundColor: "{colors.honey-gold}"
    textColor: "{colors.charcoal-bg}"
    rounded: "{rounded.full}"
    width: "48px"
    height: "48px"
  button-attachment:
    backgroundColor: "{colors.charcoal-surface}"
    textColor: "{colors.soft-ivory}"
    rounded: "{rounded.full}"
    width: "48px"
    height: "48px"
  composer:
    backgroundColor: "{colors.charcoal-composer}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: "8px 8px 8px 10px"
  question-tile:
    backgroundColor: "{colors.charcoal-surface}"
    textColor: "{colors.ivory}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "14px"
  reference-chip:
    backgroundColor: "{colors.charcoal-surface}"
    textColor: "{colors.honey-gold}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    padding: "4px 8px 4px 12px"
  navigation:
    backgroundColor: "{colors.charcoal-elevated}"
    typography: "{typography.support}"
    padding: "4px 8px"
---

# Design System: SureWord Android chat

## Overview

**Creative North Star: "Approved companion and question grid"**

The Android chat home uses warm charcoal, ivory text, restrained gold, and a friendly folded-page companion. The open-Bible day-star mark and Pirata One wordmark preserve SureWord's recognizable identity; readable Atkinson Hyperlegible carries questions and controls.

This record applies to the approved chat surface and its shared navigation geometry. It does not replace the existing visual system for Bible, Notes, Settings, web, or Apple clients. Global palettes, Scripture typography, and reader ink remain defined by src/theme/index.ts.

The approved composition and current evidence live in [.impeccable/surfaces/chat-home.md](.impeccable/surfaces/chat-home.md). Tokens in the frontmatter are normative. Its portable px strings serialize React Native logical dimensions; native spacing uses dp and text follows system font scaling.

**Key Characteristics:**

- Friendly parchment companion with an unchanged face, folds, and chest day-star.
- Quiet tonal surfaces, restrained hairline gold borders, and readable body type.
- Responsive question grid above a stable docked composer.

## Colors

The palette pairs warm olive charcoal and ivory with honey gold; light appearance uses parchment and readable bronze. Exact source-role mappings are in the sidecar.

### Primary

- **Honey gold and aged gold:** question references, action glyphs, the header mark, and the selected Chat tab. Solid gold identifies Send.
- **Gold wash, outline, and pressed gold:** restrained state and border treatments.
- **Readable bronze and its washes:** the corresponding accents in light chat appearance.

### Neutral

- **Warm charcoal, elevated charcoal, and olive charcoal surface:** screen, navigation, and question surfaces.
- **Composer charcoal and pressed charcoal:** composer separation and press feedback.
- **Warm ivory, soft ivory, and stone tones:** question text, secondary glyphs, section labels, placeholders, and inactive navigation.
- **Parchment, warm paper, ivory composer, and olive inks:** the corresponding light chat surfaces and text.

**The Chat Boundary Rule.** Resolve the sanctuary palette through chatColors for chat. Preserve global theme colors and reader ink elsewhere.

## Typography

**Display Font:** Pirata One, bundled as PirataOne_400Regular.
**Body Font:** Atkinson Hyperlegible, with regular and bold faces resolved by AppText.

The header uses display (27/34); the welcome uses headline (28/33, 700). Question text and input use body (16/22). The uppercase section heading uses label (13/18, 700, tracking 1.7). References and the optional conversation subtitle use micro (12/16). Tab labels use support (14/20, 400); the more-questions action uses support-bold (14/20, 700). Verse-context pills use chip (13/18, declared weight 600 resolved by AppText to the bundled bold face). These are observed surface roles, not a replacement of the broader mobile type scale.

**The Reading First Rule.** Use Pirata One only for the SureWord wordmark; questions and controls retain the shared readable body family.

## Layout

Native measurements come from WelcomeState.tsx, ChatHeader.tsx, ChatInputBar.tsx, layout.ts, and app/(app)/_layout.tsx. The header has a minimum height of 56dp, 16dp horizontal padding, 4dp vertical padding, 8dp gaps, and 48dp action targets.

The hero centers a 190dp-wide companion in a 228dp-high image box. Its margins are -18dp above and below; the headline adds -8dp top margin, a 310dp maximum width, and 12dp horizontal padding. Hero bottom padding is 24dp. The absolute backdrop container is 344dp high, at 0.65 opacity in dark appearance and 0.18 in light. Its child image explicitly fills 100% width and height with a cover crop. Light appearance selects the separate RGBA sanctuary asset so the foliage blends into parchment without an opaque gray seam.

The study section uses 16dp horizontal padding. The default two-column grid has 10dp row and column gaps, 14dp tile padding, and a 124dp minimum tile height. It becomes one column below 350dp width or at a rounded font scale of 130% or greater, using Math.round(fontScale * 100) >= 130. Rounding includes Android's 130% setting when its reported float is 1.2999999523162842. The more-questions row has a 48dp minimum target height. Four questions are initially visible; additional questions remain available in order.

The composer wrapper has 16dp horizontal and 8dp top padding. Its bottom padding is useTabBarSpace() + 12dp. The visible navigation is 72dp minimum item height plus 8dp total vertical padding, or 80dp before the system bottom inset. The bar adds max(bottom inset, 8dp). A positive-height soft keyboard sets reserved tab space to zero; a zero-height hardware-keyboard event retains clearance. These dimensions apply to all Android primary tabs, while chat palette selection applies only when Chat is selected.

**The Shared Clearance Rule.** Derive reserved navigation space from TAB_BAR_HEIGHT and safe-area insets. Never substitute the item height for the whole bar.

## Elevation & Depth

Chat controls use solid tonal surfaces and hairline borders. The extracted header, tiles, composer, and navigation define no shadows. Depth comes from the raster foliage, companion materials, and tonal separation. All six generated assets in assets/chat-home have JSON provenance retaining prompts, references, original output paths, and transparency/export details. The light sanctuary layer retains genuine RGBA transparency instead of an opaque backing.

## Shapes

Question tiles and tab items use the shared large radius (16dp). The more-questions action and editing row use medium radius (12dp); the composer uses a 24dp radius. Attachment, Send, and verse-context controls use full rounding. The New chat target is 48dp with a 24dp radius, enclosing a 36dp circle with an 18dp radius. Borders use StyleSheet.hairlineWidth rather than a fixed 1dp stroke.

## Components

- **Question tile:** ivory text on the surface tone, a gold outline, wrapping question text, and a bottom reference/arrow row. Pressing uses the pressed surface. Missing reference labels reserve footer space without inventing text.
- **Composer:** strong surface tone, gold outline, 8dp padding with 10dp left inset, and 8dp gaps. The input grows from 48dp to a 140dp maximum height. Attachment and Send targets are 48dp; disabled targets use 0.5 opacity. Send changes to Stop while generating.
- **Header:** idle open-Bible mark, recognizable wordmark, New chat, and an options sheet for model selection, history, and settings. Thinking and answering replace the mark with a 44dp companion.
- **Navigation:** opaque shared bar, 24dp icons, 14/20 labels, and a 2dp-high gold selected-Chat underline spanning from 26% to 74% of its item. Non-chat tabs retain their existing theme treatment.
- **Companion:** idle has one gently raised page arm; thinking reaches upward prayerfully; answering raises both page arms in praise. guidePhase selects thinking until non-whitespace answer text arrives and returns idle when streaming ends. SureWordGuideAvatar supplies phase labels and pointerEvents="none".

**The Quiet Motion Rule.** Keep the selected pose readable when animation stops. Disable companion movement for Reduce Motion, a screen reader, or a backgrounded app.

Motion uses a native sinusoidal in/out loop, with half-cycle durations of 3200ms idle hero, 2200ms thinking, and 2600ms answering. Translation is at most 3dp for the hero and 1.2dp for message/header use. Thinking rotates from -2 to 1 degrees; other states use -1 to 1 degrees. Idle message avatars remain still.

Native fixture evidence measured 0 changed pixels with Reduce Motion and 83,289 with motion enabled in avatar region [315,926,855,1574]. The 6.9-second guide-motion.mp4 is cropped from a native screen recording and demonstrates reaching followed by praising. It proves pose presentation and motion in that fixture, not live answer delivery or physical-device performance. The surface brief links the result JSON, video, and extracted frames.

The sidecar contains browser panel translations of native primitives. Its hover and keyboard focus states are preview affordances, and its synthetic color ramps are swatch metadata. They add no Android implementation tokens or evidence.

## Do's and Don'ts

### Do:

- Do preserve the folded-page companion, open-Bible day-star mark, and SureWord wordmark.
- Do keep every suggested question in server order, reveal additional questions, and allow question text to wrap.
- Do keep chat palette changes scoped to chat and reserve the shared navigation height.

### Don't:

- Don't apply this chat palette to reader ink or treat the surface as an app-wide redesign.
- Don't hide model selection, conversation history, settings, attachment, send, or stop callbacks behind a visual replacement.
- Don't treat fixture screenshots or a scoped visual approval as authenticated transport, device, or release proof.

