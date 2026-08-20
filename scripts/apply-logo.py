#!/usr/bin/env python3
"""Turn one square logo master into every icon Android, web and macOS need.

    python scripts/apply-logo.py .logo-work/dawn.png
    python scripts/apply-logo.py mobile/assets/icon.png --only macos

Doing this by hand is how icon sets drift - the web favicon ends up a release
behind the launcher icon, and nobody notices because both "look right" in
isolation. One master in, every asset out, every time.

The master is treated as artwork-on-dark, not as the icon itself: the gold
mark is lifted off the background as an alpha layer and re-composed onto
purpose-built plates. Browser favicons get a circular badge (soft shadow,
radial-gradient disc, thin gold rim) because a raw dark square disappears
into a dark tab strip; launcher/manifest icons get a full-bleed gradient
plate with the mark held inside the maskable safe zone.

`--only web|android|macos` limits the emission to one client - useful when the
master is gone (it is gitignored) and `mobile/assets/icon.png` stands in for
it: the art extraction works off brightness, so a previously-emitted icon can
seed a re-run.

Companion to scripts/generate-logo.mjs, which produces the master.
"""
from __future__ import annotations

import sys
import base64
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent

# The app shell's background; also the outer edge of every icon plate.
BG = (10, 10, 10)
# Warm charcoal at the plate's centre - gives the icon depth instead of the
# flat "screenshot of a black square" look the raw master has.
BG_INNER = (38, 30, 18)

# The mark's gold, sampled from the master, plus the rim gradient's endpoints.
GOLD_LIGHT = (246, 208, 122)
GOLD_DARK = (188, 136, 52)

# Android launchers and PWA maskable icons only guarantee a centred circle of
# 80% of the canvas; a square mark inscribed in that circle caps out around
# 0.62 of the canvas edge.
MASKABLE_SAFE_FRACTION = 0.62

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


