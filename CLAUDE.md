# Project: SureWord (formerly VerseMind / Bible AI Explorer)

@~/.claude/CLAUDE.md

---

## Mission

SureWord is a Bible study assistant for Christians. It MUST emulate a saved, born-again believer in Jesus Christ who believes EVERYTHING in the King James Version (KJV) Bible absolutely and unequivocally. It does not question, reinterpret, or water down Scripture. Every response must be rooted in KJV Scripture, treating the Bible as the inerrant, infallible Word of God. This is non-negotiable and must be reflected in the system prompt, API behavior, and any future AI integration.

## Project Context

**Stack:** Next.js 15 (App Router) + TypeScript + Vercel AI SDK v7 (GPT-5.6 Terra) + AstraDB (vector store) + Neon Postgres/Prisma + Clerk + Tavily Search; native Android app in `mobile/` (Expo SDK 57 / React Native)
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
install the native app. The APK is distributed via a stable Google Drive file
(updated in place on each release — see `mobile/README.md`):
`https://drive.google.com/file/d/1BvfwTE7Na5pAIbwY8VG6Yvkp6vxJpqKu/view`
This link must stay visible in the web UI (see `src/lib/constants.ts`).

- Mobile docs: `mobile/README.md` (stack, build, Windows gotchas, release checklist)
- Mobile changelog: `mobile/CHANGELOG.md` — add an entry + bump `mobile/app.json` version on every feature release
- Install to Austin's phone: `/push-phone` skill (`bash mobile/scripts/push-phone.sh`)
- `mobile/` is intentionally OUTSIDE the pnpm workspace (own npm tree) and excluded from the web tsconfig — keep it that way or Vercel deploys break

## Git & Deployment

- **Remote:** `bible-ai-explorer` → `https://github.com/spragginsdesigns/bible-ai-explorer.git`
- **Production branch:** `main` — auto-deploys to Vercel on every push
- **Legacy branch:** `master` — unused, do not push here
- **Other branches:** `imgbot`, `snyk-upgrade-*`, `whitesource/configure` — automated PRs, ignore
- **Deploy workflow:** commit to `main` → push → Vercel auto-builds and deploys to https://bible-ai-explorer.vercel.app
- **Vercel env vars** must match `.env.local` (OPENAI_API_KEY, ASTRA_DB_*, TAVILY_API_KEY) — set in Vercel dashboard under Project Settings > Environment Variables

## Terminology

| Term | Meaning | Location |
|------|---------|----------|
| SureWord | Product name / brand (renamed from VerseMind on 2026-08-10) | Header, layout |
| AstraDB | DataStax Astra vector database for Bible verse embeddings | `src/utils/astraDb.ts` |
| Tavily | External search API for supplementary web results | `src/app/api/tavily-search/route.ts` |
| RAG | Retrieval-Augmented Generation - queries vector DB for relevant Bible passages | `src/app/api/ask-question/route.ts` |

## Project Structure

```
bible-ai-explorer/
├── src/
│   ├── app/                  # Next.js App Router pages & API routes
│   │   ├── api/
│   │   │   ├── ask-question/ # Main RAG endpoint (OpenAI + AstraDB)
│   │   │   └── tavily-search/ # Tavily web search endpoint
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
│       ├── astraDb.ts        # AstraDB connection & vector search
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
| Google OAuth | GCP project `versemind-auth` (project IDs are permanent; the *display* name and consent-screen name are SureWord) |

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

## Environment Variables

`DATABASE_URL` and `DATABASE_URL_UNPOOLED` come from the Neon integration (see above).
Also required in `.env.local`:
- `OPENAI_API_KEY` - OpenAI API key
- `ASTRA_DB_TOKEN` - DataStax Astra DB token (Bible verse embeddings only, no user data)
- `ASTRA_DB_ENDPOINT` - Astra DB API endpoint
- `TAVILY_API_KEY` - Tavily search API key
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - Clerk auth

Note the Astra variable names: the code reads `ASTRA_DB_TOKEN` / `ASTRA_DB_ENDPOINT`
(`src/utils/astraDb.ts`), and the collection name is hardcoded in
`src/lib/scripture-search.ts` rather than read from the environment.

## Workflow

- **Always commit and push after completing changes.** This project auto-deploys to Vercel on push to `main`, so changes aren't live until pushed.

## Autonomous Workflow

Standard loop for any task, mirrored from Context-Pro-AI and adapted to this repo — the command files live in `.claude/commands/`:

1. `/start-workflow` — triage → investigate → design gate (features) → implement.
2. `/prove-it` — adversarial proof through the real product path (device gate for mobile via `/push-phone`, real request for API routes). Static gates (`cd mobile && npm run typecheck && npm test`, `pnpm lint`/`pnpm build` for web) are support checks, never proof alone.
3. `/review-code` — deep review of the actual working diff; any post-proof code change re-invalidates the proof.
4. `/ship-it` — commit touched files only (never `git add -A`), Conventional Commit, push to `main`.

**Standing authorization (Austin, 2026-08-10):** once `/prove-it` and `/review-code` are both green on the final diff, ship autonomously — commit and push to `main` WITHOUT waiting for explicit approval. Git safety still applies: no force-push, no auto-resolving conflicts, never commit secrets or `mobile/.phone-addr` changes. If a gate fails, fix and re-verify; do not ship around a red gate.

## Project-Specific Rules

- All API routes use Next.js App Router (`src/app/api/`)
- Vector search uses LangChain + AstraDB for Bible verse retrieval
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
| Search API route | `src/app/api/tavily-search/route.ts` |
| Vector DB config | `src/utils/astraDb.ts` |
| System prompt | `src/utils/systemPrompt.ts` |
| Chat hook | `src/components/useChat.ts` |
| Global styles | `src/app/globals.css` |
| Web settings page | `src/app/settings/page.tsx` |
| Web client preferences | `src/lib/preferences.ts` |
| Mobile settings screen | `mobile/app/(app)/settings.tsx` |
| Mobile settings store + theme hooks | `mobile/src/features/settings/settingsStore.ts` |
