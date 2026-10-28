#!/usr/bin/env python3
"""Build SureWord's bundled Reina-Valera 1909 (Spanish), Lutherbibel 1912
(German) and American Standard Version 1901 (English) from eBible.org's
public-domain VPL exports.

Usage (from the repository root):

    curl --fail --location https://ebible.org/Scriptures/spaRV1909_vpl.zip -o /tmp/spaRV1909_vpl.zip
    curl --fail --location https://ebible.org/Scriptures/deu1912_vpl.zip -o /tmp/deu1912_vpl.zip
    python3 scripts/bible/build-ebible.py RV1909 /tmp/spaRV1909_vpl.zip
    python3 scripts/bible/build-ebible.py LUT1912 /tmp/deu1912_vpl.zip
    curl --fail --location https://ebible.org/Scriptures/eng-asv_vpl.zip -o /tmp/eng-asv_vpl.zip
    python3 scripts/bible/build-ebible.py ASV /tmp/eng-asv_vpl.zip

Every verse is the edition's own wording; nothing is translated or
paraphrased. The only changes are mechanical, and each one is listed here:

- All: eBible's supplied-word brackets ("se [le] reunió") are dropped and the
  word kept, the same way the KJV carries its italic words as plain text.
- German: eBible already places Luther's text in KJV verse slots and marks
  Luther's own number in front of a moved verse ("[2:1] Aber der HERR...").
  That marker is removed.
- Spanish: eBible's RV1909 keeps the chapter lengths of the KJV but leaves
  18 slots empty and folds their text into a neighbouring verse (Jonah 1:17
  is printed as 2:1, Acts 19:41 is the end of 19:40). The span table in
  `versification/RV1909.json` moves and splits that text back into the KJV
  slots; every split point is a literal phrase from the verse, checked by
  hand against the KJV.
- Spanish: chapter openings are set in drop capitals ("Y DESPUÉS movió",
  "¿CAZARÁS tú"). The leading capital run of a verse 1 is written in normal
  case, keeping names capitalized (a word stays capitalized when the corpus
  capitalizes it more often than not). Psalm 119's acrostic letter labels
  ("ALEPH.") and the subscriptions after Paul's epistles ("Fué escrita de
  Roma...") are removed, as the KJV build removes them.

Psalm titles stay in verse 1 in both editions, where both print them.

Known textual difference, not a build defect: Luther 1912 has no Comma
Johanneum at 1 John 5:7 ("three that bear record in heaven"); Luther
translated without it. RV1909 has it, as the KJV does.

English: eBible's ASV is already in KJV verse slots and needs no other change.
It writes the divine name as "Jehovah", as the 1901 edition does. It leaves 16
slots empty because the ASV omits those verses as later additions (EMPTY_SLOTS
below, LC-17800); they stay empty strings, and the reader shows them the way
it shows a verse a translation lacks.

Nothing is written unless all 31,102 KJV verse slots are filled, apart from
exactly the edition's EMPTY_SLOTS. Writes the
same per-book JSON (string[][], chapters of verses, like the KJV) to:

    mobile/src/features/bible/data/<id>/<NN>.json   Android
    src/data/<id>/<NN>.json                          web + API
    macos/Shared/Bible/Data/<id>/<NN>.json           macOS + iOS
    src/data/<id>-source.json                        source archive hash
"""

import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BOOKS = json.loads((ROOT / "src/data/books.json").read_text())
KJV_DIR = ROOT / "src/data/kjv"

EDITIONS = {
    "RV1909": {
        "dir": "rv1909",
        "vpl": "spaRV1909_vpl.txt",
        "title": "Reina-Valera 1909",
        "url": "https://ebible.org/Scriptures/spaRV1909_vpl.zip",
    },
    "LUT1912": {
        "dir": "lut1912",
        "vpl": "deu1912_vpl.txt",
        "title": "Lutherbibel 1912",
        "url": "https://ebible.org/Scriptures/deu1912_vpl.zip",
    },
    "ASV": {
        "dir": "asv",
        "vpl": "eng-asv_vpl.txt",
        "title": "American Standard Version (1901)",
        "url": "https://ebible.org/Scriptures/eng-asv_vpl.zip",
    },
}

# Slots an edition leaves empty on purpose. The build refuses any other empty
# slot, and refuses a listed slot that has text, so the list stays exact.
EMPTY_SLOTS = {
    "ASV": [
        "MAT 17:21", "MAT 18:11", "MAT 23:14",
        "MAR 7:16", "MAR 9:44", "MAR 9:46", "MAR 11:26", "MAR 15:28",
        "LUK 17:36", "LUK 23:17",
        "JOH 5:4",
        "ACT 8:37", "ACT 15:34", "ACT 24:7", "ACT 28:29",
        "ROM 16:24",
    ],
}

