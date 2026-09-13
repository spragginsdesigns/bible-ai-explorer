import type { TranslationId } from "@/features/bible/translations";
import { DEFAULT_LISTEN_RATE, normalizeListenRate } from "@/features/cross/listen";

export const HIGHLIGHT_LABEL_IDS = [
	"yellow",
	"orange",
	"red",
	"pink",
	"purple",
	"blue",
	"teal",
	"green",
] as const;

export type HighlightLabelId = (typeof HIGHLIGHT_LABEL_IDS)[number];
export type HighlightLabels = Partial<Record<HighlightLabelId, string>>;

export const MAX_HIGHLIGHT_LABEL_LENGTH = 24;
export const EMPTY_HIGHLIGHT_LABELS: HighlightLabels = Object.freeze({});

function isHighlightLabelId(value: string): value is HighlightLabelId {
	return (HIGHLIGHT_LABEL_IDS as readonly string[]).includes(value);
}

export function normalizeHighlightLabels(value: unknown): HighlightLabels {
	const record = asRecord(value);
	if (!record) return EMPTY_HIGHLIGHT_LABELS;
	const labels: HighlightLabels = {};
	for (const [id, raw] of Object.entries(record)) {
		if (!isHighlightLabelId(id) || typeof raw !== "string") continue;
		const label = raw.trim().slice(0, MAX_HIGHLIGHT_LABEL_LENGTH);
		if (label) labels[id] = label;
	}
	return Object.keys(labels).length > 0 ? labels : EMPTY_HIGHLIGHT_LABELS;
}

export function mergeHighlightLabelEdits(
	base: HighlightLabels,
	edits: Partial<Record<HighlightLabelId, string>>
): HighlightLabels {
	const merged: HighlightLabels = { ...normalizeHighlightLabels(base) };
	for (const id of HIGHLIGHT_LABEL_IDS) {
		if (!Object.prototype.hasOwnProperty.call(edits, id)) continue;
		const label = (edits[id] ?? "").trim().slice(0, MAX_HIGHLIGHT_LABEL_LENGTH);
		if (label) merged[id] = label;
		else delete merged[id];
	}
	return normalizeHighlightLabels(merged);
}

export function highlightLabelFor(
	labels: HighlightLabels,
	colorName: string | null | undefined
): string | null {
	if (!colorName) return null;
	const id = colorName.toLowerCase();
	return isHighlightLabelId(id) ? labels[id] ?? null : null;
}

/**
 * Pure rules for the account preferences document served by
 * `GET/PATCH /api/preferences`. The server row is the single source of truth
 * for every field here; the local settings store is only a first-paint cache
 * of it.
 *
 * Everything in this file is side-effect free so the parts that are easy to
 * get wrong - the stale-fetch guard, the document mapping, the cache-owner
 * check - can be tested without AsyncStorage, Clerk or the network.
 *
 * `@/features/bible/translations` is imported for its type only: the runtime
 * module pulls in the bundled KJV text, which has no business loading here.
 */

export interface PreferencesChat {
	modelId: string | null;
	effort: string | null;
	speed: string | null;
	verbosity: string | null;
	mode: string | null;
}

export interface PreferencesDocument {
	plan: "free" | "pro";
	webSearchEnabled: boolean;
	memoryEnabled: boolean;
	translation: TranslationId;
	parchment: boolean;
	listenRate: number;
	/** null only when this build is talking to an older response with no field. */
	highlightLabels: HighlightLabels | null;
	chat: PreferencesChat;
}

/** A partial write. Only the keys present are sent, and only they are changed. */
export interface PreferencesPatch {
	webSearchEnabled?: boolean;
	memoryEnabled?: boolean;
	translation?: TranslationId;
	parchment?: boolean;
	listenRate?: number;
	highlightLabels?: HighlightLabels;
	chat?: Partial<PreferencesChat>;
}

/** The settings-store fields the server owns, in the store's own field names. */
export interface SyncedSettingsFields {
	translation: TranslationId;
	parchment: boolean;
	listenRate: number;
	highlightLabels: HighlightLabels | null;
	chatModelId: string | null;
	chatEffort: string | null;
	chatSpeed: string | null;
	chatVerbosity: string | null;
	chatMode: string | null;
}

/**
 * The server's own column defaults. Kept here rather than in the settings
 * store so the seed below and the store cannot drift apart about what counts
 * as "never chosen"; the store builds its defaults from this.
 */
export const DEFAULT_SYNCED_SETTINGS: SyncedSettingsFields = {
	translation: "KJV",
	parchment: true,
	listenRate: DEFAULT_LISTEN_RATE,
	highlightLabels: null,
	chatModelId: null,
	chatEffort: null,
	chatSpeed: null,
	chatVerbosity: null,
	chatMode: null,
};

/**
 * First-adopt seed: the local picks worth pushing up, given what the account
 * already holds. Null when there is nothing to push.
 *
 * A field qualifies only when the device has chosen something and the server
 * is *still on its column default*. Both halves matter, and each answers a
 * different failure:
 *
 * - Local differs from default: a device sitting on a default has expressed no
 *   preference, and claiming one would overwrite a real choice made elsewhere.
 * - Server still on default: an absent cache owner does not prove the local
 *   values belong to the account now signing in. On a shared phone they may be
 *   the previous user's. An account that has already chosen therefore always
 *   wins; the seed only fills columns nobody has written yet.
 */
