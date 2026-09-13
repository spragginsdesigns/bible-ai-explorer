#!/usr/bin/env python3
"""Extract eBible USFM Jesus-speech spans, validating against our unchanged KJV.
Usage: python3 scripts/bible/build-kjv-red-letters.py /path/to/eng-kjv_usfm.zip
Source: https://ebible.org/Scriptures/eng-kjv_usfm.zip
No fuzzy matching, speaker inference, or cross-translation offsets.
"""

import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "mobile/src/features/bible/data"
# Reviewed spelling/text variants between these two KJV editions. These are
# alignment aliases only: neither the displayed text nor the speech tags change.
VARIANTS = {
    "40:5:40": ("cloke", "cloak"),
    "40:16:3": ("lowring", "lowering"),
    "40:26:39": ("further", "farther"),
    "41:15:2": ("unto him,", "unto them,"),
    "42:6:29": ("cloke", "cloak"),
    "43:15:22": ("cloke", "cloak"),
    "43:21:18": ("girdedst", "girdest"),
    "66:2:6": ("Nicolaitans", "Nicolaitanes"),
    "66:2:15": ("Nicolaitans", "Nicolaitanes"),
}
CODES = "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split()


def letters(text):
    # Ignore editorial whitespace/punctuation/capitalization only. Every letter
    # and digit must match after the explicit edition aliases below.
    return "".join(c.lower() for c in text if c.isalnum())


def build(archive):
    result, failures, counts = {}, [], {}
    with zipfile.ZipFile(archive) as z:
        for order, code in enumerate(CODES, 40):
            source = z.read(
                next(n for n in z.namelist() if f"-{code}eng-kjv.usfm" in n)
            ).decode("utf-8-sig")
            book = json.loads(
                next((DATA / "kjv").glob(f"{order:02}-*.json")).read_text()
            )
            # Remove footnotes and lexical attributes, keeping actual Scripture.
            source = re.sub(r"\\(f|x)\s.*?\\\1\*", "", source, flags=re.S)
            source = re.sub(
                r"\\\+?w\s+([^|]*?)\|.*?\\\+?w\*", r"\1", source, flags=re.S
            )
            chapter = 0
            for chunk in re.split(r"(\\c\s+\d+|\\v\s+\d+)", source):
                if chunk.startswith("\\c "):
                    chapter = int(chunk.split()[1])
                    verse = 0
                elif chunk.startswith("\\v "):
                    verse = int(chunk.split()[1])
                elif chapter and verse:
                    if "\\wj" not in chunk:
                        continue
                    # wj markers delimit source-authored speech. Other inline
                    # markers (e.g. supplied-word italics) do not change speech.
                    key = f"{order}:{chapter}:{verse}"
                    chunks = re.split(r"(\\wj\*|\\wj\s+)", chunk)
                    plain, speech, active = "", [], False
                    for part in chunks:
                        if part.startswith("\\wj"):
                            active = part != "\\wj*"
                            continue
                        part = re.sub(r"\\\+?[a-z]+\d*\*?\s*", "", part)
                        part = part.replace("æ", "ae").replace("Æ", "AE")
                        if key in VARIANTS:
                            part = part.replace(*VARIANTS[key])
                        start = len(letters(plain))
                        plain += part
                        end = len(letters(plain))
                        if active and end > start:
                            speech.append((start, end))
                    if active:
                        raise ValueError(f"Unclosed speech marker: {key}")
                    text = book[chapter - 1][verse - 1]
                    key = f"{order}:{chapter}:{verse}"
                    if letters(plain) != letters(text):
                        failures.append((key, plain.strip(), text))
                        continue
                    positions = [i for i, c in enumerate(text) if c.isalnum()]
                    ranges = []
                    for start, end in speech:
                        lo, hi = positions[start], positions[end - 1] + 1
                        # Keep adjacent closing punctuation in the quotation.
                        while (
                            hi < len(text)
                            and not text[hi].isalnum()
                            and not text[hi].isspace()
                        ):
                            hi += 1
                        ranges.append([lo, hi])
                    result[key] = {"text": text, "ranges": ranges}
                    counts[code] = counts.get(code, 0) + 1
    if failures:
        for f in failures:
            print(f, file=sys.stderr)
        raise SystemExit(f"{len(failures)} mismatched verses; no output written")
    out = DATA / "kjv-red-letters.json"
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    manifest = {
        "source": "https://ebible.org/Scriptures/eng-kjv_usfm.zip",
        "copyright": "https://ebible.org/eng-kjv/copyright.htm",
        "sourceSha256": hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
        "verses": len(result),
        "byBook": counts,
        "method": "USFM wj markers; alphanumeric alignment with explicit reviewed edition aliases; stored exact text guards offsets at runtime.",
    }
    (DATA / "kjv-red-letters.source.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    build(sys.argv[1])
