# Daily Walk navigation

Approved by Austin on 2026-10-19. Android 1.97.0 (111), Apple 1.22.0 (28).

## Product contract

Five primary destinations, in order: Today, Bible, Chat, Connections, Study.
Today is an invitation to return to Scripture, with compact local dawn artwork.
Chat remains focused on conversation. Existing Chat root URLs retain their meaning.
Notes is the first Study destination. Settings and Memories are explicitly reachable
from every primary destination. Appearance follows the user's existing theme.

| Capability | Primary home |
| --- | --- |
| Pick Up Your Cross, devotional audio and sharing | Today |
| Reading plans, Learn a verse, Your walk and reading history | Today |
| Send a word | Today |
| Books, chapter grid, reader, passage search, audio and verse actions | Bible |
| Conversation, chat history and attachments | Chat |
| Whole-Bible ring, chapter links, section filters and explanation | Connections |
| Notes and note folders | Study |
| Timeline, people, places, atlas and journeys | Study |
| Sermon studies and actual church announcements | Study |
| Original-language word study | Study and contextual reader actions |

## Compatibility and Back

Android keeps the old `/bible/cross`, `/bible/plan`, `/bible/learn`,
`/bible/history`, timeline, atlas, sermon, `/notes` and `/cross` routes as
parameter-preserving aliases. New Today and Study stacks own their corresponding
screens. Contextual chapter routes re-export the single reader rather than
duplicating its implementation. Opening a chapter from a devotional, reading plan,
reading history or atlas retains that source in its stack. Reader cross-references
keep the same owning context. Cold links have an anchored section home below them.
The tab navigator retains history-based Back behavior.

Web retains existing URLs and classifies the active primary section from the
destination rather than its old URL prefix. Desktop navigation exposes child
destinations under the same five sections. Apple uses native sidebar and tab
navigation with explicit pending destinations for chat receipts and verse handoffs.

## Data and artwork

`GET /api/verse-of-day/preview` authenticates the owner and returns a narrow view
of an existing daily word, or `cross: null`. It never generates, replaces or charges
for a devotional. Responses use private, no-store caching. The existing devotional
workflow runs only after the user opens it. The fallback Scripture is a general
invitation, not a claim that a personalized daily word has been prepared.

Reading history and plans come from existing account-owned data. Study never
invents church content. Word-study handoffs attach real KJV text when requested,
clear prior passage and devotional provenance otherwise, and support repeated asks.

The dawn artwork was generated with the built-in imagegen tool from the approved
visual reference: a simple wooden cross on a rocky overlook, sunrise over a misty
forested valley, evergreen framing, natural gold light, no text or UI. Its prompt
requested a shallow landscape composition with both the sunrise and cross visible.
The 1200-pixel JPEG is 131,721 bytes and identical across `public/`, `mobile/assets/`
and `macos/Shared/Resources/DailyWalk/`. UI labels and icons remain native controls.

## Verification target

Expected: all existing capabilities remain reachable under their new homes,
old links preserve their parameters, and Back returns to the initiating feature.
Real paths: signed release APK on VerseMind_Test, browser at narrow and desktop
widths, native macOS and iOS builds on Austin's Mac.

Required attacks: cold legacy links, devotional to reader and Back, repeated Chat
handoffs with stale provenance, note navigation and save/reopen, rapid tab changes,
offline Today, light/dark appearance and larger text. Opening Today must not generate
a new daily word. Gates and release results will be recorded below before closeout.

## Evidence and release status

Two independent source reviews completed, with all reported P2 issues corrected
and re-reviewed. The final explanation lifecycle test also passed a negative
control: removing only the new guard reproduced the old stale-error failure.

- Android: 81 test files and 1,077 tests pass, plus typecheck. The final signed
  1.97.0 (111) APK passed the navigation walkthrough on VerseMind_Test, including
  contextual Back, cold legacy devotional and note links, real Notes and atlas,
  Settings and Memories, offline Today, repeated Chat handoffs, rapid tab changes,
  font scale 1.3 and explicit dark/light appearance. Original device settings
  were restored. No personal notes or memories were edited and no Chat message
  was sent. The existing word-study endpoint was exercised explicitly.
- Final tested APK SHA-256:
  `4e654f553bfc96bffdb2582ae84d4ebd0da1339669f692d8dadf61428adc465f`.
- Web: typecheck, lint and isolated production build pass. Logic tests: 1,658
  total, 1,641 passing, 17 optional skips, zero failures. Signed-in browser proof
  ran on localhost:3001 because another app occupied port 3000. Today and Study
  were checked at desktop and 375-pixel widths; Notes returned to Study; John 1:1
  rendered Greek, Strong's details and passage actions; Connections filtered
  John 3:16 from ten links to five Gospels links, streamed a grounded explanation,
  and handed the question plus KJV attachment to Chat without sending it.
- Preview boundary: anonymous HTTP 401; authenticated `{ "cross": null }` for
  an account without a current word. SureWord's database retained 240 daily-word
  rows before and after repeated home/preview reads. The server was explicitly
  pinned to the repo's database configuration, overriding an unrelated inherited
  shell connection, and confirmed `current_database() = neondb`.
- Apple: final native source compiles on the Mac for macOS and iOS. The final
  iOS test run passed 365 XCTest cases (one skip) and 334 Swift tests. Result:
  `macos/build-nav-ios.noindex/Logs/Test/Test-SureWord-iOS-2026.10.19_22-32-15--0700.xcresult`.
- Mac release blocker: `bash macos/install-mac.sh --release --no-launch` failed
  at CodeSign with `errSecInternalComponent`; `security show-keychain-info`
  also returned `User interaction is not allowed`. Final unsigned macOS Release
  compilation passed. The installed signed app was preserved; no new Mac DMG
  or installed build is claimed. Logs on the Mac:
  `/tmp/sureword-nav-install.log` and `/tmp/sureword-nav-mac-final-compile.log`.

Local raw evidence is in the gitignored `artifacts/nav-qa/` directory. The Android
reviewer's `android-review/QA-REPORT.md` indexes all screenshots and UI trees.
Play and Vercel publication results will be recorded after their live checks.
