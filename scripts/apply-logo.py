#!/usr/bin/env python3
"""Turn one square logo master into every icon Android, web and macOS need.

    python scripts/apply-logo.py .logo-work/dawn.png
    python scripts/apply-logo.py mobile/assets/icon.png --only macos

Doing this by hand is how icon sets drift - the web favicon ends up a release
behind the launcher icon, and nobody notices because both "look right" in
isolation. One master in, every asset out, every time.

`--only web|android|macos` limits the emission to one client - useful when the
master is gone (it is gitignored) and `mobile/assets/icon.png` stands in for it:
that file IS the master at full resolution, but re-running the other sections
from it would churn bytes in assets that are already correct.

Companion to scripts/generate-logo.mjs, which produces the master.
"""
from __future__ import annotations

import sys
import base64
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

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
MACOS_ICONSET = ROOT / "macos" / "SureWord" / "Assets.xcassets" / "AppIcon.appiconset"

# Apple's macOS icon grid: on a 1024 canvas the icon body is an 824px rounded
# rectangle (radius ~185) centred with 100px transparent margins, and the dock
# shadow is baked into the artwork rather than added by the system.
MACOS_BODY = 824
MACOS_RADIUS = 185
MACOS_SHADOW_ALPHA = 115
MACOS_SHADOW_OFFSET_Y = 10
MACOS_SHADOW_BLUR = 12

# (point size, scale) pairs Xcode requires for a mac appiconset.
MACOS_SIZES = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
               (256, 1), (256, 2), (512, 1), (512, 2)]


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


def macos_icon(master: Image.Image) -> Image.Image:
    """Compose the Apple-grid icon: rounded rect + baked soft shadow, at 1024."""
    size = 1024
    offset = (size - MACOS_BODY) // 2

    art = master.resize((MACOS_BODY, MACOS_BODY), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (MACOS_BODY, MACOS_BODY), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, MACOS_BODY - 1, MACOS_BODY - 1], radius=MACOS_RADIUS, fill=255
    )

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate = Image.new("RGBA", (MACOS_BODY, MACOS_BODY), (0, 0, 0, MACOS_SHADOW_ALPHA))
    shadow.paste(plate, (offset, offset + MACOS_SHADOW_OFFSET_Y), mask)
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(MACOS_SHADOW_BLUR)))
    canvas.paste(art, (offset, offset), mask)
    return canvas


def main() -> int:
    args = sys.argv[1:]
    only: str | None = None
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1] if i + 1 < len(args) else ""
        del args[i:i + 2]
    if len(args) != 1 or only not in (None, "web", "android", "macos"):
        print(f"usage: {Path(sys.argv[0]).name} <master.png> [--only web|android|macos]",
              file=sys.stderr)
        return 1

    src = Path(args[0])
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
    if only in (None, "web"):
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
    if only in (None, "android"):
        icon = MOBILE / "icon.png"
        square(master, 1024).save(icon, "PNG", optimize=True)
        written.append((icon, "1024x1024"))

        adaptive = MOBILE / "adaptive-icon.png"
        inset(master, 1024, ADAPTIVE_SAFE_FRACTION).save(adaptive, "PNG", optimize=True)
        written.append((adaptive, f"1024x1024 (inset {int(ADAPTIVE_SAFE_FRACTION * 100)}%)"))

    # --- macos -------------------------------------------------------------
    if only in (None, "macos"):
        MACOS_ICONSET.mkdir(parents=True, exist_ok=True)
        composed = macos_icon(master)
        images = []
        for points, scale in MACOS_SIZES:
            px = points * scale
            name = f"icon_{points}x{points}" + (f"@{scale}x" if scale > 1 else "") + ".png"
            out = MACOS_ICONSET / name
            composed.resize((px, px), Image.LANCZOS).save(out, "PNG", optimize=True)
            images.append({
                "filename": name,
                "idiom": "mac",
                "scale": f"{scale}x",
                "size": f"{points}x{points}",
            })
            written.append((out, f"{px}x{px}"))
        contents = MACOS_ICONSET / "Contents.json"
        contents.write_text(
            json.dumps({"images": images, "info": {"author": "xcode", "version": 1}},
                       indent=2) + "\n",
            encoding="utf-8",
        )
        written.append((contents, "manifest"))

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
