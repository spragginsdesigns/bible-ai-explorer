# Security scan 2026-10-09: findings and fixes

Codex Security Cloud scanned `spragginsdesigns/bible-ai-explorer` at `5204fb7`
on 2026-10-09 (32 minutes, 12 findings). Every finding was checked against the
code before it was fixed, and all twelve were real. This page records what each
one was, what changed, and how the fix was proven, so the next scan (or the next
person in this code) can tell a regression from a known trade-off.

Proof environment: the isolated Neon branch `ep-withered-dew` (never
production), with every migration applied from the files, real Vercel Blob
uploads, real OpenAI transcription and real Google Places calls, driven
through the actual route handlers by a plain-Node harness. Production was only
read (row counts and mismatch checks) until the release itself.

## High

### 1. Concurrent attachment completion duplicated paid transcription

**Was:** `POST /api/chat/attachments/[id]/complete` read the row, checked the
allowance from a non-transactional sum, and called OpenAI before writing
anything, so N parallel requests for one voice message paid N times and all
spent against the same stale total.

**Now:** one request claims the upload with a conditional update
(`ChatAttachment.processingToken`); the others wait for its answer and return
the same finished attachment, so a double tap or a client retry still gets a
200 with the transcript. A claim older than the route's `maxDuration` belongs to
a dead request and may be taken over. The final write is conditional on the
claim token, so a row removed mid-flight answers 409 instead of resurrecting.

**Proof:** five parallel completes of one real WAV: five 200s with the same
transcript, **one** OpenAI transcription call, one ledger row. Negative control
against the old route: **five** calls.

### 2. Deleting completed audio reset the rolling allowance

**Was:** the free daily minutes were summed from live `ChatAttachment` rows, so
deleting a transcribed attachment (or its conversation) handed the minutes
back.

**Now:** `AudioTranscriptionUsage` is an append-only ledger with no foreign key
to the attachment. `reserveAudioSeconds` counts it and books the new message
under a per-user advisory lock (namespace 8204) before the paid call; only a
failed transcription releases its row. The last 24 hours of usage was carried
into the ledger by the migration.

**Proof:** transcribe, delete the attachment, upload again: 429 `audio_quota`
with zero OpenAI calls.

## Medium

### 3. Church enrichment could fetch private-network addresses (SSRF)

**Was:** a Places `websiteUri` was fetched after a syntax-only check, following
redirects, with no DNS or address validation.

**Now:** `src/lib/safe-fetch.ts` checks scheme, credentials, port (80/443) and
host on every hop with manual redirects (max 5), resolves the name inside the
socket's own lookup, refuses every non-global IPv4/IPv6 range (loopback,
private, link-local and metadata, CGNAT, IPv4-mapped, NAT64, 6to4, Teredo,
documentation, multicast, reserved) and connects to the address it checked,
which also defeats DNS rebinding. A Places website that fails the policy is no
longer stored or shown.

**Proof:** `tests/safe-fetch.test.mjs` (local server: redirects to metadata,
`[::1]`, localhost and private-resolving names refused with no connection; hop,
body and time caps). Real sites (fmbcfresno.org, saddleback.com) fetch as
before; `169.254.169.254.nip.io` and `10.0.0.1.nip.io` are refused.

### 4. Attachment initialization had no cumulative quota

**Was:** each request could create five rows and up to 25 MB of upload
capacity with no per-account bound, and the cleanup cron removed only 100 stale
rows a day.

**Now:** an account may hold 25 started-but-unsent uploads or 125 MB of them
(`MAX_PENDING_ATTACHMENTS`), counted and created under advisory lock 8205; past
that, 429 `attachments_pending`. The cron drains page by page within a
four-minute budget.

**Proof:** 26th unsent upload refused; four parallel inits at the cap leave
exactly 25 rows.

### 5. Native release scripts published without signer or revision checks

**Now:** `scripts/lib/release-provenance.sh` (Git Bash and macOS bash 3.2).
Android artifacts must be signed by the upload certificate pinned in
`mobile/scripts/upload-cert.sha256` (apksigner for the APK, jarsigner and
keytool for the AAB), checked in `build-aab.sh`, before the Play upload in
`push-phone.sh` (including `--skip-build`) and in `release-apk.sh`. The build
records a digest of `mobile/` and publishing refuses if the source changed
since. The DMG carries a provenance file; `release-dmg.sh` checks its hash,
version and `macos/` digest, then requires `codesign --verify --deep --strict`
with the SureWord identifier and team `389LLKGY3Y`. A pre-existing bug that
left the DMG mounted (and ran `rm -rf` on the mountpoint) after a failed check
is fixed.

