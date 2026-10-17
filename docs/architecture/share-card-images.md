# How share card images are made

Every share card SureWord produces (a verse, Pick Up Your Cross, an answer, a
Send a word card) is drawn by code on the server. No image model runs when a
card is made, and the same request always produces the same picture. This page
is the internal guide to that pipeline: where each piece comes from, how a card
is drawn, and how to change the look safely. The product behavior (routes,
privacy rules, Send a word) is in `docs/FEATURES.md` under "Share cards".

## AI or code?

| Part of a card | Made by | When |
|---|---|---|
| Layout, type, sizing, the picture itself | Code (`src/lib/share-cards/render.tsx`) | Every time a card is requested |
| Background art (Dawn, Parchment, Sanctuary) | AI image generation, once, then cropped by ImageMagick | Ahead of time; the files are committed |
| Day-star mark | The logo pipeline (`scripts/generate-logo.mjs`, `gpt-image-2`), once | Ahead of time; committed |
| Scripture | The bundled KJV/BSB/NKJV text, looked up by reference | Every card |
| Encouragement line under a verse | AI (house model), once per passage, stored in `VerseEncouragement` | First time a signed-in reader asks for it; reused by everyone after |
| Send a word message | AI, on the sender's account, per draft | When the sender drafts the card |
| Sender's line and name | The sender | Typed in the sheet |

So the art was made with AI once, before any card existed, and the words on a
few card types are written by AI. Drawing is entirely programmatic.

## The pipeline

```
client asks for a card URL
  -> route checks the request, loads the words (Scripture by reference, or a saved record)
  -> layout.ts fits every block of text with real glyph widths (glyph-widths.ts)
  -> render.tsx builds a React tree: background JPEG + mark + text layers
  -> next/og (satori + resvg) turns the tree into a PNG
  -> sharp re-encodes it as JPEG (quality 90, 4:4:4 chroma; preview 540 px at quality 80)
  -> CDN or client caches it; the client shares the JPEG file
```

### 1. The request

All cards come from `renderShareCard(content, { style, format, size, cacheControl })`
in `src/lib/share-cards/render.tsx`. Each route builds a `ShareCardContent` (a
verse, a cross day, an answer or a personal card, typed in `layout.ts`) and
passes it in.

