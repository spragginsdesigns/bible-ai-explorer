# Apple remote push: current protocol and historical design

## Current checkpoint, 2026-10-28

Both Apple clients now use direct APNs. The 2026-10-07 Expo recommendation and
`PushRegistration.isServerDeliveryConfigured = false` below are historical;
neither describes current source. Source/unit/build proof and a real closed-Mac
production APNs receipt now exist. Final Developer ID 1.30 is installed against
production, READY deployment/alias readback is confirmed, and native Mac
sign-out/session restoration passed. Device migration, iOS sign-out, taps and
the corrected complete server answer-ready lifecycle remain open. Do not call
this push release complete.

### Registration and transport

- iOS `macos/SureWord-iOS/App/PushRegistration.swift` and macOS
  `macos/SureWord/App/MacPushRegistration.swift` send raw hex tokens through
  `POST /api/push-tokens` with `platform: "ios"` or `"macos"`,
  `apnsEnvironment: "development" | "production"`, timezone, notifyHour,
  enabled, chatReplies and the existing device proof. The canonical stored
  token is `apns:<environment>:<lowercase hex>`; no schema migration is needed.
- iOS uses `SureWordAPNsEnvironment` Info.plist metadata generated from the
  same `SUREWORD_APS_ENVIRONMENT` setting as its `aps-environment` entitlement.
  Missing/unknown metadata disables registration; there is no DEBUG guess.
  macOS reads `com.apple.developer.aps-environment` from its actual signature.
- The server accepts legacy iOS Expo tokens unchanged. Android stays on Expo;
  Web Push stays on VAPID. Only Apple native clients may register raw APNs
  tokens. Caller-supplied server token prefixes are rejected. An Apple raw
  DELETE expands the environment-specific rows; an iOS Expo DELETE retains
  its exact-token behavior. Ownership checks and proof binding remain in the
  existing conditional registration flow.
- `src/lib/apns.ts` selects Apple's production or sandbox HTTP/2 host per
  recipient. ES256 JWTs cache for 50 minutes independently by credential
  identity. Requests carry the SureWord topic, alert type/priority and useful
  collapse IDs; `aps.alert`, `sound: "default"` and top-level screen/conversation
  data preserve native tap routing. Dead tokens are retired; provider-auth
  rejection gets one refresh retry. An unavailable environment returns 503 at
  registration and skips existing rows rather than claiming delivery is live.
- Direct remote-live state is scoped to account, Clerk session, environment
  and token. Permission is deferred to meaningful moments, with read-only
  launch sync. Sign-out stops OS registration, then best-effort removes server
  rows before Clerk invalidates the session. A failed DELETE must not be
  reported as successful unregistration. Local reminders cover unavailable
  delivery without inheriting another account/build's remote-live state.
- On macOS, a live background stream still needs its local answer notice,
  because the server sends answer-ready only after disconnect. Recovered
  answers suppress that local notice while matching remote delivery is live.
  APNs collapse IDs alone do not deduplicate an independent local request.

### Legacy iOS migration protocol and device acceptance

A surviving Expo row can duplicate direct APNs delivery. Current source in
`APNsRegistration.syncIOSLegacyMigration` disables that cached legacy row first
using its proof-bound
Expo POST with `enabled: false` and `chatReplies: false`, before enabling raw
APNs delivery. Once disabling succeeds, a failed legacy DELETE may retry
without blocking direct delivery; retain cached migration state until cleanup
succeeds. If disabling fails, do not create a second enabled delivery row.
Turning both streams off must also clean legacy state before requiring a new
APNs token. Existing valid legacy remote delivery may remain the fallback
while the transition cannot complete.

Post-registration best-effort DELETE alone was rejected during review because
its failure can leave both rows enabled. The disable-first correction and
failure-sequence tests are integrated into the passing signed iOS unit suite.
Migration on a physical installation with a surviving Expo row is still a
runtime acceptance gate; unit coverage does not prove that device transition.

### Credentials and Mac signing

With Austin's explicit approval, separate topic-specific Sandbox and Production
APNs keys were created. Portal readback showed exactly one topic,
`com.spragginsdesigns.sureword`, in the corresponding environment for each key.
Private key contents stay outside the repository. The SureWord Vercel project
has these six variables read back as Hidden Secret values in **Production**:

