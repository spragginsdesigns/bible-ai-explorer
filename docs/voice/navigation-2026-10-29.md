# Spoken choices, navigation and 1.15x playback

The Mac screen Austin reported used welcome narration, which could read a
question but did not listen or select its choices. This update adds voice
controls to the account shell on Android, Apple and web, so leaving Chat
does not remove the controller.

New listening controls remain restricted to the verified owner account
`atmosphere9999@gmail.com`, with Pro required. Clients ask the authenticated
`GET /api/voice/live` endpoint, whose server checks Clerk's verified primary
email. Another account, failed verification, sign-out or non-200 disables
capture. A successful owner response can enable local commands while the
paid relay is unavailable: local commands do not create GPT-Live sessions
or consume its connected-time allowance.

Activate **Start voice controls** once and grant microphone/speech permission.
The app reads the current question and numbered choices before listening.
Examples include:

- “Saved and growing in the Word” or “choose option four.”
- “Call me Alice” or a testimony where **Type my own** is allowed.
- “Open Bible,” “open Notes,” “open Settings,” and “go back.”
- “Read my options,” “repeat options,” and “stop voice controls.”
- Choose **Pick a time**, then a displayed hour or its option number.
- During a tour, choose the visible **Next**, **Done**, or close action.

Navigation covers Today, Bible, Chat, Connections, Study, Notes and Settings.
It does not provide arbitrary OS control or make every nested reader/editor
button voice-addressable. Native church-search result picking and arbitrary
reader chapter/verse controls remain outside this change. Web and Android
also register their visible church search/result actions.

Clients register current labels and their existing callbacks. Only a final
recognition result selects by full label or valid number/ordinal. Ambiguous
“saved” does not guess between “Newly saved” and “Saved and growing.” A stale
card, route, tour step or account invalidates the captured command. Choices
run the same handlers as tapping, including device effects and the normal
saved chat reply. The current action surface is consumed before execution
so duplicate recognition cannot submit it twice.

Unknown speech on a freeform card goes through its answer handler; strict
cards clarify. Ordinary questions use the existing chat send and tools.
Capture pauses while SureWord speaks, navigates, sends or confirms a saved
answer. Clients verify the exact saved assistant row before speaking it or
listening again. Save failures stop with an explanation instead of retrying
a potentially completed action. Stop, account change, background and
teardown cancel capture and fence late permission/recognition callbacks.

Welcome narration and device speech now play at **1.15x**. Native streamed
audio, Android audio and browser HTML audio preserve pitch. Raw GPT-Live PCM
also uses 1.15x with corrected chunk scheduling and queue accounting; that
browser path changes pitch slightly because AudioBufferSourceNode does not
offer pitch-preserving stretch.

Apple requires on-device English Speech recognition and fails with an
explanation if it is unavailable. Android uses the native Expo speech
recognition service. Browser controls require Web Speech recognition.
Browser/Android recognition may use the platform's speech service; these
controls are separate from GPT-Live.

This branch does not update the installed Mac app or publish native builds.
Native clients must target an API serving the owner eligibility endpoint
before their Start button appears. Android needs a native rebuild for its
new recognition module and microphone permission; a Metro bundle alone
cannot install the module. Actual microphone/TCC, spoken recognition,
speaker/Bluetooth routing, echo and blind-user VoiceOver/TalkBack acceptance
remain release checks. Headphones help keep screen-reader speech out of
capture outside app-owned narration. No physical-device or store-release
result is inferred from tests, builds or synthetic recognition events.

Evidence: [navigation validation](navigation-validation-2026-10-29.json).