def art_layer(master: Image.Image) -> Image.Image:
    """Lift the gold mark off its dark background as RGBA, cropped to bounds.

    Alpha comes from brightness, so the antialiased fringe survives as partial
    coverage instead of dragging halos of near-black background along.
    """
    rgb = master.convert("RGB")
    lum = rgb.convert("L")
    alpha = lum.point(
        lambda v: 0 if v <= 24 else 255 if v >= 96 else int((v - 24) * 255 / 72)
    )
    art = rgb.copy()
    art.putalpha(alpha)

    solid = alpha.point(lambda v: 255 if v > 48 else 0)
    box = solid.getbbox()
    if box is None:
        raise SystemExit("no artwork found in master - is it all-dark?")
    pad = max(2, master.width // 100)
    l, t, r, b = box
    return art.crop((max(0, l - pad), max(0, t - pad),
                     min(master.width, r + pad), min(master.height, b + pad)))


def radial_plate(size: int) -> Image.Image:
    """BG_INNER -> BG radial gradient square, centre pulled above the middle
    so the light appears to come from where the day star sits."""
    small = 128
    grad = Image.new("L", (small, small))
    px = grad.load()
    cx, cy = small / 2, small * 0.40
    max_d = math.hypot(cx, small - cy)
    for y in range(small):
        for x in range(small):
            d = min(1.0, math.hypot(x - cx, y - cy) / max_d)
            px[x, y] = int(255 * d ** 1.3)
    grad = grad.resize((size, size), Image.BICUBIC)
    bands = [
        grad.point(lambda v, i=i: BG_INNER[i] + (BG[i] - BG_INNER[i]) * v // 255)
        for i in range(3)
    ]
    return Image.merge("RGB", bands)


def gold_gradient(size: int) -> Image.Image:
    """Vertical GOLD_LIGHT -> GOLD_DARK gradient, for the badge rim."""
    lin = Image.linear_gradient("L").resize((size, size), Image.BICUBIC)
    bands = [
        lin.point(lambda v, i=i: GOLD_LIGHT[i] + (GOLD_DARK[i] - GOLD_LIGHT[i]) * v // 255)
        for i in range(3)
    ]
    return Image.merge("RGB", bands)


def ellipse_mask(size: int, bbox: tuple[float, float, float, float],
                 width: float = 0) -> Image.Image:
    """Antialiased ellipse (or ring, when width > 0) mask, drawn at 4x."""
    ss = 4
    mask = Image.new("L", (size * ss, size * ss), 0)
    draw = ImageDraw.Draw(mask)
    box = [c * ss for c in bbox]
    if width > 0:
        draw.ellipse(box, outline=255, width=max(1, round(width * ss)))
    else:
        draw.ellipse(box, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def paste_fit(canvas: Image.Image, art: Image.Image, box: int, dy: int = 0) -> None:
    """Alpha-composite `art` scaled to fit a centred box of `box` px."""
    scale = box / max(art.size)
    w, h = max(1, round(art.width * scale)), max(1, round(art.height * scale))
    fitted = art.resize((w, h), Image.LANCZOS)
    cw, ch = canvas.size
    canvas.alpha_composite(fitted, ((cw - w) // 2, (ch - h) // 2 + dy))


def flat_icon(art: Image.Image, size: int, fraction: float) -> Image.Image:
    """Full-bleed gradient plate with the mark at `fraction` of the edge.
    For surfaces that mask the icon themselves (iOS, launchers, Play)."""
    work = max(size, 512)
    canvas = radial_plate(work).convert("RGBA")
    paste_fit(canvas, art, int(work * fraction))
    return canvas.resize((size, size), Image.LANCZOS).convert("RGB")


def badge(art: Image.Image) -> Image.Image:
    """Circular favicon badge at 1024: soft drop shadow, gradient disc, thin
    gold rim, centred mark. Transparent corners, so it reads as a deliberate
    round mark in the tab strip instead of a murky square."""
    s = 1024
    d = round(s * 0.92)  # disc diameter; the margin absorbs the shadow blur
    off = (s - d) / 2

    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # Drop shadow - invisible on dark UI chrome, lifts the disc on light.
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    drop = round(s * 0.012)
    shadow.paste((0, 0, 0, 115), (0, 0, s, s),
                 ellipse_mask(s, (off, off + drop, off + d, off + d + drop)))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s * 0.014)))

    # Gradient disc.
    disc = radial_plate(s).convert("RGBA")
    disc.putalpha(ellipse_mask(s, (off, off, off + d, off + d)))
    canvas.alpha_composite(disc)

    # Thin gold rim, just inside the disc edge.
    rim_w = s * 0.016
    inset = off + rim_w / 2 + 1
    rim = gold_gradient(s).convert("RGBA")
    rim.putalpha(ellipse_mask(s, (inset, inset, s - inset, s - inset), width=rim_w))
    canvas.alpha_composite(rim)

    paste_fit(canvas, art, round(d * 0.66))
    return canvas


def macos_icon(flat: Image.Image) -> Image.Image:
    """Compose the Apple-grid icon: rounded rect + baked soft shadow, at 1024."""
    size = 1024
    offset = (size - MACOS_BODY) // 2

    art = flat.resize((MACOS_BODY, MACOS_BODY), Image.LANCZOS).convert("RGBA")
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

    master = Image.open(src)
    if master.width != master.height:
        print(f"warning: master is {master.width}x{master.height}, not square", file=sys.stderr)

    art = art_layer(master)
    written: list[tuple[Path, str]] = []

    # --- web ---------------------------------------------------------------
    if only in (None, "web"):
        round_icon = badge(art)

        for name, size in [
            ("favicon-96x96.png", 96),
            ("icon-192.png", 192),
            ("icon-512.png", 512),
        ]:
            out = WEB / name
            round_icon.resize((size, size), Image.LANCZOS).save(out, "PNG", optimize=True)
            written.append((out, f"{size}x{size} round"))

        # Multi-resolution .ico so Windows/older browsers pick a sane size.
        ico = WEB / "favicon.ico"
        round_icon.resize((256, 256), Image.LANCZOS).save(
            ico, "ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
        written.append((ico, "16/32/48/64 round"))

        # The layout advertises an SVG favicon. Tracing the raster to real paths
        # is out of scope, but an SVG wrapping the PNG is valid and honours the
        # declared type, so the <link> keeps working instead of 404-ing. A 256
        # embed is indistinguishable at favicon sizes and half the payload.
        buf = io.BytesIO()
        round_icon.resize((256, 256), Image.LANCZOS).save(buf, "PNG", optimize=True)
        data_uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        svg = WEB / "favicon.svg"
        svg.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
            f'<image width="256" height="256" href="{data_uri}"/>'
            "</svg>",
            encoding="utf-8",
        )
        written.append((svg, "256x256 (embedded round)"))

        # Surfaces that apply their own mask get the full-bleed plate: iOS
        # home screen, PWA maskable icons (which double as the OG image), and
        # the legacy Windows tile.
        out = WEB / "apple-touch-icon.png"
        flat_icon(art, 180, 0.74).save(out, "PNG", optimize=True)
        written.append((out, "180x180 flat"))

        for name, size in [
            ("web-app-manifest-512x512.png", 512),
            ("web-app-manifest-192x192.png", 192),
        ]:
            out = WEB / name
            flat_icon(art, size, MASKABLE_SAFE_FRACTION).save(out, "PNG", optimize=True)
            written.append((out, f"{size}x{size} maskable"))

        out = WEB / "mstile-150x150.png"
        flat_icon(art, 150, MASKABLE_SAFE_FRACTION).save(out, "PNG", optimize=True)
        written.append((out, "150x150 tile"))

    # --- android -----------------------------------------------------------
    if only in (None, "android"):
        icon = MOBILE / "icon.png"
        flat_icon(art, 1024, 0.74).save(icon, "PNG", optimize=True)
        written.append((icon, "1024x1024 flat"))

        adaptive = MOBILE / "adaptive-icon.png"
        flat_icon(art, 1024, MASKABLE_SAFE_FRACTION).save(adaptive, "PNG", optimize=True)
        written.append((adaptive, f"1024x1024 (safe {int(MASKABLE_SAFE_FRACTION * 100)}%)"))

    # --- macos -------------------------------------------------------------
    if only in (None, "macos"):
        MACOS_ICONSET.mkdir(parents=True, exist_ok=True)
        composed = macos_icon(flat_icon(art, 1024, 0.72))
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
    # The badge at real favicon sizes on light and dark tab-strip greys, each
    # upscaled 4x with NEAREST, so small-size legibility is something you look
    # at rather than assume.
    round_icon = badge(art)
    strip_sizes = [16, 24, 32, 48, 96]
    cell = 4
    pad = 12
    total_w = sum(sz * cell + pad for sz in strip_sizes) + pad
    row_h = max(strip_sizes) * cell + pad
    sheet = Image.new("RGB", (total_w, row_h * 2 + pad), (32, 33, 36))
    ImageDraw.Draw(sheet).rectangle([0, row_h + pad // 2, total_w, row_h * 2 + pad],
                                    fill=(240, 240, 240))
    for y0 in (pad // 2, row_h + pad):
        x = pad
        for sz in strip_sizes:
            tiny = round_icon.resize((sz, sz), Image.LANCZOS)
            big = tiny.resize((sz * cell, sz * cell), Image.NEAREST)
            sheet.paste(big, (x, y0 + (row_h - pad - sz * cell) // 2), big)
            x += sz * cell + pad
    preview = ROOT / ".logo-work" / "preview-favicons.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(preview, "PNG")

    for path, note in written:
        print(f"  {path.relative_to(ROOT)}  ({note})")
    print(f"\n  {preview.relative_to(ROOT)}  (16-96px favicon check on dark/light)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
