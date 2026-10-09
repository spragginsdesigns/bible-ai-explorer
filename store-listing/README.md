# Store listings: the text on SureWord's Play Store and App Store pages

**This folder is the source of truth for every word users see on the store
pages.** Change the text here first, then copy it to the stores. Never edit a
store listing in a console without changing these files in the same session.

| Store | File | Fields |
|---|---|---|
| Google Play (Android) | [`play-store.md`](play-store.md) | App name, short description, full description |
| App Store (iPhone, iPad) | [`app-store.md`](app-store.md) | Name, subtitle, promotional text, description, keywords, plus categories, URLs, age rating |

## Status

Both stores are **behind** these files right now. Each file opens with a
**PENDING** block that says exactly what is missing and how to clear it. While
a PENDING block exists, the job is not done. TickTick task
`6ac950948f089f376a25a421` tracks it.

- **App Store:** the 2026-10-09 rename and new copy wait on Apple's review of
  1.13.0, which locks the listing. Afterwards, on the Mac:
  `uv run -q --with pyjwt --with cryptography --with requests python macos/scripts/asc.py listing apply com.spragginsdesigns.sureword store-listing/app-store.md`
  (`listing check` reports drift; `macos/release-ios.sh` runs it on every
  release).
- **Play:** the same copy is saved as a draft in the Play Console and goes live
  when the draft is sent for review.

## Rules (Austin, 2026-10-09)

1. **Both stores say the same thing.** The App Store description is the Play
   full description word for word plus Apple's required subscription terms
   footer, and the Play short description is the App Store promotional text.
   `tests/store-listing-parity.test.mjs` fails on any drift.
2. **List every feature.** When a user-visible feature ships, add it to the
   description in both files in the same release cycle.
3. **Write for search and for the heart.** Open with why the Word matters, and
   name features in the phrases people type (KJV Bible, audio Bible, verse of
   the day, daily devotional, Strong's concordance, Bible reading plans, prayer
   list, Scripture memory). No competitor names, no "best"/"#1", no em or en
   dashes.
4. **Claim only what ships.** The App Store copy has a "Verify before
   submitting" list; a feature not verified on the iOS build being submitted
   comes out of both files before the copy goes in.
5. **Limits:** name/title 30, subtitle 30, short description 80, promotional
   text 170, description 4000, keywords 100 (comma separated, no spaces). The
   parity test checks them.
