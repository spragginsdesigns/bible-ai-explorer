/**
 * Account deletion (App Store 5.1.1(v) / Play account-deletion policy).
 *
 * Pure, dependency-injected logic behind `DELETE /api/account`. Nothing here
 * imports Prisma, Clerk, Stripe or Vercel Blob, so the ordering and failure
 * rules are testable without a database. The route wires the real services in.
 *
 * Order matters and is the contract:
 *   1. stop Google Play renewal (before Stripe, because Play's cancel keeps
 *      access to the period end while Stripe's ends it at once, so a later
 *      step failing leaves the member least worse off),
 *   2. cancel the Stripe subscription (a deleted user must not keep paying),
 *   3. collect the user's blob pathnames (needs the rows we are about to drop),
 *   4. delete every row in ONE transaction,
 *   5. best-effort delete the blobs (never blocks, never logs PII),
 *   6. delete the Clerk user LAST, only after the transaction committed.
 * Steps 1-2 run before anything is deleted, so any failure there leaves the
 * account whole and the member can simply retry.
 *
 * App Store subscriptions are deliberately not a step. No server API can
 * cancel one, and refusing to delete until the member cancels it would break
 * App Store 5.1.1(v), which expects deletion to go ahead with a notice that
 * Apple billing continues (a reviewer buying sandbox Pro and then deleting
 * would be refused). A missed DID_CHANGE_RENEWAL_STATUS notification could
 * also have blocked deletion for up to 60 days. Instead every client warns
 * before the request is sent.
 */

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

/** True only for a body that is exactly `{ "confirm": "DELETE" }`-shaped. */
export function isDeletionConfirmed(body: unknown): boolean {
	if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
	return (body as { confirm?: unknown }).confirm === ACCOUNT_DELETION_CONFIRMATION;
}

/**
 * Every Prisma model that holds user data, and how it goes away.
 *  - "cascade": FK to User (or to a model that cascades) with onDelete: Cascade.
 *  - "explicit": no FK, deleted by hand inside the transaction.
 *  - "blob": also owns Vercel Blob objects.
 * The docs/FEATURES.md "Account deletion" table mirrors this list; a test
 * keeps it in step with prisma/schema.prisma.
 */
export interface AccountDataModel {
	model: string;
	via: "cascade" | "explicit";
	/** Cascade parent when it is not User itself. */
	parent?: string;
	blob?: boolean;
}

export const ACCOUNT_DATA_MODELS: readonly AccountDataModel[] = [
	{ model: "AgentStudy", via: "cascade" },
	{ model: "AgentAction", via: "cascade" },
	{ model: "User", via: "explicit" },
	{ model: "AiPreference", via: "cascade" },
	{ model: "BillingSubscription", via: "cascade" },
	{ model: "GooglePlaySubscription", via: "cascade" },
	{ model: "AppStoreSubscription", via: "cascade" },
	{ model: "AiUsageRequest", via: "cascade" },
	{ model: "UserChurch", via: "cascade" },
	{ model: "ChurchSaveEvent", via: "cascade" },
	{ model: "ProviderCredential", via: "cascade" },
	{ model: "UserMemory", via: "cascade" },
	{ model: "Conversation", via: "cascade" },
	{ model: "Message", via: "cascade", parent: "Conversation" },
	{ model: "ChatAttachment", via: "cascade", blob: true },
	{ model: "AudioTranscriptionUsage", via: "cascade" },
	{ model: "Folder", via: "cascade" },
	{ model: "Tag", via: "cascade" },
	{ model: "Note", via: "cascade" },
	{ model: "NoteLink", via: "cascade", parent: "Note" },
	{ model: "NoteEmbedding", via: "cascade", parent: "Note" },
	{ model: "NoteTag", via: "cascade", parent: "Note" },
	{ model: "NoteAIMessage", via: "cascade", parent: "Note" },
	{ model: "PushToken", via: "cascade" },
	{ model: "ReadingEvent", via: "cascade" },
	{ model: "VerseHighlight", via: "cascade" },
	{ model: "VerseOfDay", via: "cascade", blob: true },
	{ model: "SuggestedQuestionSet", via: "cascade" },
	{ model: "ReadingPlan", via: "cascade" },
	{ model: "ReadingPlanCompletion", via: "cascade", parent: "ReadingPlan" },
	{ model: "VerseMemory", via: "cascade" },
	{ model: "LearnReviewReceipt", via: "cascade" },
	{ model: "ReadingLogEntry", via: "cascade" },
	{ model: "ReadingLogChapter", via: "cascade" },
	{ model: "ReadingLogDay", via: "cascade" },
	{ model: "ReadingLogSession", via: "cascade" },
	{ model: "ReadingLogTotals", via: "cascade" },
	{ model: "ReadingLogChapterDay", via: "cascade" },
	{ model: "ReadingLogStreak", via: "cascade" },
	{ model: "ReadingReflection", via: "cascade" },
	{ model: "SharedAnswer", via: "cascade" },
	{ model: "SharedCard", via: "cascade" },
	{ model: "Feedback", via: "cascade" },
	{ model: "GuestTurn", via: "explicit" },
	{ model: "LegacyClerkAccount", via: "explicit" },
];

