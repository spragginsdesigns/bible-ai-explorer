# App Store App Privacy answers (PRD H5)

Status: **draft for the iPhone/iPad app, not entered in App Store Connect.**
These answers must say the same thing as the privacy policy
(`src/lib/marketing/legal-content.ts`, served at https://sureword.app/privacy)
and as the app's `PrivacyInfo.xcprivacy` (PRD A5). Change all three together.

Scope: what the iOS app and the SureWord servers collect from people using the
iOS app, including data collected by SDKs inside it (ClerkKit today; the
PostHog iOS SDK once PRD B3 lands). It assumes the submission build includes
the required lanes B3 (client analytics), B4 (Send feedback), B6 (APNs push),
D7 (voice messages) and A1 (account deletion). If any of them is cut, revisit
the row that names it.

## Top-level answers

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Is any data used to track users? | **No.** No advertising, no ad SDKs, no IDFA, no data brokers, nothing combined with other companies' data for ads. App Tracking Transparency prompt: not needed. |
| Privacy policy URL | https://sureword.app/privacy |

Every collected type below is **linked to the user** (it is stored against the
Clerk account id) and **not used for tracking**.

## Per data type

Purposes use Apple's names: App Functionality, Analytics, Product
Personalization. None of the types is used for Third-Party Advertising,
Developer's Advertising or Marketing, or Other Purposes.

| Apple data type | Collected | Purposes | What it is in SureWord |
|---|---|---|---|
| **Contact Info → Name** | Yes | App Functionality | Name from Google or Sign in with Apple, if the person shares it (Clerk). |
| **Contact Info → Email Address** | Yes | App Functionality | Account email (Clerk), and the optional reply address in Send feedback. The iOS app does not send email to analytics (Android's `identify` sends the user id only, and B3 mirrors Android). If the iOS B3 build sends email in `identify`, add Analytics. |
| Contact Info → Phone Number | No | | |
| Contact Info → Physical Address | No | | My church stores a church's public address, not the user's. |
| Contact Info → Other User Contact Info | No | | |
| Health & Fitness (both) | No | | |
| Financial Info → Payment Info | No | | No purchases in the iOS app (PRD F1). |
| Financial Info → Credit Info, Other Financial Info | No | | |
| **Location → Coarse Location** | Yes | Analytics | PostHog derives country and region from the device's IP address on client events (B3). Server events disable GeoIP. If B3 ships with GeoIP disabled on iOS, change to No. |
| Location → Precise Location | No | | My church is a text search; the app never requests location permission. |
| **Sensitive Info** | Yes | App Functionality, Product Personalization | My testimony (how the person came to faith), and the religious content of their study generally. Apple lists "religious or philosophical beliefs" here. |
| Contacts | No | | |
| User Content → Emails or Text Messages | No | | Chat is with the AI, not between people; it is declared under Other User Content. |
| **User Content → Photos or Videos** | Yes | App Functionality | Photos and screenshots attached to a chat (camera, library, paste), stored in Vercel Blob. |
| **User Content → Audio Data** | Yes | App Functionality | Voice messages attached or shared into a chat, stored in Vercel Blob and transcribed by OpenAI; the transcript is stored. |
| User Content → Gameplay Content | No | | |
| **User Content → Customer Support** | Yes | App Functionality | Settings → Send feedback messages (B4) and answer ratings with their optional written reason. |
| **User Content → Other User Content** | Yes | App Functionality, Product Personalization | Conversations, notes, folders and tags, memories, About me, highlights and labels, documents and text files attached to a chat, saved church, reading plans, Learn progress, shared answers. |
| Browsing History | No | | |
| Search History | No | | Bible search runs on the device. Questions to the assistant are declared as Other User Content. |
| **Identifiers → User ID** | Yes | App Functionality, Analytics | Clerk account id; it is also the PostHog distinct id after sign-in. |
| **Identifiers → Device ID** | Yes | App Functionality, Analytics | The push token registered through `POST /api/push-tokens` (B6), and the random install id the PostHog SDK creates (B3). Not the IDFA. |
| Purchases → Purchase History | No | | No in-app purchases in v1.0. Becomes Yes (App Functionality) when StoreKit (F2) ships. |
| **Usage Data → Product Interaction** | Yes | App Functionality, Analytics, Product Personalization | Screens opened, features used, answer ratings, settings changed by name (Analytics); chapters read and reading log (App Functionality, Product Personalization: Daily Cross, suggested questions, plan progress). |
| Usage Data → Advertising Data | No | | |
| Usage Data → Other Usage Data | No | | |
| Diagnostics → Crash Data | No | | No crash-reporting SDK. Apple's own opt-in crash reports are not collected by the developer. |
| **Diagnostics → Performance Data** | Yes | Analytics | Answer duration buckets, request failures by route shape and cause (B3). |
| **Diagnostics → Other Diagnostic Data** | Yes | Analytics | Sign-in failures by method and Clerk error code, provider failure codes, app version and OS. |
| Surroundings, Body | No | | |
| **Other Data Types** | Yes | App Functionality | Timezone and delivery hour for notifications; personal AI provider API keys (encrypted at rest). |

## Consistency check against the policy

Each "Yes" row maps to a bullet in the policy's "What we collect":

| Row | Policy bullet |
|---|---|
| Name, Email | Account information; Feedback you send |
| Coarse Location | Product usage ("approximate location (country and region)") |
| Sensitive Info | About me and My testimony |
| Photos or Videos | Photos, PDFs and other files |
| Audio Data | Voice messages |
| Customer Support | Feedback you send |
| Other User Content | Your study content; Your home church; Answers you share |
| User ID, Device ID | Account information; Notification data; Product usage ("a random identifier for your device") |
| Product Interaction | Reading activity; Product usage |
| Performance, Other Diagnostic Data | Product usage |
| Other Data Types | Notification data; Settings |

Third parties named in the policy that receive these types: OpenAI, the
user's own AI provider, Tavily, Google Places, ElevenLabs, Clerk, Vercel, Neon,
PostHog, Expo / APNs. Apple does not ask for processor names, but App Review
reads the policy against these answers.

## PrivacyInfo.xcprivacy mapping (for A5)

`NSPrivacyTracking` = false, `NSPrivacyTrackingDomains` = empty. Each type
below gets `NSPrivacyCollectedDataTypeLinked` = true and
`NSPrivacyCollectedDataTypeTracking` = false.

| `NSPrivacyCollectedDataType` | `NSPrivacyCollectedDataTypePurposes` |
|---|---|
| `NSPrivacyCollectedDataTypeName` | AppFunctionality |
| `NSPrivacyCollectedDataTypeEmailAddress` | AppFunctionality |
| `NSPrivacyCollectedDataTypeCoarseLocation` | Analytics |
| `NSPrivacyCollectedDataTypeSensitiveInfo` | AppFunctionality, ProductPersonalization |
| `NSPrivacyCollectedDataTypePhotosorVideos` | AppFunctionality |
| `NSPrivacyCollectedDataTypeAudioData` | AppFunctionality |
| `NSPrivacyCollectedDataTypeCustomerSupport` | AppFunctionality |
| `NSPrivacyCollectedDataTypeOtherUserContent` | AppFunctionality, ProductPersonalization |
| `NSPrivacyCollectedDataTypeUserID` | AppFunctionality, Analytics |
| `NSPrivacyCollectedDataTypeDeviceID` | AppFunctionality, Analytics |
| `NSPrivacyCollectedDataTypeProductInteraction` | AppFunctionality, Analytics, ProductPersonalization |
| `NSPrivacyCollectedDataTypePerformanceData` | Analytics |
| `NSPrivacyCollectedDataTypeOtherDiagnosticData` | Analytics |
| `NSPrivacyCollectedDataTypeOtherDataTypes` | AppFunctionality |

(Purpose constants are `NSPrivacyCollectedDataTypePurpose<Name>`.) Required-
reason API declarations are A5's job and are not covered here.

## Open items for Austin

1. **Coarse Location**: decide whether the iOS PostHog SDK keeps GeoIP (then
   this row stays Yes) or disables it (No). Also check the PostHog project
   setting "Discard client IP data"; the policy says only an approximate
   location is derived, not that the IP is stored.
2. **PostHog on account deletion**: `DELETE /api/account` does not delete the
   PostHog person, so the policy tells people to email for it. Deleting the
   person through the PostHog API inside the route would let the policy drop
   that sentence.
3. **Play Data safety drift** (`docs/PLAY_STORE.md` step 3): the Play form still
   says account deletion is "via email", declares no audio, no device IDs and
   no app activity analytics, and predates voice messages, testimony, push and
   PostHog. It should be re-filed to match this table and the new policy.
