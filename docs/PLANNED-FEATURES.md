# Planned Features

Product ideas that are worth preserving but are not part of the current
implementation. An item moves out of this file only when its product contract,
entitlements, data model and acceptance path are settled.

## Pro built-in AI identity

**Status:** Pinned for product design

SureWord Pro users should not need to bring an API key. Pro uses SureWord's
app-managed OpenAI access, while bring-your-own-key remains an optional path for
people who explicitly want to use their own provider account.

The UI should present the built-in option as a SureWord product capability, not
as though the user configured an OpenAI key. The final name is intentionally
unsettled; possible directions include **SureWord Pro AI** or **SureWord AI**.

Before implementation, decide:

- how the built-in option is labelled in the model/provider picker;
- whether the underlying model name is visible as secondary technical detail;
- how Pro entitlement, fair-use limits and provider outages are explained;
- whether a user's BYOK selection overrides the built-in option globally or
  only for chat;
- which background features always use the app-managed model so scheduled work
  does not depend on a short-lived or revoked personal credential;
- how free users experience features that require app-managed inference.

Non-negotiable: no UI or API response may expose the app-managed credential.

## Longitudinal daily-walk controls

**Status:** Explore after selection provenance has real usage data

Pick Up Your Cross should eventually let a person signal whether they want to
continue a developing theme or receive a fresh direction. Candidate controls:

- **Stay with this** — make continuity explicit and advance to a materially new
  angle rather than repeating yesterday's application;
- **Take me somewhere fresh** — strengthen the recent-theme novelty penalty;
- lightweight “helpful” / “too repetitive” feedback for evaluation and future
  personalization.

Do not build these controls until stored theme, evidence and message-origin data
can support them honestly.
