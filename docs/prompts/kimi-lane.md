# Prompt for the Kimi K3 orchestrator: Windows, Learn a verse, and the small wins

Paste everything below the line into Kimi, started in `C:/Users/Owner/Documents/Github_Repositories/sureword-kimi` (your own git worktree; see below).

---

## IMPORTANT: work in your own worktree, not the main checkout (added 2026-09-12)

The main checkout at `C:/Users/Owner/Documents/Github_Repositories/bible-ai-explorer` belongs to the Fable lane, which has workers editing files there right now. **Do not run `git checkout`, `git switch`, `git stash` or `git add` in that directory**; switching branches there moves other agents' uncommitted work onto your branch.

Your worktree is `C:/Users/Owner/Documents/Github_Repositories/sureword-kimi` on branch `kimi/stage-lane`, created from origin/main at 6aa06fb. Do all of your work there. First run, inside it: `pnpm install` (repo root) and `cd mobile && npm install` (mobile is a separate npm tree). Cut one branch per item from `kimi/stage-lane` if you like (`git switch -c kimi/<item>` inside your worktree only). Push your branches to origin; the Fable lane reviews and merges to main. Before starting each item, `git fetch origin && git rebase origin/main` inside your worktree so you build on the latest contracts (receipts and Learn a verse are in docs/FEATURES.md).


You own the third lane of the SureWord plan. Read, in this order, before touching anything:

1. `CLAUDE.md` (repo rules: Android is the primary client, capability parity on web in the same cycle, never `git add -A`, never commit `mobile/.phone-addr`, Conventional Commits, `mobile/` is outside the pnpm workspace).
2. `docs/product-changes-review-2026-09-12.html` (the plan; open it in a browser). Your items carry the purple **Kimi** badge: N5, N4, B5, B6, B7, B8, B9, C1 UI, and the Microsoft Store submission in C8.
3. The matching cards in `docs/product-opportunity-audit-2026-09-12.html` for the file:line evidence.

**Your files and nobody else's:** `windows/**` (create it), `src/components/learn/**` and `mobile/src/features/learn/**` (create), `src/app/bible/learn/**` and `mobile/app/(app)/bible/learn.tsx` (create), `mobile/src/features/notes/components/CreateItemSheet.tsx`, `src/components/notes/**`, `src/components/settings/**` and `mobile/app/(app)/settings.tsx` (only the new highlight-colour-names section), `src/lib/shortcuts.ts` (create), `mobile/app/(app)/bible/index.tsx` and `src/components/bible/BibleBookPicker.tsx` (the continue-reading row only), `src/components/ChatSidebar.tsx`, `mobile/src/features/chat/HistoryModal.tsx`, and for C1 the "See also" section inside the verse sheet once the Fable lane's cross-reference route exists. Do not edit `src/app/api`, `src/lib` (except the new `shortcuts.ts`), `src/utils`, `prisma`, `docs/PARITY.md`, `mobile/CHANGELOG.md`, `mobile/app.json`, or anything under `mobile/src/features/chat/` other than `HistoryModal.tsx`; those belong to the Fable and Codex lanes. Server changes you need go in your return report.

**Order of work:** Stage 1: N5 phase 1, the Windows app as a PWABuilder MSIX built from `https://sureword.app` (the manifest is `public/site.webmanifest`; icons come from `scripts/apply-logo.py`, never hand-drawn), documented in `windows/README.md` with the exact build steps, and a local install proven on this Windows 11 PC. Stage 2: B5, B6, B7, B8 (after the Fable lane ships the reading-history route), B9. Stage 3: N4 Learn a verse against the API spec the Fable lane publishes in `docs/FEATURES.md` (do not invent tables or routes), then C1's "See also" UI, then the Microsoft Store submission.

**Learn a verse, the product bar:** one verse per screen, full-bleed, one job. "Learn" on the verse sheet or a highlight adds it to the queue. Opening Learn shows today's three cards. Each card runs a ladder: read it; the same verse with every fourth word hidden; half hidden; the reference alone. Tap a blank to reveal, swipe to advance. Spaced repetition picks tomorrow's three. No streaks, hearts or badges; the only number shown is "verses you know". Works offline on Android from the bundled KJV. The assistant's chat-side quiz is the Fable lane's.

**Highlight colour names (B6):** eight editable labels stored in the synced preference document (the Fable lane adds the field; you build the Settings section on web and Android and read the labels in the highlight picker).

**How to work:** one branch per item (`kimi/windows-pwa`, `kimi/learn`), never on `main`. Every user-visible change ships on web and Android in the same branch. No new dependencies without asking; no migrations; no AI tools. Do not run `push-phone.sh` or touch Play.

**Proof before you report done:** `pnpm lint && pnpm build`; `cd mobile && npm run typecheck && npm test`; Android emulator screenshots (AVD `VerseMind_Test`) and web screenshots at desktop and 375px, dark and light, saved under `artifacts/<branch>/`; for Windows, a screenshot of the installed app in the Start menu and running. List the `docs/PARITY.md` rows you affect in your report; the Fable lane edits the file.

**Return report format:** branch name, files changed, commands run with real output, screenshot paths, any server change you need, open risks. Never report "tests pass" alone.
