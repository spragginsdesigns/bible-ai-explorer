# Project: SureWord (formerly VerseMind / Bible AI Explorer)

@~/.claude/CLAUDE.md

---

## Mission

SureWord is a Bible study assistant for Christians. It MUST emulate a saved, born-again believer in Jesus Christ who believes EVERYTHING in the King James Version (KJV) Bible absolutely and unequivocally. It does not question, reinterpret, or water down Scripture. Every response must be rooted in KJV Scripture, treating the Bible as the inerrant, infallible Word of God. This is non-negotiable and must be reflected in the system prompt, API behavior, and any future AI integration.

## Project Context

**Stack:** Next.js 15 (App Router) + TypeScript + Vercel AI SDK v7 (GPT-5.6 Terra) + Neon Postgres/Prisma (app data AND pgvector embeddings) + Clerk + Tavily Search; native Android app in `mobile/` (Expo SDK 57 / React Native)
**Repo:** https://github.com/spragginsdesigns/bible-ai-explorer

## Development Priorities (IMPORTANT)

**The Android app (`mobile/`) is the PRIMARY client and the source of truth
for features.** New features are built for Android first — and the **web
client MUST be brought to 1:1 feature parity with Android**. Web is NOT
sunsetted; it is a first-class client that mirrors Android.

### The Parity Rule (non-negotiable)

1. **Android leads, web follows — always.** When a feature ships on Android,
   the same feature MUST ship on web in the same release cycle. A release is
   not done until both clients have it.
2. **Parity means feature parity.** Every user-visible Android capability must
   exist on web with the same behavior (same API calls, same message/tool
   rendering, same actions). Layout may adapt to the form factor (sidebar vs
   bottom sheet, click vs long-press), but no capability may be missing.
3. **Never remove a web feature Android lacks** — web may be a superset
   (e.g. light-mode toggle, sign-out button), but never a subset.
4. **The parity tracker is `docs/PARITY.md`.** It lists every Android feature
   and its web status. Update it whenever either client changes. A feature is
   only "done" when its row says ✅ on both sides.
5. **The backend is shared and fully active** — the Next.js API routes
   (`src/app/api/*`) serve both clients, so server-side work (tools, prompts,
   memory, persistence) automatically benefits both and auto-deploys to Vercel
   on push. Prefer server-side changes over duplicating logic per client.

**The web app must also always link to the Android APK** so web users can
install the native app. The APK is distributed via GitHub Releases under the
fixed asset name `SureWord.apk` on the latest release (published by
`mobile/scripts/release-apk.sh` — see `mobile/README.md`):
`https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk`
This link must stay visible in the web UI (see `src/lib/constants.ts`).
Google Drive is no longer used for distribution — APK, DMG, and (when it
ships) IPA all live on GitHub Releases, and every release must carry every
platform's asset under its fixed name so `releases/latest/download/<asset>`
keeps working for all of them.

