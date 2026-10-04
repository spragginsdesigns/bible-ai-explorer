/**
 * Verse highlights for the web reader, ported from Android's
 * mobile/src/features/bible/highlightsStore.ts: a module-level snapshot read
 * through useSyncExternalStore, cached in localStorage so a chapter paints
 * its colors instantly (and offline), and revalidated against the server one
 * chapter at a time. Writes are optimistic and serialized per verse: a failed
 * PUT/DELETE rolls back to the last value the server accepted, never to an
 * older optimistic intent, and a slow earlier write can never land after a
 * newer one.
 *
 * Entry keys are `translation:book:chapter:verse` (book = 1-66 order). The
 * cache itself is keyed by account, so one account's colors never paint
 * another's verses in a shared browser.
 *
 * Deliberately free of React and of the "@/" alias: the dependencies are
 * injected, which is what lets tests drive the real queue and rollback logic.
 */

export interface HighlightRef {
	translation: string;
	book: number;
	chapter: number;
	verse: number;
}

export interface HighlightsApi {
	fetchChapter(
		translation: string,
		book: number,
		chapter: number
	): Promise<{ verse: number; color: string }[]>;
	put(input: HighlightRef & { color: string }): Promise<void>;
	remove(input: HighlightRef): Promise<void>;
}

/** The subset of Web Storage the cache needs; every call may throw. */
export interface HighlightsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface HighlightsStoreDependencies {
	api: HighlightsApi;
	/** Null when storage is unavailable (SSR, blocked site data). */
	storage: () => HighlightsStorage | null;
	normalize: (hex: string) => string | null;
}

export type HighlightsSnapshot = ReadonlyMap<string, string>;

const STORAGE_PREFIX = "sureword.highlights-cache.v1:";

export function highlightsStorageKey(owner: string): string {
	return `${STORAGE_PREFIX}${encodeURIComponent(owner)}`;
}

export function highlightKey(ref: HighlightRef): string {
	return `${ref.translation}:${ref.book}:${ref.chapter}:${ref.verse}`;
}

export function chapterPrefix(translation: string, book: number, chapter: number): string {
	return `${translation}:${book}:${chapter}:`;
}

/** One chapter's slice of the snapshot as `Map<verse, color>`. */
export function chapterView(all: HighlightsSnapshot, scope: string): Map<number, string> {
	const view = new Map<number, string>();
	for (const [k, color] of all) {
		if (!k.startsWith(scope)) continue;
		const verse = Number.parseInt(k.slice(scope.length), 10);
		if (Number.isFinite(verse)) view.set(verse, color);
	}
	return view;
}

type HighlightValue = string | undefined;

