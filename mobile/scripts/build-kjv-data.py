#!/usr/bin/env python3
"""Parse Project Gutenberg KJV (#10) into per-book JSON for the mobile app.

The Gutenberg text wraps verses: a verse can begin mid-line ("...Gihon: 1:34 And
let Zadok..."), so this parser joins each book into a stream and walks verse
markers sequentially, accepting a marker only when it is exactly the next
expected chapter:verse. Output:

  mobile/src/features/bible/data/kjv/<order>-<slug>.json  (chapters: string[][])
  mobile/src/features/bible/data/books.json              (book metadata index)
"""
import json, os, re, sys

SRC = "biblical-texts/KJV-Bible.txt"
OUT_DIR = "mobile/src/features/bible/data/kjv"
BOOKS_JSON = "mobile/src/features/bible/data/books.json"

# (Gutenberg header, display name, order 1-66, abbreviation, chapter count)
BOOKS = [
    ("The First Book of Moses: Called Genesis", "Genesis", 1, "Gen", 50),
    ("The Second Book of Moses: Called Exodus", "Exodus", 2, "Ex", 40),
    ("The Third Book of Moses: Called Leviticus", "Leviticus", 3, "Lev", 27),
    ("The Fourth Book of Moses: Called Numbers", "Numbers", 4, "Num", 36),
    ("The Fifth Book of Moses: Called Deuteronomy", "Deuteronomy", 5, "Deut", 34),
    ("The Book of Joshua", "Joshua", 6, "Josh", 24),
    ("The Book of Judges", "Judges", 7, "Judg", 21),
    ("The Book of Ruth", "Ruth", 8, "Ruth", 4),
    ("The First Book of Samuel", "1 Samuel", 9, "1 Sam", 31),
    ("The Second Book of Samuel", "2 Samuel", 10, "2 Sam", 24),
    ("The First Book of the Kings", "1 Kings", 11, "1 Kgs", 22),
    ("The Second Book of the Kings", "2 Kings", 12, "2 Kgs", 25),
    ("The First Book of the Chronicles", "1 Chronicles", 13, "1 Chr", 29),
    ("The Second Book of the Chronicles", "2 Chronicles", 14, "2 Chr", 36),
    ("Ezra", "Ezra", 15, "Ezra", 10),
    ("The Book of Nehemiah", "Nehemiah", 16, "Neh", 13),
    ("The Book of Esther", "Esther", 17, "Esth", 10),
    ("The Book of Job", "Job", 18, "Job", 42),
    ("The Book of Psalms", "Psalms", 19, "Ps", 150),
    ("The Proverbs", "Proverbs", 20, "Prov", 31),
    ("Ecclesiastes", "Ecclesiastes", 21, "Eccl", 12),
    ("The Song of Solomon", "Song of Solomon", 22, "Song", 8),
    ("The Book of the Prophet Isaiah", "Isaiah", 23, "Isa", 66),
    ("The Book of the Prophet Jeremiah", "Jeremiah", 24, "Jer", 52),
    ("The Lamentations of Jeremiah", "Lamentations", 25, "Lam", 5),
    ("The Book of the Prophet Ezekiel", "Ezekiel", 26, "Ezek", 48),
    ("The Book of Daniel", "Daniel", 27, "Dan", 12),
    ("Hosea", "Hosea", 28, "Hos", 14),
    ("Joel", "Joel", 29, "Joel", 3),
    ("Amos", "Amos", 30, "Amos", 9),
    ("Obadiah", "Obadiah", 31, "Obad", 1),
    ("Jonah", "Jonah", 32, "Jonah", 4),
    ("Micah", "Micah", 33, "Mic", 7),
    ("Nahum", "Nahum", 34, "Nah", 3),
    ("Habakkuk", "Habakkuk", 35, "Hab", 3),
    ("Zephaniah", "Zephaniah", 36, "Zeph", 3),
    ("Haggai", "Haggai", 37, "Hag", 2),
    ("Zechariah", "Zechariah", 38, "Zech", 14),
    ("Malachi", "Malachi", 39, "Mal", 4),
    ("The Gospel According to Saint Matthew", "Matthew", 40, "Matt", 28),
    ("The Gospel According to Saint Mark", "Mark", 41, "Mark", 16),
    ("The Gospel According to Saint Luke", "Luke", 42, "Luke", 24),
    ("The Gospel According to Saint John", "John", 43, "John", 21),
    ("The Acts of the Apostles", "Acts", 44, "Acts", 28),
    ("The Epistle of Paul the Apostle to the Romans", "Romans", 45, "Rom", 16),
    ("The First Epistle of Paul the Apostle to the Corinthians", "1 Corinthians", 46, "1 Cor", 16),
    ("The Second Epistle of Paul the Apostle to the Corinthians", "2 Corinthians", 47, "2 Cor", 13),
    ("The Epistle of Paul the Apostle to the Galatians", "Galatians", 48, "Gal", 6),
    ("The Epistle of Paul the Apostle to the Ephesians", "Ephesians", 49, "Eph", 6),
    ("The Epistle of Paul the Apostle to the Philippians", "Philippians", 50, "Phil", 4),
    ("The Epistle of Paul the Apostle to the Colossians", "Colossians", 51, "Col", 4),
    ("The First Epistle of Paul the Apostle to the Thessalonians", "1 Thessalonians", 52, "1 Thess", 5),
    ("The Second Epistle of Paul the Apostle to the Thessalonians", "2 Thessalonians", 53, "2 Thess", 3),
    ("The First Epistle of Paul the Apostle to Timothy", "1 Timothy", 54, "1 Tim", 6),
    ("The Second Epistle of Paul the Apostle to Timothy", "2 Timothy", 55, "2 Tim", 4),
    ("The Epistle of Paul the Apostle to Titus", "Titus", 56, "Titus", 3),
    ("The Epistle of Paul the Apostle to Philemon", "Philemon", 57, "Phlm", 1),
    ("The Epistle of Paul the Apostle to the Hebrews", "Hebrews", 58, "Heb", 13),
    ("The General Epistle of James", "James", 59, "Jas", 5),
    ("The First Epistle General of Peter", "1 Peter", 60, "1 Pet", 5),
    ("The Second General Epistle of Peter", "2 Peter", 61, "2 Pet", 3),
    ("The First Epistle General of John", "1 John", 62, "1 John", 5),
    ("The Second Epistle General of John", "2 John", 63, "2 John", 1),
    ("The Third Epistle General of John", "3 John", 64, "3 John", 1),
    ("The General Epistle of Jude", "Jude", 65, "Jude", 1),
    ("The Revelation of Saint John the Divine", "Revelation", 66, "Rev", 22),
]

