# Chapter Games (`games`)

**Where:** SureWord Beta, Bible → Chapter Games, `/beta/bible/games` (founders
only, web only), and a card at the end of a chapter that has a game.
**Issue:** LC-17850 (Austin): "incorporate minigames into the bible for each
chapter ... start with an example i.e. Matthew 14: Peter's Water Walking
Simulator ... should feel like a real flash mini-game, should be fun and feel
immersive and slightly challenging, and get an award when you complete it."
LC-17851 (Jay): "try 2 additional types of flash games for it (so we can try
different styles - art, theme, feel, vibe, immersiveness, etc) ... and then
can do another flash game for something in the book of matthew, same thing
(3 variants, to see which one feels right)."
**Status:** building (two chapters have games, each three ways to play).

## Ways to play a passage

A passage can be played more than one way (LC-17851), so the founders can
try styles side by side. Each way is its own game in `CHAPTER_GAMES` with its
own slug, page, component and award item; the ways of one passage share its
`reference`, `story`, `award`, `grades`, `measure` and medal `emblem`, and
`style` tells them apart. The games page groups them under their passage, and
the reader card at the end of the chapter lists every way with its own Play.

| Passage | Game (slug) | Style |
|---|---|---|
| Matthew 14:22-33, Peter walks on the water | Peter's Water Walk (`water-walk`) | The storm, side on |
| | Through the Storm (`through-the-storm`) | First person |
| | Crest Hopper (`crest-hopper`) | Arcade |
| Matthew 2:1-12, the wise men follow the star | Follow the Star (`follow-the-star`) | Night sky |
| | The Caravan (`the-caravan`) | Side-scroller |
| | Star Chart (`star-chart`) | Puzzle |

Every game takes the same props (`components/beta/games/types.ts`) and uses
the shared header, passage card, story screens, mute setting and award save
in `components/beta/games/shared.tsx`; its stage, controls, art and sound are
its own.

## What it does

- **Peter's Water Walk** (`/beta/bible/games/water-walk`, Matthew 14:22-33).
  Peter steps out of the ship in the fourth watch and walks the storm to
  Jesus across the sea, in about half a minute when it goes well. The HUD
  shows how much of the way is walked, never a distance: Matthew 14 gives none.
  - **Lean against the wind.** Gusts of the "wind boisterous" push him off
    balance; the rain and the streaks across the sky show which way. Hold left
    or right (arrow keys or A/D, the Lean buttons, or a thumb on each on a
    phone) to keep the balance marker in its steady middle.
  - **Step up over each swell** as its crest reaches him (Up, W or Space, or
    Step up). Too early or too late and the crest strikes him: faith drops and
    he is shoved back toward the ship.
  - **Keep your eyes on Jesus.** Standing steady builds faith; tipping and
    being struck drain it. Jesus' light is always at the edge of the view. As
    faith falls the water climbs Peter's legs and the view darkens.
  - **Beginning to sink.** At no faith he sinks, verse 30 comes up, and the one
    thing to do is cry "Lord, save me". Jesus comes to him and catches him
    (verse 31) and the storm calms; then Try again. Nothing is recorded.
  - **Reaching Jesus** takes his hand, the wind ceases (verse 32, the sound
    resolves to a quiet chord) and the award comes up with verses 32-33.
  - Sound is synthesized in the browser (wind, rain, sea, thunder, a splash,
    the chord), muted with one button and remembered on the device. Lightning
    never flashes for someone who asked for reduced motion. Leaving the tab
    pauses the game.
- **The award.** Finishing earns **Walked on the Water**, graded by the lowest
  faith of the walk: **Eyes on Jesus** (gold, faith never under 70%), **Of
  Good Cheer** (silver, 40-69%) and **Be Not Afraid** (bronze). The best
  grade, best faith and best time stand, and every finish is counted; a worse
  finish never lowers them.
- **Where to find it.** The Bible destination lists Chapter Games; its page
  lists every chapter with a game and the award earned on each. At the end of
  Matthew 14 in the reader, founders get a Chapter game card with Play.
  Chapters without a game ask nothing; on a chapter with one, the card asks
  `GET /api/beta/access` at most once per account per session, the same
  pattern as the atlas's verse links.
- **Scripture first.** Every verse the game shows is read from the bundled KJV
  by the page (`getKjvChapter`) and handed to the game, never typed into it.
  The whole passage sits under the game. It is played straight: no comedy, no
  caricature.

