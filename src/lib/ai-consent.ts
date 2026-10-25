/**
 * The one-time AI disclosure and consent sheet ("How SureWord answers you"),
 * PRD A4 and docs/ios/ai-consent.md. Apple 5.1.2(i) asks for disclosure of, and
 * permission for, personal data sent to a third-party AI; the same copy ships
 * on every client (Parity Rule).
 *
 * This is the single source of the text. It is mirrored by hand in
 * `mobile/src/lib/aiConsent.ts` and `macos/Shared/AIConsent.swift`, and
 * `tests/ai-consent.test.mjs` fails if any mirror drifts in text or version.
 * The provider list must also match the "How AI processing works" section of
 * `/privacy` (`src/lib/marketing/legal-content.ts`).
 *
 * Copy approved verbatim by Austin on 2026-10-07. The sheet is shown once per
 * account, ever (Austin, 2026-10-13): a yes or a confirmed no is saved on the
 * account and never asked again, so bumping `AI_CONSENT_VERSION` only stops
 * stale builds recording agreement; it never re-asks anyone.
 */
import { AI_CONSENT_VERSION } from "./preferences-contract";
import type { AiConsentDocument } from "./preferences-contract";

export { AI_CONSENT_VERSION };

export const AI_CONSENT_TITLE = "How SureWord answers you";

export const AI_CONSENT_BODY =
	"SureWord's answers are written by AI. To answer you, SureWord sends your question, the conversation, your attachments, and the study context you have shared (About me, your testimony, memories, notes, highlights and reading) to OpenAI, or through OpenRouter to the provider of the selected model. OpenAI also transcribes voice messages. Web searches go to Tavily, and spoken devotionals are voiced by ElevenLabs. They use it only to answer you; it is never sold or used for ads. The AI can be wrong, so search the Scriptures to see whether these things are so.";

export const AI_CONSENT_PRIVACY_LABEL = "Privacy Policy";

export const AI_CONSENT_PRIVACY_URL = "https://sureword.app/privacy";

export const AI_CONSENT_AGREE = "Agree and continue";

export const AI_CONSENT_DECLINE = "No thanks";

/**
 * The confirmation "No thanks" leads to. SureWord is mostly AI, so a no is
 * confirmed before it is saved; once saved it is never asked again.
 */
export const AI_CONSENT_CONFIRM_TITLE = "Turn off AI?";

export const AI_CONSENT_CONFIRM_BODY =
	"SureWord is built around AI. Without it, chat, verse explanations, word studies, Pick Up Your Cross reflections and note help won't work. You can still read the Bible, highlight and write notes. You won't be asked again; to change your mind, go to Settings → AI.";

/** The confirmation's primary button: agrees, as "Agree and continue" does. */
export const AI_CONSENT_CONFIRM_ALLOW = "Allow AI";

/** The confirmation's no, saved on the account. Also Settings → AI's off action. */
export const AI_CONSENT_CONFIRM_DECLINE = "Turn off AI";

/** Settings → AI row title. */
export const AI_CONSENT_SETTINGS_TITLE = "AI data sharing";

/** Settings → AI action that turns AI off, after a confirm dialog. */
export const AI_CONSENT_WITHDRAW = "Turn off AI";

/** Settings → AI action that shows the disclosure again so AI can be turned on. */
export const AI_CONSENT_ENABLE = "Turn on AI";

/** Settings → AI value when AI is off or was never allowed. */
export const AI_CONSENT_OFF_LABEL = "Off";

/**
 * True when AI is not allowed: no consent on record. Any recorded agreement
 * counts, whatever copy version it was given to, because the sheet is asked
 * once per account, ever.
 */
export function aiConsentNeeded(
	consent: Pick<AiConsentDocument, "version"> | null | undefined
): boolean {
	return !consent;
}

/** "Allowed on October 7, 2026" for the Settings row; null when not allowed. */
export function aiConsentStatusLabel(
	consent: Pick<AiConsentDocument, "acceptedAt"> | null | undefined,
	locale?: string
): string | null {
	if (!consent) return null;
	const at = new Date(consent.acceptedAt);
	if (Number.isNaN(at.getTime())) return null;
	const date = at.toLocaleDateString(locale ?? "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	return `Allowed on ${date}`;
}