| Route | Who can call it | Draws | Cache-Control |
|---|---|---|---|
| `GET /api/cards/verse` | Anyone | Scripture looked up by reference, plus the stored encouragement line when `note=1` | `public, max-age=86400, s-maxage=31536000, immutable` |
| `GET /api/cards/cross/{id}` | The owner only | The day's verse, the date in the device's zone, "Carry this" | `private, max-age=3600` (it carries today's date) |
| `GET /api/shared/{id}/image` | Anyone with the answer link | The opening of a shared answer | `public, max-age=0, s-maxage=300, must-revalidate` (`SHARED_CARD_CACHE_CONTROL`) |
| `GET /api/cards/personal/{id}/image` | The owner only | An unsent Send a word draft | `private, no-store` |
| `GET /api/cards/c/{id}/image` | Anyone with the card link | A sent Send a word card | `SHARED_CARD_CACHE_CONTROL` |

The public verse route never draws text the caller sends, only Scripture it
looked up itself, so nobody can make a SureWord-branded image say something
else. Every card has one canonical URL; any other spelling is redirected to it
before anything is drawn, so random query strings cannot force renders.

### 2. Fitting the text

Satori cannot say how tall text came out, so the layout never asks it to. Before
drawing, `fitText` in `src/lib/share-cards/layout.ts` wraps each block itself
using the advance width of every glyph in the card fonts
(`src/lib/share-cards/glyph-widths.ts`), then picks the largest size on a ladder
whose wrapped height fits its share of the card. "Jesus wept." sets at 112 px;
Esther 8:9, the longest verse, at 52 px. `plan()` in `render.tsx` runs that for
every block (body, reference, encouragement or word, the sender's line, the
question, the headline) and reports whether anything was truncated.

Scripture is never clipped: a verse card that cannot hold its passage throws
`CardTooLongError`, and the route answers 422. `cardFitsEverySize(content)`
runs the plan at all three sizes in all three styles; Send a word uses it to
size the AI's message and to hold Share until the sender's own words fit.

### 3. Drawing

`renderPng` builds one absolutely positioned React tree at the card's exact
pixel size: the style's background JPEG, a soft lift behind text on the
photographic style, the mark, the eyebrow, the text blocks at their fitted
sizes, and the footer (wordmark and the `sureword.app/v/<slug>` door link).
Colors per style live in `PALETTES`, positions and type ladders per size in
`GEOMETRY`. `next/og`'s `ImageResponse` renders it to a PNG.

### 4. Encoding

A PNG of a painting is 2 to 4 MB, too heavy to send in a chat. `sharp`
re-encodes it with mozjpeg at quality 90 and 4:4:4 chroma (so thin gold type
stays crisp) to roughly 300 to 700 KB. `size=preview` resizes to 540 px wide at
quality 80 (about 60 KB) for the sheet's live preview.

### 5. On the clients

The share sheets show the preview, then download the full JPEG and hand the
file to the platform:

- Android: `mobile/src/features/shareCards/shareCardFiles.ts` downloads with
  `File.downloadFileAsync` and shares through `expo-sharing` (React Native's
  `Share` cannot send a file on Android).
- Web: `src/components/share/ShareCardDialog.tsx` uses `navigator.share({ files })`
  where the browser supports it and downloads the image where it does not.
- macOS and iOS: `macos/Shared/Share/ShareCardSheet.swift`, the system share
  sheet (`UIActivityViewController` on iOS, since the file only exists after
  the download).

The URL builders (`shareCardPath`, `personalCardPath`, `personalPreviewPath`)
live in the client module shared byte for byte between
`src/lib/share-cards/targets.ts` and `mobile/src/features/shareCards/shareCards.ts`.

## The assets

Everything the renderer reads is in `src/assets/share-cards/` and is bundled
into the card routes by `outputFileTracingIncludes` in `next.config.mjs`. If you
add a route that draws a card, add it there too, or the deployed function will
not find its fonts.

### Backgrounds

Each style has a pre-cropped JPEG per size (`<style>-<format>.jpg`), so the
renderer never resizes art at request time. They are cut from art the app
already ships:

- **Dawn** from `public/splash/sureword-dawn.webp`, the launch splash (generated
  with an image model for the splash; see `docs/sureword-splash.md`).
- **Parchment** from `public/textures/parchment-light.webp`, the reader's light
  parchment (`scripts/generate-parchment.mjs`, `gpt-image-2`).
- **Sanctuary** from `public/textures/parchment-dark.webp`, the reader's dark
  leather parchment, from the same script.

The exact commands (ImageMagick 7, run from the repo root; re-running them
reproduces all nine committed files byte for byte, checked 2026-10-17):

```bash
D=src/assets/share-cards
magick public/splash/sureword-dawn.webp -resize x1920 -gravity center -crop 1080x1920+0+0 +repage -quality 84 $D/dawn-story.jpg
magick public/splash/sureword-dawn.webp -resize 1080x -gravity north -crop 1080x1080+0+250 +repage -quality 84 $D/dawn-square.jpg
magick public/splash/sureword-dawn.webp -resize 1200x -gravity north -crop 1200x630+0+380 +repage -quality 84 $D/dawn-wide.jpg
for f in story:x1920:1080x1920 square:1080x:1080x1080 wide:1200x:1200x630; do
  IFS=: read fmt size crop <<<"$f"
  magick public/textures/parchment-light.webp -resize $size -gravity center -crop $crop+0+0 +repage -quality 84 $D/parchment-$fmt.jpg
  magick public/textures/parchment-dark.webp  -resize $size -gravity center -crop $crop+0+0 +repage -quality 84 $D/sanctuary-$fmt.jpg
done
```

Dawn's square and wide crops are anchored to the top (`-gravity north` plus an
offset) so the sun and hills sit where the text bands expect them.

