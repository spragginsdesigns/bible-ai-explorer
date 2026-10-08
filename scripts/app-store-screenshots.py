#!/usr/bin/env python3
"""App Store screenshot sets and social promo images for SureWord (PRD H4).

Reproducible end to end:

    uv run --with pillow --with requests scripts/app-store-screenshots.py all

Steps (each can be run alone):

    capture   build the Debug iOS app (signed, per project.yml), create two
              throwaway simulators (iPhone 18 Pro Max = 6.9", iPad Pro 13-inch
              M5 = 13"), install fixtures, launch each screen through the
              evidence harness (macos/SureWord-iOS/App/UIEvidenceHarness.swift)
              and save raw captures. Simulators are deleted afterwards.
    art       generate the textless background art with OpenAI
              gpt-image-2.5-sunburst. Skips any image already on disk, so the
              generation budget is spent once. Key file: $OPENAI_KEY_FILE, or
              OPENAI_API_KEY in the environment.
    compose   lay out headline + subline + framed real capture over the art,
              at exact App Store sizes, and the three social promos.
    all       capture, art, compose.

Raw captures and generated art live in .app-store-work/ (gitignored). Final
PNGs: docs/ios/app-store/screenshots/{iphone-6.9,ipad-13}/ and
docs/marketing/promos/.

Truthfulness (App Store guideline 2.3.3 / 2.3.7): everything inside the device
frame is an untouched simulator capture of the real app. Account data comes
from the fixtures below, served through EvidenceFixtures (DEBUG only) to the
real views and decoders. The fixtures are sample content of the kind the app
produces, with no data from any real account. The Words study and the verse
explanation for 1 Timothy 2:5 are the production app's own cached outputs for
that verse (VerseWordStudy / VerseInsight are shared, account-free caches).
Never touch Austin's simulator (4C41C3D8-781A-4446-A5D8-AF7325A9A84A), and
never use `simctl ... booted`.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MACOS = ROOT / "macos"
WORK = ROOT / ".app-store-work"
RAW = WORK / "raw"
ART = WORK / "art"
FIXTURES = WORK / "fixtures"
OUT_IPHONE = ROOT / "docs/ios/app-store/screenshots/iphone-6.9"
OUT_IPAD = ROOT / "docs/ios/app-store/screenshots/ipad-13"
OUT_PROMO = ROOT / "docs/marketing/promos"
DERIVED = MACOS / "build-shots.noindex"
BUNDLE_ID = "com.spragginsdesigns.sureword"
AUSTIN_SIM = "4C41C3D8-781A-4446-A5D8-AF7325A9A84A"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-27-0"
DEVICES = {
    "iphone": ("shots-iphone69", "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max", (1320, 2868)),
    "ipad": ("shots-ipad13", "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB", (2064, 2752)),
}
DEFAULT_KEY_FILE = Path(
    "/private/tmp/claude-501/-Users-spragginsdesigns-Documents-Github-Repositories-bible-ai-explorer/"
    "705437c8-b5f1-4456-ac25-c891d64707d9/scratchpad/oa.key"
)

# --------------------------------------------------------------------------
# Fixtures: sample account content, served to the real app by EvidenceFixtures
# --------------------------------------------------------------------------

CONVERSATION_ID = "ev-assurance"

ANSWER = """God means for you to know. John wrote, "These things have I written unto you that believe on the name of the Son of God; that ye may know that ye have eternal life" (1 John 5:13).

**It rests on Christ, not on your feelings.** "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast" (Ephesians 2:8-9).

**Have you believed and confessed Him?** "That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved" (Romans 10:9).

**He keeps what He saves.** Of His sheep the Lord Jesus said, "they shall never perish, neither shall any man pluck them out of my hand" (John 10:28).

[FOLLOWUP] What does it mean to be born again?
[FOLLOWUP] How do I grow in assurance day by day?"""

# The iPad's taller chat shows the same conversation one turn later: the user
# tapped the first follow-up chip.
FOLLOWUP_QUESTION = "What does it mean to be born again?"
FOLLOWUP_ANSWER = """The Lord Jesus said it plainly to Nicodemus: "Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God" (John 3:3).

**It is a birth from above, not a reformation.** "That which is born of the flesh is flesh; and that which is born of the Spirit is spirit" (John 3:6). You cannot improve the old life into the new; God gives a new one.

**God does it through His Word.** "Being born again, not of corruptible seed, but of incorruptible, by the word of God, which liveth and abideth for ever" (1 Peter 1:23).

**It shows in a changed life.** "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new" (2 Corinthians 5:17).

