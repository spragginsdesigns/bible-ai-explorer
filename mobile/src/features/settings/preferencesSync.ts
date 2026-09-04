import { useEffect, useRef, useSyncExternalStore } from "react";
import { Alert, AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@clerk/expo";
import { ApiError, type GetToken } from "@/lib/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { adoptCacheOwner, clearUserCaches } from "./cacheOwner";
import {
	overridesToPush,
	parsePreferencesDocument,
	settingsFromDocument,
	shouldApplyResponse,
	shouldFetchNow,
	type PreferencesDocument,
	type PreferencesPatch,
} from "./preferences";
import { fetchPreferences, patchPreferences } from "./preferencesApi";
import { applyServerPreferences, getSettings, setPreferencesWriter } from "./settingsStore";

/**
 * Keeps this device's preferences in step with the account row.
 *
 * The server document is the record. This module hydrates it on sign-in and on
 * every return to the foreground, writes every user change straight back, and
 * discards the persisted caches when the signed-in account is not the one they
 * were written for. The settings store holds the synced fields themselves; the
 * small snapshot here holds the two toggles that have no home there, so the
 * Settings screen can paint them without waiting for a request.
 */

interface PreferencesToggles {
	/** null while nothing has been loaded yet, which disables the switches. */
	webSearchEnabled: boolean | null;
	memoryEnabled: boolean | null;
}

const EMPTY_TOGGLES: PreferencesToggles = { webSearchEnabled: null, memoryEnabled: null };

let toggles: PreferencesToggles = EMPTY_TOGGLES;
const listeners = new Set<() => void>();

function setToggles(next: PreferencesToggles) {
	toggles = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function usePreferencesToggles(): PreferencesToggles {
	return useSyncExternalStore(subscribe, () => toggles);
}

/**
 * Token getter for the signed-in session, or null when there is nobody to sync
 * for. Held at module scope because the settings store's setters are plain
 * functions called from taps, not hooks.
 */
let tokenGetter: GetToken | null = null;

/**
 * Bumped on every user edit. A GET or PATCH response is applied only if this
 * has not moved since the request went out, so a slow response can never undo
 * a tap the user made while waiting.
 */
let editSeq = 0;

let lastFetchAt: number | null = null;
let inflightFetch: Promise<void> | null = null;

function applyDocument(doc: PreferencesDocument) {
	applyServerPreferences(doc);
	setToggles({ webSearchEnabled: doc.webSearchEnabled, memoryEnabled: doc.memoryEnabled });
}

/**
 * Failures that must not roll a change back or say anything.
 *
 * 401: the session is not usable yet (or at all); the contract says keep local
 * and stay quiet. The API layer already signs out on a 401 that survives its
 * own fresh-token retry.
 *
 * 404: this build is talking to a deploy that predates the route. Reverting
 * then would undo a pick the user just made, on every tap, for a reason that
 * has nothing to do with them. Local still works exactly as it did before
 * preferences were synced at all.
 */
function isSilentFailure(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 401 || error.status === 404);
}

let lastFailureNoticeAt = 0;

/**
 * Non-blocking failure notice, the same Alert the Memory toggle uses. Rate
 * limited because these fire per tap: someone flipping chips on a dead
 * connection would otherwise stack one dialog per chip.
 */
function reportFailure(error: unknown) {
	const now = Date.now();
	if (now - lastFailureNoticeAt < 10_000) return;
	lastFailureNoticeAt = now;
	Alert.alert(
		"Could not save that setting",
		error instanceof Error && error.message
			? error.message
			: "Your change was not saved to your account. Try again."
	);
}

/** Sends one patch and applies the fresh document it answers with. Throws. */
async function requestPatch(patch: PreferencesPatch): Promise<void> {
	const getToken = tokenGetter;
	if (!getToken) return;
	const seqAtRequest = ++editSeq;
	const doc = parsePreferencesDocument(await patchPreferences(getToken, patch));
	if (doc && shouldApplyResponse(seqAtRequest, editSeq)) applyDocument(doc);
}

/** The settings store's write-through path: fire and forget, roll back on failure. */
function writePreference(patch: PreferencesPatch, revert: () => void) {
	void (async () => {
		try {
			await requestPatch(patch);
		} catch (error) {
			if (isSilentFailure(error)) return;
			revert();
			reportFailure(error);
		}
	})();
}

/**
 * Read the whole document and adopt it. `force` skips the foreground throttle,
 * which sign-in needs: the first hydrate of a session must not be swallowed by
 * a fetch the previous account made seconds earlier.
 */
export async function hydratePreferences(force = false): Promise<void> {
	const getToken = tokenGetter;
	if (!getToken) return;
	const now = Date.now();
	if (!force && !shouldFetchNow(lastFetchAt, now)) return;
	if (inflightFetch) return inflightFetch;
	lastFetchAt = now;
	const seqAtRequest = editSeq;
	inflightFetch = (async () => {
		try {
			const doc = parsePreferencesDocument(await fetchPreferences(getToken));
			if (doc && shouldApplyResponse(seqAtRequest, editSeq)) applyDocument(doc);
		} catch {
			// Offline, 401, or a server that has no such route yet: keep local.
			// A failed hydrate must never blank out Settings.
		} finally {
			inflightFetch = null;
		}
	})();
	return inflightFetch;
}

/**
 * First launch of this build on an install that predates the account columns.
 *
 * The account is read first and always wins: an absent cache owner is not proof
 * that the values on this phone belong to whoever is signing in, so only
 * columns the account has never written are filled from local. Whatever comes
 * back, or comes back from the patch, is this session's hydrate.
 *
 * One shot by design. The owner key is already written, so a failure here just
 * means a device whose picks never made it up; retrying later could overwrite
 * choices made on another device in the meantime.
 */
async function seedThenHydrate(): Promise<void> {
	const getToken = tokenGetter;
	if (!getToken) return;
	const seqAtRequest = editSeq;
	lastFetchAt = Date.now();

	let server: PreferencesDocument | null = null;
	try {
		server = parsePreferencesDocument(await fetchPreferences(getToken));
	} catch {
		// Keep local. Pushing without knowing what the account holds is exactly
		// the overwrite this version exists to prevent.
		return;
	}
	if (!server || !shouldApplyResponse(seqAtRequest, editSeq)) return;

	const patch = overridesToPush(getSettings(), settingsFromDocument(server));
	if (!patch) {
		applyDocument(server);
		return;
	}
	try {
		await requestPatch(patch);
	} catch {
		// The document already in hand is still the truth for this session.
		applyDocument(server);
	}
}

/**
 * Web Search toggle. Optimistic like the Memory toggle, and it rethrows so the
 * Settings screen can report the failure in its own words.
 */
export async function updateWebSearchEnabled(enabled: boolean): Promise<void> {
	const previous = toggles.webSearchEnabled;
	setToggles({ ...toggles, webSearchEnabled: enabled });
	try {
		await requestPatch({ webSearchEnabled: enabled });
	} catch (error) {
		setToggles({ ...toggles, webSearchEnabled: previous });
		throw error;
	}
}

/**
 * Memory stays on `PATCH /api/memories`, which is where the count comes from
 * too. This only keeps the shared snapshot honest so a later hydrate and the
 * Settings screen agree about what the account chose.
 */
export function noteMemoryEnabled(enabled: boolean) {
	setToggles({ ...toggles, memoryEnabled: enabled });
}

/**
 * Mount once inside the signed-in shell. Registers the write-through path,
 * discards another account's caches, hydrates on sign-in, and re-hydrates when
 * the app comes back to the foreground.
 */
export function usePreferencesSync(): void {
	const getToken = useStableGetToken();
	const { isSignedIn, userId } = useAuth();

	useEffect(() => {
		tokenGetter = getToken;
		setPreferencesWriter(writePreference);
		return () => {
			tokenGetter = null;
			setPreferencesWriter(null);
		};
	}, [getToken]);

	useEffect(() => {
		if (!isSignedIn || !userId) return;
		let cancelled = false;
		void (async () => {
			// Order matters: a cache belonging to another account is dropped
			// before the new account's document lands on top of it.
			const discard = await adoptCacheOwner(userId);
			if (cancelled) return;
			// "private" means no owner was recorded, so this is an upgrade and
			// the settings still on this phone predate the account columns.
			if (discard === "private") await seedThenHydrate();
			else await hydratePreferences(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [isSignedIn, userId]);

	useEffect(() => {
		if (!isSignedIn) return;
		const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
			if (state === "active") void hydratePreferences();
		});
		return () => subscription.remove();
	}, [isSignedIn]);
}

/**
 * Mount at the root, above the signed-in stack. Sign-out tears that stack down,
 * so the clear has to be watched from somewhere that outlives it.
 */
export function usePreferencesLifecycle(): void {
	const { isLoaded, isSignedIn } = useAuth();
	const wasSignedIn = useRef(false);

	useEffect(() => {
		if (!isLoaded) return;
		if (isSignedIn) {
			wasSignedIn.current = true;
			return;
		}
		// Only a real sign-out clears; a cold start that was never signed in
		// has nothing to clear and must not wipe a cache waiting for its owner.
		if (!wasSignedIn.current) return;
		wasSignedIn.current = false;
		lastFetchAt = null;
		setToggles(EMPTY_TOGGLES);
		void clearUserCaches();
	}, [isLoaded, isSignedIn]);
}
