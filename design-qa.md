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
