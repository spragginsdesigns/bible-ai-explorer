import { useEffect, useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiJson, type GetToken } from "@/lib/api";
import type { TranslationId } from "@/features/bible/translations";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { normalizeHighlightHex } from "./highlights";

/**
 * Verse highlights, modeled on settingsStore/notesStore: a module-level
 * snapshot exposed through useSyncExternalStore, hydrated from / persisted to
 * AsyncStorage so the reader paints instantly, and revalidated against the
 * server chapter-by-chapter. Writes are optimistic — the row recolors before
 * the PUT/DELETE lands, and a failure rolls the snapshot back.
 *
 * Keys are `translation:book:chapter:verse` (book = 1-66 order), matching the
 * `translation:order:chapter` chapterKey the reader already uses.
 */

const STORAGE_KEY = "sureword.highlights-cache.v1";

export interface HighlightRef {
	translation: TranslationId;
	book: number;
	chapter: number;
	verse: number;
}

interface ChapterHighlightsResponse {
	highlights: { verse: number; color: string }[];
}

let snapshot: ReadonlyMap<string, string> = new Map();
let hydrated = false;
const listeners = new Set<() => void>();

function key(ref: HighlightRef): string {
	return `${ref.translation}:${ref.book}:${ref.chapter}:${ref.verse}`;
}

function chapterPrefix(translation: TranslationId, book: number, chapter: number): string {
	return `${translation}:${book}:${chapter}:`;
}

function emit() {
	for (const listener of listeners) listener();
}

function persist() {
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(snapshot))).catch(() => {
		// A full/unavailable store must never break the UI.
	});
}

function setSnapshot(next: Map<string, string>) {
	snapshot = next;
	persist();
	emit();
}

/**
 * Bumped by every clear, for the same reason as the notes cache: a read issued
 * before a clear is still in flight after it, and would repaint the previous
 * account's colors over the cleared map.
 */
let generation = 0;

/** Load the cached highlights once at startup (root layout holds the splash). */
export async function hydrateHighlights(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	const startedAt = generation;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (!raw || generation !== startedAt) return;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const next = new Map<string, string>();
		for (const [k, value] of Object.entries(parsed)) {
			if (typeof value !== "string") continue;
			const color = normalizeHighlightHex(value);
			if (color) next.set(k, color);
		}
		snapshot = next;
	} catch {
		// A corrupt or unreadable cache falls back to a server refresh.
	}
}

/**
 * Drop every cached highlight and the persisted blob behind it. Called when
 * the signed-in account is not the one this cache was written for, and on
 * sign-out: the reader would otherwise paint one account's verses in another
 * account's colors until each chapter revalidated.
 */
export function clearHighlightsCache(): Promise<void> {
	generation += 1;
	// Left marked hydrated: the startup read must not resurrect the file we
	// are deleting, and every chapter revalidates against the server anyway.
	hydrated = true;
	snapshot = new Map();
	emit();
	return AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
		// An unwritable store must never break sign-out.
	});
}

// Server revalidation, one in-flight GET per chapter - paging back and forth
// must not stack duplicate requests.
const inflight = new Set<string>();

function refreshChapter(getToken: GetToken, translation: TranslationId, book: number, chapter: number) {
	const scope = chapterPrefix(translation, book, chapter);
	if (inflight.has(scope)) return;
	inflight.add(scope);
	const knownAtStart = new Set<string>();
	for (const k of snapshot.keys()) {
		if (k.startsWith(scope)) knownAtStart.add(k);
	}
	apiJson<ChapterHighlightsResponse>(
		getToken,
		`/api/highlights?translation=${translation}&book=${book}&chapter=${chapter}`
	)
		.then((data) => {
			const incoming = new Map<string, string>();
			for (const entry of data.highlights ?? []) {
				if (typeof entry.verse !== "number") continue;
				const color = normalizeHighlightHex(entry.color ?? "");
				if (color) incoming.set(`${scope}${entry.verse}`, color);
			}
			const next = new Map(snapshot);
			// Drop entries the server no longer has — but only ones we already
			// knew about when the request started, so an optimistic write made
			// mid-flight is never clobbered by a stale response.
			for (const k of knownAtStart) {
				if (!incoming.has(k)) next.delete(k);
			}
			for (const [k, color] of incoming) next.set(k, color);
			setSnapshot(next);
		})
		.catch(() => {
			// Offline or not signed in: keep the cached/optimistic snapshot.
		})
		.finally(() => {
			inflight.delete(scope);
		});
}

/**
 * The highlights for one chapter as a `Map<verse, color>`. Subscribes to the
 * shared snapshot and kicks off a server refresh whenever the chapter changes.
 */
export function useChapterHighlights(
	translation: TranslationId,
	book: number,
	chapter: number
): Map<number, string> {
	const getToken = useStableGetToken();
	const all = useSyncExternalStore(subscribe, () => snapshot);
	const scope = chapterPrefix(translation, book, chapter);

	useEffect(() => {
		refreshChapter(getToken, translation, book, chapter);
	}, [getToken, translation, book, chapter]);

	return useMemo(() => {
		const view = new Map<number, string>();
		for (const [k, color] of all) {
			if (!k.startsWith(scope)) continue;
			const verse = Number.parseInt(k.slice(scope.length), 10);
			if (Number.isFinite(verse)) view.set(verse, color);
		}
		return view;
	}, [all, scope]);
}

/** Optimistic upsert; rolls back if the server write fails. */
export async function setHighlight(getToken: GetToken, ref: HighlightRef & { color: string }) {
	const k = key(ref);
	const color = normalizeHighlightHex(ref.color);
	if (!color) return;
	const previous = snapshot.get(k);
	const next = new Map(snapshot);
	next.set(k, color);
	setSnapshot(next);
	try {
		await apiJson(getToken, "/api/highlights", { method: "PUT", body: { ...ref, color } });
	} catch (error) {
		rollback(k, previous);
		throw error;
	}
}

/** Optimistic delete; rolls back if the server write fails. */
export async function removeHighlight(getToken: GetToken, ref: HighlightRef) {
	const k = key(ref);
	const previous = snapshot.get(k);
	if (previous === undefined) return;
	const next = new Map(snapshot);
	next.delete(k);
	setSnapshot(next);
	try {
		await apiJson(getToken, "/api/highlights", { method: "DELETE", body: ref });
	} catch (error) {
		rollback(k, previous);
		throw error;
	}
}

function rollback(k: string, previous: string | undefined) {
	const next = new Map(snapshot);
	if (previous === undefined) next.delete(k);
	else next.set(k, previous);
	setSnapshot(next);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