header_to_book = {h: (name, order, abbr, chs) for h, name, order, abbr, chs in BOOKS}
MARKER_RE = re.compile(r"(\d+):(\d+)\s")
EXPECTED_TOTAL_VERSES = 31102

def slug(name):
    return name.lower().replace(" ", "-")

def parse_book(text, name, expected_chapters):
    """Walk verse markers sequentially through one book's joined text."""
    chapters = []
    ch, vs = 1, 1
    pos = 0
    marks = []  # (start_of_marker, end_of_marker) accepted
    while True:
        m = MARKER_RE.search(text, pos)
        if not m:
            break
        got = (int(m.group(1)), int(m.group(2)))
        if got == (ch, vs):
            marks.append((m.start(), m.end()))
            pos = m.end()
            vs += 1
        elif got == (ch + 1, 1):
            ch, vs = ch + 1, 1
            marks.append((m.start(), m.end()))
            pos = m.end()
            vs = 2
        else:
            pos = m.start() + 1  # not a verse boundary; keep scanning
    if not marks:
        raise SystemExit(f"{name}: no verses found")
    verses = []
    for i, (ms, me) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        verses.append((ms, me, text[me:end].strip()))
    # Rebuild chapters
    cur_ch = 1
    chapter_verses = []
    for ms, me, vtext in verses:
        m = MARKER_RE.match(text, ms)
        vch = int(m.group(1))
        if vch != cur_ch:
            chapters.append(chapter_verses)
            chapter_verses = []
            cur_ch = vch
        chapter_verses.append(" ".join(vtext.split()))
    chapters.append(chapter_verses)
    if len(chapters) != expected_chapters:
        raise SystemExit(f"{name}: got {len(chapters)} chapters, expected {expected_chapters}")
    for ci, cvs in enumerate(chapters, 1):
        if not cvs:
            raise SystemExit(f"{name}: chapter {ci} is empty")
    return chapters

def main():
    with open(SRC, encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f]

    # Body starts after the 2nd occurrence of the Genesis header (1st is the TOC).
    gen_header = BOOKS[0][0]
    seen = [i for i, ln in enumerate(lines) if ln.strip() == gen_header]
    start = seen[1]
    end = next(i for i, ln in enumerate(lines) if ln.startswith("*** END OF THE PROJECT GUTENBERG"))

    # Split body into per-book text chunks.
    chunks = {}  # order -> list of text lines
    cur_order = None
    skip_alias = False  # line after "Otherwise Called:"/"Commonly Called:" is an alias header
    for ln in lines[start:end]:
        s = ln.strip()
        if not s:
            continue
        if skip_alias:
            # Multi-line book headers (e.g. 1 Samuel "...Otherwise Called: / The First
            # Book of the Kings") — drop the alias line even if it matches a header.
            skip_alias = False
            continue
        if s in ("Otherwise Called:", "Commonly Called:"):
            skip_alias = True
            continue
        if s in header_to_book:
            cur_order = header_to_book[s][1]
            chunks.setdefault(cur_order, [])
            continue
        if cur_order is not None:
            chunks[cur_order].append(s)

    if set(chunks) != set(range(1, 67)):
        raise SystemExit(f"missing books: {sorted(set(range(1, 67)) - set(chunks))}")

    books = {}
    for h, name, order, abbr, chs in BOOKS:
        text = " ".join(chunks[order])
        books[order] = parse_book(text, name, chs)

    total_verses = sum(len(vs) for chs in books.values() for vs in chs)
    if total_verses != EXPECTED_TOTAL_VERSES:
        raise SystemExit(f"total verses {total_verses} != {EXPECTED_TOTAL_VERSES}")

    os.makedirs(OUT_DIR, exist_ok=True)
    index = []
    for h, name, order, abbr, chs_count in BOOKS:
        chs = books[order]
        fn = f"{order:02d}-{slug(name)}.json"
        with open(os.path.join(OUT_DIR, fn), "w", encoding="utf-8") as f:
            json.dump(chs, f, separators=(",", ":"), ensure_ascii=False)
        index.append({
            "order": order, "name": name, "abbr": abbr,
            "testament": "OT" if order <= 39 else "NT",
            "chapters": len(chs), "file": fn,
        })
    os.makedirs(os.path.dirname(BOOKS_JSON), exist_ok=True)
    with open(BOOKS_JSON, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)

    size = sum(os.path.getsize(os.path.join(OUT_DIR, fn)) for fn in os.listdir(OUT_DIR))
    print(f"OK: 66 books, {total_verses} verses, data size {size / 1e6:.2f} MB")

if __name__ == "__main__":
    main()
