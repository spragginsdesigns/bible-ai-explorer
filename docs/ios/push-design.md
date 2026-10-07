# iOS remote push: design note (PRD B6)

Status 2026-10-07: the iOS client side is built and gated off
(`PushRegistration.isServerDeliveryConfigured = false`). Nothing is sent to
the server from iOS until the Apple key below exists and is uploaded. The
local daily-verse reminder is the iOS delivery path until then, exactly as
before.

## What the server can send today

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

## What the iOS client now does

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

## Options

### A. Expo push with the APNs key uploaded to the EAS project (recommended)

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

### B. Direct APNs, token-based auth with a .p8 key

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

## What the supervisor (Austin) must create for A

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

## Server follow-ups (not done here)

- `sound: "default"` on Expo messages for iOS recipients, so the morning verse
  is not silent on iPhone (Android's channels carry their own sound). Small
  change in `sendViaExpo`; check it on Android too, where the channel
  normally decides the sound.
- Android suppresses an "answer is ready" banner for a conversation the user
  stopped on purpose (`chatStopSignals.ts`); iOS shows it. Porting that needs
  a stop record from `ChatViewModel.stop()` checked in `willPresent`.
- Neither phone unregisters its token on sign-out; the next account to sign
  in on the device takes the row over by upsert (same as Android).
