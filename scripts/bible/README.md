# SureWord Bible data

SureWord serves and bundles published public-domain editions. This is our own
API and presentation layer, not a new translation. There is no paid upstream
Bible API call for KJV or BSB. Normal app hosting and bandwidth still apply.

- `GET /api/bible/versions` lists the editions and their formatting capabilities.
- `GET /api/bible/chapter?translation=BSB&book=43&chapter=3` returns John 3.
- `translation=KJV` uses the bundled KJV (built from eBible.org's standard
  1769 text by `scripts/bible/build-kjv.py`) plus the eBible speech sidecar
  and separately attributed BSB editorial section headings.

The chapter response contains numbered verses, plain Scripture text, separate
section headings, paragraph starts, and text segments with `italic` and
`jesusSpeech` flags. Omitted BSB verse numbers have empty text and `omitted:
true`; later references keep their actual number. Headings never enter copied
Scripture. These public endpoints contain no account data and are edge cached.

## BSB provenance and rebuild

Publisher downloads: https://berean.bible/downloads.htm
Publisher rights: https://berean.bible/licensing.htm

```sh
curl --fail --location https://bereanbible.com/bsb_usj.zip -o /tmp/bsb_usj.zip
curl --fail --location https://bereanbible.com/bsb.txt -o /tmp/bsb.txt
python3 scripts/bible/build-bsb.py /tmp/bsb_usj.zip /tmp/bsb.txt
npm --prefix mobile test -- src/features/bible/bsb.test.ts
```

The importer preserves publisher-authored speech spans across verses, supplied
word italics, section headings, Psalm 119 alphabet headings, and poetry line
breaks. Footnote bodies and parallel-reference labels are excluded from the
main verse text. The source labels are not AI-generated. The source manifest
records both SHA-256 hashes.

Before writing outputs, all 31,102 verse slots are checked against the
publisher's independent plain-text download, ignoring formatting. Three `vvv`
export artifacts at Genesis 35:18, Luke 9:33, and Acts 4:36 are removed by
explicit reference-specific rules validated against that download. Unknown
wording differences abort the import. Do not replace those checks with fuzzy
matching.

Generated data ships in `src/data/bsb` and
`mobile/src/features/bible/data/bsb`; corpus tests enforce equality. Web loads
one book at a time. Android bundles the edition and works without a network.
The loader interfaces live in each client's `bsb.ts`; data regeneration does
not modify those interfaces.

KJV red letters: see
`mobile/src/features/bible/data/RED-LETTERS.md` and
`build-kjv-red-letters.py`.

## Scope

BSB is an additional named translation. Existing KJV and NKJV preferences are
not automatically migrated. The web and React Native readers, attachments,
preferences, search, verse lookup, insight and learning contracts support BSB.
Apple's SwiftUI clients still need corresponding edition support before a
coordinated release; they are not modified by this change. NKJV remains on the
existing provider and does not claim red-letter/heading support. Self-hosting
NKJV would still require permission from its rights holder.

KJV section headings are an editorial aid extracted from the BSB source and
credited separately. They do not claim to be part of the original KJV text,
are not used as speech markers, and never enter copied Scripture.

## Reina-Valera 1909 and Lutherbibel 1912

`build-ebible.py RV1909|LUT1912 <vpl.zip>` turns eBible.org's verse-per-line
download (`spaRV1909_vpl.zip`, `deu1912_vpl.zip`) into one `string[][]` JSON
per book, in KJV verse slots, for web (`src/data/rv1909`, `src/data/lut1912`),
Android and Apple, plus a `src/data/<id>-source.json` with the source's sha256.
Run it with `python -I` and keep the download in its own folder.

- Luther 1912 already uses KJV numbering.
- The Spanish source merges a few verses into their neighbours, the same way in
  every RV1909 edition we found. `versification/RV1909.json` lists each span
  and the opening words of every verse to split back out, so all 31,102 KJV
  slots get their own text. The build aborts if any slot is empty or any text
  falls outside a slot.
- Spanish cleanup: Psalm 119 acrostic labels, drop capitals on verse 1 and
  after Psalm and Proverbs titles, and the epistle subscriptions after the
  final "Amén." are removed.
- Luther 1912 does not contain 1 John 5:7 as the KJV reads it; the slot holds
  Luther's own wording of that verse.