export function createHighlightsStore(deps: HighlightsStoreDependencies) {
	let owner: string | null = null;
	let snapshot: HighlightsSnapshot = new Map();
	const listeners = new Set<() => void>();
	// Revisions identify the latest local intent for each verse. The persisted
	// value is deliberately separate from the optimistic snapshot: a failed
	// write must return to the last value the server accepted.
	const revisions = new Map<string, number>();
	const persistedValues = new Map<string, HighlightValue>();
	const writeQueues = new Map<string, Promise<void>>();
	// One in-flight GET per chapter: paging back and forth must not stack them.
	const inflight = new Set<string>();
	/**
	 * Bumped on every account switch: a request issued for the previous account
	 * is still in flight after it, and must not repaint the new account's map.
	 */
	let generation = 0;

	function emit() {
		for (const listener of listeners) listener();
	}

	function persist() {
		if (!owner) return;
		try {
			deps.storage()?.setItem(highlightsStorageKey(owner), JSON.stringify(Object.fromEntries(snapshot)));
		} catch {
			// A full or blocked store must never break the reader.
		}
	}

	function setSnapshot(next: Map<string, string>) {
		snapshot = next;
		persist();
		emit();
	}

	function readCache(account: string): Map<string, string> {
		const next = new Map<string, string>();
		try {
			const raw = deps.storage()?.getItem(highlightsStorageKey(account));
			if (!raw) return next;
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object") return next;
			for (const [k, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof value !== "string") continue;
				const color = deps.normalize(value);
				if (color) next.set(k, color);
			}
		} catch {
			// A corrupt or unreadable cache falls back to the server refresh.
		}
		return next;
	}

	/**
	 * Point the store at the signed-in account (null when signed out). A
	 * different account drops every in-memory value and loads that account's
	 * own cache, so nothing crosses between accounts in one browser.
	 */
	function setOwner(next: string | null) {
		if (next === owner) return;
		generation += 1;
		owner = next;
		revisions.clear();
		persistedValues.clear();
		writeQueues.clear();
		inflight.clear();
		snapshot = next ? readCache(next) : new Map();
		for (const [k, value] of snapshot) persistedValues.set(k, value);
		emit();
	}

	function currentRevision(k: string): number {
		return revisions.get(k) ?? 0;
	}

	function applyValue(k: string, value: HighlightValue) {
		// Re-applying what is already on screen would rewrite the whole cache
		// and wake every subscriber for no visible change.
		if (value === undefined ? !snapshot.has(k) : snapshot.get(k) === value) return;
		const next = new Map(snapshot);
		if (value === undefined) next.delete(k);
		else next.set(k, value);
		setSnapshot(next);
	}

	function refreshChapter(translation: string, book: number, chapter: number) {
		if (!owner) return;
		const scope = chapterPrefix(translation, book, chapter);
		if (inflight.has(scope)) return;
		inflight.add(scope);
		const knownAtStart = new Set<string>();
		const revisionsAtStart = new Map<string, number>();
		const pendingAtStart = new Set<string>();
		const keysAtStart = new Set<string>([
			...snapshot.keys(),
			...revisions.keys(),
			...persistedValues.keys(),
		]);
		for (const k of keysAtStart) {
			if (!k.startsWith(scope)) continue;
			if (snapshot.has(k)) knownAtStart.add(k);
			revisionsAtStart.set(k, currentRevision(k));
			if (writeQueues.has(k)) pendingAtStart.add(k);
		}
		const startedGeneration = generation;
		const canApply = (k: string) =>
			!pendingAtStart.has(k) && currentRevision(k) === (revisionsAtStart.get(k) ?? 0);
		deps.api
			.fetchChapter(translation, book, chapter)
			.then((rows) => {
				if (generation !== startedGeneration) return;
				const incoming = new Map<string, string>();
				for (const entry of rows) {
					if (typeof entry.verse !== "number") continue;
					const color = deps.normalize(entry.color ?? "");
					if (color) incoming.set(`${scope}${entry.verse}`, color);
				}
				const next = new Map(snapshot);
				// A chapter almost always comes back exactly as cached; only a real
				// change rewrites the cache and re-renders the reader.
				let changed = false;
				// Drop entries the server no longer has, but only ones known when the
				// request started, so a write made mid-flight is never clobbered.
				for (const k of knownAtStart) {
					if (!canApply(k) || incoming.has(k)) continue;
					if (next.delete(k)) changed = true;
					persistedValues.set(k, undefined);
				}
				for (const [k, color] of incoming) {
					if (!canApply(k)) continue;
					if (next.get(k) !== color) {
						next.set(k, color);
						changed = true;
					}
					persistedValues.set(k, color);
				}
				if (changed) setSnapshot(next);
			})
			.catch(() => {
				// Offline or signed out: keep the cached and optimistic snapshot.
			})
			.finally(() => {
				if (generation === startedGeneration) inflight.delete(scope);
			});
	}

	function enqueueWrite(k: string, value: HighlightValue, write: () => Promise<void>): Promise<void> {
		const startedGeneration = generation;
		const revision = currentRevision(k) + 1;
		revisions.set(k, revision);
		if (!persistedValues.has(k)) persistedValues.set(k, snapshot.get(k));
		applyValue(k, value);

		const previous = writeQueues.get(k) ?? Promise.resolve();
		const run = previous
			.catch(() => undefined)
			.then(async () => {
				if (generation !== startedGeneration) return;
				try {
					await write();
					if (generation !== startedGeneration) return;
					persistedValues.set(k, value);
				} catch (error) {
					// Only the newest intent rolls back: an older failed write must not
					// undo a newer color the reader has already chosen.
					if (generation === startedGeneration && currentRevision(k) === revision) {
						applyValue(k, persistedValues.get(k));
					}
					throw error;
				}
			});
		writeQueues.set(k, run);
		const settle = () => {
			if (writeQueues.get(k) === run) writeQueues.delete(k);
		};
		void run.then(settle, settle);
		return run;
	}

	/** Optimistic upsert, serialized with other intents for the same verse. */
	function setHighlight(ref: HighlightRef & { color: string }): Promise<void> {
		const color = deps.normalize(ref.color);
		if (!color) return Promise.resolve();
		const input = {
			translation: ref.translation,
			book: ref.book,
			chapter: ref.chapter,
			verse: ref.verse,
			color,
		};
		return enqueueWrite(highlightKey(ref), color, () => deps.api.put(input));
	}

	/** Optimistic delete, serialized with other intents for the same verse. */
	function removeHighlight(ref: HighlightRef): Promise<void> {
		const k = highlightKey(ref);
		if (snapshot.get(k) === undefined) return Promise.resolve();
		const input = {
			translation: ref.translation,
			book: ref.book,
			chapter: ref.chapter,
			verse: ref.verse,
		};
		return enqueueWrite(k, undefined, () => deps.api.remove(input));
	}

	return {
		setOwner,
		refreshChapter,
		setHighlight,
		removeHighlight,
		getSnapshot: (): HighlightsSnapshot => snapshot,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export type HighlightsStore = ReturnType<typeof createHighlightsStore>;