export function overridesToPush(
	local: SyncedSettingsFields,
	server: SyncedSettingsFields
): PreferencesPatch | null {
	const pushable = <K extends keyof SyncedSettingsFields>(field: K): boolean =>
		local[field] !== DEFAULT_SYNCED_SETTINGS[field] &&
		server[field] === DEFAULT_SYNCED_SETTINGS[field];

	const patch: PreferencesPatch = {};
	if (pushable("translation")) patch.translation = local.translation;
	if (pushable("parchment")) patch.parchment = local.parchment;
	if (pushable("listenRate")) patch.listenRate = local.listenRate;

	const chat: Partial<PreferencesChat> = {};
	if (pushable("chatModelId")) chat.modelId = local.chatModelId;
	if (pushable("chatEffort")) chat.effort = local.chatEffort;
	if (pushable("chatSpeed")) chat.speed = local.chatSpeed;
	if (pushable("chatVerbosity")) chat.verbosity = local.chatVerbosity;
	if (pushable("chatMode")) chat.mode = local.chatMode;
	if (Object.keys(chat).length > 0) patch.chat = chat;

	return Object.keys(patch).length > 0 ? patch : null;
}

/** At most one hydrate per this interval, per the shared client contract. */
export const PREFERENCES_REFRESH_INTERVAL_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Chat picks are opaque strings on the way through. A model id is whatever
 * `/api/ai/models` listed (`provider/model`), and the run options are whatever
 * that model declared: this client validates neither, so a value the server
 * adds later rides along without a client release.
 */
function asNullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read a server document defensively. A field the server omits or sends in a
 * shape this build does not understand falls back to the documented default
 * rather than poisoning the local cache: a preferences response is applied
 * wholesale, so one bad key must not take the reader's translation with it.
 * A response that is not an object at all (an error page, a proxy) yields
 * null, and the caller keeps whatever is already local.
 */
export function parsePreferencesDocument(raw: unknown): PreferencesDocument | null {
	const doc = asRecord(raw);
	if (!doc) return null;
	const chat = asRecord(doc.chat) ?? {};
	return {
		plan: doc.plan === "pro" ? "pro" : "free",
		webSearchEnabled: doc.webSearchEnabled !== false,
		memoryEnabled: doc.memoryEnabled !== false,
		translation: doc.translation === "BSB" ? "BSB" : doc.translation === "NKJV" ? "NKJV" : "KJV",
		parchment: doc.parchment !== false,
		// Normalized rather than trusted: a rate this build no longer offers
		// would leave the Listen speed chip outside its own cycle.
		listenRate: normalizeListenRate(doc.listenRate),
		highlightLabels:
			Object.prototype.hasOwnProperty.call(doc, "highlightLabels") && asRecord(doc.highlightLabels)
				? normalizeHighlightLabels(doc.highlightLabels)
				: null,
		chat: {
			modelId: asNullableString(chat.modelId),
			effort: asNullableString(chat.effort),
			speed: asNullableString(chat.speed),
			verbosity: asNullableString(chat.verbosity),
			mode: asNullableString(chat.mode),
		},
	};
}

/** The server document in the settings store's field names. */
export function settingsFromDocument(doc: PreferencesDocument): SyncedSettingsFields {
	return {
		translation: doc.translation,
		parchment: doc.parchment,
		listenRate: doc.listenRate,
		highlightLabels: doc.highlightLabels,
		chatModelId: doc.chat.modelId,
		chatEffort: doc.chat.effort,
		chatSpeed: doc.chat.speed,
		chatVerbosity: doc.chat.verbosity,
		chatMode: doc.chat.mode,
	};
}

/**
 * The stale-fetch guard. A response is applied only when no user edit has
 * happened since the request was issued; otherwise the response describes a
 * document older than what the user just chose, and applying it would visibly
 * undo their tap.
 */
export function shouldApplyResponse(seqAtRequest: number, seqNow: number): boolean {
	return seqAtRequest === seqNow;
}

/**
 * Foreground hydrates are throttled: Android fires AppState "active" for
 * things as small as dismissing a permission dialog, and the document is not
 * worth a round trip that often.
 */
export function shouldFetchNow(
	lastFetchAt: number | null,
	now: number,
	minIntervalMs: number = PREFERENCES_REFRESH_INTERVAL_MS
): boolean {
	if (lastFetchAt === null) return true;
	return now - lastFetchAt >= minIntervalMs;
}

/**
 * What to throw away before hydrating, given the owner recorded beside the
 * caches and the account that just signed in.
 *
 * - `"none"`: the caches were written for this account.
 * - `"all"`: they were written for a different account. Settings included.
 * - `"private"`: no owner was recorded, which is every install upgrading from a
 *   build before this one. Notes and highlights go, because they are that
 *   account's study and there is no way to tell whose they are. Settings stay:
 *   the hydrate one step later overwrites them anyway, and discarding them
 *   would reset the translation of every existing user whose first launch on
 *   this build happens to be offline.
 */
export type CacheDiscard = "none" | "private" | "all";

export function cacheDiscardFor(cachedOwner: string | null, userId: string): CacheDiscard {
	if (cachedOwner === userId) return "none";
	return cachedOwner === null ? "private" : "all";
}
