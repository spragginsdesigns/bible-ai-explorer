import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { GetToken } from "@/lib/api";
import type { ChurchResponse } from "@/features/church/church";
import { fetchChurch } from "@/features/church/api";
import { fetchMemories } from "@/features/memories/api";
import { fetchProviders, type ProvidersResponse } from "./aiApi";

/**
 * The three Settings sections that used to fetch on mount: AI Providers, My
 * church, and the saved-memory count.
 *
 * Each rendered a small spinner card and then grew to its real height when
 * its request landed, a few hundred points for the providers card. Someone
 * flinging the screen to "Check for updates" would have that row slide out
 * from under their thumb and land on a provider's Add key / Remove button
 * instead. This store fixes that at the source rather than in the layout:
 *
 * - the last response for each section is persisted, so the screen paints its
 *   real content on the first frame of every later launch;
 * - all three are prefetched at sign-in, so even the first open after a fresh
 *   install usually finds them here;
 * - sections revalidate in place (stale-while-revalidate) and never fall back
 *   to a spinner once they have data.
 *
 * Account data, so it lives and dies with the other per-user caches (see
 * `cacheOwner.ts`): discarded when a different account signs in and on
 * sign-out. Modeled on notesStore/planStore: plain module state, one hook.
 */

const STORAGE_KEY = "sureword.settings-data.v1";

export interface MemorySummary {
	/** Number of saved memories. */
	count: number;
	/**
	 * The account's memory switch as `/api/memories` last reported it. The
	 * Settings screen reads the preferences document first and falls back to
	 * this, so a launch whose preferences hydrate failed still paints the
	 * switch. Absent when the count was set from the Memories screen alone.
	 */
	enabled?: boolean;
}

export interface Slice<T> {
	data: T | null;
	/** A refresh is in flight. */
	loading: boolean;
	/** The last refresh failed. Only meaningful to the UI while `data` is null. */
	failed: boolean;
}

export interface SettingsDataSnapshot {
	providers: Slice<ProvidersResponse>;
	church: Slice<ChurchResponse>;
	memories: Slice<MemorySummary>;
	/** True once the persisted cache has been read (or found absent). */
	hydrated: boolean;
}

type SliceKey = "providers" | "church" | "memories";
type SliceData<K extends SliceKey> = NonNullable<SettingsDataSnapshot[K]["data"]>;

const EMPTY_SLICE = { data: null, loading: false, failed: false } as const;

function emptySnapshot(): SettingsDataSnapshot {
	return {
		providers: { ...EMPTY_SLICE },
		church: { ...EMPTY_SLICE },
		memories: { ...EMPTY_SLICE },
		hydrated: false,
	};
}

let snapshot: SettingsDataSnapshot = emptySnapshot();

const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useSettingsData(): SettingsDataSnapshot {
	return useSyncExternalStore(subscribe, () => snapshot);
}

/** Test seam and the non-hook read for callers outside React. */
export function getSettingsData(): SettingsDataSnapshot {
	return snapshot;
}

function persist() {
	AsyncStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			providers: snapshot.providers.data,
			church: snapshot.church.data,
			memories: snapshot.memories.data,
		})
	).catch(() => {
		// A full or unavailable store must never break Settings.
	});
}

function setSlice<K extends SliceKey>(key: K, changes: Partial<Slice<SliceData<K>>>) {
	const next = { ...snapshot };
	next[key] = { ...snapshot[key], ...changes } as SettingsDataSnapshot[K];
	snapshot = next;
	emit();
}

/**
 * Bumped by every clear. A request or a cache read issued before a sign-out is
 * still in flight after it, and would otherwise resolve straight into the
 * snapshot and hand the next account the previous account's providers.
 */
let generation = 0;

let hydratePromise: Promise<void> | null = null;

/** One request per section at a time; a second caller joins the first. */
const inflight = new Map<SliceKey, Promise<void>>();

/**
 * Hard ceiling on a refresh. The API layer times out the fetch itself, but
 * the Clerk token step before it has no bound and has been seen to hang for
 * good after an offline launch. Without this, that one hung request would
 * hold the section's in-flight slot for the rest of the session and every
 * later refresh would silently join it. A little above the API's own 30s so
 * a real fetch timeout still surfaces with its own message.
 */
export const REFRESH_TIMEOUT_MS = 35_000;

interface PersistedShape {
	providers?: ProvidersResponse | null;
	church?: ChurchResponse | null;
	memories?: MemorySummary | null;
}

