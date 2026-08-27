# Bible atlas data

Four hand-authored files behind **Timeline, People & Places**:

| File | What it holds |
|---|---|
| `events.json` | 220 events from Creation to the writing of Revelation, in chronological order |
| `people.json` | 186 people |
| `places.json` | 93 places |
| `relations.json` | Reviewed, KJV-cited typed relationship edges between people and places |

They are mirrored into the Android app at `mobile/src/data/bible-atlas/` by
`scripts/build-bible-atlas.mjs`. **Never edit the copies in `mobile/`** - edit
these, then run the script.

## Dating: Ussher, because the KJV's margins carry it

Every `yearLabel` follows the traditional **Ussher chronology** ("c. 4004 BC"
for the creation), the dating printed in the margins of most KJV editions since
the eighteenth century. It is a computation from the genealogies and reign
lengths of Scripture, not part of the inspired text itself - which is why the
labels are marked "c." and why the app calls them the traditional dating rather
than presenting them as Scripture. Where Scripture gives no date at all, the
label says so (`"date not given"`, as for Job).

## Content rules

These are enforced by the validator wherever a machine can check them, and are
binding on the author where it cannot:

1. **Only what the KJV says.** Every `summary` and `description` states what the
   text states. No tradition, no extra-biblical legend, no speculation
   presented as Scripture.
2. **Every reference must resolve** to a real KJV book, chapter and verse. The
   validator opens the bundled KJV text and checks the verse numbers exist.
3. **Every person and place must actually be named** in at least one of the
   verses it cites. The validator reads the verse text and looks for the `name`
   or one of its `alsoCalled` aliases. This is what stops an invented reference
   from surviving: if the KJV calls someone by a different name there
   (`Elias` for Elijah, `Booz` for Boaz, `Esaias` for Isaiah), that spelling
   belongs in `alsoCalled`.
4. **Events stay in chronological order** in the file, and their `era` values
   never go backwards.
5. **Every id an event names must exist** in `people.json` / `places.json`, and
   every `related` id must exist too.

## Shapes

```jsonc
// events.json
{ "id": "the-flood", "title": "The flood", "era": "Creation & the Patriarchs",
  "yearLabel": "c. 2348 BC", "summary": "...",
  "refs": ["Genesis 7:11", "Genesis 8:4"],
  "people": ["noah"], "places": ["ararat"] }

// people.json
{ "id": "moses", "name": "Moses", "alsoCalled": ["..."], "description": "...",
  "era": "Egypt & the Exodus", "refs": ["Exodus 2:10"], "related": ["aaron"] }

// places.json
{ "id": "jericho", "name": "Jericho", "alsoCalled": ["..."], "description": "...",
  "refs": ["Joshua 6:20"], "modernRegion": "..." }

// relations.json
{ "id": "moses-aaron-sibling", "from": "moses", "to": "aaron",
  "type": "sibling", "refs": ["Exodus 4:14"], "certainty": "explicit" }
```

Relations are authored in one direction; the atlas core computes inverse display
labels. `related` remains as a legacy, untyped fallback for older clients.
Collision-prone people may also carry a short `disambiguator` label (for
example, `Joseph, son of Jacob`) for list and detail displays.

`modernRegion` is set only where the location is not in doubt; it is left off
everywhere else rather than guessed at.

The nine eras, in order, are listed in `src/lib/bible/atlas-core.ts`
(`ATLAS_ERAS`) and repeated in the validator. Adding one means changing both.

## References

Four shapes are accepted, and nothing else:

| Shape | Example |
|---|---|
| whole chapter | `Genesis 1` |
| one verse | `John 3:16` |
| verses in a chapter | `Genesis 12:1-4` |
| whole chapters | `Genesis 6-9` |

## Regenerating / validating

```bash
node scripts/build-bible-atlas.mjs
```

Prints the counts and the number of references checked, or exits non-zero
listing every problem. It also copies `src/lib/bible/atlas-core.ts` to
`mobile/src/features/atlas/atlasCore.ts`, so the phone and the server share one
implementation of search ranking, era grouping and reference parsing.

`tests/bible-atlas.test.mjs` (run by `pnpm test:logic`) re-checks the data from
the test side: unique ids, resolvable references, no dangling entity ids, and
that search finds the right entry by name and by alias.
