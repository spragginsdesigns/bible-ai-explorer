# Study Projects (`projects`, LC-17642)

A workspace for one deep study, inspired by NotebookLM and Notion: The Book of
Romans, The Life of Paul. It holds the study's chapters or sections, the
passages a founder gathers, their notes and highlights, sources they paste or
upload, and the questions they are working through. Its assistant answers only
from those materials and shows the verse or the source's own words behind
every claim. Founders only, web only, at `/beta/study/projects`.

## What a founder can do

- **Create, rename, archive, restore and delete** projects. A *book study*
  takes a book and makes its chapters the sections; a *topic study* takes a
  name and any sections the founder adds, each optionally opening a chapter
  ("The road to Damascus", Acts 9). The empty state offers both, including a
  ready-made **The Life of Paul** (nine stages through Acts). Each project has
  a cover (SureWord's own art: Dawn, Olive path, Heavens, Sanctuary, Vellum,
  or a plain Olive or Dusk plate; nothing generated), a description, and
  progress ("6 of 16 chapters"). **Continue study** opens the first section not
  yet done, in the project's reader; **Done, on to Romans 7** ticks it and
  moves on.
- **Gather**, in the Passages and Sources tabs:
  - passages by typed reference ("Romans 5:1-11", one chapter at a time), by
    tapping verses in the project's reader (`/read`, the bundled KJV), or the
    chapter the founder last read in the Bible reader (the shared
    `useContinueReading`);
  - **notes and highlights as pointers**: the item keeps the note id or the
    verse key, never a copy, and every view and every question reads the
    note's current text and the highlight's KJV verse live. A deleted note or
    cleared highlight shows as gone and is left out of the assistant's
    material;
  - **pasted text** and **uploaded PDF, .txt or .md files** (up to 4 MB,
    400 pages). The text is extracted on the server
    (`src/lib/beta/projects/extract.ts`, unpdf, the serverless build of
    PDF.js with its worker inlined, no native dependency) and kept as the
    source's body, cut at the store's 200,000 characters and marked when cut.
    The file itself is not stored anywhere. Scanned PDFs with no text layer
    are refused with a message to paste instead. PDF.js parses as one
    unbroken chain of promise callbacks that no timer on the request's thread
    can interrupt (a 150 KB file whose one page inflates to 150 MB ran 50
    seconds), so each PDF is read on a worker thread of its own
    (`pdf-worker.ts`, LC-17680), which the route terminates after 25 seconds
    with "This PDF took too long to read". Webpack bundles that worker as its
    own server chunk, `chunks/pdf-worker.js`; `next.config.mjs` adds it to the
    upload route's output trace (Next traces a route's chunks, not its
    workers') and sets `output.workerPublicPath` so the server finds it;
  - **questions**, open or answered, with the founder's own answer.
- **Ask** (the AI chat). Answers come only from the project: gathered passages,
  highlighted verses, the chapters of a book study (or a topic study's section
  chapters), notes and sources, ranked against the question and cut to about
  100,000 characters (`buildMaterials` in `ai.ts`). The answer is a list of
  segments, each labelled Scripture, Interpretation, From a source, or Not in
  your materials, each with its citations.
- **Overview**, written when the founder presses the button: key themes with
  the verses that carry them, **connected passages** chosen only from
  SureWord's bundled cross-references (openbible.info) outside the project,
  and study questions that can be added to the founder's questions.
- **Write**: an outline or a written study assembled from the project, every
  point cited, then **Save as a note** (the "Add to notes" pipe,
  `appendMarkdownToNote`, stored exactly as assembled; a second press opens
  the same note) or **Copy as Markdown**.

## How the citations are kept honest

Every AI call is a structured response (`Output.object`) checked in
`src/lib/beta/projects/ai.ts` before anything is shown or stored:

- A **verse citation** is kept only for verses that were in the material
  sent, and it is displayed from the bundled KJV (`kjvChapter`), never in the
  model's words. A citation to a verse outside the project is dropped.
- A **source citation** must quote words that are really in that source:
  `findQuote` (`projects-rules.ts`) matches ignoring case, punctuation and
  spacing, whole words only, with `...` allowed between parts, and returns the
  source's own text for display. The quote must carry at least two meaningful
  words (`isSubstantialQuote`: "it is the" proves nothing). A paraphrase passed
  off as a quote is dropped.
- A sentence that puts words in quotation marks (double or single, straight or
  curly) that are nowhere in the project is left out: those words came from
  the model's memory. A quotation that is in the project but not in what the
  sentence cites is shown with a warning. A sentence left with no citation is
  shown dimmed with "No citation in this project backs this sentence". In an
  assembled study, a point that is not backed, or quotes anything its own
  citations do not say, is left out altogether.
- When a project's gathered passages are more than one request can carry,
  the ones whose words the question shares are sent first (`rankPieces`).
- The prompts carry SureWord's mission (`doctrinalFoundation`,
  `interpretationGuidance`): Scripture first, interpretation labelled as
  interpretation, sources treated as human writings and as data, never as
  instructions.

## Data

