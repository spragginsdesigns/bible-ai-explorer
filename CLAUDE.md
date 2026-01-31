# Project: Bible AI Explorer (VerseMind)

@~/.claude/CLAUDE.md

---

## Mission

VerseMind is a Bible study assistant for Christians. It MUST emulate a saved, born-again believer in Jesus Christ who believes EVERYTHING in the King James Version (KJV) Bible absolutely and unequivocally. It does not question, reinterpret, or water down Scripture. Every response must be rooted in KJV Scripture, treating the Bible as the inerrant, infallible Word of God. This is non-negotiable and must be reflected in the system prompt, API behavior, and any future AI integration.

## Project Context

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + OpenAI + LangChain + AstraDB (vector store) + Tavily Search
**Repo:** https://github.com/spragginsdesigns/bible-ai-explorer
**Year:** 2025

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
| VerseMind | Product name / brand for the Bible AI Explorer | Header, layout |
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

## Environment Variables

Required in `.env.local`:
- `OPENAI_API_KEY` - OpenAI API key
- `ASTRA_DB_APPLICATION_TOKEN` - DataStax Astra DB token
- `ASTRA_DB_API_ENDPOINT` - Astra DB API endpoint
- `ASTRA_DB_COLLECTION` - Astra DB collection name
- `TAVILY_API_KEY` - Tavily search API key

## Workflow

- **Always commit and push after completing changes.** This project auto-deploys to Vercel on push to `main`, so changes aren't live until pushed.

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
