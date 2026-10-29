# SureWord personal-service connections

Status on October 29, 2026: implementation prepared for review. Not publicly
enabled. No live connector OAuth flow or provider write has been verified.
TickTick and Google Tasks are both in scope, alongside Todoist, Google Calendar,
Outlook Calendar, Notion, Drive/Docs, OneNote, Gmail and YouVersion highlights.
The existing Bible Connections map is a separate feature.

## Official public connections are the release target

Austin's requirement: the customer should see the service's normal authorization
screen identifying SureWord, rather than a developer-only warning or instructions
to create their own app or paste an access token. Use provider-owned OAuth and
public production registrations. Complete branding, scope, publisher and partner
review wherever the provider requires or offers it. Do not tell customers to
bypass an unverified-app warning. A Marketplace listing or verified-publisher
badge is not a security certification and must not be claimed without evidence.

The catalog requires an explicit per-provider production release flag in addition
to working credentials. That flag records a completed release review; it must
never substitute for provider approval. Keep it false until the actual SureWord
consent screen, scopes, public availability and connection flow have been checked.
There is no customer personal-token or internal-app fallback.

## Registration details

Use the existing product identity and logo:

- Application: SureWord
- Homepage: https://sureword.app
- Privacy policy: https://sureword.app/privacy
- Terms: https://sureword.app/terms
- Support: https://sureword.app/support
- Existing public contact: spragginsdesigns@gmail.com
- Existing logo source: `public/icon-512.png`
- Exact OAuth redirect: `https://sureword.app/api/connections/oauth/callback`
- Product entry: Settings → Connections on every client

The Google project `versemind-auth` identifies itself as SureWord and is active.
Its branding was missing the homepage, privacy link, terms link and logo. Those
existing public identity details were saved, Google verified the brand, and the
verified branding was published on October 28, 2026. The console then stated
"Your branding has been verified and is being shown to users." This establishes
brand verification only; connector scope review is still outstanding. Its existing Clerk
sign-in client is separate from connector authorization. Do not change Clerk's
registered callbacks or repurpose its client secret.

A dedicated web OAuth client, **SureWord Connections AI**, was registered in
`versemind-auth` with the AI-agent designation and the exact production callback.
Calendar, Tasks, Drive and Picker APIs were enabled. Its credential pair is stored
as production Secrets. The existing Clerk client and callbacks were preserved.

