"use client";

import { useCallback, useSyncExternalStore } from "react";
import { AUTO_EFFORT_SENTINEL } from "@/components/modelPickerRules";
import { DEFAULT_LISTEN_RATE, LISTEN_RATE_PREF_KEY } from "@/components/cross/listen";
import type { TranslationId } from "@/lib/bible/translations";
import type { PreferencesDocument } from "@/lib/preferences-contract";
import {
	EFFORT_PREF_KEY,
	MEMORY_ENABLED_PREF_KEY,
	MODE_PREF_KEY,
	MODEL_PREF_KEY,
	PARCHMENT_PREF_KEY,
	SPEED_PREF_KEY,
	TRANSLATION_PREF_KEY,
	VERBOSITY_PREF_KEY,
	WEB_SEARCH_ENABLED_PREF_KEY,
	readEffortPref,
	readListenRatePref,
	readModePref,
	readModelPref,
	readParchmentPref,
	readSpeedPref,
	readTranslationPref,
	readVerbosityPref,
	readWebSearchEnabledPref,
	writeEffortPref,
	writeListenRatePref,
	writeModePref,
	writeModelPref,
	writeMemoryEnabledPref,
	writeParchmentPref,
	writeSpeedPref,
	writeTranslationPref,
	writeVerbosityPref,
	writeWebSearchEnabledPref,
} from "@/lib/preferences";

/**
 * Account preference sync for the web client.
 *
 * The server row is the source of truth (see `docs`/the shared contract): this
 * module hydrates the whole document from `GET /api/preferences` on sign-in
 * and every time the tab comes back to the foreground, and write-throughs every
 * user change with `PATCH /api/preferences`. The localStorage keys in
 * `src/lib/preferences.ts` stay exactly as they were and keep serving first
 * paint; this only decides what goes into them and tells mounted components
 * when it changed, so a value set on the phone shows up here without a reload.
 */

/** The document is re-fetched on wake at most this often. */
const HYDRATE_THROTTLE_MS = 15_000;

/** Which Clerk account the cached values belong to. */
const CACHE_OWNER_KEY = "sureword-prefs-owner";

/** The account whose choices this device has already seeded upward, if any. */
const ADOPTED_KEY = "sureword-preferences-adopted";

/** Every synced key, for the discard-on-account-change rule. */
const SYNCED_KEYS = [
	TRANSLATION_PREF_KEY,
	PARCHMENT_PREF_KEY,
	LISTEN_RATE_PREF_KEY,
	MEMORY_ENABLED_PREF_KEY,
	WEB_SEARCH_ENABLED_PREF_KEY,
	MODEL_PREF_KEY,
	EFFORT_PREF_KEY,
	SPEED_PREF_KEY,
	VERBOSITY_PREF_KEY,
	MODE_PREF_KEY,
] as const;

export type ChatRunOptionKey = "effort" | "speed" | "verbosity" | "mode";

/** Any subset of the document, exactly as PATCH accepts it. */
interface PreferencesPatchBody {
	webSearchEnabled?: boolean;
	memoryEnabled?: boolean;
	translation?: TranslationId;
	parchment?: boolean;
	listenRate?: number;
	chat?: Partial<Record<"modelId" | ChatRunOptionKey, string | null>>;
}

/* -------------------------------------------------------------------------- */
/* Change notification                                                        */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

/**
 * Subscribe to "a stored preference changed". Deliberately valueless: readers
 * re-read the localStorage key they care about, so one channel serves every
 * field and nothing has to be kept in a second copy of the state.
 */
export function subscribePreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Tell mounted readers to re-read. Call after any local preference write. */
export function notifyPreferencesChanged(): void {
	for (const listener of listeners) listener();
}

/**
 * Read one preference reactively.
 *
 * `read` must be a module-level function (the exported `read*Pref` helpers all
 * are) so the snapshot is stable between renders, and the values are primitives,
 * so `useSyncExternalStore` can compare them by identity. `serverValue` is what
 * the server render and the hydration pass use, since localStorage does not
 * exist there.
 */
export function usePreference<T>(read: () => T, serverValue: T): T {
	const getServerSnapshot = useCallback(() => serverValue, [serverValue]);
	return useSyncExternalStore(subscribePreferences, read, getServerSnapshot);
}

