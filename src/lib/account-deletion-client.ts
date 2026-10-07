/**
 * Settings -> Account -> Delete account, browser half. Same request, status
 * handling and copy as the Apple clients (`macos/Shared/Settings/
 * AccountDeletion.swift`) and Android (`mobile/src/features/settings/
 * accountDeletion.ts`). Pinned by tests/account-deletion-client.test.mjs.
 *
 * `DELETE /api/account` (docs/FEATURES.md "Account deletion"), cookie session.
 * - 200: everything is gone (database rows, blobs, the Clerk user).
 * - 500: aborted before the database transaction; nothing was removed.
 * - 502: the data is gone but deleting the Clerk user failed; retry is safe.
 * - 401: no session. After an attempt that may already have gone through (a
 *   502, or a request whose answer was lost) it means the Clerk user is gone.
 *
 * No imports, so the logic test can load it straight through type stripping.
 */

export const ACCOUNT_DELETION_PATH = "/api/account";
export const ACCOUNT_DELETION_BODY = JSON.stringify({ confirm: "DELETE" });
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
	/** True once an attempt may have done its work: a 502 or a lost response. */
	mayHaveDeleted: boolean;
}

export const initialDeletionState: DeletionState = { phase: { kind: "idle" }, mayHaveDeleted: false };

export type DeletionOutcome =
	| { kind: "ok" }
	| { kind: "status"; status: number }
	| { kind: "offline" }
	| { kind: "lost" };

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
			return { mayHaveDeleted: true, phase: { kind: "failed", message: FAILED_NETWORK } };
		case "lost":
			return { mayHaveDeleted: true, phase: { kind: "failed", message: FAILED_RETRYABLE } };
	}
}

export function isConfirmationTyped(typed: string): boolean {
	return typed.trim() === CONFIRMATION_WORD;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Sends the request once and reduces whatever happened to an outcome. Never
 * throws. A rejected fetch is a request that never got an answer: offline when
 * the browser says so, otherwise a lost response.
 */
export async function requestAccountDeletion(
	doFetch: FetchLike = (input, init) => fetch(input, init),
	isOnline: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false
): Promise<DeletionOutcome> {
	try {
		const res = await doFetch(ACCOUNT_DELETION_PATH, {
			method: "DELETE",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: ACCOUNT_DELETION_BODY,
		});
		return res.ok ? { kind: "ok" } : { kind: "status", status: res.status };
	} catch {
		return isOnline() ? { kind: "lost" } : { kind: "offline" };
	}
}