UPPER = "A-ZÁÉÍÓÚÑÜÂÊÎÔÛ"
LOWER = "a-záéíóúñüâêîôû"
EPISTLES = {"ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB"}
ACROSTIC = re.compile(
    r"^(ALEPH|BETH|GIMEL|DALETH|HE|VAU|ZAIN|CHETH|TETH|JOD|CAPH|LAMED|MEM|NUN|SAMECH|AIN|PE|TZADDI|COPH|RESH|SIN|SCHIN|TAU)\.?\s+"
)


def die(message: str) -> None:
    sys.exit(f"build-ebible: {message}")


def kjv_lengths() -> list[list[int]]:
    lengths = []
    for book in BOOKS:
        chapters = json.loads((KJV_DIR / book["file"]).read_text(encoding="utf-8"))
        lengths.append([len(chapter) for chapter in chapters])
    return lengths


def read_vpl(archive: Path, member: str) -> tuple[dict[tuple[int, int, int], str], str, list[str]]:
    raw = zipfile.ZipFile(archive).read(member)
    rows: dict[tuple[int, int, int], str] = {}
    codes: list[str] = []
    for line in raw.decode("utf-8").splitlines():
        match = re.match(r"^(\S+) (\d+):(\d+) ?(.*)$", line)
        if not match:
            continue
        code = match.group(1)
        if code not in codes:
            codes.append(code)
        book = codes.index(code) + 1
        rows[(book, int(match.group(2)), int(match.group(3)))] = match.group(4)
    if len(codes) != 66:
        die(f"{member}: expected 66 books, found {len(codes)}")
    return rows, hashlib.sha256(raw).hexdigest(), codes


def tidy(text: str) -> str:
    text = re.sub(r"\[(\d+:\d+)\]\s*", "", text)
    text = text.replace("[", "").replace("]", "")
    return re.sub(r"\s+", " ", text).strip()


def proper_nouns(rows: dict) -> set[str]:
    capitalized: dict[str, int] = {}
    lowered: dict[str, int] = {}
    for text in rows.values():
        for word in re.findall(rf"[{UPPER}{LOWER}]+", text):
            if word.isupper():
                continue
            key = word.lower()
            bucket = capitalized if word[0].isupper() else lowered
            bucket[key] = bucket.get(key, 0) + 1
    return {word for word, count in capitalized.items() if count > lowered.get(word, 0)}


def drop_capitals(text: str, names: set[str]) -> str:
    match = re.match(rf"^([¿¡(]*)((?:[{UPPER}]+ )*[{UPPER}]{{2,}})(?![{UPPER}])", text)
    if not match:
        return text
    words = []
    for word in match.group(2).split(" "):
        lower = word.lower()
        words.append(lower.capitalize() if lower in names else lower)
    run = " ".join(words)
    run = run[0].upper() + run[1:]
    return match.group(1) + run + text[match.end():]


def parse_ref(ref: str, codes: list[str]) -> tuple[int, int, int]:
    code, rest = ref.split(" ")
    chapter, verse = rest.split(":")
    return codes.index(code) + 1, int(chapter), int(verse)


def expand(span: str, codes: list[str], lengths) -> list[tuple[int, int, int]]:
    """'NUM 12:16-13:33' or 'JOB 35:15-16' -> every slot in that range."""
    code, rest = span.split(" ")
    start, end = rest.split("-")
    c1, v1 = map(int, start.split(":"))
    c2, v2 = map(int, end.split(":")) if ":" in end else (c1, int(end))
    book = codes.index(code) + 1
    slots = []
    for chapter in range(c1, c2 + 1):
        first = v1 if chapter == c1 else 1
        last = v2 if chapter == c2 else lengths(book, chapter)
        slots.extend((book, chapter, verse) for verse in range(first, last + 1))
    return slots


