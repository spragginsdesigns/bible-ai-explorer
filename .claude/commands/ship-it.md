---
description: Commit, push to main (auto-deploys to Vercel), report
argument-hint: [additional instructions]
---

# Ship It

Executes the full VerseMind deploy workflow. Authorization is the green-gate rule (`CLAUDE.md` → Autonomous Workflow): run this autonomously once `/prove-it` and `/review-code` are both green on the final diff — no human approval required. Never run this workflow with a failed or unsatisfied gate; a failed gate means fix and re-verify, not ship.

## Modifiers in `$ARGUMENTS`

- `but first prove-it`: run `/prove-it` before committing; do not proceed until proven.
- `but only current working changes`: stage ONLY files touched this session (default — be extra strict).
- `skip verification`: bypass the gates — only valid when Austin says it explicitly.

## Mandatory Verification Gate

Runs BEFORE any git operation. Refuse the ship unless every requirement has real evidence in this conversation:

- Mobile: `cd mobile && npm run typecheck && npm test` green, plus the device gate (`/prove-it` → Mobile device gate) passed or its gap explicitly reported.
- Backend/web: `pnpm lint` (and `pnpm build` for contract changes) green, plus a real request through the changed route.
- The reviewed diff is the proven diff — no code changed after the last proof.

**Not evidence:** "logic looks correct," "small change," tests alone for a user-facing flow.

**Bypass — only these two paths:** (1) Austin includes `skip verification` in `$ARGUMENTS`; (2) Austin explicitly confirms he personally tested each named surface. If the gate fails, stop and name the specific gap; offer `/prove-it` or wait for an explicit bypass.

## Pre-computed Context

- **Current branch**: !`git branch --show-current`
- **Git status**: !`git status --short`
- **Staged changes**: !`git diff --cached --stat`
- **Unstaged changes**: !`git diff --stat`
- **Recent commits on main**: !`git log --oneline -5`

## Workflow

1. **Sync:** `git fetch bible-ai-explorer`, `git checkout main`, `git pull --rebase bible-ai-explorer main`.
2. **Commit:** stage only files touched this session with explicit `git add <files>` — never `git add .` or `git add -A` (the repo root has `.env` files and scratch artifacts; check `git status` first). Conventional Commit message via HEREDOC (`feat(mobile): …`, `fix(mobile): …`, `feat(api): …`); body states what and why in 1-3 sentences. Do NOT commit `mobile/.phone-addr` changes or any secret-bearing file.
3. **Push:** `git push bible-ai-explorer main`. A non-fast-forward rejection means fetch + rebase + retry (up to 3 attempts). Never force-push. Pushing `main` auto-deploys the backend/web to Vercel — that is the deploy step; there is no separate Production branch here.
4. **Post-deploy smoke (backend changes only):** after ~1-2 min, hit the deployed endpoint or page at `https://bible-ai-explorer.vercel.app` and confirm a sane response. Mobile-only shipments skip this (the APK is the artifact — offer `/push-phone` if it didn't run during proof).
5. **Report:** commit hash, files committed, gates evidence summary, any reported gaps, current branch.

## Safety

- No force push to `main`; no `git reset --hard` with uncommitted work present.
- Merge conflicts: STOP and report, never auto-resolve.
- Never commit secrets (`.env`, `.env.local`, keys, tokens). If a secret is already staged, unstage it and warn Austin.

## Success Output

Report: commit hash, files committed, Vercel deploy note (if backend touched), gates summary, current branch.