/* -------------------------------------------------------------------------- */
/* Non-blocking error surface                                                 */
/* -------------------------------------------------------------------------- */

let syncError: string | null = null;
const errorListeners = new Set<() => void>();

function subscribeSyncError(listener: () => void): () => void {
	errorListeners.add(listener);
	return () => {
		errorListeners.delete(listener);
	};
}

function readSyncError(): string | null {
	return syncError;
}

function setSyncError(message: string | null): void {
	if (syncError === message) return;
	syncError = message;
	for (const listener of errorListeners) listener();
}

/** The last failed write, for the notice `PreferencesSync` renders. */
export function usePreferencesSyncError(): string | null {
	return useSyncExternalStore(subscribeSyncError, readSyncError, () => null);
}

export function dismissPreferencesSyncError(): void {
	setSyncError(null);
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `null` means "not signed in" (401), which is not an error: the contract says
 * an unauthenticated client keeps whatever it has locally.
 */
async function readDocument(res: Response): Promise<PreferencesDocument | null> {
	if (res.status === 401) return null;
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(data?.error ?? `Request failed (${res.status})`);
	}
	return (await res.json()) as PreferencesDocument;
}

export async function fetchPreferences(): Promise<PreferencesDocument | null> {
	const res = await fetch("/api/preferences", { credentials: "same-origin" });
	return readDocument(res);
}

