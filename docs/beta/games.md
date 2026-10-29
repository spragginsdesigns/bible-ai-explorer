# Chapter Games (`games`)

**Where:** SureWord Beta, at the end of each chapter of Matthew in the reader
(founders only, web only), and Bible → Chapter Games, `/beta/bible/games`.
Every game plays right there in the page; there are no game pages.
**Issue:** LC-17850 (Austin): "incorporate minigames into the bible for each
chapter ... should feel like a real flash mini-game, should be fun and feel
immersive and slightly challenging, and get an award when you complete it."
LC-17851 (Jay, then Austin after playing the first six): "controls and
instructions and tips at start should be highlighted and way more obvious
... games should be like that wario-ware thing ... maybe like 15 seconds
instead of i.e. 1 min long ... the UI should load within the page ... let's
just isolate it to whichever 1 game you think is best for each, and then do a
mini-game for each chapter ... just the book of matthew to start ... can have
fish audio etc as well for any voices."
**Status:** building (all 28 chapters of Matthew have a game).

## How a round plays

Every game runs in one player (`MicroGame.tsx`), the same everywhere:

1. **How to play.** The game's command ("Hop!") in large type, each control
   as big key caps (or, on a touch screen, the gesture first), what it does,
   and one or two tips. The scene sits behind it. Start (or Enter).
2. **Countdown.** About a second and a half: the command flashes with the
   controls under it. The cast speaks the game's intro verse.
3. **The round,** about fifteen seconds (12-15). A timer bar runs above the
   stage and the controls stay in view under it. Keys reach the game only
   while it has focus, and never scroll the page. Escape or leaving the tab
   pauses.
4. **The outcome.** A win shows the medal in its grade, the grade's name,
   the score and time, the win verse in the KJV (spoken by the cast) and saves
   the award. A loss shows the controls and the first tip again, and Try
   again.

The voice is the chapter's existing recording (`/api/bible/audio`, Matthew's
full-cast KJV production, `src/lib/bible/audioBible.ts`), played from the
verse's start to its end (`verse-voice.ts`). Every word heard is the KJV on
screen and nothing is generated when someone plays. The device's mute
setting silences the voice and the game's sound alike.

## The games

