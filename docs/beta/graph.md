# Living Study Graph (`graph`, Library)

**LC-17646.** A connected map of everything a founder has studied in SureWord,
at `/beta/library/graph`. Inspired by Obsidian and Roam Research. It carries
the study-platform proposal's feature 1 (Scripture Knowledge Graph) and big
idea A (the Living Study Graph), and it is built on the Knowledge Vault's
reading of every source ([`vault.md`](vault.md)). Built on the contract in
[`README.md`](README.md); founders only, web only.

## What it does

- **The graph.** The founder's passages sit around a ring in Bible order,
  evenly spaced from twelve o'clock clockwise (the canon's own proportions would
  crowd most study into the New Testament's last quarter), coloured by section
  exactly as the Connections ring is. Everything studied is drawn inside the
  ring, pulled toward the passages and topics it touches: notes, chats, sermon
  studies and every beta module's items (`BetaItem`). Topics are the labels the
  founder's study already carries (note tags, beta item topics, highlight
  colour names such as "Promises").
- **Edges.** A study to each chapter it names, and to each of its topics; note
  to note for every resolved `[[wikilink]]`, one edge per pair: the panel says
  "Links to", "Linked from (a backlink)" or, when both notes link each other,
  "Links to …, and back"; a project to the sources inside it (`parentId`); every
  `BetaLink` between items, drawn solid with its reason, and every suggested one
  dashed; and passage to passage wherever the bundled cross-references (the
  Connections ring's data, through `getChapterConnections`) join two chapters
  the founder has studied.
- **Pan, zoom and tap.** Drag to pan and pinch to zoom on a phone; drag, the
  wheel and the zoom buttons on a computer. A tap selects a node: it and its
  neighbours stay lit, everything else dims, and the panel beside the graph (below
  it on a phone) lists every connection with why it exists. From the keyboard, the
  canvas takes arrows to pan, + and - to zoom and 0 to reset; Tab reaches every
  node and Enter selects it (its panel holds the link to open it). Escape clears
  the selection. Selecting only rewrites the address (`history.replaceState`), so
  a tap never waits on the server.
- **Open any node where it lives.** A note opens in Notes, a chat at `/c/<id>`, a
  study on its module's page with `?item=<id>`, a sermon study at
  `/sermons/<id>`, and a passage in the reader (and its cross-references in
  Connections). Highlights, verses being learned and reading fold into their
  passage and are listed there with their own links.
- **Search the graph** by any word of a label: passages, topics, notes, chats
  and studies. Enter (or a tap) selects the best match and centres the view on it.
- **Follow a topic** across books (each book it reaches through the studies on
  it, with the chapters) and over time (everything studied on it, oldest first by
  month), with a link to the Vault's over-time view for the full words side by
  side.
- **The selected node is in the URL** (`?node=passage:45.5`, `?node=topic:faith`),
  and a module's usual `?item=<id>` opens that study, so a node can be linked.

## Suggested connections

Between studies (beta items), because a `BetaLink` joins two items. A
suggestion is made only when the founder asks: **Suggest connections** for the
whole graph, or **Find connections for this study** on a selected study. There
is no backfill, no job and no model call: the reasons come from the founder's own
data, so they are exact and cost nothing.

- **What counts.** A topic both studies carry (3 points each), a chapter both
  study (2), and a cross-reference between a verse each of them names (2 each, up
  to three). A cross-reference only between their chapters adds 1. A pair needs
  2: one shared topic, one shared chapter, or one verse-to-verse cross-reference.
  Pairs already linked in either direction, any kind, are never suggested, nor a
  study and the source inside it, nor a source and the partner its parent study
  is already suggested or linked to.
- **The reason** names exactly what they share, newest study first, so today's
  study reads as touching an earlier one. From the proof: "“Romans: the
  righteousness of God” and “Galatians 2: not by the works of the law”: both are
  about faith and justification; Romans 3:28 and Galatians 2:16 are
  cross-references." A cross-reference only between their chapters is named by
  its verses: "their chapters meet in a cross-reference (Ephesians 2:16 and
  Galatians 2:20)".