/**
 * Read the persisted cache exactly once per app run. Only fills sections that
 * are still empty, so a prefetch that beat it to the store is not overwritten
 * with older data.
 */
export function hydrateSettingsData(): Promise<void> {
	if (!hydratePromise) {
		const startedAt = generation;
		hydratePromise = (async () => {
			try {
				const raw = await AsyncStorage.getItem(STORAGE_KEY);
				if (generation !== startedAt) return;
				if (raw) {
					const parsed = JSON.parse(raw) as PersistedShape;
					if (!snapshot.providers.data && parsed.providers) {
						setSlice("providers", { data: parsed.providers });
					}
					if (!snapshot.church.data && parsed.church) {
						setSlice("church", { data: parsed.church });
					}
					if (!snapshot.memories.data && parsed.memories) {
						setSlice("memories", { data: parsed.memories });
					}
				}
			} catch {
				// Corrupt or unreadable cache: the sections fall through to their
				// network load and skeletons.
			} finally {
				if (generation === startedAt && !snapshot.hydrated) {
					snapshot = { ...snapshot, hydrated: true };
					emit();
				}
			}
		})();
	}
	return hydratePromise;
}

/**
 * Drop everything, in memory and on disk. Called when the signed-in account is
 * not the one this cache was written for, and on sign-out.
 *
 * `hydratePromise` is replaced rather than cleared so a screen mounting later
 * cannot re-read the file being deleted; the snapshot is marked hydrated so
 * the sections go straight to a server load.
 */
export function clearSettingsData(): Promise<void> {
	generation += 1;
	inflight.clear();
	snapshot = { ...emptySnapshot(), hydrated: true };
	hydratePromise = Promise.resolve();
	emit();
	return AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
		// An unwritable store must never break sign-out; the snapshot is
		// already empty, so nothing is shown from it either way.
	});
}

function refresh<K extends SliceKey>(key: K, load: () => Promise<SliceData<K>>): Promise<void> {
	const existing = inflight.get(key);
	if (existing) return existing;
	const startedAt = generation;
	setSlice(key, { loading: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const ceiling = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error("Settings could not be refreshed. Check your connection.")),
			REFRESH_TIMEOUT_MS
		);
	});
	// A load that outlives the ceiling is simply dropped when it settles.
	const request = Promise.race([load(), ceiling])
		.then((data) => {
			if (generation !== startedAt) return;
			setSlice(key, { data, loading: false, failed: false });
			persist();
		})
		.catch((error: unknown) => {
			if (generation !== startedAt) return;
			setSlice(key, { loading: false, failed: true });
			throw error;
		})
		.finally(() => {
			clearTimeout(timer);
			if (inflight.get(key) === request) inflight.delete(key);
		});
	inflight.set(key, request);
	return request;
}

/** Rejects on failure so a section can show its Retry row. */
export function refreshProviders(getToken: GetToken): Promise<void> {
	return refresh("providers", () => fetchProviders(getToken));
}

export function refreshChurch(getToken: GetToken): Promise<void> {
	return refresh("church", () => fetchChurch(getToken));
}

export function refreshMemories(getToken: GetToken): Promise<void> {
	return refresh("memories", async () => {
		const data = await fetchMemories(getToken);
		return { count: data.memories.length, enabled: data.enabled };
	});
}

/**
 * Warm every section. Called at sign-in, right after the caches are claimed
 * for the account, and again every time Settings gains focus. Never rejects:
 * a section that fails simply keeps whatever it had and reports through its
 * own `failed` flag.
 */
export async function prefetchSettingsData(getToken: GetToken): Promise<void> {
	await hydrateSettingsData();
	await Promise.allSettled([
		refreshProviders(getToken),
		refreshChurch(getToken),
		refreshMemories(getToken),
	]);
}

/**
 * A church save or remove answers with the new profile, so the store takes it
 * straight from the mutation instead of paying for another GET.
 */
export function noteChurch(response: ChurchResponse) {
	setSlice("church", { data: response, failed: false });
	persist();
}

/** The Memories screen knows the exact count after every add/delete/clear. */
export function noteMemoryCount(count: number) {
	const current = snapshot.memories.data;
	if (current?.count === count) return;
	setSlice("memories", { data: { ...current, count }, failed: false });
	persist();
}

/** The Settings switch, so the fallback above never disagrees with a tap. */
export function noteMemoryEnabled(enabled: boolean) {
	const current = snapshot.memories.data;
	if (!current || current.enabled === enabled) return;
	setSlice("memories", { data: { ...current, enabled } });
	persist();
}
