# Prompt for the next Claude Code session

Paste everything below the line into a fresh session started in
`/Users/spragginsdesigns/Documents/Github_Repositories/bible-ai-explorer`.

---

You are the lead engineer and supervisor for the SureWord iOS launch. Read
`CLAUDE.md`, `docs/ios/IOS-APP-STORE-PRD.md` (the spec, authoritative),
`docs/PARITY.md`, `docs/FEATURES.md`, `macos/README.md` and `mobile/CHANGELOG.md`
before doing anything else. Your job is to take the iOS app from where it is to
submitted-and-approved on the App Store, at 100% of the PRD, with Android
untouched and macOS not regressed. Work autonomously; stop only at the
Austin-only gates listed in PRD section 7 and at the check-ins below.

## Operating rules

- Android is the source of truth. For every requirement, read the Android code
  and its `docs/FEATURES.md` contract first and port the behavior, not your
  idea of it. Same endpoints, same payloads, same rules.
- Money-efficient by design: you supervise, review and verify; workers write
  code. Do not hand-write large Swift features yourself when a worker can.
- Never claim something works because it compiles. Run it in the simulator
  signed in as the reviewer demo account (credentials: ask Austin for the
  1Password item name; never write them to the repo) and keep screenshots.
- Ship by default per `CLAUDE.md`: when a lane is verified, commit touched files
  only (Conventional Commit) and push to `main`. No force-push, never
  `git add -A`, never commit secrets or `mobile/.phone-addr`.
- Backend changes deploy on push; verify against production after the deploy.
- macOS: any change under `macos/Shared/` must keep `-scheme SureWord` building
  and its tests green; run `bash macos/install-mac.sh` before you finish if
  `Shared/` or macOS files changed. Every manual `xcodebuild` uses
  `-derivedDataPath <name>.noindex`.
- Update `docs/PARITY.md` per lane with honest evidence. Device-only items stay
  🟡 with the gate named until Austin runs them.
- The Prisma and database traps in `CLAUDE.md` apply: pin `DATABASE_URL`, check
  `current_database()` and row counts before any migration.

## Step 0: confirm and plan (no code yet)

1. Ask Austin, in one message: (a) is the paid Apple Developer Program active
   for team `389LLKGY3Y`, and which App Store Connect API key in
   `~/.appstoreconnect/private_keys` belongs to it; (b) ship v1.0 with no
   purchase UI (PRD F1, the default) or build StoreKit first; (c) the AI
   consent copy approach (A4); (d) which 1Password item holds the review demo
   account. Proceed on the defaults if he does not object within the turn.
2. Audit Android `mobile/CHANGELOG.md` entries 1.50.0 to 1.78.0 and the
   `mobile/app` + `mobile/src/features` tree against `macos/SureWord-iOS` and
   `macos/Shared`. Extend the PRD gap table with anything missing and commit
   that edit. This is the definitive scope.
3. Write `docs/ios/PROGRESS.md`: one row per PRD requirement ID with owner lane,
   status, evidence path. Keep it current; it is how a resumed session recovers.

## Orchestration

Use git worktrees, one per lane, branch `ios/<lane>`, derived data
`build-<lane>.noindex`. Run at most 3 Xcode lanes at once. One lane owns
`macos/project.yml` at a time; after any lane merges, regenerate with
`xcodegen`, rebuild both schemes, and run both test suites on `main` before the
next merge. Merge lanes serially.

Suggested lanes (adjust after the Step 0 audit):

| Lane | Requirements | Worker |
|---|---|---|
| store-blockers | A1 (server first, then every client), A2, A3, A5, A6, B1 | Sonnet 5.5 via the Agent tool |
| reader | C1 to C6, then D4 | Sonnet 5.5 |
| breadth-1 | C7, C8, C11, D1 | Sonnet 5.5 |
| ports | B2, B3, B4, D1 (if not above), E1, E2 markdown export | GLM 5.3 Flash via opencode |
| notes | E3, E4 | Sonnet 5.5 |
| verify | C9, C10, D2, D3, D5 smoke and fixes | Sonnet 5.5 |
| design | G1 to G6 | Sonnet 5.5, after reader screens exist |
| store-prep | A7, A4 copy, H1 to H6 | Sonnet 5.5, with Austin gates |

Cheap-worker recipe (mechanical ports only):

```bash
cd <lane worktree>
opencode run -m openrouter/z-ai/glm-5.3-flash "<contract: files to read, files to write, acceptance test, the exact build/test command>"
```

A worker contract always contains: the Android source file(s) to mirror, the
iOS files it may create or edit and the ones it must not touch, the exact
`xcodebuild ... test` command, and "do not report done until that command is
green". If a Flash lane fails its gate twice, take it over with Sonnet. Never
let a worker edit `project.yml`, `docs/PARITY.md` or shared networking without
that being in its contract.

## The gate every lane must pass before you review it

```bash
cd macos && xcodegen
xcodebuild -scheme SureWord-iOS -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build-<lane>.noindex test
xcodebuild -scheme SureWord -destination 'platform=macOS' \
  -derivedDataPath build-<lane>-mac.noindex build   # if Shared/ changed
```

Then you personally: read the whole diff, launch the app in the simulator,
exercise the feature against production, capture screenshots, compare to
Android for the same input, and only then merge. Use `/review-code` on the
final diff and `/prove-it` for the real-path proof.

## Design pass (PRD section G)

Start when the reader and chat screens are stable. Audit with screenshots on
iPhone 18 Pro, iPhone Air and iPad Pro 13 in light, dark and parchment at
default and AX5 text, rank the findings, fix them, re-shoot. Judge it by eye:
look at the images. Glass on chrome only; reading surfaces stay calm; every
animation respects Reduce Motion; every control has an accessibility label.
Record the Accessibility Inspector audit.

## Store launch (PRD section H)

Create `macos/release-ios.sh` and `macos/scripts/capture-screenshots.sh`,
generate the listing, privacy answers and review notes in `docs/ios/`, build
the archive with the Distribution profile, and upload to TestFlight. Do not
press "Submit for Review" or accept agreements yourself; prepare everything,
then hand Austin the exact remaining clicks.

## Check-ins and reporting

- After Step 0, after each merged lane, and before any store submission,
  post a short status: what merged, evidence, what is next, what you need from
  Austin. Keep `docs/ios/PROGRESS.md` current in the same commits.
- If a gate cannot be passed after two honest attempts, stop that lane, say
  what failed with the actual output, and propose options.
- Credit Austin's specific product decisions in commit messages and ship
  notes where they shaped the work; do not praise generically.

## Definition of done

PRD section 9, all eight criteria, with evidence linked from
`docs/ios/PROGRESS.md`. Do not declare completion earlier. If something is
deferred, it must be deferred by Austin in writing and recorded in the PRD.