## How hard it is

The simulation is pure and seeded (`water-walk-rules.ts`), so the tests play
it. Measured with the shipped tuning over 400 seeds: a scripted steady player
reaches Jesus on every seed with gold; one who reacts a quarter second late on
keys finishes 97% of walks (three in four with gold); never stepping up
finishes 48%, never with gold; never leaning and doing nothing never finish.
During tuning, a player a third of a second late and loose on the swells
finished about half. The tuning numbers sit at
the top of that file. Re-run `tests/beta-games.test.mjs` after changing any of
them: its bounds are the "slightly challenging" contract.

## Data

One study-store item per founder per game (`docs/beta/README.md`, the shared
study store), written only through `src/lib/beta/store.ts`:

| Field | Value |
|---|---|
| `module` / `kind` | `games` / `award` |
| `title` | `<award>: <game title>`, e.g. `Walked on the Water: Peter's Water Walk` |
| `body` | the grade, the game's measure (faith kept, kept to the star), best time and finishes, in words the Vault searches |
| `refs` | the passage's first and last verse, e.g. `40.14.22`, `40.14.33` (and `40.14`, added by the store) |
| `topics` | the passage's, e.g. `chapter game`, `faith` (Matthew 14) or `chapter game`, `worship` (Matthew 2) |
| `data` | `{ game, grade, bestFaith, bestSeconds, completions, firstAt, lastAt }` |

Once the award exists, its update is conditional on the item's `updatedAt`,
so two finishes saved at once both count (a lost race reads again and retries). Account deletion cascades through the store. No table and no
migration.

## API

| Route | Does |
|---|---|
| `POST /api/beta/games/<game>/award` `{ faithKept, seconds, swellsCleared }` | Records a finished game and returns `{ award }`. `faithKept` is the game's 0-100 score as its `measure` names it (faith kept, kept to the star), `seconds` at least the fastest that game can be finished (`GAME_MIN_SECONDS`; 26 s for the water walk) and at most an hour, and `swellsCleared` the game's count of what it clears (swells, crests, legs charted; the name is the first game's), 0-500. Anything else is a 400; an unknown game, or anyone off `BETA_USER_IDS`, the ordinary 404. |

The pages read awards on the server; there is no GET route.

## Adding the next chapter's game

1. Add its entry to `CHAPTER_GAMES` in `src/lib/beta/games/games-rules.ts`
   (slug, title, style, book, chapter, verses, story, award and grade names
   from the passage, measure, emblem, topics). Another way to play a passage
   that already has a game spreads that passage's shared fields.
2. Write its simulation as a pure `*-rules.ts` beside the water walk's, with
   tests that it can be won, lost and not trivially won.
3. Add its component (taking `ChapterGameProps`, built on `shared.tsx`) to
   `GAMES` in `src/components/beta/games/ChapterGamePlayer.tsx` for its slug
   (a client component, so each game's code loads on its own page only), and its
   fastest time to `GAME_MIN_SECONDS` in `awards.ts`. A test fails when either
   is missing.

The reader card, the games page and the award store pick it up from the
registry.

## Files

| What | Where |
|---|---|
| Pages | `src/app/beta/bible/games/page.tsx`, `src/app/beta/bible/games/[game]/page.tsx` |
| Games, scenes, sound, medal, list, reader card | `src/components/beta/games/` (`<Game>.tsx`, `<slug>-scene.ts`, `<slug>-audio.ts`) |
| What every game shares, and its props | `src/components/beta/games/shared.tsx`, `types.ts` |
| Registry, grades, award rules | `src/lib/beta/games/games-rules.ts` |
| Each game's simulation | `src/lib/beta/games/<slug>-rules.ts` |
| Awards in the study store | `src/lib/beta/games/awards.ts` |
| API | `src/app/api/beta/games/[game]/award/route.ts` |
| Tests | `tests/beta-games.test.mjs` (registry, awards, gate, the water walk), `tests/beta-games-<slug>.test.mjs` (each other game) |

## Proof

See LC-17850 for the water walk and LC-17851 for the other five: a production build against a throwaway Neon branch, signed in as
the founder stand-in and the off-list control, the game played to Jesus
through real keyboard input at 1280 and real touch at 375px, a sink and rescue,
the award row read back from the database, and the API attacked with bad runs.