[FOLLOWUP] How was Nicodemus changed afterward?
[FOLLOWUP] What are the evidences of the new birth in 1 John?"""

FOLLOWUP_RETRIEVED = [
    ("John 3:3", 0.86, "Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God."),
    ("John 3:6", 0.81, "That which is born of the flesh is flesh; and that which is born of the Spirit is spirit."),
    ("1 Peter 1:23", 0.78, "Being born again, not of corruptible seed, but of incorruptible, by the word of God, which liveth and abideth for ever."),
    ("2 Corinthians 5:17", 0.75, "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new."),
]

RETRIEVED = [
    ("1 John 5:13", 0.83, "These things have I written unto you that believe on the name of the Son of God; that ye may know that ye have eternal life, and that ye may believe on the name of the Son of God."),
    ("Ephesians 2:8", 0.79, "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God:"),
    ("Romans 10:9", 0.78, "That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved."),
    ("John 10:28", 0.74, "And I give unto them eternal life; and they shall never perish, neither shall any man pluck them out of my hand."),
]

CROSS = {
    "id": "ev-cross",
    "reference": "Luke 9:23",
    "book": "Luke",
    "chapter": 9,
    "verse": 23,
    "text": "And he said to them all, If any man will come after me, let him deny himself, and take up his cross daily, and follow me.",
    "reason": "Chosen from your week in Romans 6 and your note on dying to self.",
    "whyToday": "You have been reading about being dead to sin and alive unto God, and you asked how that works on an ordinary day. The Lord's answer is one word: daily. The cross is not taken up once and set down; it is picked up again each morning.",
    "application": "Before the day's first decision, deny yourself one small thing for Christ's sake, and say plainly, \"Not my will, but thine.\" When pride or worry rises, pick the cross up again and follow Him.",
    "studyPath": [
        {"book": "Luke", "chapter": 9, "focus": "Whosoever will lose his life for my sake, the same shall save it (verses 23-26)."},
        {"book": "Romans", "chapter": 6, "focus": "Buried with Him by baptism, raised to walk in newness of life."},
        {"book": "Galatians", "chapter": 2, "focus": "Crucified with Christ, yet living by the faith of the Son of God (verse 20)."},
    ],
    "question": "What will you lay down today so that you can follow Him?",
    "themeKey": "take-up-the-cross",
    "theme": "Take up the cross daily",
}

MEMORIES = [
    ("profile", "Saved at 19 and baptized at a small Baptist church; reads the King James Bible."),
    ("profile", "Married, with two young children; leads family devotions most evenings."),
    ("profile", "Teaches a men's Sunday school class at Grace Bible Church."),
    ("prayer", "Praying for a coworker, Daniel, who has started asking about the Gospel."),
    ("prayer", "Asked for wisdom about a job decision before the end of the month."),
    ("study", "Reading through Romans this autumn, one chapter a day."),
    ("study", "Memorizing Psalm 119:105 and Galatians 2:20."),
    ("preference", "Prefers short answers with the full verse quoted, then the reference."),
]

FOLDERS = [("f-romans", "Romans study"), ("f-sermons", "Sermon notes"), ("f-prayer", "Prayer journal")]
TAGS = [("t-grace", "grace", "#F5D76E"), ("t-faith", "faith", "#4A90D9"), ("t-cross", "the cross", "#E84C3D")]
NOTES = [
    ("n1", "Dead to sin, alive unto God", "f-romans", ["t-grace"], True, "Romans 6:11 Likewise reckon ye also yourselves to be dead indeed unto sin, but alive unto God through Jesus Christ our Lord. Reckon is an accounting word: count it as already true because God says it is.", 214, "2026-10-07T13:40:00.000Z"),
    ("n2", "Galatians 2:20 - not I, but Christ", None, ["t-cross"], True, "I am crucified with Christ: nevertheless I live; yet not I, but Christ liveth in me. Paul speaks of a finished fact and a present life.", 156, "2026-10-06T21:05:00.000Z"),
    ("n3", "Sunday: The Prodigal's Father (Luke 15)", "f-sermons", ["t-grace"], False, "But when he was yet a great way off, his father saw him, and had compassion, and ran, and fell on his neck, and kissed him. Points: the father watching, running, restoring.", 402, "2026-10-05T18:22:00.000Z"),
    ("n4", "Justified by faith (Romans 5:1)", "f-romans", ["t-faith"], False, "Therefore being justified by faith, we have peace with God through our Lord Jesus Christ. Peace with God comes before the peace of God.", 188, "2026-10-04T07:15:00.000Z"),
    ("n5", "Answered: wisdom for the move", "f-prayer", [], False, "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not (James 1:5). He answered, and the door opened.", 97, "2026-10-02T20:48:00.000Z"),
    ("n6", "The armour of God, piece by piece", None, ["t-faith"], False, "Ephesians 6:13-18. Truth, righteousness, the gospel of peace, the shield of faith, the helmet of salvation, the sword of the Spirit.", 331, "2026-09-29T06:30:00.000Z"),
]

# The production app's cached Words study for 1 Timothy 2:5 (VerseWordStudy,
# promptVersion 2, account-free cache) - exactly what /api/verse-words serves.
WORDS_1TIM_2_5 = json.loads(r'''{"book":54,"chapter":2,"verse":5,"reference":"1 Timothy 2:5","language":"Greek","textName":"Scrivener 1894 Textus Receptus","kjvText":"For there is one God, and one mediator between God and men, the man Christ Jesus;","words":[{"text":"εις","strongs":"G1520","morph":"A-NSM","lemma":"εἷς","translit":"heîs","gloss":"a(-n, -ny, certain), + abundantly, man, one (another), only, other, some","grammar":{"partOfSpeech":"adjective","features":["nominative","singular","masculine"],"summary":"adjective, nominative singular masculine"}},{"text":"γαρ","strongs":"G1063","morph":"CONJ","lemma":"γάρ","translit":"gár","gloss":"and, as, because (that), but, even, for, indeed, no doubt, seeing, then, therefore, verily, what, why, yet","grammar":{"partOfSpeech":"conjunction","features":[],"summary":"conjunction"}},{"text":"θεος","strongs":"G2316","morph":"N-NSM","lemma":"θεός","translit":"theós","gloss":"X exceeding, God, god(-ly, -ward)","grammar":{"partOfSpeech":"noun","features":["nominative","singular","masculine"],"summary":"noun, nominative singular masculine"}},{"text":"εις","strongs":"G1520","morph":"A-NSM","lemma":"εἷς","translit":"heîs","gloss":"a(-n, -ny, certain), + abundantly, man, one (another), only, other, some","grammar":{"partOfSpeech":"adjective","features":["nominative","singular","masculine"],"summary":"adjective, nominative singular masculine"}},{"text":"και","strongs":"G2532","morph":"CONJ","lemma":"καί","translit":"kaí","gloss":"and, also, both, but, even, for, if, or, so, that, then, therefore, when, yet","grammar":{"partOfSpeech":"conjunction","features":[],"summary":"conjunction"}},{"text":"μεσιτης","strongs":"G3316","morph":"N-NSM","lemma":"μεσίτης","translit":"mesítēs","gloss":"mediator","grammar":{"partOfSpeech":"noun","features":["nominative","singular","masculine"],"summary":"noun, nominative singular masculine"}},{"text":"θεου","strongs":"G2316","morph":"N-GSM","lemma":"θεός","translit":"theós","gloss":"X exceeding, God, god(-ly, -ward)","grammar":{"partOfSpeech":"noun","features":["genitive","singular","masculine"],"summary":"noun, genitive singular masculine"}},{"text":"και","strongs":"G2532","morph":"CONJ","lemma":"καί","translit":"kaí","gloss":"and, also, both, but, even, for, if, or, so, that, then, therefore, when, yet","grammar":{"partOfSpeech":"conjunction","features":[],"summary":"conjunction"}},{"text":"ανθρωπων","strongs":"G444","morph":"N-GPM","lemma":"ἄνθρωπος","translit":"ánthrōpos","gloss":"certain, man","grammar":{"partOfSpeech":"noun","features":["genitive","plural","masculine"],"summary":"noun, genitive plural masculine"}},{"text":"ανθρωπος","strongs":"G444","morph":"N-NSM","lemma":"ἄνθρωπος","translit":"ánthrōpos","gloss":"certain, man","grammar":{"partOfSpeech":"noun","features":["nominative","singular","masculine"],"summary":"noun, nominative singular masculine"}},{"text":"χριστος","strongs":"G5547","morph":"N-NSM","lemma":"Χριστός","translit":"Christós","gloss":"Christ","grammar":{"partOfSpeech":"noun","features":["nominative","singular","masculine"],"summary":"noun, nominative singular masculine"}},{"text":"ιησους","strongs":"G2424","morph":"N-NSM","lemma":"Ἰησοῦς","translit":"Iēsoûs","gloss":"Jesus","grammar":{"partOfSpeech":"noun","features":["nominative","singular","masculine"],"summary":"noun, nominative singular masculine"}}],"rows":[{"wordIndexes":[0],"original":"εις","translit":"heis","kjv":"one","sense":"Numerically one, emphasizing God’s uniqueness and unity."},{"wordIndexes":[1],"original":"γαρ","translit":"gar","kjv":"For","sense":"Introduces the reason supporting the preceding instruction."},{"wordIndexes":[2],"original":"θεος","translit":"theos","kjv":"God","sense":"The one God, named as the first party joined by the mediator."},{"wordIndexes":[3],"original":"εις","translit":"heis","kjv":"one","sense":"Again numerically one, matching one mediator with one God."},{"wordIndexes":[4],"original":"και","translit":"kai","kjv":"and","sense":"Joins the two declarations: one God and one mediator."},{"wordIndexes":[5],"original":"μεσιτης","translit":"mesites","kjv":"mediator between","sense":"A go-between, with the supplied definition carrying reconciliation and intercession."},{"wordIndexes":[6],"original":"θεου","translit":"theou","kjv":"God","sense":"The genitive identifies God as one party served by the mediator."},{"wordIndexes":[7],"original":"και","translit":"kai","kjv":"and","sense":"Connects God and mankind as the two parties between whom he mediates."},{"wordIndexes":[8],"original":"ανθρωπων","translit":"anthropon","kjv":"men","sense":"Plural humanity: the mediator stands in relation to human beings collectively."},{"wordIndexes":[9],"original":"ανθρωπος","translit":"anthropos","kjv":"the man","sense":"Singular and emphatic: the mediator is truly human."},{"wordIndexes":[10],"original":"χριστος","translit":"Christos","kjv":"Christ","sense":"The Anointed One, identifying Jesus as the promised Messiah."},{"wordIndexes":[11],"original":"ιησους","translit":"Iesous","kjv":"Jesus","sense":"The personal name of the Lord, completing the mediator’s identification."}],"study":["The repeated heis, “one,” carries the verse’s balance: one God and one mediator. Mesites pictures a go-between who reconciles and intercedes, while the genitives “God” and “men” identify the parties between whom He stands. The KJV faithfully expresses that relationship with “mediator between.”","Anthropos then stresses that this mediator is “the man,” not an abstraction. He is personally identified as Christos Iesous, “Christ Jesus,” the Anointed One Jesus. The verse therefore fixes saving mediation in one person alone."],"carry":"The one God has appointed one mediator for mankind: the man Christ Jesus.","model":"openai/gpt-5.6-sol","cached":true}''')

# The production app's cached tap-a-verse explanation for 1 Timothy 2:5 KJV
# (VerseInsight, account-free cache) - what /api/verse-insight streams.
INSIGHT_1TIM_2_5 = (
    "In context, Paul grounds prayer for all people in God’s desire that they be saved and know the truth "
    "(1 Timothy 2:1-4). Jesus Christ alone reconciles sinful humanity to the one holy God because He gave "
    "Himself as the ransom for sinners (1 Timothy 2:6); no saint, priest, or other being shares His unique "
    "mediatorial office. This matters because salvation and access to the Father are found only through "
    "Christ, who is truly man and also God the Son (John 14:6; 1 Timothy 3:16)."
)

# Reader highlights for Matthew 5 (KJV), the Beatitudes: narration in verses
# 1-2, the Lord's words in red from verse 3.
HIGHLIGHTS = [(3, "#F5D76E"), (6, "#F5D76E"), (8, "#4A90D9"), (9, "#E87EA1")]

# What "Generate summary" returns for the sample memories above
# (POST /api/memories/summary).
MEMORY_SUMMARY = {
    "summary": {
        "overview": "A believer saved at 19 who reads the King James Bible, leads his family in devotions and teaches a men's class. This autumn he is reading Romans and hiding Scripture in his heart.",
        "sections": [
            {"title": "Walk", "content": "Saved and baptized young; growing in what it means to be dead to sin and alive unto God."},
            {"title": "Praying for", "content": "A coworker asking about the Gospel, and wisdom for a job decision."},
            {"title": "How he studies", "content": "One chapter of Romans a day; short answers with the full verse quoted."},
        ],
    },
    "generatedAt": "2026-10-07T15:20:00.000Z",
}


def verify_scripture() -> None:
    """Fail unless every KJV quotation in the fixtures matches the bundled KJV."""
    import re

    books = {b["name"]: b for b in json.loads((ROOT / "src/data/books.json").read_text())}

    def passage(ref: str) -> str:
        m = re.fullmatch(r"(.+?) (\d+):(\d+)(?:-(\d+))?", ref.strip())
        assert m, f"unparsed reference {ref}"
        book, chapter, start, end = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4) or m.group(3))
        verses = json.loads((ROOT / "src/data/kjv" / books[book]["file"]).read_text())[chapter - 1]
        return " ".join(verses[start - 1:end])

    def norm(text: str) -> str:
        return re.sub(r"[^a-z ]", "", re.sub(r"\s+", " ", text.lower().replace("-", " "))).strip()

    checks: list[tuple[str, str]] = []
    for answer in (ANSWER, FOLLOWUP_ANSWER):
        checks += [(q, r) for q, r in re.findall(r'"([^"]+)"\s*\(([^);]+)\)', answer)]
    checks += [(t, r) for r, _, t in RETRIEVED + FOLLOWUP_RETRIEVED]
    checks.append((CROSS["text"], CROSS["reference"]))
    for quote, ref in checks:
        assert norm(quote) in norm(passage(ref)), f"not KJV: {ref}: {quote}"
    print(f"verified {len(checks)} KJV quotations")


def write_fixtures() -> None:
    """Write the fixture manifest and bodies EvidenceFixtures reads."""
    verify_scripture()
    if FIXTURES.exists():
        shutil.rmtree(FIXTURES)
    FIXTURES.mkdir(parents=True)
    routes: list[dict] = []

    def add(method: str, path: str, name: str, body, content_type: str = "application/json") -> None:
        data = body if isinstance(body, str) and content_type != "application/json" else json.dumps(body, ensure_ascii=False)
        (FIXTURES / name).write_text(data, encoding="utf-8")
        routes.append({"method": method, "path": path, "file": name, "contentType": content_type})

    created = "2026-10-07T14:58:00.000Z"
    add("GET", "/api/conversations", "conversations.json", [
        {"id": CONVERSATION_ID, "title": "Can I know I am saved?", "createdAt": created},
        {"id": "ev-2", "title": "Romans 6 and dying to self", "createdAt": "2026-10-06T20:11:00.000Z"},
        {"id": "ev-3", "title": "Family devotions on Psalm 23", "createdAt": "2026-10-05T19:30:00.000Z"},
    ])
    def turn(n: int, question: str, query: str, verses, answer: str) -> list[dict]:
        """One stored question/answer pair, as GET /api/conversations/{id} returns it."""
        parts = [
            {
                "type": "tool-searchScripture",
                "toolCallId": f"call-{n}",
                "state": "output-available",
                "input": {"query": query},
                "output": {"verses": [
                    {"reference": r, "similarity": s, "text": t, "translation": "KJV"} for r, s, t in verses
                ]},
            },
            {"type": "text", "id": f"t{n}", "text": answer},
        ]
        return [
            {"id": f"u{n}", "role": "user", "content": question, "createdAt": created,
             "metadata": {"parts": [{"type": "text", "id": f"q{n}", "text": question}]}},
            {"id": f"a{n}", "role": "assistant", "content": answer, "createdAt": created,
             "metadata": {"parts": parts}},
        ]

    first = turn(1, "How can I know for sure that I am saved?", "assurance of salvation eternal life", RETRIEVED, ANSWER)
    second = turn(2, FOLLOWUP_QUESTION, "born again new birth", FOLLOWUP_RETRIEVED, FOLLOWUP_ANSWER)
    add("GET", f"/api/conversations/{CONVERSATION_ID}", "conversation.json",
        {"id": CONVERSATION_ID, "title": "Can I know I am saved?", "messages": first})
    add("GET", f"/api/conversations/{CONVERSATION_ID}-long", "conversation-long.json",
        {"id": f"{CONVERSATION_ID}-long", "title": "Can I know I am saved?", "messages": first + second})
    add("GET", "/api/verse-of-day/today", "cross.json", CROSS)
    # Listen is a Pro benefit; the fixture answers "unavailable" so no card
    # (and no purchase wording) appears in the store screenshots.
    add("GET", "/api/verse-of-day/audio", "audio.json", {"status": "unavailable", "plan": "free"})
    add("POST", "/api/verse-words", "words.json", WORDS_1TIM_2_5)
    add("POST", "/api/verse-insight", "insight.txt", INSIGHT_1TIM_2_5, "text/plain; charset=utf-8")
    add("GET", "/api/highlights", "highlights.json", {
        "highlights": [{"verse": v, "color": c} for v, c in HIGHLIGHTS]
    })
    add("POST", "/api/memories/summary", "memory-summary.json", MEMORY_SUMMARY)
    add("GET", "/api/memories", "memories.json", {
        "enabled": True,
        "memories": [
            {"id": f"mem{i}", "content": c, "category": cat, "updatedAt": f"2026-10-0{7 - i % 6}T09:00:00.000Z",
             **({"status": "open"} if cat == "prayer" else {})}
            for i, (cat, c) in enumerate(MEMORIES)
        ],
    })
    tag_rows = {tid: {"id": tid, "name": n, "color": c, "createdAt": "2026-09-01T00:00:00.000Z"} for tid, n, c in TAGS}
    add("GET", "/api/folders", "folders.json", [
        {"id": fid, "name": n, "parentId": None, "sortOrder": i, "createdAt": "2026-09-01T00:00:00.000Z"}
        for i, (fid, n) in enumerate(FOLDERS)
    ])
    add("GET", "/api/tags", "tags.json", list(tag_rows.values()))
    add("GET", "/api/notes", "notes.json", [
        {"id": nid, "title": title, "plainText": text, "folderId": folder, "isPinned": pinned,
         "wordCount": words, "createdAt": updated, "updatedAt": updated,
         "tags": [{"tag": tag_rows[t]} for t in tags], "aliases": []}
        for nid, title, folder, tags, pinned, text, words, updated in NOTES
    ])
    (FIXTURES / "routes.json").write_text(json.dumps(routes, indent=1), encoding="utf-8")


# --------------------------------------------------------------------------
# Capture
# --------------------------------------------------------------------------

# name -> launch arguments for the evidence harness (after -SureWordEvidence YES)
SCREENS: dict[str, list[str]] = {
    "chat": ["-evidence.screen", "shell", "-evidence.conversation", CONVERSATION_ID],
    "cross": ["-evidence.screen", "cross"],
    "reader": ["-evidence.screen", "reader", "-evidence.book", "40", "-evidence.chapter", "5", "-evidence.parchment", "1"],
    "words": ["-evidence.screen", "reader", "-evidence.book", "54", "-evidence.chapter", "2", "-evidence.select", "5",
              "-evidence.tier", "expanded", "-evidence.tab", "words"],
    "explain": ["-evidence.screen", "reader", "-evidence.book", "54", "-evidence.chapter", "2", "-evidence.select", "5",
                "-evidence.tier", "expanded", "-evidence.tab", "explain"],
    "notes": ["-evidence.screen", "shell", "-evidence.shellTab", "notes"],
    "memories": ["-evidence.screen", "memories", "-evidence.summary", "1"],
    "settings": ["-evidence.screen", "settings"],
    "home": ["-evidence.screen", "shell", "-evidence.shellTab", "bible", "-evidence.lastRead", "Romans|6|KJV"],
    "search": ["-evidence.screen", "search", "-evidence.query", "living water"],
}


def run(cmd: list[str], check: bool = True, **kw) -> subprocess.CompletedProcess:
    assert "booted" not in cmd, "never target 'booted'"
    assert AUSTIN_SIM not in cmd, "never touch Austin's simulator"
    return subprocess.run(cmd, check=check, text=True, capture_output=True, **kw)


def build_app(udid: str) -> Path:
    run(["xcodegen", "generate"], cwd=MACOS)
    result = run([
        "xcodebuild", "-project", "SureWord.xcodeproj", "-scheme", "SureWord-iOS", "-configuration", "Debug",
        "-destination", f"id={udid}", "-derivedDataPath", str(DERIVED), "build",
    ], check=False, cwd=MACOS)
    if result.returncode != 0:
        print(result.stdout[-4000:], result.stderr[-2000:])
        sys.exit("xcodebuild failed")
    return DERIVED / "Build/Products/Debug-iphonesimulator/SureWord.app"


def capture(only: list[str] | None = None, devices: list[str] | None = None, keep: bool = False) -> None:
    write_fixtures()
    RAW.mkdir(parents=True, exist_ok=True)
    for kind in devices or list(DEVICES):
        name, device_type, size = DEVICES[kind]
        existing = json.loads(run(["xcrun", "simctl", "list", "devices", "-j"]).stdout)["devices"].get(RUNTIME, [])
        udid = next((d["udid"] for d in existing if d["name"] == name), None)
        if udid is None:
            udid = run(["xcrun", "simctl", "create", name, device_type, RUNTIME]).stdout.strip()
        assert udid != AUSTIN_SIM
        run(["xcrun", "simctl", "boot", udid], check=False)
        run(["xcrun", "simctl", "bootstatus", udid, "-b"])
        app = build_app(udid)
        run(["xcrun", "simctl", "install", udid, str(app)])
        run(["xcrun", "simctl", "ui", udid, "appearance", "dark"])
        run(["xcrun", "simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged",
             "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3", "--dataNetwork", "wifi"])
        container = Path(run(["xcrun", "simctl", "get_app_container", udid, BUNDLE_ID, "data"]).stdout.strip())
        target = container / "Documents/evidence-fixtures"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(FIXTURES, target)
        for screen, args in SCREENS.items():
            if only and screen not in only:
                continue
            if kind == "ipad" and screen == "chat":
                # The 13" screen has room for the follow-up turn too.
                args = [a if a != CONVERSATION_ID else f"{CONVERSATION_ID}-long" for a in args]
            run(["xcrun", "simctl", "launch", "--terminate-running-process", udid, BUNDLE_ID,
                 "-SureWordEvidence", "YES", "-evidence.appearance", "dark", *args])
            time.sleep(9 if screen in ("words", "explain", "chat", "atlas") else 6)
            out = RAW / f"{kind}-{screen}.png"
            run(["xcrun", "simctl", "io", udid, "screenshot", str(out)])
            print("captured", out.relative_to(ROOT))
        run(["xcrun", "simctl", "terminate", udid, BUNDLE_ID], check=False)
        if not keep:
            run(["xcrun", "simctl", "shutdown", udid], check=False)
            run(["xcrun", "simctl", "delete", udid], check=False)


# --------------------------------------------------------------------------
# Art (textless backgrounds, OpenAI gpt-image-2.5-sunburst)
# --------------------------------------------------------------------------

IMAGE_MODEL = "gpt-image-2.5-sunburst"

STYLE = (
    "Reverent, quiet, cinematic fine-art photograph. Palette: near-black #0a0a0a background, warm gold and "
    "amber light, a little deep umber; no other colours. Soft, low contrast, lots of calm dark negative space, "
    "fine film grain. Absolutely no text, no letters, no words, no numbers, no writing, no calligraphy, no "
    "symbols, no logos, no watermark, no people, no faces, no crosses drawn on anything."
)

ART_PROMPTS: dict[str, str] = {
    "dawn": (
        "A single bright morning star rising in a deep near-black sky just before dawn, its warm gold light "
        "spreading in long, soft rays across the upper half of the frame. Far below, at the very bottom edge, "
        "the faint gilded edges of an open old book catch the first light, its pages softly out of focus and "
        "blank. The top third is dark and empty. " + STYLE
    ),
    "rays": (
        "Abstract: gentle shafts of warm golden light falling diagonally from the upper left through darkness, "
        "with fine floating dust motes glowing like tiny stars, and a soft radiant glow low in the frame. "
        "Mostly deep black. " + STYLE
    ),
    "parchment": (
        "Close macro texture of very old, dark aged parchment paper with subtle fibres and creases, lit from the "
        "top by a soft warm gold glow that fades into near-black at the edges, like candlelight. The parchment "
        "is completely blank. " + STYLE
    ),
}

# Where the day star sits in each dawn image (fraction of width, height),
# measured on the generated art; the composer lifts it into the gap under
# the headline.
STAR_AT = {"iphone-dawn": (0.508, 0.479), "ipad-dawn": (0.506, 0.453)}

# Which art each output format gets, and the size requested from the model
# (multiples of 16, close to the target aspect; the composer cover-crops).
ART_JOBS: dict[str, tuple[str, str]] = {
    "iphone-dawn": ("dawn", "1328x2880"),
    "iphone-rays": ("rays", "1328x2880"),
    "iphone-parchment": ("parchment", "1328x2880"),
    "ipad-dawn": ("dawn", "1536x2048"),
    "ipad-rays": ("rays", "1536x2048"),
    "ipad-parchment": ("parchment", "1536x2048"),
    "promo-square": ("dawn", "1088x1088"),
    "promo-portrait": ("rays", "1088x1360"),
    "promo-story": ("dawn", "1088x1920"),
}


def openai_key() -> str:
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"].strip()
    path = Path(os.environ.get("OPENAI_KEY_FILE", DEFAULT_KEY_FILE))
    return path.read_text().strip()


def generate_art(only: list[str] | None = None) -> int:
    import requests

    ART.mkdir(parents=True, exist_ok=True)
    key = openai_key()
    generated = 0
    for name, (prompt_key, size) in ART_JOBS.items():
        if only and name not in only:
            continue
        out = ART / f"{name}.png"
        if out.exists():
            continue
        response = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": IMAGE_MODEL, "prompt": ART_PROMPTS[prompt_key], "size": size, "quality": "high",
                  "output_format": "png", "n": 1},
            timeout=600,
        )
        if response.status_code != 200:
            print(name, response.status_code, response.text[:500])
            continue
        out.write_bytes(base64.b64decode(response.json()["data"][0]["b64_json"]))
        generated += 1
        print("generated", out.relative_to(ROOT))
    return generated


# --------------------------------------------------------------------------
# Compose
# --------------------------------------------------------------------------

# (file stem, capture, art, headline, subline). Same story on both devices;
# the first slide is the strongest.
SLIDES = [
    ("01-answers", "chat", "dawn", "Answers from the\nKing James Bible",
     "Ask anything. Every answer quotes the verses and cites them."),
    ("02-daily-cross", "cross", "rays", "A verse chosen for you,\neach morning",
     "Pick Up Your Cross: why it was chosen, and how to live it today."),
    ("03-knows-your-walk", "memories", "dawn", "Study that knows\nyour walk",
     "SureWord remembers what you share, and you can see or delete all of it."),
    ("04-reader", "reader", "parchment", "The whole\nKing James Bible",
     "Red letters, highlights and a parchment page, even offline."),
    ("05-original-words", "words", "rays", "Every word, back to\nthe Greek and Hebrew",
     "Tap a verse for an explanation and a word-by-word study."),
    ("06-notes", "notes", "parchment", "Your notes,\nkept together",
     "Folders, tags and pins, all in one quiet place."),
    ("07-pick-up", "home", "dawn", "Pick up where\nyou left off",
     "Continue reading, today's cross and Learn a verse, on one page."),
    ("08-search", "search", "rays", "Find the verse you\nhalf remember",
     "Search the King James text and open any passage."),
]

PROMOS = [
    # (file, size, art, capture, headline, subline)
    ("sureword-promo-1080x1080.png", (1080, 1080), "promo-square", "cross", "Your daily walk\nwith God",
     "A verse chosen for you each morning, from the King James Bible."),
    ("sureword-promo-1080x1350.png", (1080, 1350), "promo-portrait", "chat", "Bible study\nthat knows you",
     "Answers from the King James Bible, shaped by your reading, notes and walk."),
    ("sureword-promo-1080x1920.png", (1080, 1920), "promo-story", "cross", "Pick up your cross\neach morning",
     "A personal Bible study and daily walk with God, rooted in the King James Bible."),
]

HEADLINE_COLOR = (246, 236, 212)
SUBLINE_COLOR = (214, 186, 128)
GOLD = (201, 162, 74)
FONT_SERIF = "/System/Library/Fonts/NewYork.ttf"
FONT_SANS = "/System/Library/Fonts/SFNS.ttf"
FONT_WORDMARK = MACOS / "Shared/Resources/Fonts/PirataOne-Regular.ttf"
APP_ICON = MACOS / "SureWord-iOS/Assets.xcassets/AppIcon.appiconset/icon-1024.png"


def font(path, size: int, weight: str | None = None):
    from PIL import ImageFont

    f = ImageFont.truetype(str(path), size)
    if weight:
        try:
            f.set_variation_by_name(weight)
        except Exception:
            pass
    return f


def cover(img, size):
    from PIL import Image

    w, h = size
    scale = max(w / img.width, h / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    return resized.crop((left, top, left + w, top + h))


def background(art_name: str, size, text_band: float, star_y: int | None = None):
    """Art cover-cropped, darkened behind the headline band, softly vignetted."""
    from PIL import Image, ImageDraw, ImageFilter

    w, h = size
    source = Image.open(ART / f"{art_name}.png").convert("RGB")
    if art_name in STAR_AT and star_y is not None:
        # Rise the day star into the gap between the words and the device.
        sx, sy = STAR_AT[art_name]
        scale = max(w / source.width, h / source.height) * 1.3
        big = source.resize((round(source.width * scale), round(source.height * scale)), Image.LANCZOS)
        left = round(big.width * sx - w / 2)
        top = max(0, min(big.height - h, round(big.height * sy - star_y)))
        art = big.crop((left, top, left + w, top + h))
    else:
        art = cover(source, size)
    if "parchment" in art_name:
        # The parchment is the brightest art; keep it a texture, not a page.
        art = Image.blend(Image.new("RGB", size, (10, 10, 10)), art, 0.55)
    shade = Image.new("L", size, 0)
    draw = ImageDraw.Draw(shade)
    lifted = art_name in STAR_AT and star_y is not None
    # With the star lifted, the shade ends just above it so it shines.
    band = star_y - int(h * 0.02) if lifted else int(h * text_band)
    fade = h * (0.05 if lifted else 0.3)
    for y in range(h):
        if y < band:
            a = 200 - int(70 * y / band)
        else:
            a = max(25 if lifted else 40, 130 - int(110 * (y - band) / fade))
        draw.line([(0, y), (w, y)], fill=a)
    art = Image.composite(Image.new("RGB", size, (10, 10, 10)), art, shade)
    vignette = Image.new("L", size, 0)
    ImageDraw.Draw(vignette).ellipse((-w * 0.25, -h * 0.1, w * 1.25, h * 1.1), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(w * 0.12))
    return Image.composite(art, Image.new("RGB", size, (10, 10, 10)), vignette)


def framed_device(shot, width: int):
    """The untouched capture inside a dark rounded bezel with a thin warm rim."""
    from PIL import Image, ImageDraw

    scale = width / shot.width
    inner = shot.convert("RGB").resize((width, round(shot.height * scale)), Image.LANCZOS)
    is_pad = shot.width / shot.height > 0.6
    bezel = round(width * (0.022 if is_pad else 0.03))
    radius_inner = round(width * (0.035 if is_pad else 0.135))
    radius_outer = radius_inner + bezel
    W, H = inner.width + 2 * bezel, inner.height + 2 * bezel
    device = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(device)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius_outer, fill=(64, 54, 38, 255))
    rim = max(2, round(width * 0.003))
    d.rounded_rectangle((rim, rim, W - 1 - rim, H - 1 - rim), radius_outer - rim, fill=(14, 14, 14, 255))
    mask = Image.new("L", inner.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner.width - 1, inner.height - 1), radius_inner, fill=255)
    device.paste(inner, (bezel, bezel), mask)
    return device


def paste_with_shadow(canvas, device, xy, glow: bool = True):
    from PIL import Image, ImageFilter

    x, y = xy
    pad = round(device.width * 0.12)
    alpha = device.split()[3]
    shadow = Image.new("RGBA", (device.width + 2 * pad, device.height + 2 * pad), (0, 0, 0, 0))
    black = Image.new("RGBA", device.size, (0, 0, 0, 230))
    shadow.paste(black, (pad, pad + round(device.width * 0.02)), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(device.width * 0.04))
    canvas.alpha_composite(shadow, (x - pad, y - pad))
    if glow:
        halo = Image.new("RGBA", shadow.size, (0, 0, 0, 0))
        warm = Image.new("RGBA", device.size, (214, 170, 80, 70))
        halo.paste(warm, (pad, pad), alpha)
        halo = halo.filter(ImageFilter.GaussianBlur(device.width * 0.07))
        canvas.alpha_composite(halo, (x - pad, y - pad))
    canvas.alpha_composite(device, (x, y))


def draw_text_block(canvas, headline: str, subline: str, top: int, width: int, head_size: int, sub_size: int,
                    max_text_width: int) -> int:
    """Centered serif headline and sans subline; returns the bottom y."""
    from PIL import ImageDraw

    d = ImageDraw.Draw(canvas)
    hf = font(FONT_SERIF, head_size, "Semibold")
    sf = font(FONT_SANS, sub_size, "Regular")
    y = top
    for line in headline.split("\n"):
        box = d.textbbox((0, 0), line, font=hf)
        assert box[2] - box[0] <= width * 0.92, f"headline too wide: {line}"
        d.text(((width - (box[2] - box[0])) / 2 - box[0], y), line, font=hf, fill=HEADLINE_COLOR)
        y += round(head_size * 1.16)
    # A short gold rule between headline and subline, like the app's dividers.
    y += round(head_size * 0.22)
    rule = round(width * 0.05)
    d.line([((width - rule) / 2, y), ((width + rule) / 2, y)], fill=GOLD, width=max(2, round(head_size * 0.03)))
    y += round(head_size * 0.36)
    # Balanced wrap: as few lines as fit, with the words spread evenly so no
    # line ends on a lonely word.
    words = subline.split()
    total = d.textlength(subline, font=sf)
    def wrap(target: float) -> list[str]:
        out, current = [], ""
        for word in words:
            trial = f"{current} {word}".strip()
            if d.textlength(trial, font=sf) <= target or not current:
                current = trial
            else:
                out.append(current)
                current = word
        return out + [current]

    count = len(wrap(max_text_width))
    target = total / count
    while len(lines := wrap(target)) > count:
        target += max_text_width * 0.01
    for line in lines:
        w = d.textlength(line, font=sf)
        d.text(((width - w) / 2, y), line, font=sf, fill=SUBLINE_COLOR)
        y += round(sub_size * 1.35)
    return y


def compose_slide(kind: str, slide) -> Path:
    from PIL import Image

    stem, capture_name, art, headline, subline = slide
    size = DEVICES[kind][2]
    w, h = size
    if kind == "iphone":
        head, sub, top, text_w, device_w = 112, 46, 170, 1100, 1000
    else:
        head, sub, top, text_w, device_w = 124, 52, 150, 1700, 1640
    words = Image.new("RGBA", size, (0, 0, 0, 0))
    bottom = draw_text_block(words, headline, subline, top, w, head, sub, text_w)
    canvas = background(f"{kind}-{art}", size, 0.24 if kind == "iphone" else 0.2,
                        star_y=bottom + round(h * 0.03)).convert("RGBA")
    canvas.alpha_composite(words)
    shot = Image.open(RAW / f"{kind}-{capture_name}.png")
    assert shot.size == size, f"{capture_name}: capture is {shot.size}, expected {size}"
    y = bottom + round(h * 0.05)
    # The whole screen stays visible, tab bar included: shrink to fit.
    available = h - y - round(h * 0.03)
    device_w = min(device_w, int(available / (shot.height / shot.width) * 0.97))
    device = framed_device(shot, device_w)
    paste_with_shadow(canvas, device, ((w - device.width) // 2, y))
    out_dir = OUT_IPHONE if kind == "iphone" else OUT_IPAD
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}.png"
    save_png(canvas.convert("RGB"), out)
    return out


def compose_promo(promo) -> Path:
    from PIL import Image, ImageDraw

    name, size, art, capture_name, headline, subline = promo
    w, h = size
    canvas = background(art, size, 0.34 if h > w else 0.42).convert("RGBA")
    # Wordmark row: app icon + "SureWord" in the brand face.
    icon_size = round(w * 0.075)
    icon = Image.open(APP_ICON).convert("RGBA").resize((icon_size, icon_size), Image.LANCZOS)
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, icon_size - 1, icon_size - 1), round(icon_size * 0.225), fill=255)
    wf = font(FONT_WORDMARK, round(icon_size * 0.8))
    d = ImageDraw.Draw(canvas)
    label_w = d.textlength("SureWord", font=wf)
    gap = round(icon_size * 0.28)
    row_w = icon_size + gap + label_w
    top = round(h * 0.05) if h > w else round(h * 0.055)
    x0 = round((w - row_w) / 2)
    canvas.paste(icon, (x0, top), mask)
    box = d.textbbox((0, 0), "SureWord", font=wf)
    d.text((x0 + icon_size + gap, top + (icon_size - (box[3] - box[1])) / 2 - box[1]), "SureWord", font=wf,
           fill=(228, 196, 120))
    head = round(w * (0.088 if h > w else 0.078))
    sub = round(w * 0.033)
    bottom = draw_text_block(canvas, headline, subline, top + icon_size + round(h * 0.035), w, head, sub,
                             round(w * 0.86))
    shot = Image.open(RAW / f"iphone-{capture_name}.png")
    device_w = round(w * (0.62 if h > w * 1.5 else 0.56 if h > w else 0.5))
    device = framed_device(shot, device_w)
    paste_with_shadow(canvas, device, ((w - device.width) // 2, bottom + round(h * 0.03)))
    OUT_PROMO.mkdir(parents=True, exist_ok=True)
    out = OUT_PROMO / name
    save_png(canvas.convert("RGB"), out)
    return out


def save_png(img, out: Path) -> None:
    """Palette-quantize with libimagequant when available (pngquant's engine),
    else a lossless optimized PNG. Never writes alpha: App Store Connect
    refuses screenshots with transparency, so a palette PNG gets no tRNS."""
    try:
        import imagequant

        quantized = imagequant.quantize_pil_image(img, dithering_level=1.0, max_colors=256, min_quality=70,
                                                  max_quality=95)
        # libimagequant hands back an RGBA palette; rebuild it as plain RGB.
        from PIL import Image

        opaque = Image.frombytes("P", quantized.size, quantized.tobytes())
        opaque.putpalette(quantized.getpalette("RGB"))
        opaque.save(out, optimize=True)
    except Exception as error:
        if not isinstance(error, ImportError):
            print("quantize failed, saving lossless:", error)
        img.save(out, optimize=True)


def compose(only: list[str] | None = None) -> None:
    outputs = []
    for kind in DEVICES:
        for slide in SLIDES:
            if only and slide[0] not in only and kind not in only:
                continue
            outputs.append(compose_slide(kind, slide))
    if not only or "promos" in only:
        outputs += [compose_promo(p) for p in PROMOS]
    for out in outputs:
        info = run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", str(out)]).stdout.split()
        width, height, alpha = info[-5], info[-3], info[-1]
        assert alpha == "no", f"{out} has an alpha channel"
        print(out.relative_to(ROOT), f"{width}x{height}", f"alpha={alpha}", f"{out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    args = sys.argv[1:] or ["all"]
    step = args[0]
    rest = args[1:]
    if step == "fixtures":
        write_fixtures()
    elif step == "capture":
        devices = [a for a in rest if a in DEVICES]
        screens = [a for a in rest if a in SCREENS]
        capture(screens or None, devices or None, keep="--keep" in rest)
    elif step == "art":
        print("generations:", generate_art(rest or None))
    elif step == "compose":
        compose(rest or None)
    elif step == "all":
        capture()
        print("generations:", generate_art())
        compose()
    else:
        sys.exit(f"unknown step {step}")