Austin asked for the one best game of each passage from the first six
(LC-17851): The Caravan was kept for Matthew 2 and Crest Hopper for Matthew
14, both cut to fifteen-second rounds; Peter's Water Walk, Through the
Storm, Follow the Star and Star Chart were retired
(their awards stay in founders' study stores). The registry,
`CHAPTER_GAMES` in `src/lib/beta/games/games-rules.ts`, holds each game's
passage, command, controls, tips, round length, fastest possible win, voiced
verses, award, grades and medal.

| Ch. | Game (slug) | Passage | Play |
|---|---|---|---|
| 1 | The Generations (`the-generations`) | 1:1-17 | Tap who begat whom, in order |
| 2 | The Caravan (`the-caravan`) | 2:1-12 | Run under the star: jump and duck |
| 3 | Winnow the Floor (`winnow`) | 3:11-17 | Wheat to the garner, chaff to the fire |
| 4 | Fishers of Men (`fishers-of-men`) | 4:18-22 | Catch the fish in the net |
| 5 | Let Your Light Shine (`let-your-light-shine`) | 5:14-16 | Lift the bushels off the candles |
| 6 | Treasures in Heaven (`treasures-in-heaven`) | 6:19-21 | Catch treasure, dodge moth and rust |
| 7 | Built on the Rock (`house-on-the-rock`) | 7:24-27 | Stack the house true |
| 8 | Lord, Save Us (`lord-save-us`) | 8:23-27 | Bail the ship, left and right |
| 9 | The Hem of His Garment (`hem-of-his-garment`) | 9:20-22 | Weave through the crowd to the hem |
| 10 | Sheep Among Wolves (`sheep-among-wolves`) | 10:16-31 | Dodge the wolves |
| 11 | Rest for Your Souls (`rest-for-your-souls`) | 11:28-30 | Lift burdens off the weary |
| 12 | Known by His Fruit (`known-by-his-fruit`) | 12:33-35 | Pick the good fruit |
| 13 | The Sower (`the-sower`) | 13:3-9 | Sow on the good ground |
| 14 | Crest Hopper (`crest-hopper`) | 14:22-33 | Hop the swells to Jesus |
| 15 | Seven Baskets Full (`seven-baskets`) | 15:32-38 | Gather the fragments |
| 16 | Whom Say Ye? (`whom-say-ye`) | 16:13-18 | Follow the true answer as it shuffles |
| 17 | The Coin in the Fish (`coin-in-the-fish`) | 17:24-27 | Strike when the fish bites |
| 18 | The Lost Sheep (`the-lost-sheep`) | 18:12-14 | Find the one gone astray |
| 19 | The Eye of a Needle (`eye-of-a-needle`) | 19:23-26 | Thread the needles |
| 20 | Have Mercy on Us (`have-mercy-on-us`) | 20:29-34 | Cry out above the crowd |
| 21 | Hosanna! (`hosanna`) | 21:1-11 | Spread branches in the way |
| 22 | The Wedding Garment (`the-wedding-garment`) | 22:1-14 | Clothe each guest |
| 23 | Under Her Wings (`under-her-wings`) | 23:37-39 | Gather the chickens |
| 24 | Watch! (`watch`) | 24:42-44 | Tap the instant the lightning flashes |
| 25 | The Sheep and the Goats (`sheep-and-goats`) | 25:31-40 | Sheep to the right, goats to the left |
| 26 | Watch with Me (`watch-with-me`) | 26:36-41 | Keep Peter, James and John awake |
| 27 | The Veil Was Rent (`the-veil-rent`) | 27:50-54 | Trace the veil from the top to the bottom |
| 28 | He Is Risen (`he-is-risen`) | 28:1-10 | Run and tell his disciples |

Every game is played straight: reverent, KJV-rooted, Jesus drawn as a
simple robed figure in light with no detailed face, and Matthew 27 shows
only the veil, the darkness and the quake.

## The award

Winning a round earns the chapter's award, graded by the round's 0-100
score: gold 70 and up, silver 40-69, bronze below. The best grade, best
score and best time stand, and every win is counted; a worse win never
lowers them. A loss records nothing.

## How hard it is

Each game's simulation is pure and seeded (`<slug>-rules.ts`), so its tests
play it (`tests/beta-games-<slug>.test.mjs`): a skilled scripted player wins
on at least 95% of 200 seeds and never faster than the game's `minSeconds`,
an idle player never wins, a masher rarely does, and a sloppy one sometimes
loses. Re-run a game's tests after changing its tuning: their bounds are the
"hard enough" contract.

## Data

One study-store item per founder per game (`docs/beta/README.md`, the shared
study store), written only through `src/lib/beta/store.ts`:

| Field | Value |
|---|---|
| `module` / `kind` | `games` / `award` |
| `title` | `<award>: <game title>`, e.g. `A Great Calm: Lord, Save Us` |
| `body` | the grade, the game's measure, best time and wins, in words the Vault searches |
| `refs` | the passage's first and last verse, e.g. `40.8.23`, `40.8.27` (and `40.8`, added by the store) |
| `topics` | the game's, e.g. `chapter game`, `faith` |
| `data` | `{ game, grade, bestFaith, bestSeconds, completions, firstAt, lastAt }` |

Once the award exists, its update is conditional on the item's `updatedAt`,
so two wins saved at once both count (a lost race reads again and retries).
Account deletion cascades through the store. No table and no migration.

## API

| Route | Does |
|---|---|
| `GET /api/beta/games/<game>/award` | `{ award }`, the founder's award for the game or `null`; the reader card shows the medal from it. |
| `POST /api/beta/games/<game>/award` `{ faithKept, seconds, swellsCleared }` | Records a won round and returns `{ award }`. `faithKept` is the round's 0-100 score, `seconds` at least the game's `minSeconds` and at most an hour, and `swellsCleared` the game's count (fish caught, stones laid), 0-500. Anything else is a 400; an unknown game, or anyone off `BETA_USER_IDS`, the ordinary 404. |

## A game's stage

The player owns everything around the round; a game is three files:

1. **Rules,** `src/lib/beta/games/<slug>-rules.ts`: pure and seeded, no
   runtime imports (the tests load it with Node's type stripping), stepped at
   1/60 s, ending when the task is done or at the round's length, with a
   result `{ won, score, count, seconds }`.
2. **Stage,** `src/components/beta/games/stages/<Pascal>.tsx`: takes
   `StageProps` (`types.ts`), draws a 400x400 picture on a canvas through
   `useStageLoop` (`stage-kit.ts`), reads keys from `keys` and its own
   pointer events, plays sound through `useSynth`, calls `onTime` as the
   clock runs and `onEnd` once. Sound always goes through the one shared
   `stageAudioContext()` that the player unlocks on the Start press (a game
   with its own engine, like The Caravan, builds it on that context): iOS
   Safari plays nothing from a context opened later in the game loop.
3. **Tests,** `tests/beta-games-<slug>.test.mjs`, to the bounds above.

Have Mercy on Us (Matthew 20) is the reference. To add a chapter, add its
registry entry, its three files and its line in `STAGES`
(`ChapterGamePlayer.tsx`); `tests/beta-games.test.mjs` fails until all are
there.

## Files

| What | Where |
|---|---|
| Games list page | `src/app/beta/bible/games/page.tsx` |
| Reader card, games list, player, medal | `src/components/beta/games/` (`ChapterGameCard.tsx`, `GamesHome.tsx`, `ChapterGamePlayer.tsx`, `MicroGame.tsx`, `AwardMedal.tsx`) |
| Stage kit, voice, props | `src/components/beta/games/stage-kit.ts`, `verse-voice.ts`, `types.ts`, `shared.tsx` |
| Each game's stage | `src/components/beta/games/stages/` (The Caravan and Crest Hopper keep their `<slug>-scene.ts` and `<slug>-audio.ts` beside them) |
| Registry, grades, award rules | `src/lib/beta/games/games-rules.ts` |
| Each game's simulation | `src/lib/beta/games/<slug>-rules.ts` |
| Awards in the study store | `src/lib/beta/games/awards.ts` |
| API | `src/app/api/beta/games/[game]/award/route.ts` |
| Tests | `tests/beta-games.test.mjs` (registry, awards, gate, in-page play), `tests/beta-games-<slug>.test.mjs` (each game) |

## Proof

LC-17850 and LC-17851 hold the proof: a production build against a throwaway
Neon branch, signed in as the founder stand-in and the off-list control,
every game played through real input in the page, the award rows read back
from the database, and the API attacked with bad runs.