export async function patchPreferences(
	patch: PreferencesPatchBody
): Promise<PreferencesDocument | null> {
	const res = await fetch("/api/preferences", {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	return readDocument(res);
}

/* -------------------------------------------------------------------------- */
/* Applying a server document                                                 */
/* -------------------------------------------------------------------------- */

/**
 * House-mode accounts have no chat pick of their own: the picker pins them to
 * SureWord's included model and overwrites the stored ids on load. Hydrating
 * the account's stored `chat.*` over that would put a model the account cannot
 * run back into the request body, so hydration leaves those five keys alone
 * while the lock is on. Everything else still syncs.
 */
let chatPrefsLocked = false;

export function setChatPrefsLocked(locked: boolean): void {
	chatPrefsLocked = locked;
}

/** Write a server document into the local cache and wake every reader. */
export function applyPreferencesDocument(document: PreferencesDocument): void {
	writeTranslationPref(document.translation);
	writeParchmentPref(document.parchment);
	writeListenRatePref(document.listenRate);
	writeMemoryEnabledPref(document.memoryEnabled);
	writeWebSearchEnabledPref(document.webSearchEnabled);
	if (!chatPrefsLocked) {
		writeModelPref(document.chat.modelId);
		writeEffortPref(document.chat.effort);
		writeSpeedPref(document.chat.speed);
		writeVerbosityPref(document.chat.verbosity);
		writeModePref(document.chat.mode);
	}
	notifyPreferencesChanged();
}

/* -------------------------------------------------------------------------- */
/* Hydration                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bumped by every user edit. A GET issued before an edit is discarded when it
 * lands after one, so a slow hydrate can never undo a tap the user has already
 * seen take effect; the PATCH's own response carries the fresher document.
 */
let editSeq = 0;
let lastHydrateAt = 0;
let inFlightHydrate: Promise<boolean> | null = null;

/**
 * Pull the whole document and replace the local cache with it.
 * Returns false only when the request itself failed (offline, 500); a signed-out
 * client resolves true and keeps what it has.
 */
export function hydratePreferences(options: { force?: boolean } = {}): Promise<boolean> {
	if (typeof window === "undefined") return Promise.resolve(false);
	if (inFlightHydrate) return inFlightHydrate;
	const now = Date.now();
	if (!options.force && now - lastHydrateAt < HYDRATE_THROTTLE_MS) {
		return Promise.resolve(true);
	}
	lastHydrateAt = now;
	const seqAtRequest = editSeq;
	const run = (async () => {
		try {
			const document = await fetchPreferences();
			if (!document) return true;
			if (editSeq !== seqAtRequest) return true;
			applyPreferencesDocument(document);
			return true;
		} catch {
			// Hydration is best effort: the cache from last time still stands.
			return false;
		} finally {
			inFlightHydrate = null;
		}
	})();
	inFlightHydrate = run;
	return run;
}

/* -------------------------------------------------------------------------- */
/* First-adopt seed                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The local values worth seeding upward: not the column default here, and
 * still the column default on the server. `null` when there is nothing to send.
 *
 * Both halves of that test matter. The columns landed after these keys did, so
 * a browser can be carrying real choices (NKJV, a model, a slower listen speed)
 * the account row has never heard of. But an absent cache owner can equally be
 * a previous user's values on a shared browser, so an account that has already
 * chosen something elsewhere always wins over what is sitting in this cache.
 */
function collectLocalOverrides(server: PreferencesDocument): PreferencesPatchBody | null {
	const patch: PreferencesPatchBody = {};
	const chat: NonNullable<PreferencesPatchBody["chat"]> = {};
	let found = false;

	const translation = readTranslationPref();
	if (translation !== "KJV" && server.translation === "KJV") {
		patch.translation = translation;
		found = true;
	}
	if (!readParchmentPref() && server.parchment) {
		patch.parchment = false;
		found = true;
	}
	const listenRate = readListenRatePref();
	if (listenRate !== DEFAULT_LISTEN_RATE && server.listenRate === DEFAULT_LISTEN_RATE) {
		patch.listenRate = listenRate;
		found = true;
	}
	const modelId = readModelPref();
	if (typeof modelId === "string" && modelId && server.chat.modelId === null) {
		chat.modelId = modelId;
		found = true;
	}
	for (const key of Object.keys(RUN_OPTION_IO) as ChatRunOptionKey[]) {
		const value = RUN_OPTION_IO[key].read();
		if (value === null || server.chat[key] !== null) continue;
		// Same sentinel mapping the setters make: "auto" is not an effort.
		chat[key] = key === "effort" && value === AUTO_EFFORT_SENTINEL ? null : value;
		found = true;
	}

	if (!found) return null;
	if (Object.keys(chat).length > 0) patch.chat = chat;
	return patch;
}

/**
 * The first thing this browser does for an account: read the document, seed up
 * only the fields the account has never set, and take the answer as the
 * hydrate. Every later run for the same account is a plain hydrate, so a value
 * cleared elsewhere stays cleared rather than being resurrected from here.
 *
 * A failed GET leaves the flag unset and the cache untouched, so the next
 * launch tries the seed again rather than adopting a document it never saw.
 */
export async function adoptOrHydratePreferences(userId: string): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (window.localStorage.getItem(ADOPTED_KEY) === userId) {
		return hydratePreferences({ force: true });
	}

	let server: PreferencesDocument | null;
	try {
		server = await fetchPreferences();
	} catch {
		return false;
	}
	// No document means 401: nothing to adopt, and local still stands.
	if (!server) return true;
	// As fresh as a hydrate, so it starts the wake throttle either way.
	lastHydrateAt = Date.now();

	const overrides = collectLocalOverrides(server);
	if (!overrides) {
		applyPreferencesDocument(server);
		window.localStorage.setItem(ADOPTED_KEY, userId);
		return true;
	}
	try {
		const seeded = await patchPreferences(overrides);
		if (seeded) {
			applyPreferencesDocument(seeded);
			window.localStorage.setItem(ADOPTED_KEY, userId);
			return true;
		}
	} catch {
		// The seed did not land; the document just read is still the truth.
	}
	applyPreferencesDocument(server);
	return true;
}

/* -------------------------------------------------------------------------- */
/* Per-account cache                                                          */
/* -------------------------------------------------------------------------- */

function readCacheOwner(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(CACHE_OWNER_KEY);
}

/** Drop every synced value so the next account does not inherit this one's. */
export function clearSyncedPreferences(): void {
	if (typeof window === "undefined") return;
	for (const key of SYNCED_KEYS) window.localStorage.removeItem(key);
	window.localStorage.removeItem(CACHE_OWNER_KEY);
	notifyPreferencesChanged();
}

/**
 * Point the cache at `userId`, discarding it first when it belonged to someone
 * else. An absent owner is adopted rather than cleared: that is every browser
 * the first time it runs this build, and the values in it are this user's.
 */
export function claimPreferencesCache(userId: string): void {
	if (typeof window === "undefined") return;
	const owner = readCacheOwner();
	if (owner && owner !== userId) clearSyncedPreferences();
	window.localStorage.setItem(CACHE_OWNER_KEY, userId);
}

/* -------------------------------------------------------------------------- */
/* Write-through setters                                                      */
/* -------------------------------------------------------------------------- */

export interface WriteThroughOptions {
	/**
	 * Skip the shared error notice. For call sites that render the failure
	 * themselves, like the Settings toggles.
	 */
	silent?: boolean;
}

/**
 * The optimistic-write pipe every setter runs through: write local, tell the
 * readers, PATCH, and on failure put the old value back and say so.
 */
async function writeThrough(
	apply: () => void,
	rollback: () => void,
	stillHolds: () => boolean,
	patch: PreferencesPatchBody,
	fallbackMessage: string,
	options: WriteThroughOptions
): Promise<string | null> {
	apply();
	notifyPreferencesChanged();
	const seq = ++editSeq;
	try {
		const document = await patchPreferences(patch);
		// A signed-out client gets no document and keeps the local write; a later
		// edit means this response is already stale, so it is dropped.
		if (document && editSeq === seq) applyPreferencesDocument(document);
		return null;
	} catch (err) {
		// Only undo a value that is still the one this write put there. Something
		// newer - a second tap, or a hydrate - has already replaced it otherwise,
		// and rolling back would throw that away instead of this.
		if (stillHolds()) {
			rollback();
			notifyPreferencesChanged();
		}
		const message = err instanceof Error ? err.message : fallbackMessage;
		if (!options.silent) setSyncError(message);
		return message;
	}
}

export function setTranslationPreference(
	translation: TranslationId,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const previous = readTranslationPref();
	return writeThrough(
		() => writeTranslationPref(translation),
		() => writeTranslationPref(previous),
		() => readTranslationPref() === translation,
		{ translation },
		"Couldn't save your translation.",
		options
	);
}

export function setParchmentPreference(
	parchment: boolean,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const previous = readParchmentPref();
	return writeThrough(
		() => writeParchmentPref(parchment),
		() => writeParchmentPref(previous),
		() => readParchmentPref() === parchment,
		{ parchment },
		"Couldn't save the reader style.",
		options
	);
}

export function setListenRatePreference(
	listenRate: number,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const previous = readListenRatePref();
	return writeThrough(
		() => writeListenRatePref(listenRate),
		() => writeListenRatePref(previous),
		() => readListenRatePref() === listenRate,
		{ listenRate },
		"Couldn't save the playback speed.",
		options
	);
}

export function setWebSearchPreference(
	webSearchEnabled: boolean,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const previous = readWebSearchEnabledPref();
	return writeThrough(
		() => writeWebSearchEnabledPref(webSearchEnabled),
		() => writeWebSearchEnabledPref(previous ?? !webSearchEnabled),
		() => readWebSearchEnabledPref() === webSearchEnabled,
		{ webSearchEnabled },
		"Couldn't update web search settings.",
		options
	);
}

export function setChatModelPreference(
	modelId: string,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const previous = readModelPref();
	return writeThrough(
		() => writeModelPref(modelId),
		() => writeModelPref(previous),
		() => readModelPref() === modelId,
		{ chat: { modelId } },
		"Couldn't save your model.",
		options
	);
}

const RUN_OPTION_IO: Record<
	ChatRunOptionKey,
	{ read: () => string | null; write: (value: string | null) => void }
> = {
	effort: { read: readEffortPref, write: writeEffortPref },
	speed: { read: readSpeedPref, write: writeSpeedPref },
	verbosity: { read: readVerbosityPref, write: writeVerbosityPref },
	mode: { read: readModePref, write: writeModePref },
};

export function setChatRunOptionPreference(
	key: ChatRunOptionKey,
	value: string | null,
	options: WriteThroughOptions = {}
): Promise<string | null> {
	const io = RUN_OPTION_IO[key];
	const previous = io.read();
	// "auto" is this client's marker for "the user chose Auto", which the column
	// stores as null - the same mapping the chat request already makes. Sending
	// the sentinel would fail validation, since it is not a reasoning effort.
	const stored = key === "effort" && value === AUTO_EFFORT_SENTINEL ? null : value;
	return writeThrough(
		() => io.write(value),
		() => io.write(previous),
		() => io.read() === value,
		{ chat: { [key]: stored } },
		"Couldn't save that option.",
		options
	);
}
