#!/usr/bin/env python3
"""Derive the Apple clients' bundled Bible sidecars from Android's data.

Android (mobile/src/features/bible/data) is the source of truth. This copies
the KJV speech sidecar and the editorial section headings verbatim, and writes
the Berean Standard Bible in a lossless compact form:

    bsb-NN.json = [chapter][verse] -> {"s": [[text, flags], ...], "o": 1?}

flags bit 1 = italic, bit 2 = words of Jesus. Everything Android stores beyond
that is derivable and checked here before anything is written:

- `number` is always the verse's position in its chapter plus one;
- `text` is always the segments joined;
- `headings` always equals section-headings.json at the same reference (the
  reader renders that file for KJV and BSB alike, as Android does);
- `paragraphStart` is not rendered by any client.

The compact file is about 45% of the source (5.3 MB against 11.6 MB), which is
what keeps the full offline BSB from doubling the app's Bible payload.

Run from the repo root after Android's data changes:

    python3 macos/scripts/build-bible-data.py
"""

import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCE = os.path.join(ROOT, "mobile", "src", "features", "bible", "data")
TARGET = os.path.join(ROOT, "macos", "Shared", "Bible", "Data")


def fail(message: str) -> None:
    print(f"build-bible-data: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    with open(os.path.join(SOURCE, "section-headings.json"), encoding="utf-8") as handle:
        headings = json.load(handle)

    os.makedirs(os.path.join(TARGET, "bsb"), exist_ok=True)
    total = 0
    for book in range(1, 67):
        path = os.path.join(SOURCE, "bsb", f"{book:02d}.json")
        with open(path, encoding="utf-8") as handle:
            chapters = json.load(handle)
        compact = []
        for chapter_index, verses in enumerate(chapters):
            out = []
            for verse_index, verse in enumerate(verses):
                reference = f"{book}:{chapter_index + 1}:{verse_index + 1}"
                if verse["number"] != verse_index + 1:
                    fail(f"{reference}: verse number {verse['number']} is not positional")
                joined = "".join(segment["text"] for segment in verse["segments"])
                if joined != verse["text"]:
                    fail(f"{reference}: text differs from its segments")
                if verse["headings"] != headings.get(reference, []):
                    fail(f"{reference}: headings differ from section-headings.json")
                entry = {
                    "s": [
                        [
                            segment["text"],
                            (1 if segment["italic"] else 0) | (2 if segment["jesusSpeech"] else 0),
                        ]
                        for segment in verse["segments"]
                    ]
                }
                if verse.get("omitted"):
                    entry["o"] = 1
                out.append(entry)
                total += 1
            compact.append(out)
        with open(os.path.join(TARGET, "bsb", f"bsb-{book:02d}.json"), "w", encoding="utf-8") as handle:
            json.dump(compact, handle, ensure_ascii=False, separators=(",", ":"))

    if total != 31102:
        fail(f"expected 31102 verse slots, wrote {total}")

    for name in ("section-headings.json", "kjv-red-letters.json"):
        shutil.copyfile(os.path.join(SOURCE, name), os.path.join(TARGET, name))

    print(f"build-bible-data: wrote {total} BSB verses and copied the KJV sidecars")


if __name__ == "__main__":
    main()
