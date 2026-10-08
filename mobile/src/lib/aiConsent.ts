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
 * Copy approved verbatim by Austin on 2026-10-07. Changing what is said about
 * who receives what is a material change: bump `AI_CONSENT_VERSION` in
 * `preferences-contract.ts` so everyone is asked again.
 */
const AI_CONSENT_VERSION = 2;
interface AiConsentDocument { version: number; acceptedAt: string }

export { AI_CONSENT_VERSION };

export const AI_CONSENT_TITLE = "How SureWord answers you";

export const AI_CONSENT_BODY =
	"SureWord's answers are written by AI. To answer you, SureWord sends your question, the conversation, your attachments, and the study context you have shared (About me, your testimony, memories, notes, highlights and reading) to OpenAI, or through OpenRouter to the provider of the selected model, or to the provider of your own API key when you choose one of its models. OpenAI also transcribes voice messages. Web searches go to Tavily, and spoken devotionals are voiced by ElevenLabs. They use it only to answer you; it is never sold or used for ads. The AI can be wrong, so search the Scriptures to see whether these things are so.";

export const AI_CONSENT_PRIVACY_LABEL = "Privacy Policy";

export const AI_CONSENT_PRIVACY_URL = "https://sureword.app/privacy";

export const AI_CONSENT_AGREE = "Agree and continue";

export const AI_CONSENT_DECLINE = "Not now";

/** Settings → AI row title. */
export const AI_CONSENT_SETTINGS_TITLE = "AI data sharing";

/** Settings → AI action that clears consent, after a confirm dialog. */
export const AI_CONSENT_WITHDRAW = "Withdraw";

/**
 * True when the sheet must be shown before an AI action: no consent on record,
 * or consent to a version other than the one the server now requires.
 */
export function aiConsentNeeded(
	consent: Pick<AiConsentDocument, "version"> | null | undefined,
	required: number = AI_CONSENT_VERSION
): boolean {
	return consent?.version !== required;
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
