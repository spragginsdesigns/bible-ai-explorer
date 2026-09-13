#!/usr/bin/env python3
"""Import publisher USJ without inferring speech or section headings.
python3 scripts/bible/build-bsb.py /tmp/bsb_usj.zip /tmp/bsb.txt
"""

import hashlib, json, re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODES = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split()


def plain(node):
    return (
        node
        if isinstance(node, str)
        else "".join(plain(x) for x in node.get("content", []))
    )


def parse(doc):
    chapters = []
    chapter = None
    verse = None
    pending = []
    paragraph = False

    def walk(node, red=False, italic=False):
        nonlocal chapter, verse, pending, paragraph
        if isinstance(node, str):
            if verse is not None:
                text = re.sub(r"\s+", " ", node)
                # Three publisher USJ export artifacts, verified against publisher bsb.txt.
                if (code, len(chapters), verse["number"]) in {
                    ("GEN", 35, 18),
                    ("LUK", 9, 33),
                    ("ACT", 4, 36),
                }:
                    text = text.replace("vvv ", "")
                if text:
                    verse["segments"].append(
                        {"text": text, "italic": italic, "jesusSpeech": red}
                    )
            return
        kind = node["type"]
        marker = node.get("marker", "")
        if kind in ["book", "note", "ref"]:
            return
        if kind == "chapter":
            assert int(node["number"]) == len(chapters) + 1
            chapter = []
            chapters.append(chapter)
            verse = None
            return
        if kind == "verse":
            number = int(node["number"])
            assert chapter is not None and number > len(chapter), (
                code,
                len(chapters),
                number,
                len(chapter),
            )
            while len(chapter) < number - 1:
                chapter.append(
                    {
                        "number": len(chapter) + 1,
                        "headings": [],
                        "paragraphStart": False,
                        "segments": [],
                        "omitted": True,
                    }
                )
            verse = {
                "number": number,
                "headings": pending,
                "paragraphStart": paragraph,
                "segments": [],
            }
            chapter.append(verse)
            pending = []
            paragraph = False
            return
        if kind == "para":
            if re.fullmatch(r"s\d*", marker) or marker == "qa":
                pending.append(plain(node).strip())
                return
            if marker in ["h", "r"] or marker.startswith(
                ("toc", "mt", "is", "ip", "iot", "io", "iex", "im", "iq")
            ):
                return
            if marker not in ["b"] and chapter is not None:
                paragraph = True
                if verse is not None and verse["segments"]:
                    verse["segments"].append(
                        {"text": "\n", "italic": False, "jesusSpeech": False}
                    )
        for child in node.get("content", []):
            walk(child, red or marker == "wj", italic or marker in ["add", "it"])

    walk(doc)
    for chapter in chapters:
        for verse in chapter:
            parts = verse["segments"]
            while parts and not parts[0]["text"].strip():
                parts.pop(0)
            while parts and not parts[-1]["text"].strip():
                parts.pop()
            if parts:
                parts[0]["text"] = parts[0]["text"].lstrip()
                parts[-1]["text"] = parts[-1]["text"].rstrip()
            merged = []
            for s in parts:
                if merged and all(
                    merged[-1][k] == s[k] for k in ["italic", "jesusSpeech"]
                ):
                    merged[-1]["text"] += s["text"]
                else:
                    merged.append(s)
            verse["segments"] = merged
            verse["text"] = "".join(s["text"] for s in merged)
    return chapters


archive = Path(sys.argv[1])
z = zipfile.ZipFile(archive)
counts = {"books": 0, "chapters": 0, "verses": 0, "headings": 0, "redLetterVerses": 0}
generated = []
for order, code in enumerate(CODES, 1):
    doc = json.loads(
        z.read(next(n for n in z.namelist() if n.endswith("/" + code + ".usj")))
    )
    book = parse(doc)
    counts["books"] += 1
    counts["chapters"] += len(book)
    for ch in book:
        for v in ch:
            counts["verses"] += 1
            counts["headings"] += len(v["headings"])
            counts["redLetterVerses"] += any(s["jesusSpeech"] for s in v["segments"])
    generated.append(book)
assert (
    counts["books"] == 66 and counts["chapters"] == 1189 and counts["verses"] == 31102
), counts
# Independently verify all wording against the publisher's verse-per-line TXT.
plain_rows = []
for line in Path(sys.argv[2]).read_text(encoding="utf-8-sig").splitlines():
    m = re.match(r"(.+) (\d+):(\d+)\t(.*)", line)
    if m:
        plain_rows.append(m.groups())
assert len(plain_rows) == 31102
names = []
for name, ch, v, text in plain_rows:
    if name not in names:
        names.append(name)
    actual = generated[names.index(name)][int(ch) - 1][int(v) - 1]["text"]
    normalize = lambda s: "".join(c.lower() for c in s if c.isalnum())
    assert normalize(actual) == normalize(text), (name, ch, v, text, actual)
for order, book in enumerate(generated, 1):
    for directory in [
        ROOT / "mobile/src/features/bible/data/bsb",
        ROOT / "src/data/bsb",
    ]:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{order:02}.json").write_text(
            json.dumps(book, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
manifest = {
    "source": "https://bereanbible.com/bsb_usj.zip",
    "rights": "https://berean.bible/licensing.htm",
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "textVerificationSource": "https://bereanbible.com/bsb.txt",
    "textSha256": hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest(),
    **counts,
}
(ROOT / "src/data/bsb-source.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))

# Editorial headings can accompany KJV without changing its Scripture text.
headings = {
    f"{book}:{chapter}:{v['number']}": v["headings"]
    for book, chapters in enumerate(generated, 1)
    for chapter, verses in enumerate(chapters, 1)
    for v in verses
    if v["headings"]
}
(ROOT / "mobile/src/features/bible/data/section-headings.json").write_text(
    json.dumps(headings, ensure_ascii=False, separators=(",", ":")) + "\n"
)