- **Stored** as a `BetaLink` of kind `related` with `origin: "suggested"` and the
  reason, up to eight per ask.
- **Connect** makes it the founder's (`origin: "user"`, reason kept). **Not
  related** removes it and keeps the pair as a `not-related` link, which is never
  drawn and stops the pair from being suggested again.
- **Private items** (`data.private`, such as the Habits & Reflection journal) are
  drawn by their title, passages and dates only, never with their topics, and are
  never suggested.

## Data

No table of its own and no migration. Everything is read in place:

| What | From |
|---|---|
| Notes, chats, sermon studies, highlights, Learn cards, reading | The Knowledge Vault's readers (`READERS` through `readSafely`, `src/lib/beta/vault/sources.ts`) |
| Note wikilinks | `NoteLink` rows with a resolved `targetNoteId` |
| Studies and their links | The shared store: `betaGraphItems`, `listOwnerBetaLinks`, `getBetaLink` (new owner-scoped reads at the end of `src/lib/beta/store.ts`), `linkBetaItems`, `unlinkBetaItems` |
| Passage-to-passage edges | `getChapterConnections` (`src/lib/bible/connections.ts`), the bundled cross-references the Connections ring draws |
| Ring positions | `getVerseIndex` (each chapter's place among every verse of the Bible) |

Memories are left out (they describe the person, not a study). The graph caps
at 700 nodes: studies first, then notes, chats and sermon studies newest first,
then the passages that only highlights, Learn cards and reading touch; the page
says when the cap is reached. Layout runs once on the server per request (`layoutGraph`,
deterministic, so the same study draws the same way every visit; about 0.3 s for
600 nodes), and the client only draws.

## API (`src/app/api/beta/graph/**`)

Every route starts with `requireBetaApi()`; anyone off `BETA_USER_IDS` gets the
ordinary 404, signed out the middleware's 401. Responses are `private, no-store`
and `noindex`.

| Route | What |
|---|---|
| `GET /api/beta/graph` | the laid-out graph: `nodes`, `edges`, `counts`, `truncated`, `suggestable` |
| `POST /api/beta/graph/suggest` | `{ itemId? }`, suggest connections, answers `{ suggested }` |
| `PATCH /api/beta/graph/links/<id>` | `{ action: "accept" \| "dismiss" }` on a suggestion; anything else is a 404 |

## Look and performance

One SVG. During a pan or pinch only the group's `transform` changes (no React
render per frame); labels re-render when the gesture rests. Dots, labels and tap
discs are sized in screen pixels (12px labels, 44px tap discs), so they stay
usable at 375px. Labels show for the best-connected passages and topics, the
selection and its neighbours, and everything once zoomed in. No blur, filter,
glow or animation on any node or edge.

## Files

`src/app/beta/library/graph/page.tsx`, `src/components/beta/graph/`,
`src/lib/beta/graph/` (`graph-rules.ts` is the pure half, tested by
`tests/beta-graph.test.mjs`), `src/app/api/beta/graph/`, and the graph reads at
the end of `src/lib/beta/store.ts`.

## Proof (LC-17646)

A production build against a Neon branch, signed in as the founder stand-in
(on `BETA_USER_IDS`) and a control account off it, at 1280 and 375px with touch,
light and dark. The stand-in's notes were written through `/api/notes` (so the
app made their wikilinks), tagged and dated March to October; their studies
(a Romans project with a source inside it, a Galatians sermon study, an Ephesians
project linked to Romans, a Genesis 3 voice session, a Psalm 23 project and a
private reflection), highlights and a chat were written in the stores' shapes.
The control holds marker-stamped studies, a suggestion and a note on the same
passages and topics, and none of it reached the founder's graph; every graph
page is the control's 404 and every graph route a 404. The issue's closeout
lists the checks and the suggestions made.