def apply_spans(rows: dict, codes: list[str], kjv: list[list[int]], table: list[dict]) -> None:
    def source_length(book: int, chapter: int) -> int:
        return max(v for (b, c, v) in rows if b == book and c == chapter)

    def kjv_length(book: int, chapter: int) -> int:
        return kjv[book - 1][chapter - 1]

    for entry in table:
        targets = expand(entry["kjv"], codes, kjv_length)
        pieces: list[str] = []
        for slot in expand(entry["src"], codes, source_length):
            text = rows.get(slot, "")
            if not text:
                continue
            ref = f"{codes[slot[0] - 1]} {slot[1]}:{slot[2]}"
            for phrase in entry.get("split", {}).get(ref, []):
                index = text.find(phrase)
                if index <= 0:
                    die(f"{entry['kjv']}: split phrase {phrase!r} not found in {ref}")
                pieces.append(text[:index].strip())
                text = text[index:]
            pieces.append(text.strip())
        if len(pieces) != len(targets):
            die(f"{entry['kjv']}: {len(pieces)} pieces for {len(targets)} KJV slots")
        for slot in expand(entry["src"], codes, source_length):
            rows.pop(slot, None)
        for slot, text in zip(targets, pieces):
            rows[slot] = text[0].upper() + text[1:]


def build(edition_id: str, archive: Path) -> None:
    edition = EDITIONS[edition_id]
    rows, digest, codes = read_vpl(archive, edition["vpl"])
    kjv = kjv_lengths()
    rows = {slot: tidy(text) for slot, text in rows.items()}

    if edition_id == "RV1909":
        names = proper_nouns(rows)
        for slot, text in list(rows.items()):
            book, chapter, verse = slot
            if codes[book - 1] == "PSA" and chapter == 119:
                text = ACROSTIC.sub("", text)
            if verse == 1 or (codes[book - 1] == "PSA" and chapter == 119):
                text = drop_capitals(text, names)
                # A psalm or proverb title comes first, so the drop capital follows it.
                title = re.search(rf"\. (?=[¿¡(]*(?:[{UPPER}]+ )*[{UPPER}]{{2,}}(?![{UPPER}]))", text)
                if codes[book - 1] in ("PSA", "PRO") and title:
                    text = text[: title.end()] + drop_capitals(text[title.end():], names)
            rows[slot] = text
        for book, code in enumerate(codes, start=1):
            if code in EPISTLES:
                chapter = len(kjv[book - 1])
                verse = max(v for (b, c, v) in rows if b == book and c == chapter and rows[(b, c, v)])
                text = rows[(book, chapter, verse)]
                cut = text.rfind("Amén.")
                if cut > 0 and text[cut + 5:].strip():
                    rows[(book, chapter, verse)] = text[: cut + 5]
        table = json.loads((Path(__file__).parent / "versification" / f"{edition_id}.json").read_text(encoding="utf-8"))
        apply_spans(rows, codes, kjv, table["spans"])

    books: list[list[list[str]]] = []
    missing = []
    for book, chapters in enumerate(kjv, start=1):
        out = []
        for chapter, count in enumerate(chapters, start=1):
            verses = [rows.get((book, chapter, verse), "") for verse in range(1, count + 1)]
            missing.extend(f"{codes[book - 1]} {chapter}:{v + 1}" for v, t in enumerate(verses) if not t)
            out.append(verses)
        books.append(out)
    extra = [slot for slot in rows if slot[1] > len(kjv[slot[0] - 1]) or slot[2] > kjv[slot[0] - 1][slot[1] - 1]]
    extra = [slot for slot in extra if rows[slot]]
    allowed = EMPTY_SLOTS.get(edition_id, [])
    if missing != allowed or extra:
        unexpected = [ref for ref in missing if ref not in allowed]
        filled = [ref for ref in allowed if ref not in missing]
        die(
            f"{edition_id}: empty KJV slots {unexpected[:20]} / allowed-empty slots with text {filled}"
            f" / text outside KJV slots {extra[:20]}"
        )
    total = sum(len(chapter) for book in books for chapter in book)
    if total != 31102:
        die(f"{edition_id}: {total} verses, expected 31102")

    for base in (
        ROOT / "mobile/src/features/bible/data" / edition["dir"],
        ROOT / "src/data" / edition["dir"],
        ROOT / "macos/Shared/Bible/Data" / edition["dir"],
    ):
        base.mkdir(parents=True, exist_ok=True)
        for order, book in enumerate(books, start=1):
            (base / f"{order:02}.json").write_text(
                json.dumps(book, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
            )
    manifest = {"id": edition_id, "title": edition["title"], "source": edition["url"], "sha256": digest, "verses": total}
    if allowed:
        manifest["empty"] = allowed
    (ROOT / "src/data" / f"{edition['dir']}-source.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in EDITIONS:
        die("usage: build-ebible.py RV1909|LUT1912|ASV <vpl.zip>")
    build(sys.argv[1], Path(sys.argv[2]))
