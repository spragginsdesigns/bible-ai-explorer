import { addCacheTag, dangerouslyDeleteByTag } from "@vercel/functions";
import { sharedAnswerCacheTag } from "@/lib/shared-answer";

/**
 * CDN cache tagging for share-card images, best effort and never throwing.
 *
 * `@vercel/functions` hands these straight to the runtime's request context,
 * which can throw synchronously or return something other than a promise, so
 * `fn(...).catch(...)` is not a guard: it 500'd every card on 2026-10-09. A
 * failed tag or purge only loses the instant purge; the card's short
 * s-maxage (SHARED_CARD_CACHE_CONTROL) still bounds a revoked card.
 */
export async function tagSharedCard(id: string): Promise<void> {
	try {
		await addCacheTag(sharedAnswerCacheTag(id));
	} catch {
		// Best effort, see above.
	}
}

/** Purge the cached cards of revoked shares. Never throws, so it cannot block a revoke or a delete. */
export async function purgeSharedCards(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	try {
		await dangerouslyDeleteByTag(ids.map(sharedAnswerCacheTag));
	} catch {
		// Best effort, see above.
	}
}
