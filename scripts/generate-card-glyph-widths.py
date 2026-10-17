"""Regenerate src/lib/share-cards/glyph-widths.ts from the share-card fonts.

The card layout (src/lib/share-cards/layout.ts) wraps text with these advance
widths so it can pick a type size that fits before satori draws anything.
Satori cannot report how tall text came out, so if a font file changes and
this table does not, cards silently wrap at the wrong width.

Usage (repo root, needs `pip install fonttools`):
    python scripts/generate-card-glyph-widths.py

See docs/architecture/share-card-images.md.
"""

import json
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "src" / "assets" / "share-cards" / "fonts"
OUT = ROOT / "src" / "lib" / "share-cards" / "glyph-widths.ts"

# Keys match the GLYPH_WIDTHS record the layout reads.
FONTS = {
    "verse": "CormorantGaramond_500Medium.ttf",
    "verseItalic": "CormorantGaramond_500Medium_Italic.ttf",
    "body": "AtkinsonHyperlegible_400Regular.ttf",
}

HEADER = """/**
 * Advance widths (in em) of every glyph in the share-card fonts, generated with
 * fontTools from src/assets/share-cards/fonts. The card layout wraps text with
 * these so it can choose a type size that fits before satori draws anything.
 * Regenerate whenever a font file changes.
 */
export interface GlyphWidthTable {
\tfallback: number;
\twidths: Record<string, number>;
}

"""


def table(path: Path) -> dict:
    font = TTFont(path)
    units = font["head"].unitsPerEm  # type: ignore[attr-defined]  # fontTools' stubs omit table fields
    metrics = font["hmtx"]
    cmap = font.getBestCmap() or {}
    widths = {}
    # Digits first, the way a JavaScript object orders integer keys, so the
    # file matches what the layout's own JSON round trip would print.
    for codepoint, glyph in sorted(cmap.items(), key=lambda item: (not "0" <= chr(item[0]) <= "9", item[0])):
        if codepoint < 32:
            continue
        width = round(metrics[glyph][0] / units, 4)
        widths[chr(codepoint)] = int(width) if width.is_integer() else width
    # Unknown characters are measured as an average lowercase letter.
    letters = [widths[c] for c in "abcdefghijklmnopqrstuvwxyz" if c in widths]
    return {"fallback": round(sum(letters) / len(letters), 4), "widths": widths}


def main() -> None:
    tables = {key: table(FONT_DIR / name) for key, name in FONTS.items()}
    body = json.dumps(tables, ensure_ascii=False, separators=(",", ":"))
    keys = " | ".join(f'"{key}"' for key in FONTS)
    source = f"{HEADER}export const GLYPH_WIDTHS: Record<{keys}, GlyphWidthTable> = {body};\n"
    OUT.write_text(source, encoding="utf-8", newline="\n")
    print({key: len(value["widths"]) for key, value in tables.items()})


if __name__ == "__main__":
    main()
