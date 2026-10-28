# Comped SureWord Pro accounts

Some accounts are on SureWord Pro for free because Austin chose to give it to
them. This page explains how that works. The list of who and why holds personal
details, and this repo is public, so the list lives in a gitignored file on
Austin's PC: `.private/comped-accounts.md`.

**Never move a comped account back to Free** during a cleanup, an audit or a
data fix. A `User.plan = 'pro'` row with no subscription is not an
inconsistency. It is usually a gift.

## How to comp someone

1. Find their Clerk id in the production database (`neondb`; see the Database
   section of `CLAUDE.md`), for example by email:
   `SELECT id, email, name, plan FROM "User" WHERE email ILIKE '%name%';`
2. Set the plan:
   `UPDATE "User" SET plan = 'pro' WHERE id = '<clerk id>';`
3. Add a row to `.private/comped-accounts.md` with who, the date and why.

The change takes effect on the person's next request. There is nothing to
deploy. `getUserPlan` (`src/lib/entitlements.ts`) reads the row fresh every
time, and any active paid subscription also counts as Pro.

To end a comp, set `plan = 'free'` and remove or annotate the row.

## What not to use

- **`SERVER_CREDENTIAL_USER_IDS`** is the owner only (Austin, 2026-10-28).
  It grants the owner picker (Free, Pro and GPT-6.1 Sol) and unmetered use of
  the server's API keys. Never add a comped person to it.
- **`PRO_USER_IDS`** also grants Pro, but it is a write-only Vercel variable
  that needs a redeploy and can't be read back. The database column is
  clearer, so prefer it.

## What a comped account gets

The same as a paying Pro member: SureWord AI Pro, Listen, no voice-message
cap, and the Pro message allowance. See `docs/FEATURES.md` for each one.
