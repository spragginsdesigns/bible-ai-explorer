import { ApiError, apiJson, isOfflineMessage, type GetToken } from "@/lib/api";

/**
 * Settings -> Account -> Delete account, the Android half of the flow the
 * Apple clients ship in `macos/Shared/Settings/AccountDeletion.swift`. Same
 * request, same status handling, same copy.
 *
 * `DELETE /api/account` (docs/FEATURES.md "Account deletion"). The body must
 * be exactly `{"confirm":"DELETE"}` or the route answers 400.
 * - 200: everything is gone (database rows, blobs, the Clerk user).
 * - 500: aborted before the database transaction; nothing was removed.
 * - 502: the data is gone but deleting the Clerk user failed; retry is safe.
 * - 401: no session. After an attempt that may already have gone through (a
 *   502, or a request whose answer was lost) it means the Clerk user is gone,
 *   i.e. the deletion finished.
 */

export const ACCOUNT_DELETION_PATH = "/api/account";
export const ACCOUNT_DELETION_BODY = { confirm: "DELETE" } as const;
/** The word the second confirmation step asks the user to type. */
export const CONFIRMATION_WORD = "DELETE";

export const DELETE_CONFIRM_TITLE = "Delete your SureWord account?";
export const DELETE_CONFIRM_MESSAGE =
	"This permanently deletes your conversations, notes, highlights, memories, " +
	"testimony, voice messages and your account. This can't be undone.";
export const DELETE_TYPE_TITLE = "Type DELETE to confirm";
export const DELETE_TYPE_MESSAGE = "Your account and everything in it will be deleted for good.";
export const DELETE_ERROR_TITLE = "Account not deleted";

export const FAILED_NOTHING_REMOVED =
	"Couldn't delete your account. Nothing was removed. Please try again.";
export const FAILED_RETRYABLE = "Couldn't finish deleting your account. Please try again.";
export const FAILED_NETWORK = "Couldn't reach SureWord. Check your connection and try again.";
export const FAILED_SESSION = "Your session expired. Sign in again, then delete your account.";

export type DeletionPhase =
	| { kind: "idle" }
	| { kind: "deleting" }
	| { kind: "failed"; message: string }
	| { kind: "deleted" };

export interface DeletionState {
	phase: DeletionPhase;
	/**
	 * True once an attempt may have reached the server and done its work: a
	 * 502 or a lost response. A 401 after that is the Clerk user being gone.
	 */
	mayHaveDeleted: boolean;
}

export const initialDeletionState: DeletionState = { phase: { kind: "idle" }, mayHaveDeleted: false };

/** What one attempt came back with, reduced from the thrown error (or none). */
export type DeletionOutcome =
	| { kind: "ok" }
	| { kind: "status"; status: number }
	| { kind: "offline" }
	| { kind: "lost" };

export function outcomeFromError(error: unknown): DeletionOutcome {
	if (error instanceof ApiError && typeof error.status === "number") {
		return { kind: "status", status: error.status };
	}
	if (isOfflineMessage(error)) return { kind: "offline" };
	return { kind: "lost" };
}

/** Pure state transition for one finished attempt. Mirrors `AccountDeletionModel.delete`. */
export function reduceDeletion(state: DeletionState, outcome: DeletionOutcome): DeletionState {
	switch (outcome.kind) {
		case "ok":
			return { ...state, phase: { kind: "deleted" } };
		case "status":
			if (outcome.status === 401) {
				return state.mayHaveDeleted
					? { ...state, phase: { kind: "deleted" } }
					: { ...state, phase: { kind: "failed", message: FAILED_SESSION } };
			}
			if (outcome.status === 502) {
				return { mayHaveDeleted: true, phase: { kind: "failed", message: FAILED_RETRYABLE } };
			}
			return { ...state, phase: { kind: "failed", message: FAILED_NOTHING_REMOVED } };
		case "offline":
			// No status: the request may have been processed before the
			// connection dropped.
			return { mayHaveDeleted: true, phase: { kind: "failed", message: FAILED_NETWORK } };
		case "lost":
			return { mayHaveDeleted: true, phase: { kind: "failed", message: FAILED_RETRYABLE } };
	}
}

export function isConfirmationTyped(typed: string): boolean {
	return typed.trim() === CONFIRMATION_WORD;
}

/** Sends the request once and reduces whatever happened to an outcome. Never throws. */
export async function requestAccountDeletion(getToken: GetToken): Promise<DeletionOutcome> {
	try {
		await apiJson<unknown>(getToken, ACCOUNT_DELETION_PATH, {
			method: "DELETE",
			body: ACCOUNT_DELETION_BODY,
		});
		return { kind: "ok" };
	} catch (error) {
		return outcomeFromError(error);
	}
}
