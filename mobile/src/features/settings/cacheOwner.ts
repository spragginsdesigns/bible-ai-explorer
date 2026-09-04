import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearHighlightsCache } from "@/features/bible/highlightsStore";
import { clearNotesCache } from "@/features/notes/notesStore";
import { cacheDiscardFor, type CacheDiscard } from "./preferences";
import { resetSyncedSettings } from "./settingsStore";

/**
 * Which account the persisted caches belong to.
 *
 * Settings, notes and highlights are all written to fixed AsyncStorage keys,
 * so before this they survived a sign-out and were handed straight to whoever
 * signed in next. One key records the owner for all three rather than stamping
 * each blob: the three are always discarded together, and a single key cannot
 * drift out of agreement with itself.
 */

const CACHE_OWNER_KEY = "sureword.cache-owner";

async function readOwner(): Promise<string | null> {
	try {
		return await AsyncStorage.getItem(CACHE_OWNER_KEY);
	} catch {
		// Unreadable store: treat as unknown, which discards. Losing a cache is
		// recoverable; showing another account's notes is not.
		return null;
	}
}

async function clearCaches(scope: Exclude<CacheDiscard, "none">): Promise<void> {
	if (scope === "all") resetSyncedSettings();
	await Promise.all([clearNotesCache(), clearHighlightsCache()]);
}

/**
 * Claim the caches for the signed-in account, discarding what does not belong
 * to it first. Call before hydrating from the server.
 *
 * Returns what was discarded, so callers can log or test it.
 */
export async function adoptCacheOwner(userId: string): Promise<CacheDiscard> {
	const owner = await readOwner();
	const discard = cacheDiscardFor(owner, userId);
	if (discard === "none") return discard;
	await clearCaches(discard);
	try {
		await AsyncStorage.setItem(CACHE_OWNER_KEY, userId);
	} catch {
		// The caches are empty either way; the next launch simply discards again.
	}
	return discard;
}

/** Sign-out: nothing of this account may be left on the device for the next one. */
export async function clearUserCaches(): Promise<void> {
	await clearCaches("all");
	try {
		await AsyncStorage.removeItem(CACHE_OWNER_KEY);
	} catch {
		// Same reasoning as above.
	}
}
