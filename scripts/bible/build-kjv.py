#!/usr/bin/env python3
"""Build SureWord's bundled KJV from eBible.org's standard 1769 text.

Usage (from the repository root):

    curl --fail --location https://ebible.org/Scriptures/eng-kjv_usfm.zip -o /tmp/eng-kjv_usfm.zip
    curl --fail --location https://ebible.org/Scriptures/eng-kjv_vpl.zip -o /tmp/eng-kjv_vpl.zip
    python3 scripts/bible/build-kjv.py /tmp/eng-kjv_usfm.zip /tmp/eng-kjv_vpl.zip

This replaced the Project Gutenberg #10 text (2026-10-08), which carried
misspellings, dropped words and modernized spellings the KJV does not have.
eBible's edition is the same one the red-letter sidecar and the narrated
audio already follow, so text, speech spans and narration agree.

What is kept from the source, verbatim: every word, spelling, hyphen and
punctuation mark of the verse text, including words the translators
supplied (USFM \\add, printed in italics; carried here as plain text).
What is not verse text, and is dropped: Psalm titles (\\d), Psalm 119's
letter headings, the subscriptions after Paul's epistles (\\s1), book
titles, footnotes (\\f), Strong's numbers, and the paragraph sign.
Two typographic normalizations: the ligature æ is written "ae" (so a search
for "Caesar" finds Cæsar), and runs of whitespace collapse to one space.

Before anything is written, every one of the 31,102 verses is checked
letter for letter against eBible's independent plain-text (VPL) export of
the same edition; any difference aborts the build.

Writes the same per-book JSON to all three clients (they must stay
byte-identical), plus the flat runtime corpus the server reads:

    mobile/src/features/bible/data/kjv/<NN>-<slug>.json   Android (source of truth)
    src/data/kjv/<NN>-<slug>.json                          web + API
    macos/Shared/Bible/Data/kjv/<NN>-<slug>.json           macOS + iOS
    biblical-texts/kjv.json                                 src/utils/kjvBible.ts
    mobile/src/features/bible/data/kjv.source.json          source archive hashes

After a rebuild, regenerate the red-letter sidecar (see
mobile/src/features/bible/data/RED-LETTERS.md), run
`python3 macos/scripts/build-bible-data.py`, and backfill the KjvVerse and
VerseEmbedding tables (scripts/backfill-kjv-verses.mjs,
scripts/backfill-verse-embeddings.mjs).
"""

import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BOOKS = json.loads((ROOT / "src/data/books.json").read_text())
OUTPUTS = [
    ROOT / "mobile/src/features/bible/data/kjv",
    ROOT / "src/data/kjv",
    ROOT / "macos/Shared/Bible/Data/kjv",
]
RUNTIME = ROOT / "biblical-texts/kjv.json"
SOURCE_MANIFEST = ROOT / "mobile/src/features/bible/data/kjv.source.json"
EXPECTED_VERSES = 31102

# eBible's USFM book codes, in canonical order 1-66.
CODES = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO "
    "ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL "
    "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB "
    "JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()
# The VPL export spells some codes differently.
VPL_CODES = {"SNG": "SOL", "EZK": "EZE", "JOL": "JOE", "NAM": "NAH", "MRK": "MAR",
             "JHN": "JOH", "PHP": "PHI", "JAS": "JAM", "1JN": "1JO", "2JN": "2JO", "3JN": "3JO"}

# Lines whose marker means "not verse text": titles, headings, Psalm
# superscriptions, epistle subscriptions, introductions.
NON_TEXT_LINE = re.compile(r"^\\(id|ide|h|toc\d|mt\d?|ms\d?|imt\d?|ip|is\d?|s\d?|d)(\s|$)")
# Paragraph/poetry markers that carry no words of their own.
LAYOUT_MARKER = re.compile(r"\\(p|q\d?|b|m|nb|pi\d?)(\s|$)")


def typography(text):
    text = unicodedata.normalize("NFC", text)
    text = text.replace("æ", "ae").replace("Æ", "Ae").replace("¶", " ")
    return " ".join(text.split())


def strip_usfm(text):
    text = re.sub(r"\\f\s.*?\\f\*", "", text, flags=re.S)  # footnotes
    text = re.sub(r"\\x\s.*?\\x\*", "", text, flags=re.S)  # cross references
    # \w word|strong="H1234"\w* (and the nested \+w form) -> word
    text = re.sub(r"\\\+?w\s+([^|\\]*?)(\|[^\\]*?)?\\\+?w\*", r"\1", text)
    # Character styles whose content is Scripture: supplied words, the divine
    # name, words of Jesus, transliterations. Keep the words, drop the tags.
    text = re.sub(r"\\\+?(add|nd|wj|tl|qs|sc|it|bd|em)\*?", " ", text)
    if "\\" in text:
        raise ValueError(f"unhandled USFM marker in: {text[:120]}")
    return text