Use this dedicated Google connector registration for Calendar, Tasks and Drive.
Keep Gmail's restricted-scope registration separate so its review does not hold
the other Google integrations behind a Gmail scope change. Production branding
must be published and the exact requested sensitive/restricted scopes reviewed.
Verify domain ownership and prepare a demonstration of each requested scope.
Google's personal-use and test-user exceptions are not this product's public
release path. [Google verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

For Microsoft, use an organization-owned multitenant Entra app, with SureWord's
publisher domain and the verified publisher process. It supports personal plus
work/school accounts. Publisher verification needs the verified Partner Center
organization, appropriate tenant roles and MFA. It does not certify app quality.
[Microsoft publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview).

For Notion, create a **public connection** with **Any workspace** installation
scope, the SureWord identity and the exact callback. Read content is needed for
study sources; Insert content enables approved new pages. Update content is not
needed. Its public OAuth flow is separate from an optional Marketplace listing.
[Notion public connections](https://developers.notion.com/guides/get-started/public-connections).

TickTick's official developer console now contains **SureWord** (app record
`51281`), with the product homepage, description, complete logo and exact callback.
The owner reset its unused initial secret; only the replacement is configured.
Its credential pair is stored as production Secrets. Verify the real public
consent experience before release. The reviewed
TickTick documentation establishes OAuth registration, not a verified-publisher
badge or an approved partner relationship. Record any actual production or app
distribution restrictions before enabling it. [TickTick](https://developer.ticktick.com/docs/openapi.md),
[Todoist](https://developer.todoist.com/api/v1/#tag/Authorization/OAuth).

Todoist's official RFC 7591 endpoint returned HTTP 201 for **SureWord** on
October 29. The registration includes the homepage, public logo, exact callback,
`data:read task:add`, authorization-code and refresh-token grants, and
`client_secret_post`. Both credentials are stored as production Secrets.
No user grant or public consent-screen behavior has been verified. This is an
application registration, not a Marketplace listing or partnership claim.
[Todoist dynamic registration](https://developer.todoist.com/api/v1/).

Gmail remains dependent on appropriate-use review, restricted-scope verification
and any required security assessment for server processing. YouVersion remains
dependent on written approval for the proposed AI use. Do not claim either has
approved SureWord. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[YouVersion terms](https://platform.youversion.com/terms).

## Configuration

All credentials are server-only. The existing AES-256-GCM helper requires
`CREDENTIAL_ENCRYPTION_KEY`; production has that variable, while the local shell
does not. Google, TickTick, Todoist and Notion credential pairs have been staged as eight
production Secret variables. Values remain in ignored local storage and the
server environment; they are never included in committed evidence.

`node scripts/connections/stage-env.mjs --provider=google --provider=ticktick
--provider=todoist --provider=notion` reports a names-only plan. Add `--apply` to stage absent
credentials without overwriting existing ones. This command never enables or
deploys the subsystem. `register-todoist.mjs` defaults to a registration plan;
its `--apply` mode retains a private recovery receipt and refuses to retry an
uncertain registration, preventing duplicate apps after interruption.

| Provider | Application credentials | Additional policy gate |
| --- | --- | --- |
| Calendar, Tasks, Drive | `CONNECTIONS_GOOGLE_CLIENT_ID`, `CONNECTIONS_GOOGLE_CLIENT_SECRET` | Per-provider public release review |
| Gmail | `CONNECTIONS_GMAIL_CLIENT_ID`, `CONNECTIONS_GMAIL_CLIENT_SECRET` | `CONNECTIONS_GMAIL_REVIEWED=true` |
| Outlook, OneNote | `CONNECTIONS_MICROSOFT_CLIENT_ID`, `CONNECTIONS_MICROSOFT_CLIENT_SECRET` | Verified publisher and actual consent review |
| Notion | `CONNECTIONS_NOTION_CLIENT_ID`, `CONNECTIONS_NOTION_CLIENT_SECRET` | Public installation and capability review |
| TickTick | `CONNECTIONS_TICKTICK_CLIENT_ID`, `CONNECTIONS_TICKTICK_CLIENT_SECRET` | Actual public OAuth consent review |
| Todoist | `CONNECTIONS_TODOIST_CLIENT_ID`, `CONNECTIONS_TODOIST_CLIENT_SECRET` | Actual public OAuth consent review |
| YouVersion | `CONNECTIONS_YOUVERSION_APP_KEY` | `CONNECTIONS_YOUVERSION_AI_APPROVED=true` |

`SUREWORD_CONNECTIONS_ENABLED=true` enables the subsystem. Each provider also
requires `CONNECTIONS_<PROVIDER_ID_WITH_UNDERSCORES>_RELEASE_APPROVED=true`.
Examples: `CONNECTIONS_TICKTICK_RELEASE_APPROVED` and
`CONNECTIONS_GOOGLE_TASKS_RELEASE_APPROVED`. No approval flag is set by this work.
`CONNECTIONS_ORIGIN` defaults to `https://sureword.app`; only localhost HTTP is
accepted outside production. Rollback is to turn off the subsystem flag and
leave credentials encrypted. Disconnected grants have no stored credentials.

For the private demonstration Google requires during scope review, local
development can use `CONNECTIONS_VERIFICATION_ONLY=true` with an explicit
localhost `CONNECTIONS_ORIGIN`. This does not enable anything in production,
does not set a release-approval flag, and does not bypass Gmail's or YouVersion's
policy gates. Use an isolated QA database and deliberately chosen test content.
No developer verification mode is part of the customer release.

## Data and action contract

OAuth starts from an authenticated app request. Its one-time start ticket is
hashed at rest. The system browser must sign in to the **same SureWord account**
before starting provider authorization; callback checks that account and a
browser-bound HttpOnly cookie. This intentionally avoids attaching a victim's
provider account through a shared authorization link. A system browser may need
one SureWord sign-in. PKCE is used where documented. Callback completion rechecks
the attempt and global AI consent inside the provider/account lock.

Connected account data has its own explicit AI-use consent. It never overrides
the once-ever global AI agreement or refusal. AI tools can read only selected
sources and return bounded data with provenance. External text is untrusted
material and cannot change doctrine, authorize tools or request secrets.

Only creating tasks, calendar events and new Notion pages is exposed. The AI
prepares an immutable exact-payload proposal; the authenticated user must review
and approve it in Settings. A chat yes or model-supplied confirmed flag cannot
execute it. Proposals bind the connection revision and selected destination.
Google event IDs, Outlook transaction IDs and Todoist request IDs are stable.
An attempted write with an unconfirmed result becomes uncertain and is never
automatically retried. Google Tasks only exposes a scheduled day, not its time.
OneNote, Drive, Gmail and YouVersion adapters expose no write method.

Google Picker is invoked during Drive authorization using `trigger_onepick`,
`drive.file` alone and supported document MIME types. Returned file IDs are
checked with the provider before selection. Existing selections remain only
when the same provider account reconnects. [Official Picker flow](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker).

No persistent external-content index or background sync is introduced. Disconnect
removes local credentials and selections and cancels pending proposals. Provider
revocation is reported only when actually attempted and successful; revoking a
shared Google grant must not silently break another active connection. Existing
copies in saved conversations or deliberately imported notes remain their own
saved records. Account deletion cascades all four new models.

## Evidence and remaining gates

- Adapter tests use actual implementation with injected provider transports.
- Security tests execute actual OAuth/service control flow with a transactional
  fake. This is support evidence, not real OAuth or database lock proof.
- Migration and FK checks ran on disposable Neon branch
  `br-bold-pond-akxzqvjj`. Cross-owner source insertion was rejected, a pending
  action claimed exactly once, owner-ID updates cascaded, and deleting the QA
  account removed all four related record types. User count returned to 78.
  The disposable branch was deleted after verification.
- The final targeted connector suite passed 56 tests. Targeted connector ESLint
  and the full web typecheck passed. Android typecheck and four account-isolation
  tests passed after restoring the installed dependency tree from its manifest.
  The Android chat-rendering regression suite also passed 42 tests.
- A real Mac build caught a sending-safety error in the new mutation helper;
  its request bodies now conform to Sendable. macOS and iOS Simulator builds
  subsequently stopped at the independent PrivacyAccess.swift helper's same
  concurrency error. Neither Apple app is claimed built, installed or verified.
- Production has not been migrated or enabled.
- Google branding was verified and published. Its dedicated connector client and
  required APIs are registered, but connector scope approval remains outstanding.
- TickTick and Todoist app registrations and production credential staging are
  complete. Neither has a verified real user grant yet.
- Notion's owner accepted Developer Terms and created the public OAuth connection
  `408d872b-594c-8187-bbc8-003799cf665f` with the exact callback. Saved capabilities
  are Read content and Insert content; Update content and both comment permissions
  are off. No user information is selected. The owner supplied the client secret
  and explicitly authorized retaining it; the credential pair is staged as
  production Secrets. A live grant has not validated the supplied pair yet.
  Logo upload remains unfinished
  after the browser file chooser failed. Marketplace listing is unpublished.
- Microsoft's portal rejected the saved personal account because it lacks access
  to an organization tenant. Organization-owner sign-in and verified publisher
  setup remain prerequisites for Outlook and OneNote registration.
- Remaining provider registrations, public verification status, real account links,
  real approved writes, Android device acceptance and Apple builds remain gates.
- Real chat proof still needs selected-source citation, a malicious source-content
  test, and representative KJV-grounded questions on the final enabled flow.
- The shared checkout currently contains an independent privacy/KMS refactor.
  Its files and schema hunks must remain separate when committing this feature.

Keep provider approval evidence and credentials private. The public app UI must
not contain developer setup instructions, invented verification badges, or
claims that an untested provider is connected.
