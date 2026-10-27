# Atlas & Timeline (`atlas`)

**Issue:** LC-17655 (Jay, from LC-17631). **Where:** `/beta/bible/atlas`,
founders only. **Status:** live.

An immersive map and chronology of Scripture, inspired by Google Earth and
historical timelines, built on SureWord's existing atlas corpus (the people,
places and events behind `/bible/timeline`) and the bundled KJV. One map and
three ways through it:

- **Journeys** play stop by stop while the map follows: Paul's first, second
  and third journeys, the voyage to Rome, the Exodus, Abraham's travels and
  the Gospels' ministry (seven journeys, 124 stops). Each stop shows its verses
  from the bundled KJV and a short note that says only what those verses say,
  with Previous, Play/Pause (8 seconds a stop) and Next, and every stop in a
  list. Legs Scripture says were sailed are drawn dashed.
- **Timeline** scrubs from Creation (c. 4004 BC) to Patmos (c. AD 96): drag
  the track, use the arrow keys (Shift for ten years, Page Up/Down for the next
  event), or zoom to one era. Nine lanes sit under the era bands: patriarchs,
  Exodus & judges, the united kingdom, the kings of Israel and of Judah, the
  prophets, exile & return, the life of Christ and the early church. Below the
  track the year is laid out side by side: who reigned in Israel and in Judah,
  which prophets were speaking, and the nearest events. The map marks the
  places of those events.
- **Places** shows every site (137 markers) with regions to fly to (the
  Bible's world, the Holy Land, Jerusalem, Galilee, Paul's world, Egypt &
  Sinai, Mesopotamia) and a search by any name Scripture uses (Sichem finds
  Shechem, Olivet the mount of Olives).

Any place or event opens a **card**: what the corpus says, how sure the site
is, its passages from the bundled KJV with links into the reader, what
happened there, the journeys through it, and "Ask about this" (the chat's
own `/?prompt=` deep link, so sending stays the founder's choice).

**From the reader:** tapping a verse opens the verse sheet, and for founders
its peek lists the atlas places those verses name ("In the atlas: Ephesus ›"),
each opening the atlas on that place. Everyone else's reader is unchanged: the
row asks the founders-only probe (`GET /api/beta/access`) at most once per
account per session, only after a verse is opened, and never calls the atlas
API for anyone off the list.

The page keeps its state in the URL (`?mode=journeys&journey=paul-2&stop=9`,
`?mode=timeline&year=-760&era=divided-kingdom`, `?place=ephesus`,
`?event=the-flood`), so refresh, Back and shared links return to the same
study; anything unknown falls back to the defaults.

## Data: extending the corpus, not forking it

The corpus (`src/data/bible-atlas/*.json`) is untouched and still the source
for every place's name, description and refs and every event's title, date
and summary. It is mirrored into the Android app, so while the beta is
web-only its additions live beside it in `src/lib/beta/atlas/`, keyed by the
corpus's own ids:

| File | What it adds |
|---|---|
| `places.ts` | Where every corpus place is (`BETA_ATLAS_GEO`), how sure the identification is (`known`, `traditional`, `uncertain`), places drawn at another's marker (Horeb at Sinai, Babel at Babylon), the one place left off (Eden: Scripture names its rivers, not its site), and 47 journey waypoints the corpus lacks (Perga, Miletus, Puteoli...). |
| `journeys.ts` | The seven journeys: each stop's place, refs, note, sea leg and corpus event. Dated by corpus events, so a journey is dated exactly as the timeline dates it. |
| `lanes.ts` | The nine timeline lanes and the era spans of the scrubber. |
| `regions.ts` | The Places view's region presets. |
| `basemap.ts` | Generated land, lakes and rivers (below). |

The waypoints use the corpus's `AtlasPlace` shape and its rules, so promoting
one into `places.json` (and so to every client and the chat's
`lookupBibleEntity`) is a copy plus `node scripts/build-bible-atlas.mjs`.

**Rules, enforced by `tests/beta-atlas.test.mjs`** (in `pnpm test:logic`):
every reference resolves in the bundled KJV; every waypoint is named in a
verse it cites; every journey stop's verses name its place (the KJV's
hyphenated spellings, Beth-el and Ezion-gaber, count); every corpus place is
mapped, shares a marker or says why not; every corpus id the beta points at
exists; every lane date that claims a corpus event still matches it; the kings
run on without overlap; every dated corpus event sits inside its era; and the
projection in the generator and the client agree.

### Dates, and whose they are

