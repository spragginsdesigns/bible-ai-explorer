#!/usr/bin/env python3
"""Turn one square logo master into every icon Android and web need.

    python scripts/apply-logo.py .logo-work/dawn.png

Doing this by hand is how icon sets drift - the web favicon ends up a release
behind the launcher icon, and nobody notices because both "look right" in
isolation. One master in, every asset out, every time.

Companion to scripts/generate-logo.mjs, which produces the master.
"""
from __future__ import annotations

import sys
import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# The app shell's background. The generated masters sit on pure black, which is
# a hair off this, so backgrounds get normalised to it below - otherwise the
# adaptive icon shows a faint seam where the artwork meets the padded canvas.
BG = (10, 10, 10)

# Anything this dark is background, not artwork. Gold (#E8B44A) is far above it,
# so only true black and its antialiased fringe get rewritten.
DARK_THRESHOLD = 40

# Android masks adaptive icons to a circle/squircle and only the middle ~66% is
# guaranteed visible, so the mark is inset rather than full-bleed.
ADAPTIVE_SAFE_FRACTION = 0.66

WEB = ROOT / "public"
MOBILE = ROOT / "mobile" / "assets"


def normalise_background(img: Image.Image) -> Image.Image:
    """Repaint the near-black background to exactly BG, leaving the gold alone."""
    img = img.convert("RGB")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(r, g, b) < DARK_THRESHOLD:
                px[x, y] = BG
    return img


def square(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def inset(img: Image.Image, size: int, fraction: float) -> Image.Image:
    """Centre the artwork at `fraction` of `size` on a BG canvas."""
    canvas = Image.new("RGB", (size, size), BG)
    inner = max(1, int(size * fraction))
    offset = (size - inner) // 2
    canvas.paste(img.resize((inner, inner), Image.LANCZOS), (offset, offset))
    return canvas


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} <master.png>", file=sys.stderr)
        return 1

    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        print(f"master not found: {src}", file=sys.stderr)
        return 1

    master = normalise_background(Image.open(src))
    if master.width != master.height:
        print(f"warning: master is {master.width}x{master.height}, not square", file=sys.stderr)

    written: list[tuple[Path, str]] = []

    # --- web ---------------------------------------------------------------
    for name, size in [
        ("web-app-manifest-512x512.png", 512),
        ("web-app-manifest-192x192.png", 192),
        ("apple-touch-icon.png", 180),
        ("favicon-96x96.png", 96),
    ]:
        out = WEB / name
        square(master, size).save(out, "PNG", optimize=True)
        written.append((out, f"{size}x{size}"))

    # Multi-resolution .ico so Windows/older browsers pick a sane size.
    ico = WEB / "favicon.ico"
    square(master, 256).save(ico, "ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    written.append((ico, "16/32/48/64"))

    # The layout advertises an SVG favicon. Tracing the raster to real paths is
    # out of scope, but an SVG wrapping the PNG is valid and honours the
    # declared type, so the <link> keeps working instead of 404-ing the old mark.
    png_512 = (WEB / "web-app-manifest-512x512.png").read_bytes()
    data_uri = "data:image/png;base64," + base64.b64encode(png_512).decode("ascii")
    svg = WEB / "favicon.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        f'<image width="512" height="512" href="{data_uri}"/>'
        "</svg>",
        encoding="utf-8",
    )
    written.append((svg, "512x512 (embedded)"))

    # --- android -----------------------------------------------------------
    icon = MOBILE / "icon.png"
    square(master, 1024).save(icon, "PNG", optimize=True)
    written.append((icon, "1024x1024"))

    adaptive = MOBILE / "adaptive-icon.png"
    inset(master, 1024, ADAPTIVE_SAFE_FRACTION).save(adaptive, "PNG", optimize=True)
    written.append((adaptive, f"1024x1024 (inset {int(ADAPTIVE_SAFE_FRACTION * 100)}%)"))

    # --- proof sheet -------------------------------------------------------
    # Renders the launcher-size icon so small-size legibility is something you
    # look at rather than assume.
    preview = ROOT / ".logo-work" / "preview-48.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    square(master, 48).resize((384, 384), Image.NEAREST).save(preview, "PNG")

    for path, note in written:
        print(f"  {path.relative_to(ROOT)}  ({note})")
    print(f"\n  {preview.relative_to(ROOT)}  (48px launcher check, upscaled)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
