# Chapter Games (`games`)

**Where:** SureWord Beta, Bible → Chapter Games, `/beta/bible/games` (founders
only, web only), and a card at the end of a chapter that has a game.
**Issue:** LC-17850 (Austin): "incorporate minigames into the bible for each
chapter ... start with an example i.e. Matthew 14: Peter's Water Walking
Simulator ... should feel like a real flash mini-game, should be fun and feel
immersive and slightly challenging, and get an award when you complete it."
**Status:** building (one chapter has a game).

## What it does

- **Peter's Water Walk** (`/beta/bible/games/water-walk`, Matthew 14:22-33).
  Peter steps out of the ship in the fourth watch and walks the storm to
  Jesus, 150 cubits across the sea, in about half a minute when it goes well.
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
| `title` | `Walked on the Water: Peter's Water Walk` |
| `body` | the grade, faith kept, best time and finishes, in words the Vault searches |
| `refs` | `40.14.22`, `40.14.33` (and `40.14`, added by the store) |
| `topics` | `chapter game`, `faith` |
| `data` | `{ game, grade, bestFaith, bestSeconds, completions, firstAt, lastAt }` |

Once the award exists, its update is conditional on the item's `updatedAt`,
so two finishes saved at once both count (a lost race reads again and retries). Account deletion cascades through the store. No table and no
migration.

## API

| Route | Does |
|---|---|
| `POST /api/beta/games/<game>/award` `{ faithKept, seconds, swellsCleared }` | Records a finished game and returns `{ award }`. `faithKept` is a whole number 0-100, `seconds` at least the fastest the game can be walked (26 s for the water walk) and at most an hour, `swellsCleared` a whole number. Anything else is a 400; an unknown game, or anyone off `BETA_USER_IDS`, the ordinary 404. |

The pages read awards on the server; there is no GET route.

## Adding the next chapter's game

1. Add its entry to `CHAPTER_GAMES` in `src/lib/beta/games/games-rules.ts`
   (slug, book, chapter, verses, award and grade names from the passage).
2. Write its simulation as a pure `*-rules.ts` beside the water walk's, with
   tests that it can be won, lost and not trivially won.
3. Add its component and render it from `src/app/beta/bible/games/[game]/page.tsx`
   for its slug, and its fastest time to `GAME_MIN_SECONDS` in `awards.ts`.

The reader card, the games page and the award store pick it up from the
registry.

## Files

| What | Where |
|---|---|
| Pages | `src/app/beta/bible/games/page.tsx`, `src/app/beta/bible/games/[game]/page.tsx` |
| Game, scene, sound, medal, list, reader card | `src/components/beta/games/` |
| Registry, grades, award rules | `src/lib/beta/games/games-rules.ts` |
| The water walk's simulation | `src/lib/beta/games/water-walk-rules.ts` |
| Awards in the study store | `src/lib/beta/games/awards.ts` |
| API | `src/app/api/beta/games/[game]/award/route.ts` |
| Tests | `tests/beta-games.test.mjs` |

## Proof

See LC-17850: a production build against a throwaway Neon branch, signed in as
the founder stand-in and the off-list control, the game played to Jesus
through real keyboard input at 1280 and real touch at 375px, a sink and rescue,
the award row read back from the database, and the API attacked with bad runs.
