/**
 * Pure helpers for the signed-out flow (`app/(auth)/sign-in.tsx`), kept out of
 * the screen so they can be tested without a React Native runtime.
 */

/**
 * Clerk's default minimum. The instance leaves `password_settings.min_length`
 * at 0, which means "Clerk's default of 8"; checking it here saves a round trip
 * that would come back with the same complaint.
 */
export const MIN_PASSWORD_LENGTH = 8;

type ClerkErrorShape = {
	errors?: { code?: string; longMessage?: string; message?: string }[];
};

function firstClerkError(err: unknown) {
	if (err && typeof err === "object" && "errors" in err) {
		return (err as ClerkErrorShape).errors?.[0];
	}
	return undefined;
}

/** The message to show a person for a Clerk failure. */
export function clerkErrorMessage(err: unknown, fallback: string): string {
	const first = firstClerkError(err);
	if (first) return first.longMessage ?? first.message ?? fallback;
	return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Clerk's machine-readable reason for a failure, for analytics only.
 *
 * The CODE and never the message: a code is `form_password_incorrect`, while a
 * message can quote what the person typed. Sign-in is also the one screen in
 * the app where the thing being typed is an email address, so nothing from
 * this form may reach an event beyond which method was used and why it
 * stopped.
 *
 * A failure that is not a Clerk API error used to come back as a bare
 * "unknown", which hid whether sign-in died offline, was aborted or threw a
 * plain bug. Those are classified from the error's kind (its `code` or class
 * name, checked against an identifier pattern), and the message is read only
 * to recognise React Native's fixed network-failure text, never sent.
 */
export function clerkErrorCode(err: unknown): string {
	const code = firstClerkError(err)?.code;
	if (code) return code;
	return failureKind(err);
}

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const NETWORK_FAILURE = /network request failed|failed to fetch|network ?error|internet connection/i;

function failureKind(err: unknown): string {
	if (!err || typeof err !== "object") return "unknown";
	const { code, name, message } = err as { code?: unknown; name?: unknown; message?: unknown };
	// ClerkRuntimeError (no `errors` array) carries a machine code such as
	// `network_error`.
	if (typeof code === "string" && SAFE_IDENTIFIER.test(code)) return code;
	if (name === "AbortError") return "aborted";
	if (typeof message === "string" && NETWORK_FAILURE.test(message)) return "network";
	if (typeof name === "string" && SAFE_IDENTIFIER.test(name)) return `exception_${name}`;
	return "unknown";
}

/**
 * What to tell someone whose Google round trip came back without a session.
 *
 * Google returned, so this is not a cancel: Clerk wants a field Google did not
 * share, or another step. Name the gap when Clerk says what it is, and always
 * point at the path that works regardless (email). This shows on the welcome
 * step too, which has no Back button, so it names no button to tap.
 */
export function googleIncompleteMessage(missingFields: readonly string[]): string {
	const fields = missingFields.filter(Boolean).map((f) => f.replace(/_/g, " "));
	const lead =
		fields.length > 0
			? `Google signed you in, but your account still needs: ${fields.join(", ")}.`
			: "Google signed you in, but we couldn't finish setting up your account.";
	return `${lead} Please try again, or use your email address instead.`;
}

/**
 * The screens of the signed-out flow. See `app/(auth)/sign-in.tsx` for why
 * `welcome` offers Create an account and Sign in as separate doors.
 */
export type AuthStep =
	| "welcome"
	| "signInEmail"
	| "signInPassword"
	| "signInCode"
	| "signUp"
	| "signUpCode";

/**
 * Where Android's hardware Back goes from each step: the same place the
 * card's own Back or "Use a different email" button goes. `null` on the first
 * step, so Back leaves the screen as usual.
 */
export function previousAuthStep(step: AuthStep): AuthStep | null {
	switch (step) {
		case "welcome":
			return null;
		case "signInEmail":
		case "signUp":
			return "welcome";
		case "signInPassword":
		case "signInCode":
			return "signInEmail";
		case "signUpCode":
			return "signUp";
	}
}

/**
 * One submit at a time. The keyboard's Enter key (`onSubmitEditing`) still
 * fires while the spinner shows, and PostHog caught a single sign-in running
 * twice: `sign_in_completed`, then 0.4 to 1 s later `sign_in_failed` from the
 * duplicate against a resource the first one had already used up. State
 * (`pending`) only changes on the next render, so the check has to be this
 * synchronous flag. A call made while one is running is dropped, not queued.
 */
export function singleFlight() {
	let busy = false;
	return async function run(task: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await task();
		} finally {
			busy = false;
		}
	};
}