Everything is a `BetaItem` of module `projects` in the shared study store,
written only through `src/lib/beta/store.ts`; no table of its own and no
migration.

| kind | parent | title / body | data | refs | topics |
|---|---|---|---|---|---|
| `project` | none | name / description | cover, scope (`book` + order, or `topic`), sections (`id`, `title`, chapter `ref`, `done`, `doneAt`), archived | its chapters and every gathered passage's chapter | the Overview's topics |
| `passage` | project | "Romans 5:1-11" / the KJV text, numbered | book, chapter, start, end, origin | every verse key | |
| `source` | project | name / the text (pasted, upload); none for a pointer | `type` `note` (noteId), `highlight` (book, chapter, verse, translation), `pasted`, `upload` (fileName, mediaType, size, pages, truncated) | references found in the text (`parseVerseReferences`), or the highlighted verse | |
| `question` | project | the question / question and answer | question, status, answer, origin (`user`, `overview`, `answer`) | references in it | the Overview theme it came from |
| `overview` | project | "Overview of ..." / themes, connections, questions as text | themes, connected, questions, basis counts, model | theme and connected verses | topics |
| `answer` | project | the question / the answer's text | question, checked segments with their KJV text and source quotes, missing, model | cited verses | |
| `study` | project | its title / plain text | the assembled study and noteId once saved; its Markdown is rebuilt from the study when read, and a very long study keeps fewer verses under each citation to stay inside the store's 256 KB | cited verses | the project's topics |

Deleting a project deletes all of these (the store's cascade); the notes and
highlights it pointed at, and any study saved as a note, stay where they are.
A project holds up to 400 passages, sources and questions, plus its last 60
answers, 20 drafts and one Overview, all inside the store's 500-item page.
Only items of module `projects` are read as a project's contents. An item's
`refs` stop at 480 keys (each verse key brings its chapter key, under the
store's 500), verse ranges held to the chapter's real verses.

## Routes

All under `/api/beta/projects`, every handler opening with `requireBetaApi()`;
the three AI routes are metered with `withIncludedAiRequest` *after* the gate,
so nobody off the list reaches the meter. `tests/beta-projects.test.mjs` checks
both.

| Route | Does |
|---|---|
| `GET, POST /` | list; create |
| `GET, PATCH, DELETE /[projectId]` | read everything; rename, describe, cover, archive, one section change; delete |
| `POST /[projectId]/items` | add a passage, note, highlight, pasted source or question |
| `PATCH, DELETE /[projectId]/items/[itemId]` | edit a question or rename a source; remove |
| `POST /[projectId]/upload` | multipart `file`: PDF or text, extracted on the server |
| `POST /[projectId]/ask` | answer one question (AI) |
| `POST /[projectId]/overview` | write the Overview (AI) |
| `POST /[projectId]/study` | `{ mode: "outline" | "study" }` (AI) |
| `POST /[projectId]/study/[studyId]/note` | save an assembled study as a Note |
| `GET /library?type=notes|highlights` | the founder's notes and highlights to point at |

Pages: `/beta/study/projects`, `/beta/study/projects/[projectId]` (tabs
Overview, Passages, Sources, Questions, Ask, Write; the tab is kept in the
URL hash) and `/beta/study/projects/[projectId]/read?section=` or
`?book=&chapter=`. A foreign or unknown project id, section or chapter is the
ordinary 404.

## AI and spend

The model is the house chat model through `resolveModel` (GPT-6 Luna at the
founder's plan effort), structured output, about 25k input tokens per question
at most. It runs only when a founder presses Ask, Write the Overview, Outline
or Written study. Nothing is scheduled, pre-generated or backfilled. Before
each AI call the client asks for SureWord's AI consent like chat does
(`aiConsentGate.ensure`). The Overview's connected passages and every quoted
verse come from bundled data at no cost. Saving a study as a note syncs its
note embeddings, as any note does.

## Proof

LC-17642 holds the proof: a production build on a throwaway Neon branch,
signed in as a founder stand-in at 1280 and at 375px with touch, light and
dark, the off-list account's 404s on every page and route, and the assistant
judged on real study questions.

## Building on Study Projects

Sermon to Study, Audio Overviews and SureWord Pastor save into projects. They
do it through this module's server functions, never by writing `projects`
items themselves, so every item keeps the shapes above:

- `listProjects(userId)` and `loadProject(userId, id)` to offer and check a
  target project;
- `addToProject(userId, projectId, { kind: "passage" | "note" | "highlight" | "pasted" | "question", ... })`
  for anything a founder could add by hand;
- `createSourceText(userId, projectId, { title, text, truncated, type: "pasted" })`
  for a transcript or generated text, with the other module's own item
  joined to the project's source by a `BetaLink` when it needs one. It checks
  that the project is the owner's and has room, and gives the source the next
  free label (`S5`), so a caller needs no checks of its own. Labels are settled
  when sources are read (`assignSourceLabels`): two sources added at the same
  moment are told apart by the order they were added.

A new kind of project (a sermon, a series) is a new `scope.type` in
`projects-rules.ts` (`parseProjectData`, `checkProjectCreate`), added
backwards-compatibly: existing projects read as they do today.