def tidy(text):
    # Removing a tag can strand a space before punctuation ("LORD ;").
    text = typography(text)
    return re.sub(r"\s+([,.;:?!)’])", r"\1", re.sub(r"([(])\s+", r"\1", text))


def parse_book(source):
    chapters, chapter, verse, buffer = [], 0, 0, []

    def flush():
        if verse:
            chapters[chapter - 1].append(tidy(strip_usfm(" ".join(buffer))))

    for raw in source.splitlines():
        line = raw.strip()
        if not line or NON_TEXT_LINE.match(line):
            continue
        line = LAYOUT_MARKER.sub(" ", line).strip()
        match = re.match(r"^\\c\s+(\d+)\s*$", line)
        if match:
            flush()
            chapter, verse, buffer = int(match.group(1)), 0, []
            if chapter != len(chapters) + 1:
                raise ValueError(f"chapter {chapter} out of order")
            chapters.append([])
            continue
        # A line may hold several verses; split on every \v marker.
        for part in re.split(r"(\\v\s+\d+\s)", line):
            marker = re.match(r"\\v\s+(\d+)\s", part)
            if marker:
                flush()
                verse, buffer = int(marker.group(1)), []
                if verse != len(chapters[chapter - 1]) + 1:
                    raise ValueError(f"{chapter}:{verse} out of order")
            elif part.strip() and verse:
                buffer.append(part)
    flush()
    return chapters


def letters(text):
    return "".join(c.lower() for c in typography(text) if c.isalnum())


def main(usfm_zip, vpl_zip):
    vpl = {}
    with zipfile.ZipFile(vpl_zip) as z:
        name = next(n for n in z.namelist() if n.endswith("_vpl.txt"))
        for line in z.read(name).decode("utf-8-sig").splitlines():
            m = re.match(r"^(\S+) (\d+):(\d+) (.*)$", line)
            if m:
                vpl[(m.group(1), int(m.group(2)), int(m.group(3)))] = m.group(4)

    books, failures, total = {}, [], 0
    with zipfile.ZipFile(usfm_zip) as z:
        for book, code in zip(BOOKS, CODES):
            name = next(n for n in z.namelist() if n.endswith(f"-{code}eng-kjv.usfm"))
            chapters = parse_book(z.read(name).decode("utf-8-sig"))
            if len(chapters) != book["chapters"]:
                failures.append(f"{book['name']}: {len(chapters)} chapters, expected {book['chapters']}")
            for c, verses in enumerate(chapters, 1):
                for v, text in enumerate(verses, 1):
                    total += 1
                    reference = vpl.get((VPL_CODES.get(code, code), c, v))
                    if reference is None:
                        failures.append(f"{book['name']} {c}:{v} missing from VPL")
                        continue
                    if code == "PSA" and v == 1 and letters(reference).endswith(letters(text)):
                        continue  # VPL folds the Psalm title into verse 1
                    if letters(text) != letters(reference):
                        failures.append(f"{book['name']} {c}:{v}\n  usfm: {text}\n  vpl:  {reference}")
            books[book["order"]] = chapters

    if total != EXPECTED_VERSES:
        failures.append(f"{total} verses, expected {EXPECTED_VERSES}")
    if failures:
        print("\n".join(failures[:40]), file=sys.stderr)
        sys.exit(f"build-kjv: {len(failures)} check(s) failed; nothing written")

    for out in OUTPUTS:
        out.mkdir(parents=True, exist_ok=True)
        for book in BOOKS:
            (out / book["file"]).write_text(
                json.dumps(books[book["order"]], ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
    RUNTIME.write_text(
        json.dumps([books[b["order"]] for b in BOOKS], ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    SOURCE_MANIFEST.write_text(
        json.dumps(
            {
                "edition": "King James Version, standardized text of 1769 (eBible.org eng-kjv)",
                "usfm": {
                    "url": "https://ebible.org/Scriptures/eng-kjv_usfm.zip",
                    "sha256": hashlib.sha256(Path(usfm_zip).read_bytes()).hexdigest(),
                },
                "validatedAgainst": {
                    "url": "https://ebible.org/Scriptures/eng-kjv_vpl.zip",
                    "sha256": hashlib.sha256(Path(vpl_zip).read_bytes()).hexdigest(),
                },
                "rights": "https://ebible.org/eng-kjv/copyright.htm",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"OK: 66 books, {total} verses, validated against VPL; wrote {len(OUTPUTS)} copies + runtime corpus")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