- **Ussher** spans are from James Ussher's own *Annals of the World* (1658),
  checked against the archive.org text of the 2003 Master Books edition: the
  patriarchs' lives (Abram born 1996 BC, para. 63) and every king's accession
  (Rehoboam and Jeroboam 975, para. 476-477; Asa 955, 488; Ahab 918, 506;
  Jehoshaphat 914, 508; Joash 878, 536; Jeroboam II 825, 550; Hezekiah 726,
  620; Samaria taken 721; Jerusalem levelled 588, 850). Ussher's interregnums
  in Israel (784-773 and 739-730 BC) are gaps on the lane, and the scrubber
  says so.
- **Traditional dating** spans take their years from corpus events, which the
  app already presents as the traditional (Ussher) chronology of the KJV
  margins.
- **Dated by reigns**: Scripture dates most prophets by the kings it names
  ("in the days of Uzziah, Jotham, Ahaz, and Hezekiah", Isaiah 1:1); the span
  runs over those reigns as Ussher dates them, and its note quotes the verse.
  Joel, Obadiah, Nahum and Habakkuk name no king and are listed undated.

Found while building this (not changed here; the corpus is shared and mirrored
to Android): three corpus labels are not Ussher's own. The temple's burning is
c. 586 BC (Ussher 588), the crucifixion c. AD 30 (Ussher AD 33), and Jephthah's
vow c. 1143 BC, the KJV-margin date, where the Annals put Jephthah about 1187.
The beta labels corpus dates "Traditional dating", never "Ussher", and the
timeline's footnote says where the two differ.

## The map

`scripts/beta-atlas-basemap.mjs` builds `src/lib/beta/atlas/basemap.ts` from
**Natural Earth** v5.1.2 1:10m land, lakes and rivers (public domain: "No
permission is needed", naturalearthdata.com/about/terms-of-use; credited on
the map anyway). It clips to 8°E-52°E, 21°N-45°N, projects equirectangular
with x scaled by cos 34°, simplifies to about 300 m in the Holy Land and 1.3 km
elsewhere, and drops modern reservoirs and canals (Lake Nasser, the Euphrates
dams, the Suez canal). About 40 KB, 18 KB gzipped, in the page's own bundle: no
tiles, no map provider, no key, no cost, and SureWord's parchment colours in
light and dark.

`AtlasMap.tsx` draws it as one SVG whose viewBox is the camera, with every place
a real 44px button laid over it. Pan with a finger or the mouse, pinch or
scroll to zoom, double-tap to zoom in, arrow keys and +/- on the focused map,
and the zoom/fit buttons. The camera lives in a ref and each frame writes the
viewBox and marker transforms straight to the DOM, so a drag never re-renders
React; once it settles a declutter keeps tap targets 34px apart, preferring the
current stop, then the emphasised places, then by rank. Fly-to eases and pulls
back on long hops; with reduced motion it jumps. Marker styles say how sure a
site is (solid, ringed, dashed). No blur and no animation on any marker.

## API (founders only, read-only bundled data)

| Route | Answers |
|---|---|
| `GET /api/beta/atlas/card?place=<id>` / `?event=<id>` | One place or event for its card, with up to four passages of KJV text |
| `GET /api/beta/atlas/journey?id=<journey>` | Every stop's verses for one journey, fetched once when it is chosen |
| `GET /api/beta/atlas/verse?book=&chapter=&verse=&end=` | The atlas places those KJV verses name, for the reader |

Each starts with `requireBetaApi()`, so anyone off `BETA_USER_IDS` gets the
ordinary 404, and answers `private, no-store`. Bad input is a 400, an unknown
id a 404. The page builds its index (markers, journeys, events, eras, lanes)
on the server after `requireBetaPage()`.

No database, no AI calls, no paid services, nothing scheduled. "Ask about this"
only prefills the chat.

## Files

- `src/app/beta/bible/atlas/page.tsx`
- `src/components/beta/atlas/`: `AtlasExplorer`, `AtlasMap`, `JourneyPanel`,
  `TimelinePanel`, `PlacesPanel`, `AtlasCardView`, `VerseAtlasLinks`,
  `atlasUi`, `useAtlasData`
- `src/lib/beta/atlas/`: `atlas.ts` (server), `atlas-rules.ts` (pure rules),
  `places.ts`, `journeys.ts`, `lanes.ts`, `regions.ts`, `types.ts`, `basemap.ts`
- `src/app/api/beta/atlas/{card,journey,verse}/route.ts`
- `scripts/beta-atlas-basemap.mjs`, `tests/beta-atlas.test.mjs`
- The reader's hook: one row in `ChapterReader.tsx`'s verse-sheet peek.

## Proof

See LC-17655 for the proof run: a production build against a throwaway Neon
branch, signed in as the founder stand-in and the off-list control, at 1280
desktop and 375px touch, light and dark.
