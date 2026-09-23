/**
 * The browser half of "Try before you sign up" (docs/FEATURES.md) that the
 * signed-in app also needs. Kept apart from the landing component so the
 * app bundle imports a constant and one function, not the guest UI.
 */

/**
 * localStorage key set once a guest answer finishes; the signed-in app reads
 * it after sign-up and asks /api/guest/claim to adopt this browser's turns.
 */
export const GUEST_PENDING_KEY = "sureword.guestPending";

let claimInFlight: Promise<string | null> | null = null;
let claimOpened = false;

/**
 * Whether the claimed conversation was already opened. The chat's effect
 * re-runs whenever its callbacks change identity, and without this each
 * re-run would pull the reader back to the guest conversation.
 */
export function guestClaimOpened(): boolean {
	return claimOpened;
}

export function markGuestClaimOpened(): void {
	claimOpened = true;
}

/**
 * Adopt this browser's guest turns, at most once per page load.
 *
 * Module scope on purpose. The chat mounts more than once right after the
 * sign-in redirect (the session settles and the tree re-renders), and a claim
 * started by a mount that is already gone used to create the conversation
 * where nobody would ever open it: the server stamps the turns exactly once,
 * so the surviving mount's own claim came back empty. Every mount now awaits
 * the same request, and whichever is still on screen opens the result.
 *
 * The flag is cleared before the request so a failure is not retried on
 * every load; the turns stay claimable server-side for 30 days regardless.
 */
export function claimGuestTurnsOnce(): Promise<string | null> {
	if (claimInFlight) return claimInFlight;
	claimInFlight = (async () => {
		try {
			if (window.localStorage.getItem(GUEST_PENDING_KEY) !== "1") return null;
			window.localStorage.removeItem(GUEST_PENDING_KEY);
		} catch {
			return null;
		}
		try {
			const res = await fetch("/api/guest/claim", { method: "POST" });
			if (!res.ok) return null;
			const body = (await res.json()) as { conversationId?: string | null };
			return body.conversationId ?? null;
		} catch {
			return null;
		}
	})();
	return claimInFlight;
}
