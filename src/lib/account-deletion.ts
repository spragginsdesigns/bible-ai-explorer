/**
 * Account deletion (App Store 5.1.1(v) / Play account-deletion policy).
 *
 * Pure, dependency-injected logic behind `DELETE /api/account`. Nothing here
 * imports Prisma, Clerk, Stripe or Vercel Blob, so the ordering and failure
 * rules are testable without a database. The route wires the real services in.
 *
 * Order matters and is the contract:
 *   1. cancel the Stripe subscription (a deleted user must not keep paying),
 *   2. collect the user's blob pathnames (needs the rows we are about to drop),
 *   3. delete every row in ONE transaction,
 *   4. best-effort delete the blobs (never blocks, never logs PII),
 *   5. delete the Clerk user LAST, only after the transaction committed.
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
	{ model: "ProviderCredential", via: "cascade" },
	{ model: "UserMemory", via: "cascade" },
	{ model: "Conversation", via: "cascade" },
	{ model: "Message", via: "cascade", parent: "Conversation" },
	{ model: "ChatAttachment", via: "cascade", blob: true },
	{ model: "Folder", via: "cascade" },
	{ model: "Tag", via: "cascade" },
	{ model: "Note", via: "cascade" },
	{ model: "NoteLink", via: "explicit", parent: "Note" },
	{ model: "NoteEmbedding", via: "explicit", parent: "Note" },
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
	{ model: "SharedAnswer", via: "cascade" },
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
	| { ok: false; stage: "billing" | "collect" | "database" | "clerk"; databaseDeleted: boolean };

export async function runAccountDeletion(
	userId: string,
	deps: AccountDeletionDeps,
): Promise<AccountDeletionResult> {
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