- Mobile docs: `mobile/README.md` (stack, build, Windows gotchas, release checklist)
- Mobile changelog: `mobile/CHANGELOG.md` - **the single source of truth for Play "What's new" notes, and MANDATORY on every Play push**: every versionCode released to Google Play needs an entry written BEFORE publishing (`push-phone.sh` extracts the notes from it and refuses to publish without one - no entry, no publish, same pattern as Context-Pro-AI's `android/CHANGELOG.md`). Bump `mobile/app.json` version on every feature release.
- Install to Austin's phone: `/push-phone` skill (`bash mobile/scripts/push-phone.sh`)
- `mobile/` is intentionally OUTSIDE the pnpm workspace (own npm tree) and excluded from the web tsconfig — keep it that way or Vercel deploys break

## Git & Deployment

- **Remote:** `bible-ai-explorer` → `https://github.com/spragginsdesigns/bible-ai-explorer.git`
- **Production branch:** `main` — auto-deploys to Vercel on every push
- **Legacy branch:** `master` — unused, do not push here
- **Other branches:** `imgbot`, `snyk-upgrade-*`, `whitesource/configure` — automated PRs, ignore
- **Deploy workflow:** commit to `main` → push → Vercel auto-builds and deploys to production at https://sureword.app (legacy host https://bible-ai-explorer.vercel.app serves the same deployment). The Android app calls `https://sureword.app/api/*`, so server-side changes reach the phone only through this deploy — `/push-phone` alone never updates the API.
- **App binaries ship ONLY via GitHub Releases** — never Google Drive or any other channel. Android: `bash mobile/scripts/release-apk.sh` (tags `android-v<version>`). macOS: the flow in `macos/README.md` ("Releasing a DMG"). iOS joins as `SureWord.ipa` when distribution starts.
- **Release invariant — breaking it breaks the website's download buttons.** The site links `releases/latest/download/<asset>`, and `releases/latest` is a *single* release (whichever was published most recently). So EVERY release, on any platform, must attach EVERY platform's current asset under its fixed name — `SureWord.apk`, `SureWord.dmg`, `SureWord.ipa` — re-attaching the other platforms' assets from the previous latest release. `release-apk.sh` does this automatically; never rename the assets, and never create a release with only one platform's binary.
- **Vercel env vars** must match `.env.local` (OPENAI_API_KEY, DATABASE_URL, TAVILY_API_KEY) — set in Vercel dashboard under Project Settings > Environment Variables

## Terminology

| Term | Meaning | Location |
|------|---------|----------|
| SureWord | Product name / brand (renamed from VerseMind on 2026-08-10) | Header, layout |
| pgvector | Verse + note embeddings live in the production Neon DB (`VerseEmbedding`, `NoteEmbedding` tables, halfvec 3072) | `src/lib/scripture-search.ts`, `src/lib/note-embeddings.ts` |
| Tavily | External search API for supplementary web results (`webSearch` AI tool; per-user toggle in Settings → Web Search) | `src/lib/tavily.ts`, `src/lib/ai-tools.ts` |
| RAG | Retrieval-Augmented Generation - queries vector DB for relevant Bible passages | `src/app/api/ask-question/route.ts` |

## Project Structure

```
bible-ai-explorer/
├── src/
│   ├── app/                  # Next.js App Router pages & API routes
│   │   ├── api/
│   │   │   ├── ask-question/ # Main RAG endpoint (OpenAI + Neon pgvector)
│   │   │   ├── memories/     # Memory list + enable toggle API
│   │   │   └── preferences/  # Per-user feature prefs (Web Search toggle)
│   │   ├── layout.tsx        # Root layout
│   │   ├── page.tsx          # Home page
│   │   └── globals.css       # Global styles
│   ├── components/           # React components
│   │   ├── ui/               # Shadcn/radix primitives (button, card, input)
│   │   ├── BibleAIExplorer.tsx # Main app component
│   │   ├── QuestionInput.tsx # User question input
│   │   ├── FormattedResponse.tsx # AI response display
│   │   ├── ClientResponse.tsx # Client-side response wrapper
│   │   ├── ChatHistory.tsx   # Conversation history sidebar
│   │   ├── SelectedConversation.tsx # Selected chat view
│   │   ├── TavilyResults.tsx # Web search results display
│   │   ├── Header.tsx        # App header
│   │   ├── LoadingAnimation.tsx # Loading spinner
│   │   ├── ThemeProvider.tsx  # Dark/light theme
│   │   └── useChat.ts        # Chat state hook
│   ├── lib/
│   │   └── utils.ts          # cn() utility (clsx + tailwind-merge)
│   └── utils/
│       ├── systemPrompt.ts   # System prompt for OpenAI
│       └── commonQuestions.ts # Predefined question suggestions
└── .env.local                # Environment variables (not committed)
```

## Development Commands

```bash
# Start dev server (Claude should NOT run this - assume it's running)
pnpm dev

# Type check / lint
pnpm lint

# Build
pnpm build
```

## Database

There is exactly ONE application database, and the Android app never touches it directly:

```
Android app (Expo)  ──HTTPS + Clerk token──>  Next.js API routes on Vercel
                                                      │ Prisma Client
                                                      v
                              Neon Postgres · project `versemind` · db `neondb`
```

| Fact | Value |
|------|-------|
| Provider | Neon Postgres (via the **Vercel Neon marketplace integration**) |
| Neon project | `versemind` — `small-cell-57936982` |
| Database | `neondb` on `ep-mute-waterfall-akrqxqaz`, us-west-2 |
| ORM | Prisma (`src/lib/prisma.ts`) — Neon is the database, Prisma is how code talks to it |
| Env vars | `DATABASE_URL` / `DATABASE_URL_UNPOOLED` / `NEON_PROJECT_ID` are **injected automatically** by the integration. Do not hand-set them in Vercel. |

**Schema changes use migrations.** Production was baselined on 2026-08-10
(`prisma migrate resolve --applied`), so `prisma migrate status` is clean and
`prisma migrate deploy` is the correct way to ship schema changes. Do not use
`prisma db push` against production any more - it was how the schema originally
got there, and it left no history, which made a routine change look like an outage.

**Two traps, both of which have already cost a debugging session:**

1. **The decoy database.** `ai-bible-explorer` on `ep-morning-star-a6x9ce52` has a
   byte-identical schema and **zero rows**. Nothing reads it. Its name looks more
   "correct" than `neondb`, which is exactly why it is dangerous. **Identify the
   database by row count, not by name** - real production has data (39 users /
   106 conversations / 371 messages as of 2026-08-10).
2. **An inherited `DATABASE_URL`.** A `DATABASE_URL` may already exist in the shell
   environment pointing at an unrelated database. Neither Node's `--env-file` nor
   Prisma's dotenv loader overrides an already-set variable, so it silently beats
   every `.env` file. Before any Prisma command, pin the URL explicitly for that
   command and confirm with `SELECT current_database()`.

## Domains & Auth

| Fact | Value |
|------|-------|
| Primary domain | `sureword.app` (Namecheap, DNS on Vercel nameservers) |
| Legacy domain | `bible-ai-explorer.vercel.app` — still connected, still the API host baked into older APKs. Do NOT rename the Vercel project. |
| Clerk Frontend API | `clerk.sureword.app` (CNAME → `frontend-api.clerk.services`) |
| Account Portal | `accounts.sureword.app` |
| Google OAuth | GCP project id `versemind-auth` — **permanent and not renameable**; every *name* in it now reads SureWord (project display name, consent-screen App name, OAuth client) |

Concrete identifiers, all verified on 2026-08-10. The console IDs are here because
none of them are guessable and every one costs a dashboard hunt to re-find:

| Thing | Value |
|-------|-------|
| DNS — `sureword.app` | `216.150.16.1` (Vercel) |
| DNS — `clerk.sureword.app` / `accounts.sureword.app` | `worker.clerkprod-cloudflare.net` |
| Clerk app / instance | `app_39iwNRGxzWPXBdZqJXfTOYkfVP0` / `ins_3Hjf4TUT4SG5ZfUFizZG3HP8RqH` |
| Clerk application name | **SureWord** — this is the string in "Sign in to …" and in auth emails, and it is *not* the domain; renaming the app renames both |
| Google OAuth client | `SureWord Clerk Production`, `130130092883-52koot97cjtq58toi3gifbacab0kcklr.apps.googleusercontent.com` |
| Google authorized redirect URIs | `https://clerk.sureword.app/v1/oauth_callback` **and** the legacy `https://bible-ai-explorer.vercel.app/__clerk/v1/oauth_callback` |
| Google authorized domains | `sureword.app` and `bible-ai-explorer.vercel.app` |

The legacy `bible-ai-explorer.vercel.app` entries in Google and in Clerk's redirect
allowlist are deliberate, not leftovers: that host is still the API baked into older
APKs. The `versemind://` scheme entries *were* leftovers and are deleted — Clerk's
native allowlist is 14 entries, all `sureword.app` / `sureword://` plus those legacy
web ones.

**Clerk does not support `*.vercel.app` for production instances.** Its API says so
outright: `provider_domain_operation_not_allowed`. Running production Clerk on the
vercel.app host is what caused every web auth failure on 2026-08-10 - a hand-rolled
Frontend API proxy was tried first and produced five separate bugs (a folder Next.js
excluded from routing, merged Set-Cookie headers, cookies scoped to Clerk's domain so
the browser discarded them, relative redirects losing the path prefix, and an
over-broad fix for that). The custom domain is the fix; the proxy was never viable.

**Android needs `@clerk/expo`, not `@clerk/clerk-expo`.** The old package builds the
native Clerk instance without passing `proxyUrl`/`domain` through, so on native it
silently falls back to the publishable key's host. Deep-link scheme is `sureword://`
and **must** stay in sync with Clerk's allowed redirect URLs - `useSSO` requires
native callers to pass `redirectUrl` explicitly or Clerk rejects the sign-in with a
bare "Missing external verification redirect URL for SSO flow".

**Redirect URLs are allowlisted per instance.** Production instances reject any
redirect not on the list, silently, by omitting `external_verification_redirect_url`.
Web needs `/sign-in/sso-callback` (not just `/sso-callback`); native needs
`sureword://sso-callback`.

**The two clients' Clerk keys must move together.** The publishable key *encodes its
Frontend API host*, so `mobile/app.json`'s `extra.clerkPublishableKey` and the web's
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` must be the same key. Android shipped 1.7.0 with a
key encoding `clerk.bible-ai-explorer.vercel.app` after Clerk moved to
`clerk.sureword.app`; that host stopped resolving, so native sign-in was dead, not
degraded. Production key is `pk_live_Y2xlcmsuc3VyZXdvcmQuYXBwJA` (base64 →
`clerk.sureword.app$`) — decode a key to see which instance it points at.

**A custom-domain instance needs no `proxyUrl`.** The `/__clerk` proxy is gone; passing
`proxyUrl` at a route that no longer exists is its own outage. `ClerkProvider` takes
the publishable key and nothing else.

**Google OAuth is a third allowlist, separate from Clerk's.** The GCP client's
*Authorized redirect URIs* must contain `https://clerk.sureword.app/v1/oauth_callback`,
or sign-in dies at Google with `Error 400: redirect_uri_mismatch` — on both clients at
once, since they share one Google client. Google warns changes take "5 minutes to a few
hours" to propagate. To check what is actually being sent, start the web Google flow and
read the `redirect_uri` query param on the `accounts.google.com` URL.

## Brand assets

The logo is the day star rising over the open Word (2 Peter 1:19, where the name
comes from) in gold on the shell's `#0a0a0a`. It replaced a brain-wired-into-a-book
mark that only ever made sense while the product was called VerseMind.

Never hand-edit the icons — every one of them derives from a single master:

```bash
node scripts/generate-logo.mjs dawn      # master → .logo-work/ (gitignored)
python scripts/apply-logo.py .logo-work/dawn.png   # master → every asset
```

`generate-logo.mjs` calls OpenAI `gpt-image-2` and holds the prompts for all four
concepts (`dawn` is the shipped one); it reads `OPENAI_API_KEY` from the
environment or `.env.local`. `apply-logo.py` treats the master as artwork, not as
the icon: it lifts the gold mark off the dark background as an alpha layer and
composes real treatments - a circular badge (gradient disc, gold rim, soft
shadow) for browser favicons, and full-bleed gradient plates for surfaces that
apply their own mask (iOS, Android launchers, PWA maskable, Windows tile,
macOS's Apple-grid rounded rect). Launcher/maskable art is held inside the 80%
safe-zone circle (~62% of the canvas edge), and a favicon proof sheet is
rendered at 16-96px on dark and light so small-size legibility is something you
look at rather than assume.

Changing icons requires a full `expo prebuild` (see below) — Android bakes them
into `res/`, so a rebuilt APK is the only way they reach the device.

## Rebuilding the Android app

**`mobile/android/` is a gitignored prebuild, and renaming things in `app.json` does not
touch it.** The VerseMind→SureWord rename sat in `app.json` for a whole release while the
installed app still had package `com.spragginsdesigns.versemind` and a launcher reading
"VerseMind". Anything that changes the package, app name, scheme, or icons needs
`npx expo prebuild --platform android --clean` to actually reach the device.

Two things bite every time you do that:

- **`local.properties` is deleted with the rest of `android/`** and must be rewritten with
  *both* `sdk.dir` and `cmake.dir` (forward slashes). Without `cmake.dir` the build picks
  the SDK default CMake 3.22.1 and loops forever on `ninja: manifest 'build.ninja' still
  dirty` compiling reanimated. `push-phone.sh` now rewrites it automatically.
- **`prebuild --clean` fails with `EBUSY … rmdir` while `adb.exe` holds a handle** on
  `mobile/android`. `adb kill-server` first (then reconnect — the wireless address is in
  `mobile/.phone-addr`). A running Gradle daemon does the same thing.

Changing the package name means the new APK installs **alongside** the old app rather than
over it; the old one must be uninstalled by hand.

## Environment Variables

`DATABASE_URL` and `DATABASE_URL_UNPOOLED` come from the Neon integration (see above).
Also required in `.env.local`:
- `OPENAI_API_KEY` - OpenAI API key
- `TAVILY_API_KEY` - Tavily search API key
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - Clerk auth

**AstraDB is retired (2026-08-19).** Its free tier hibernated the vector DB on
2026-08-13 and silently broke Scripture retrieval for six days (hibernated DBs
are also scheduled for deletion). Verse and note embeddings now live in the
production Neon DB as pgvector tables (`VerseEmbedding`, `NoteEmbedding`);
rebuild them any time with `scripts/backfill-verse-embeddings.mjs` /
`scripts/backfill-note-embeddings.mjs` (~$0.50 of OpenAI embeddings). The
`ASTRA_DB_*` env vars are dead and can be deleted from Vercel.

## Workflow

- **Ship by default — never wait to be asked.** As soon as a change is verified (lint/typecheck/tests green, and the fix actually confirmed), commit the touched files only (Conventional Commit) and push to `main` in the same turn. Do not end a turn on uncommitted verified work. This project auto-deploys to Vercel on push to `main`, so changes aren't live until pushed. (Reaffirmed by Austin on 2026-08-20: "make it the default.")
- **"Shipped" means shipped everywhere it needs to go — in the same turn, no exceptions:**
  1. **Web/API** → commit + push to `main` (Vercel auto-deploys sureword.app).
  2. **Schema changes** → `prisma migrate deploy` against the real production DB (pin `DATABASE_URL` explicitly per the Database section traps, confirm `current_database()` and row counts before running).
  3. **User-visible mobile changes** → `mobile/CHANGELOG.md` entry + `mobile/app.json` version bump, then `bash mobile/scripts/push-phone.sh` to build the AAB and publish to the Play internal track. The release is not done until the build is on its way to the Play Store. (Reaffirmed by Austin on 2026-08-22: "this is mandatory every time you finish work.")
  4. **macOS/iOS** can't build on Windows — say so and leave a build checklist instead of pretending.

## Autonomous Workflow

Standard loop for any task, mirrored from Context-Pro-AI and adapted to this repo — the command files live in `.claude/commands/`:

1. `/start-workflow` — triage → investigate → design gate (features) → implement.
2. `/prove-it` — adversarial proof through the real product path (device gate for mobile via `/push-phone`, real request for API routes). Static gates (`cd mobile && npm run typecheck && npm test`, `pnpm lint`/`pnpm build` for web) are support checks, never proof alone.
3. `/review-code` — deep review of the actual working diff; any post-proof code change re-invalidates the proof.
4. `/ship-it` — commit touched files only (never `git add -A`), Conventional Commit, push to `main`.

**Standing authorization (Austin, 2026-08-10):** once `/prove-it` and `/review-code` are both green on the final diff, ship autonomously — commit and push to `main` WITHOUT waiting for explicit approval. Git safety still applies: no force-push, no auto-resolving conflicts, never commit secrets or `mobile/.phone-addr` changes. If a gate fails, fix and re-verify; do not ship around a red gate.

## Project-Specific Rules

- All API routes use Next.js App Router (`src/app/api/`)
- Bible verse retrieval = pgvector similarity in Neon plus IDF keyword blending over the bundled KJV (`searchScripture`), with keyword-only fallback if the vector store errs
- UI uses Tailwind CSS + Shadcn/Radix components
- Theme switching via next-themes (ThemeProvider)
- Chat history stored client-side (localStorage)

## Key Files

| Purpose | Path |
|---------|------|
| Main entry | `src/app/page.tsx` |
| Root layout | `src/app/layout.tsx` |
| Main component | `src/components/BibleAIExplorer.tsx` |
| RAG API route | `src/app/api/ask-question/route.ts` |
| Tap-a-verse insight route | `src/app/api/verse-insight/route.ts` (docs: `docs/FEATURES.md`) |
| Tap-a-verse client hooks | `src/components/bible/useVerseInsight.ts` + `mobile/src/features/bible/useVerseInsight.ts` (mirrored) |
| Web search (Tavily) | `src/lib/tavily.ts` + `webSearch` tool in `src/lib/ai-tools.ts`; toggle API at `src/app/api/preferences/` |
| Scripture vector search | `src/lib/scripture-search.ts` |
| Note embeddings sync/search | `src/lib/note-embeddings.ts` |
| Original languages (WLC/TR + Strong's) | `src/lib/bible/originals.ts` + `src/data/originals/` |
| Cross-references | `src/lib/bible/crossRefs.ts` + `src/data/crossrefs/` |
| Memory extraction/injection + caps | `src/lib/memory.ts` |
| Memory management API | `src/app/api/memories/` |
| System prompt | `src/utils/systemPrompt.ts` |
| Chat hook | `src/components/useChat.ts` |
| Global styles | `src/app/globals.css` |
| Web settings page | `src/app/settings/page.tsx` |
| Web client preferences | `src/lib/preferences.ts` |
| Mobile settings screen | `mobile/app/(app)/settings.tsx` |
| Mobile settings store + theme hooks | `mobile/src/features/settings/settingsStore.ts` |