| Variable | Purpose |
| --- | --- |
| `APNS_KEY_ID`, `APNS_PRIVATE_KEY` | Production/default credential pair |
| `APNS_DEVELOPMENT_KEY_ID`, `APNS_DEVELOPMENT_PRIVATE_KEY` | Explicit sandbox credential pair; never falls back to the production-only key |
| `APNS_TEAM_ID` | Shared team `389LLKGY3Y` |
| `APNS_BUNDLE_ID` | SureWord topic `com.spragginsdesigns.sureword` |

These are deployment-environment variables: the sandbox pair is needed in the
Production server scope too when signed development devices call that server.
An environment's missing/partial pair keeps that environment unavailable.
`PUSH_TOKEN_PROOF_SECRET` remains the device-binding secret. No EAS APNs upload
or iOS Expo-token exchange is required for new direct registrations.

The active production `MAC_APP_DIRECT` profile
`SureWord com.spragginsdesigns.sureword Developer ID Push` has been created and
installed for the existing Developer ID Application certificate. Select it
through the main app target's `SUREWORD_MAC_PUSH_PROFILE`, the unioned push
entitlements through `SUREWORD_MAC_ENTITLEMENTS`, and production APS environment.
Keep the Share extension's sandbox/App Group entitlements and profile settings
separate. Developer ID host/extension signature checks established Hardened
Runtime, secure timestamps and no `get-task-allow`; the host retains production
APS, calendar and App Group entitlements. `install-mac-130-committed-final.log`
records exit 0 and strict-verified Developer ID **1.30.0 (39)** installed at
`/Applications/SureWord.app` from local commit `d30c9937` against the production
API, with no QA loopback target. The temporary proxy is stopped; this supersedes the earlier 1.29
gateway install. See `../PARITY.md` for current installation and
release readback rather than treating a provisioning profile as delivery proof.

### Evidence and remaining acceptance

Local evidence under `/tmp/sureword-parity-takeover/` includes:

- The prepared response-cancellation/connection-latch correction passes
  typecheck/lint and 1,823 logic tests with 17 skips and no failures (1,840
  total), including 11 new disconnect cases. Final build exit 0 generated
  233/233 pages, and independent peer review passed. The correction is local
  commit `80c168b2`, not pushed/deployed. The earlier build containing the creator title
  and clean backend candidate checks belong to the prior revision. `src/lib/apns.ts`,
  `src/lib/push.ts` and `/api/push-tokens` byte-match the reviewed staged source
  (`backend-candidate-deployed-source-match.json`).
- `ios-130-final-unit.log`: signed simulator units succeeded with 565 XCTest
  executions (1 skip, 0 failures) and 376 Swift Testing tests across 43 suites.
- Native Mac authenticated registration/proof binding returned 200, an
  unauthenticated request returned 401, and the client acknowledged the matching
  account/session/environment/token identity. The pending local morning request
  was removed after registration.
- Native Mac sign-out DELETE returned 200 at 20:02:45 UTC, clearing the local
  remote identity and retaining the device proof. Restoring the existing Google
  session returned registration/proof-binding 200 at 20:03:20 UTC and restored
  local identity (`mac-130-final-runtime.json`). This is bounded native Mac
  lifecycle proof, not iOS sign-out or notification-tap proof.
- A real Apple production APNs send using the SureWord topic produced the
  closed-app OS delivered-notification record in `mac-apns-os-receipt.json`.
  That receipt does not prove a visible banner, tap routing, morning cron or
  the complete server answer-ready path.

Production `dpl_DCE8t4qtT4hKFULwnZnMtfjs7Etd` for main `3dd0f8a5` is READY
and owns `sureword.app` plus the legacy host; the direct alias receipt is
`vercel-queue-resolution.json`. The former 8cd deployment
`dpl_FQo5NHfHiKnNopPyERbLJAvbZbbH` was canceled as superseded. The old staged
deployment was not promoted. Native 1.30 production chat completed two
same-conversation KJV replies, but this does not exercise disconnected-client
answer-ready delivery. The 19:54 UTC closed-app attempt persisted the complete
answer but produced no new OS notification record. Production token POSTs
returned 200 and both native preferences were on. Response-branch cancellation
tracking and a connection latch are prepared in `src/lib/chat-client-connection.ts`
and the chat route, with 11 added tests, full checks, final 233-page build and
independent peer review passing. Approved merge/push, deployment and a full
production replay are required; the current READY
deployment does not prove that correction. This is not a passing lifecycle receipt.