/** Blob prefixes the app writes per user. Swept so orphans do not survive. */
export function accountBlobPrefixes(userId: string): string[] {
	return [`chat-attachments/${userId}/`, `daily-cross-audio/${userId}/`];
}

/** De-duplicated, non-empty pathnames. */
export function uniquePathnames(...groups: (string | null | undefined)[][]): string[] {
	return [...new Set(groups.flat().filter((p): p is string => typeof p === "string" && p.length > 0))];
}

/** True for a Clerk "user does not exist" failure (already deleted). */
export function isClerkNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return (error as { status?: unknown }).status === 404;
}

export interface AccountDeletionDeps {
	/** Stop any Google Play renewal. Throw to abort before deleting. */
	stopGooglePlayRenewal(userId: string): Promise<void>;
	/** Cancel any live Stripe subscription. Throw to abort before deleting. */
	cancelBilling(userId: string): Promise<void>;
	/** Blob pathnames known from DB rows, plus anything under the prefixes. */
	collectBlobPathnames(userId: string): Promise<string[]>;
	/** One transaction that removes every row. Throw to abort. */
	deleteDatabaseRows(userId: string): Promise<void>;
	/** Best-effort; returns nothing, may throw. */
	deleteBlobs(pathnames: string[]): Promise<void>;
	deleteClerkUser(userId: string): Promise<void>;
	/** Log sink; must never receive user ids, emails or pathnames. */
	log(message: string): void;
}

export type AccountDeletionResult =
	| { ok: true; blobsDeleted: boolean }
	| { ok: false; stage: "google_play" | "billing" | "collect" | "database" | "clerk"; databaseDeleted: boolean };

export async function runAccountDeletion(
	userId: string,
	deps: AccountDeletionDeps,
): Promise<AccountDeletionResult> {
	try {
		await deps.stopGooglePlayRenewal(userId);
	} catch {
		deps.log("account deletion: Google Play cancellation failed");
		return { ok: false, stage: "google_play", databaseDeleted: false };
	}

	try {
		await deps.cancelBilling(userId);
	} catch {
		deps.log("account deletion: billing cancellation failed");
		return { ok: false, stage: "billing", databaseDeleted: false };
	}

	let pathnames: string[];
	try {
		pathnames = await deps.collectBlobPathnames(userId);
	} catch {
		deps.log("account deletion: could not list blobs");
		return { ok: false, stage: "collect", databaseDeleted: false };
	}

	try {
		await deps.deleteDatabaseRows(userId);
	} catch {
		deps.log("account deletion: database transaction failed");
		return { ok: false, stage: "database", databaseDeleted: false };
	}

	let blobsDeleted = true;
	try {
		if (pathnames.length > 0) await deps.deleteBlobs(pathnames);
	} catch {
		blobsDeleted = false;
		deps.log(`account deletion: blob cleanup failed for ${pathnames.length} object(s)`);
	}

	try {
		await deps.deleteClerkUser(userId);
	} catch (error) {
		if (!isClerkNotFound(error)) {
			deps.log("account deletion: Clerk user deletion failed");
			return { ok: false, stage: "clerk", databaseDeleted: true };
		}
	}

	return { ok: true, blobsDeleted };
}