**Proof:** real signed artifacts with Play, `gh` and `create-dmg` stubbed: the
normal and `--skip-build` paths pass; foreign-signed, unsigned and tampered
artifacts, source drift and stale manifests are all refused before publishing.
`tests/release-supply-chain.test.mjs`.

### 6. Church saves triggered paid enrichment without a rate limit

**Now:** six paid saves per user per hour, counted durably in
`ChurchSaveEvent` under advisory lock 8206 (an in-memory burst guard of ten
stays in front). A place someone saved in the last 24 hours, by
`UserChurch.enrichedAt`, is copied instead of fetched again, free and
uncounted; the copy keeps the source's `enrichedAt`, so reuse never stretches a
read. `/api/church/photo` (public, paid on cache miss) is limited to 60 per IP
per five minutes.

**Proof:** 7th paid save refused with zero Places calls; five parallel saves
with two left let exactly two through; a real save of First Missionary Baptist
(Places + safe fetch + model, 449-character mission); a second user's save of
the same place makes zero Places calls; a 25-hour-old enrichment is not reused.

### 7. Original-language builder executed JavaScript from mutable branches

**Now:** `scripts/build-original-languages.mjs` pins each upstream to a commit
SHA, verifies all 68 downloads against `scripts/build-original-languages.lock.json`,
and parses the dictionaries with `JSON.parse` instead of `eval`.

**Proof:** regenerated `src/data/originals` byte-identical to the committed
data; a tampered hash stops the build with nothing written.

### 8. Android share imports copied untrusted content before byte limits

**Was:** `expo-share-intent` copied every shared stream whole into `cacheDir`
on arrival and never cleaned up, and the app's own copy then checked the size
the *sending* app declared.

**Now:** the patched library copies nothing; the new `SureWordShare` native
module copies `content://` streams with a hard cap (the type's limit, or what
the 25 MB message budget has left), deletes partial files on every failure, and
the app uses the measured size. The iOS share extension copies with the same
per-type cap when the size is unknown and re-measures every copy.

### 9. Client-writable assistant roles allowed forged public answers

**Now:** `POST /api/conversations/[id]/messages` accepts only `role: "user"`,
and `PATCH` refuses content or metadata edits on assistant rows (thumbs still
work), so every assistant row, and therefore every shared answer, is written by
the server. A read-only production check found no forged rows or shares.

## Low

### 10. Possession of a push token allowed cross-account reassignment

**Now:** a web subscription moves to another account only with its own
`p256dh`/`auth` keys. Expo tokens get a server-issued device proof
(HMAC of the token under `PUSH_TOKEN_PROOF_SECRET`); once a device has
registered with it (`PushToken.deviceBound`), the token moves only with that
proof. Rows from builds that predate the proof keep the old behavior, so a
shared phone on an old build can still switch accounts. With the env var unset,
the feature is off. Residual: an attacker who already holds a victim's Expo
token (not exposed by any API) and binds it while the victim is on an old build
can keep the victim's pushes away until the row is cleared.

### 11. Notes could reference another user's folder

**Now:** `Note (folderId, userId)` references `Folder (id, userId)`, so the
database refuses a cross-account folder; create, patch and the organize tool
check ownership first (400 "Folder not found"). Folder delete unfiles the
owner's notes and deletes the folder in one transaction.

**Proof:** a direct insert with another user's folder fails P2003; the API
answers 400 on create and move; own-folder create, move, unfile and delete work.

### 12. Revoked share-card images stayed in shared caches

**Now:** the card is `public, max-age=0, s-maxage=300, must-revalidate`, tagged
per share, and purged by tag when the link is revoked or its conversation is
deleted.

**Caught after deploy:** the first version guarded the tag calls with
`addCacheTag(...).catch(...)`, and in production the runtime's `addCacheTag`
returns `undefined`, so every live card answered 500 ("Cannot read properties
of undefined (reading 'catch')") for 61 minutes: the fix (`80ceac0`) was
pushed within minutes, but its deploy sat queued behind the team's single
build slot for most of that hour. Revoking a link and deleting a conversation
with live shares failed the same way in that window. Tagging and purging now
live in `src/lib/shared-answer-cache.ts` behind `try`/`await`, which can never
fail a card, a revoke or a conversation delete, and a test forbids the
`.catch` form. After the fix: the live card answers 200 `image/png` and the
second request is a CDN HIT; an unknown or revoked id answers 404.