Finish warm/cold notification taps, deliberate Stop, legacy-device migration,
offline fallback, local/remote dedup and iOS sign-out. Physical iPhone
13 is unavailable, leaving iOS push and live StoreKit device acceptance open.
App and DMG notarizations are Accepted with zero issues, both artifacts are
stapled/Gatekeeper-accepted, and the installed app's ticket validates
(`mac-130-installed-notarization.json`). The matching DMG is prepared but
unpublished. ASC readback at 20:03:16 UTC confirms iOS 1.30.0 (1) VALID,
internal `READY_FOR_BETA_TESTING`, external `READY_FOR_BETA_SUBMISSION`.
App Store remains 1.26.0; external beta/device acceptance and public Mac release
remain separate gates. Apple parity `f420fe9c`, release infrastructure
`d30c9937` and server correction `80c168b2` remain local commits awaiting the
main merge/push. The server-only change does not alter the notarized Mac source.
See `../PARITY.md` for current release/deployment receipts and remaining gates.

## Historical design, 2026-10-07 (superseded)

The following text is retained as the original decision record. Its disabled
gate, two-transport description, Expo recommendation and credential steps are
not current instructions.

Status 2026-10-07: the iOS client side is built and gated off
(`PushRegistration.isServerDeliveryConfigured = false`). Nothing is sent to
the server from iOS until the Apple key below exists and is uploaded. The
local daily-verse reminder is the iOS delivery path until then, exactly as
before.

### What the server can send today

Read from `src/lib/push.ts`, `src/lib/push-routing.ts`,
`src/lib/push-audience.ts`, `src/app/api/push-tokens/route.ts` and the two
callers (`src/app/api/cron/verse-of-day/route.ts`, `notifyChatAnswerReady`
from `src/app/api/ask-question/route.ts`; the sermon watchdog also uses it).

- Two transports only: the Expo push API (`https://exp.host/--/api/v2/push/send`,
  no access token) and Web Push (VAPID) for browsers.
- `splitRecipients` sends a token to Expo only if it matches
  `^Expo(nent)?PushToken\[.+\]$`. **A raw APNs device token is silently
  dropped.** There is no APNs code anywhere in `src/`.
- `POST /api/push-tokens` accepts `platform: "ios"` and stores any token
  string, so a raw APNs token would be accepted and stored, then never sent to.
- That stored row is not harmless: `planMorningAudience` decides a person's
  due hour from their newest token and fans out to their newest three. A raw
  iOS token would become the account's newest device, set the morning hour
  for their Android phone too, take a device slot, and deliver nothing. This
  is why the client registers nothing until delivery works.
- Payloads: morning verse `data: { screen: "cross", book, chapter, verse }`,
  title/subtitle/body, `channelId: "daily-cross"`; answer ready
  `data: { screen: "chat", conversationId }`, `channelId: "chat-replies"`.
  `priority: "high"`. No `sound` field (Android plays the channel's sound;
  iOS would show the banner silently, see "Server follow-ups").

### What the iOS client now does

- `aps-environment` entitlement on SureWord-iOS (`macos/project.yml`):
  `development` for Debug, `production` for Release, via the
  `SUREWORD_APS_ENVIRONMENT` build setting. The App Groups entitlement is
  unchanged. The App ID already has the Push capability (PROGRESS H1).
- Permission is never requested at launch (B6a). After a grant the app calls
  `registerForRemoteNotifications`, stores the APNs token, and, once delivery
  is configured, exchanges it for an Expo push token exactly as
  `expo-notifications`' `getExpoPushTokenAsync` does:
  `POST https://exp.host/--/api/v2/push/getExpoPushToken` with
  `{ type: "apns", deviceId, development, appId: "com.spragginsdesigns.sureword",
  deviceToken, projectId: "2dc61e76-c7c0-4e8b-be89-0c7e0b4ce379" }` (the EAS
  project Android already uses, `mobile/app.json` `extra.eas.projectId`).
- It registers that Expo token with `POST /api/push-tokens` in Android's shape:
  `{ token, platform: "ios", timezone, notifyHour, enabled, chatReplies }`, and
  `DELETE`s it when both streams are off. Android's `remoteLive` rule decides
  when the local reminder stands down (`PushDeliveryPlan`, tested).
- Taps route like Android's `notificationTapTarget`: `screen: "cross"` opens
  the Daily Cross, `screen: "chat"` opens that conversation, legacy verse-only
  payloads open the reader. Expo nests `data` under `body` in the APNs
  payload; the parser reads either place.

### Options

#### A. Expo push with the APNs key uploaded to the EAS project (recommended)

