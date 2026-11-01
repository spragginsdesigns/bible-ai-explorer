# Scripture Check (`verify`)

**Issue:** LC-17649 (Part 1 of the module). **Status:** building.
**Route:** `/beta/study/verify`, founders only (`docs/beta/README.md`).

Paste or upload a sermon, devotional or AI answer and see every quotation set
beside the Scripture it gives, word for word, and every reference opened. The
check is deterministic: the bundled KJV and BSB decide every verdict, no model
is asked and nothing is spent. Nothing is stored yet.

## What it does

1. **Finds the references.** Modern ("John 3:16", "1 Cor. 13:4-7", "Romans
   8:28, 31", "Romans 8:28; 9:1", a trailing translation tag such as "BSB" or
   "(NKJV)"), old style ("Psalm lxxiii. 18, 19", "DEUTERONOMY xxxii. 35"), and a
   capitalized full book name with a chapter ("Psalm 23", "Romans 8"; "Mark 2
   weeks" and "9:00 am" are not references). Book names come from the chat's
   verse links (`src/utils/verseParser.ts`) and resolve through
   `resolveReference`. A chapter or verse that does not exist ("Psalm 151",
   "John 3:99") is reported as not a real reference.
2. **Finds the quotations** the teaching marks: curly or straight double
   quotes within a paragraph, and Markdown blockquotes. Apostrophes, one- to
   three-word fragments and bracketed editorial words ("[God has]") are not
   quotations. A citation belongs to a quotation when it is inside it (a
   blockquote's reference line), right after it ("(1 Peter 5:7, BSB)"), or just
   before it in the same sentence ("John 10:3 says, ...").
3. **Checks each quotation.** A semi-global word alignment against the cited
   verses: every quoted word is accounted for, and the verse may be entered and
   left anywhere, because a quotation is usually part of a verse. When the
   quotation cites nothing, or the cited verses do not hold its words, the
   whole KJV is searched (an index of every verse's words, ranked by how rare
   the shared words are) and the best verse and its neighbours are aligned.
   The BSB of the same verses is aligned too, and the closer one is shown (the
   KJV between equals).
4. **Shows it side by side.** The teaching's words (dashed rule) beside the
   verse (gold rule), each word marked: a different word, a word the verse does
   not have, a verse word left out, a minor difference, or left out where the
   quotation marks it with "...". The words of the verse around the quoted part
   are shown in grey. Every passage, and the cited one when it differs, opens in
   the reader (`/bible/chapter?book=&chapter=&verse=&translation=KJV`).

## Verdicts

| Verdict | When |
|---|---|
| Exact | Word for word the KJV or the BSB (case and punctuation aside). |
| Minor wording difference | Only spelling ("shew"/"show", "labour", doubled letters), older verb forms ("calleth"/"calls"), archaic pronouns, or small connecting words, and not too many of them. "Not", "no" and direction words are never minor. |
| Another translation | Modern English for this verse: it modernises the KJV's archaic words and keeps none of its own, or it names a translation SureWord does not bundle (NIV, NKJV, ESV ...). Shown beside the KJV, never called a misquote. A quotation that names the KJV or the BSB is held to it. |
| Misquote | Presented as the verse, with words changed, added or missing. |
| Wrong reference | Cited as one place, but the words are another ("Isaiah 40:31" for Isaiah 41:10). A quotation that runs on past its cited verse into the next one is still that verse's; "John 3:17" for the words of 3:16 is a wrong reference. |
| Not found in Scripture | Cited, or presented as Scripture ("The Bible says", "Jesus said", "It is written"), and the words are nowhere in the KJV. A quotation of a person ("As C. S. Lewis wrote") is left alone. |

An uncited quotation is only reported when its words are found in Scripture
(enough of them, and enough of the words that carry meaning: "a speck on the
surface of the earth" shares "on the ... of the earth" with Genesis 6:1 and is
not Genesis 6:1), or when it is presented as Scripture.

## Files

| What | Where |
|---|---|
| Page | `src/app/beta/study/verify/page.tsx` |
| API | `src/app/api/beta/verify/check/route.ts` (`POST { text }` → `{ report }`, up to 200,000 characters) |
| Engine | `src/lib/beta/verify/engine.ts` (references, corpus index, checks) |
| Pure rules | `src/lib/beta/verify/verify-rules.ts` (folding, alignment, verdicts, quotation spans; no imports) |
| Components | `src/components/beta/verify/` |
| Tests | `tests/beta-verify.test.mjs` |

The KJV is indexed once per server instance (about 1.5 s on first use); a
check of a 99,000-character composite of sermons takes about 2 s after that.

## Not yet (Part 2)

Claim labels (direct Scripture, interpretation, historical claim, with
contested readings named), out-of-context flags with the model's judgment
labelled as judgment, unmarked Scripture read aloud in a transcript and close
paraphrase, "verse 28" read against the chapter in view, NKJV wording through
the reader's loader, and saving a report (`BetaItem`, module `verify`, with
`refs`) to re-run and find in the Knowledge Vault. Those use the house model
and the `/check` and `/verify` discernment guidance, and never change
`doctrinalFoundation`.

## Proof (LC-17649)

A production build signed in as the founder stand-in on a throwaway Neon
branch, at 1280 and 375px with touch, on a planted AI answer, Our Daily Bread
for 2026-10-26 and Jonathan Edwards' "Sinners in the Hands of an Angry God"
(1741); the off-list account gets the ordinary 404 on the page and the API.
Screenshots are on the Linear issue.
