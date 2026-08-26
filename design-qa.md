# Android UI design QA

## Source truth

- Bottom navigation failure: `.codex-remote-attachments/019ff287-ec2c-7180-b843-c1a8cf01d1f4/2f3f2f94-6af4-4e91-835d-e65c2b0b378e/1-Photo-1.jpg`
- Stock attachment alert failure: `.codex-remote-attachments/019ff287-ec2c-7180-b843-c1a8cf01d1f4/67d7289b-6c68-4a31-8b74-99417f7023a4/1-Photo-1.jpg`
- Accepted SureWord attachment sheet: `.codex-remote-attachments/019ff287-ec2c-7180-b843-c1a8cf01d1f4/46c5121b-c828-44ac-958a-f4f9341bd2f0/1-Photo-1.jpg`
- NKJV inline-markup failure: `.codex-remote-attachments/019ff287-ec2c-7180-b843-c1a8cf01d1f4/46c5121b-c828-44ac-958a-f4f9341bd2f0/2-Photo-2.jpg`

## Implementation evidence

- Physical Android screenshot: `.vercel/proof/bible-inline-italics-fixed-device.png`
- Viewport: 1080 x 2340, dark appearance, NKJV, 1 Peter 1.
- UI tree: verse 3 exposes `Blessed be the God...` with no raw markup; the
  rendered screenshot shows only `be` in Cormorant Garamond italic.
- Navigation: the same screenshot and UI tree show only Chat, Bible, and Notes,
  with Bible selected.
- Attachment sheet: the accepted device screenshot shows the branded dark
  bottom sheet with camera, photo library, file, and clipboard sources.

## Diff history

1. Failed: route discovery rendered push-only Settings and Memories entries in
   the custom tab bar.
2. Fixed: the tab bar now uses an explicit three-route allowlist and matching
   Ionicons.
3. Failed: attachment selection used a stock Android Material alert.
4. Fixed: source selection now uses SureWord's existing dark bottom-sheet
   primitive and tokens.
5. Failed: the NKJV provider's `<i>be</i>` markup rendered literally.
6. Fixed: supported emphasis is parsed into safe native text spans, while
   downstream plain-text actions receive tag-free text.

## Result

The physical-device comparison matches the requested dark SureWord treatment,
the reported formatting defect is absent, and the user confirmed the fix.

final result: passed

---

# SureWord welcome redesign QA

## Source truth

- Selected concept: `/Users/spragginsdesigns/.codex/generated_images/01a03c39-aaa1-78c3-8c30-0bc364cc3878/exec-3bea1e53-9c1e-48cc-a702-1420d457eded.png`
- Android implementation capture: `/tmp/sureword-welcome-preview-dark-9s.png`
- Normalized side-by-side comparison: `/Users/spragginsdesigns/.codex/visualizations/2026/08/26/01a03c39-aaa1-78c3-8c30-0bc364cc3878/sureword-design-qa-side-by-side.png`
- Viewport: 1080 x 2400 Pixel 7 API 36, dark appearance.

## Axes

- Layout: passed. Header, stained-glass hero, illuminated verse, prominent
  composer, question hierarchy, and three-tab dock follow the selected concept.
- Visual: passed. Black, sapphire, burgundy, antique gold, parchment type, and
  restrained borders preserve the Living Manuscript plus Cathedral Light direction.
- Interaction: passed. UI automation exposed all five preview question buttons;
  selecting the featured question moved it into the real chat flow.
- Content: passed. The implementation consumes `useSuggestedQuestions()`, promotes
  the first returned question, and maps every remaining returned question in order.
- Accessibility: passed. Question rows expose their complete question as button
  labels; icon-only header and composer controls retain explicit labels.
- Responsive fit: passed at 1080 x 2400 in both dark and light system appearance.
  Real generated prompts are intentionally allowed to wrap instead of being
  shortened to match the compact concept copy.

## Verification boundary

The visual capture used a temporary local preview array because the clean emulator
had no Clerk session. That preview-only instrumentation was reverted. The production
API mapping is covered by source inspection and the unit test that preserves every
generated question in its original order; an authenticated live API response was not
exercised on this emulator.

final result: passed