The server already speaks Expo. Expo needs an APNs key for the bundle id
`com.spragginsdesigns.sureword` in project `@spragginsdesigns/sureword`; it
then delivers `ExponentPushToken[...]` tokens minted for that bundle id
through APNs, sandbox or production per the token's `development` flag.

- Server code: none required. The same `sendPushMessages` reaches iOS.
- Env vars: none new. (Only if "Enhanced security for push notifications" is
  ever turned on in the Expo project: `EXPO_ACCESS_TOKEN`, sent as a bearer
  header by `sendViaExpo`, which would then need that one-line change.)
- Cost: free; Expo's push service is free at this volume.
- Risks: a third party (Expo) sits between the server and APNs, as it already
  does for Android; the iOS app depends on one unauthenticated Expo endpoint
  for the token exchange, the same one `expo-notifications` uses.

#### B. Direct APNs, token-based auth with a .p8 key

- Server code: an APNs HTTP/2 sender (`node:http2`, since `fetch` cannot do
  HTTP/2 to APNs), an ES256 provider JWT refreshed under 60 minutes, routing
  raw hex tokens to it in `splitRecipients`, a per-row APNs environment
  (sandbox vs production) because Debug and TestFlight tokens differ, payload
  mapping (`aps.alert`, `aps.sound`, top-level `screen`/`conversationId`),
  and retiring rows on `410 Unregistered` / `400 BadDeviceToken`. Plus a
  migration for the environment column.
- Env vars: `APNS_KEY_ID`, `APNS_TEAM_ID` (`389LLKGY3Y`), `APNS_PRIVATE_KEY`
  (the .p8 contents), `APNS_BUNDLE_ID` (`com.spragginsdesigns.sureword`), in
  all three Vercel scopes.
- More moving parts on Vercel, new failure modes, and a second phone
  transport to keep in step with Expo for every future push.

**Recommendation: A.** It is a credentials task, not a code task: the server
is unchanged, both phones share one sender and one audience planner, and the
iOS client is already written against it. B only makes sense if SureWord
leaves Expo for Android too.

### What the supervisor (Austin) must create for A

1. **An APNs Auth Key** in the LineCrush Inc team (`389LLKGY3Y`):
   developer.apple.com → Certificates, Identifiers & Profiles → Keys → +,
   name it "SureWord APNs", enable Apple Push Notifications service (APNs).
   Environment: Sandbox & Production (Debug/simulator tokens are sandbox,
   TestFlight/App Store are production). Key restriction: if the portal
   offers topic-specific keys, restrict it to `com.spragginsdesigns.sureword`
   only; otherwise it is team-scoped, so it must be stored only in the
   SureWord EAS project and nowhere near the LineCrush app. Download the
   `.p8` once (Apple never shows it again) and keep it with the other keys in
   `~/.appstoreconnect/private_keys` (never in the repo). Note the Key ID.
   The existing App Store Connect API key (`7DQ48J77LB`) cannot be reused:
   it is an API key, not an APNs key.
2. **Upload it to Expo**: expo.dev → spragginsdesigns → sureword → Credentials
   → iOS → bundle identifier `com.spragginsdesigns.sureword` → Push Key → upload
   the `.p8` with its Key ID and team `389LLKGY3Y` (or `eas credentials -p ios`
   from `mobile/` if the dashboard asks for an iOS config first). This touches
   the iOS bundle id only; Android's FCM credentials are untouched.
3. **Flip the client**: set `PushRegistration.isServerDeliveryConfigured` to
   `true` (`macos/SureWord-iOS/App/PushRegistration.swift`) and update the
   test that pins it off.
4. **Prove it**: on a device (or an Apple silicon simulator, which gets
   sandbox tokens), grant permission, confirm a `platform = 'ios'` row whose
   token starts `ExponentPushToken[`, send one push from expo.dev's push tool,
   then let the morning cron and an "answer is ready" fire. A tap on each must
   open the Daily Cross and the conversation.

### Server follow-ups (not done here)

- `sound: "default"` on Expo messages for iOS recipients, so the morning verse
  is not silent on iPhone (Android's channels carry their own sound). Small
  change in `sendViaExpo`; check it on Android too, where the channel
  normally decides the sound.
- Android suppresses an "answer is ready" banner for a conversation the user
  stopped on purpose (`chatStopSignals.ts`); iOS shows it. Porting that needs
  a stop record from `ChatViewModel.stop()` checked in `willPresent`.
- Neither phone unregisters its token on sign-out; the next account to sign
  in on the device takes the row over by upsert (same as Android).
