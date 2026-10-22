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
 */
export function clerkErrorCode(err: unknown): string {
	return firstClerkError(err)?.code ?? "unknown";
}

/**
 * What to tell someone whose Google round trip came back without a session.
 *
 * Google returned, so this is not a cancel: Clerk wants a field Google did not
 * share, or another step. Name the gap when Clerk says what it is, and always
 * point at the path that works regardless (Create an account with email).
 */
export function googleIncompleteMessage(missingFields: readonly string[]): string {
	const fields = missingFields.filter(Boolean).map((f) => f.replace(/_/g, " "));
	const lead =
		fields.length > 0
			? `Google signed you in, but your account still needs: ${fields.join(", ")}.`
			: "Google signed you in, but we couldn't finish setting up your account.";
	return `${lead} Please try again, or tap Back and use Create an account with your email.`;
}
