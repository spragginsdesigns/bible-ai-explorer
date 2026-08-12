#!/usr/bin/env python3
"""Compose the SureWord DMG installer background.

    uv run --with pillow python scripts/make-dmg-background.py <backdrop.png> <outdir>

Takes the AI-generated atmosphere plate (macos/dmg/backdrop-raw.png — a dark
golden-dawn glow, no text or objects) and composites the crisp brand layer on
top: the day-star mark keyed off its black tile, the Pirata One wordmark, the
2 Peter 1:19 tagline in Cormorant, the drag arrow between the two icon
positions, and the first-launch hint. Text and arrow are drawn in code, not
generated, so they stay pixel-perfect.

Everything is drawn at 2x (1320x840 for a 660x420 window) and emitted as both
background@2x.png and a 1x background.png; scripts/build-dmg.sh folds them into
a single HiDPI TIFF with tiffutil.

Icon geometry must match build-dmg.sh: app icon at (165,235), Applications
link at (495,235), 128pt icons.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent

W, H = 1320, 840  # 2x pixels for a 660x420 Finder window

GOLD = (251, 191, 36)         # theme accent #FBBF24
GOLD_SOFT = (232, 180, 74)    # logo gold #E8B44A
MUTED = (163, 163, 163)       # theme textMuted #A3A3A3

FONTS = ROOT / "macos" / "SureWord" / "Resources" / "Fonts"
MARK = ROOT / "mobile" / "assets" / "icon.png"  # full-res master, gold on #0a0a0a


def keyed_mark(size: int) -> Image.Image:
    """The day-star mark with its near-black tile keyed to transparency."""
    img = Image.open(MARK).convert("RGB").resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size))
    src, dst = img.load(), out.load()
    for y in range(size):
        for x in range(size):
            r, g, b = src[x, y]
            a = max(0, min(255, (max(r, g, b) - 18) * 3))
            dst[x, y] = (r, g, b, a)
    return out


def bezier(p0, p1, p2, steps=120):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        )


def draw_arrow(layer: ImageDraw.ImageDraw):
    """Tapered arc from the app icon toward Applications, with an arrowhead."""
    p0, p1, p2 = (452, 508), (660, 448), (852, 508)
    pts = list(bezier(p0, p1, p2))
    n = len(pts)
    for i, (x, y) in enumerate(pts[:-8]):
        r = 2.2 + 2.6 * (i / n)  # taper thicker toward the head
        layer.ellipse([x - r, y - r, x + r, y + r], fill=(*GOLD, 200))
    # Arrowhead aligned to the end tangent.
    hx, hy = pts[-1]
    tx, ty = pts[-1][0] - pts[-12][0], pts[-1][1] - pts[-12][1]
    mag = (tx * tx + ty * ty) ** 0.5
    ux, uy = tx / mag, ty / mag
    px, py = -uy, ux
    tip = (hx + ux * 26, hy + uy * 26)
    left = (hx + px * 15, hy + py * 15)
    right = (hx - px * 15, hy - py * 15)
    layer.polygon([tip, left, right], fill=(*GOLD, 220))


def centered(draw, y, text, font, fill, tracking=0):
    if tracking:
        widths = [draw.textlength(c, font=font) + tracking for c in text]
        total = sum(widths) - tracking
        x = (W - total) / 2
        for c, w in zip(text, widths):
            draw.text((x, y), c, font=font, fill=fill)
            x += w
    else:
        w = draw.textlength(text, font=font)
        draw.text(((W - w) / 2, y), text, font=font, fill=fill)


def main() -> int:
    backdrop_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "macos" / "dmg" / "backdrop-raw.png"
    outdir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "macos" / "dmg"
    outdir.mkdir(parents=True, exist_ok=True)

    # Scale the 1536x1024 plate to width, keep the glow at the bottom edge.
    plate = Image.open(backdrop_path).convert("RGB")
    scale_h = round(plate.height * W / plate.width)
    plate = plate.resize((W, scale_h), Image.LANCZOS)
    canvas = plate.crop((0, scale_h - H, W, scale_h)).convert("RGBA")

    # Light pools under the two icon labels: Finder draws icon-view labels in
    # BLACK whenever a background picture is set (it never adapts to dark
    # art), so the label zones need enough warm light to read black text.
    pools = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pools)
    for cx in (330, 990):  # icon centers at 2x — keep in sync with build-dmg.sh
        pdraw.ellipse([cx - 190, 596, cx + 190, 706], fill=(214, 164, 76, 150))
    canvas.alpha_composite(pools.filter(ImageFilter.GaussianBlur(34)))

    # Glow pass behind the crisp marks so they sit in the scene.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    draw_arrow(gdraw)
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(8)))

    crisp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(crisp)

    pirata = ImageFont.truetype(str(FONTS / "PirataOne-Regular.ttf"), 92)
    tagline = ImageFont.truetype(str(FONTS / "CormorantGaramond-MediumItalic.ttf"), 34)
    caps = ImageFont.truetype(str(FONTS / "CormorantGaramond-Medium.ttf"), 20)
    hint = ImageFont.truetype(str(FONTS / "CormorantGaramond-Medium.ttf"), 27)

    mark = keyed_mark(96)
    crisp.alpha_composite(mark, ((W - 96) // 2, 34))
    centered(draw, 122, "SureWord", pirata, (*GOLD, 255))
    centered(draw, 244, "“until the day dawn, and the day star arise in your hearts”",
             tagline, (*GOLD_SOFT, 225))
    centered(draw, 292, "2 PETER 1:19", caps, (*MUTED, 195), tracking=7)

    draw_arrow(draw)

    # macOS 15 removed the right-click→Open bypass for unnotarized apps; the
    # only path is Privacy & Security → Open Anyway, so say exactly that.
    centered(draw, 776, "First launch: allow SureWord in System Settings → Privacy & Security",
             hint, (*MUTED, 210))

    canvas.alpha_composite(crisp)
    final = canvas.convert("RGB")
    final.save(outdir / "background@2x.png", "PNG", optimize=True)
    final.resize((W // 2, H // 2), Image.LANCZOS).save(outdir / "background.png", "PNG", optimize=True)
    print(f"wrote {outdir}/background.png + background@2x.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
