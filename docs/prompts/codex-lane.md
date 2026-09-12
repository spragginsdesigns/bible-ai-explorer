# Prompt for the Codex Astra orchestrator: SureWord frontend lane

Paste everything below the line into Codex, started in `C:\Users\Owner\Documents\Github_Repositories\bible-ai-explorer`.

---

You own the frontend lane of the SureWord plan. Read, in this order, before touching anything:

1. `CLAUDE.md` (repo rules: Android is the primary client, capability parity on web in the same cycle, never `git add -A`, never commit `mobile/.phone-addr`, Conventional Commits).
2. `docs/product-changes-review-2026-09-12.html` (the plan; open it in a browser). Your items carry the green **Codex** badge: N6, B1, B2, B3, B4 client half, C3 verse-sheet UI, C6 UI, C8 public pages.
3. `docs/product-opportunity-audit-2026-09-12.html`, sections "What the audit found" and the cards for B1, B2, B3, B4 (the evidence with file:line for every element you will change).

**Your files and nobody else's:** `src/app/(marketing)/**` (create it), the logged-out branch of `src/app/page.tsx` and the matching `middleware.ts` allowlist entries, `src/components/WelcomeScreen.tsx`, `src/components/Chat*.tsx`, `MessageList.tsx`, `FormattedResponse.tsx`, `markdownComponents.ts`, `RetrievedVersesCollapsible.tsx`, `FollowUpChips.tsx`, `mobile/src/features/chat/**`, `mobile/app/(app)/index.tsx`, `src/components/bible/ChapterReader.tsx` and `mobile/app/(app)/bible/chapter.tsx` for C3 only. Do not edit anything under `src/app/api`, `src/lib`, `src/utils`, `prisma`, `src/components/useChat.ts`, `mobile/src/lib/chatView.ts`, `docs/PARITY.md`, `mobile/CHANGELOG.md`, or `mobile/app.json`; those belong to the Fable lane. If you need a server change, write the request in your return report instead of making it.

**Order of work:** N6 landing page first (Stage 1, isolated, no shared files), then in Stage 2 the chat release as one branch: B1, B2, B3, then B4 rendering once the Fable lane has published the `receipts` contract in `docs/FEATURES.md` (do not invent the shape). C3 and C6 UI and the C8 pages come in Stage 3 after the Fable lane's routes exist.

**How to work:** one branch per item (`codex/landing-page`, `codex/quiet-chat`), never on `main`. Every user-visible change ships on web and Android in the same branch; layout may differ, capability may not. Do not add dependencies, migrations, or AI tools. Do not run `push-phone.sh` or touch Play.

**Design constraints for the landing page:** the brand is the day star rising over the open Word in gold on `#0a0a0a`; KJV throughout; one line on what SureWord is, today's verse (use the public verse-of-day route, no account), install cards for Android APK (`https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk` must stay visible), Play and Windows placeholders, macOS DMG via `GET /api/native-releases`, and web sign-in. No stock photos, no generic SaaS hero. Add `robots.txt` and a sitemap. The logged-in experience must be untouched.

**Design constraints for the chat release:** follow the element table in the audit card "The chat is heavy because the client amplifies structure". Cut: markdown icons, retrieval percentage and match badge, follow-up caption, byline; clamp headings to one step above body. Move: "Add to notes" into a hover row (web, the `group-hover` idiom already used in `ChatSidebar.tsx`) and a long-press sheet (Android, the notes `BottomSheet` primitive), with Copy, Share, Try again beside it. Demote: avatar to first and streaming turns; disclaimer to the welcome screen. Keep: the gold left rule and serif on Scripture blockquotes. Leave the wordmark and the avatar decisions to Austin; ship everything else. Test in dark and light mode and at 375px width; Android system font scale at 1.3x must not push the composer off the welcome screen.

**Proof before you report done:** `pnpm lint && pnpm build`; `cd mobile && npm run typecheck && npm test`; the Android emulator (`docs/android-emulator-proof-recipe` memory: AVD `VerseMind_Test`) showing a light turn, a heavy turn, the long-press sheet, and the welcome screen; web screenshots at desktop and 375px, dark and light. Save screenshots under `artifacts/<branch>/`. Update the rows you changed in `docs/PARITY.md` by listing them in your report; the Fable lane edits the file.

**Return report format:** branch name, files changed, commands run with real output, screenshot paths, any server change you need, open risks. Never report "tests pass" alone.