### The mark

`mark.png` is the gold day-star from the brand master
(`public/chat-home/sureword-mark.png`, made by `scripts/generate-logo.mjs` and
`scripts/apply-logo.py`), a 356x360 PNG with transparency. On Sanctuary it is
the hero image and steps aside when a long passage needs the room.

### Fonts

| File | Used for |
|---|---|
| `CormorantGaramond_500Medium.ttf`, `_500Medium_Italic.ttf`, `_600SemiBold.ttf` | Scripture, references, the word |
| `AtkinsonHyperlegible_400Regular.ttf`, `_700Bold.ttf` | Labels, questions, answers, the footer |
| `PirataOne_400Regular.ttf` | The SureWord wordmark |

All three families are OFL (`docs/licenses/`). Satori needs TTF/OTF, not WOFF2.
Cormorant is subset to Latin (667 KB down to 50 KB) with:

```bash
python -m fontTools.subset "$f" --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02BC,U+02C6,U+02DA,U+02DC,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2039-203A,U+2122,U+2190-2193,U+271D,U+2726" --layout-features='kern,liga,onum,lnum' --output-file="$f.sub" && mv "$f.sub" "$f"
```

### Glyph widths

`glyph-widths.ts` is generated, never edited by hand:

```bash
python scripts/generate-card-glyph-widths.py   # needs: pip install fonttools
```

It reads each card font's `hmtx` table and writes every glyph's advance width in
em, plus a fallback (the average lowercase letter) for anything missing. Run it
whenever a font file changes; a stale table makes the layout wrap at the wrong
width, and nothing else will warn you. Run against the committed fonts, it
reproduces the committed file byte for byte.

## Changing how cards look

1. **Edit the design** in `render.tsx`: colors in `PALETTES`, positions and
   type ladders in `GEOMETRY`, block shares in `measure()`. New art goes in
   `src/assets/share-cards/` at all three sizes.
2. **Look at it.** With `pnpm dev` running, open a public card in the browser,
   for example
   `http://localhost:3000/api/cards/verse?ref=John%203:16&style=dawn&format=story`
   (it redirects to the canonical URL and draws). Check a short verse, a long
   one (Esther 8:9) and a range (Philippians 4:6-7) in every style and size.
3. **Run the fit test.** `pnpm test:logic` includes
   `tests/share-card-fit.test.mjs`, which runs the real layout at the Send a
   word limits (200 character word, 120 character line, 30 character name)
   beside Philippians 4:6-7 in every size and style. If a design change makes
   text stop fitting, it fails here. `tests/share-cards.test.mjs` pins the
   fitter, route contracts and the shared client module.
4. **Bump `SHARE_CARD_DESIGN_VERSION`** in both `src/lib/share-cards/layout.ts`
   and the shared client module (`targets.ts` and its mobile copy; the test
   checks they match). Verse cards are cached for a year as `immutable`, so
   without a new version in the URL, everyone keeps seeing the old design. Old
   `v` values redirect to the new one.
5. **Ship** with a normal push to `main`. The cards are drawn on the server, so
   a design change reaches Android, web, macOS and iOS in one deploy, with no
   app release.

Adding a style also means adding it to `SHARE_CARD_STYLES` in `layout.ts` and in
the shared client module (label and swatch colors for the chips), plus its
three background JPEGs.

## Satori limits to remember

- It cannot report text height, which is why the layout measures everything
  itself.
- It cannot change font size inside one line, so verse numbers in a range are
  real superscript glyphs, not smaller digits.
- Decorative fleurons render as emoji, so Parchment's ornaments are drawn with
  divs.
- Every element with more than one child needs `display: flex`.
