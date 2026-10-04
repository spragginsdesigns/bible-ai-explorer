import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/nextjs";
import {
	deleteHighlight,
	fetchChapterHighlights,
	normalizeHighlightHex,
	putHighlight,
} from "@/lib/highlights";
import { chapterPrefix, chapterView, createHighlightsStore } from "./highlightsStore";

/** One store for the whole tab, like Android's module-level highlights store. */
const store = createHighlightsStore({
	api: {
		fetchChapter: fetchChapterHighlights,
		put: putHighlight,
		remove: deleteHighlight,
	},
	storage: () => {
		try {
			return typeof window === "undefined" ? null : window.localStorage;
		} catch {
			return null;
		}
	},
	normalize: normalizeHighlightHex,
});

const EMPTY: ReadonlyMap<string, string> = new Map();

// Layout timing so the cached colors land before the first paint of the
// chapter; the effect variant only keeps server rendering quiet.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The signed-in user's highlights for the chapter on screen, as verse number
 * -> "#RRGGBB". Painted from this account's localStorage cache at once, then
 * revalidated against GET /api/highlights. Writes are optimistic, serialized
 * per verse, and roll back to the last server-accepted color on failure.
 */
export function useChapterHighlights(translation: string, book: number, chapter: number) {
	const { userId, isLoaded } = useAuth();
	const owner = isLoaded ? (userId ?? null) : null;

	useIsomorphicLayoutEffect(() => {
		// Until Clerk has loaded the account is unknown, not signed out; keeping
		// the previous owner avoids wiping the cache for one render.
		if (isLoaded) store.setOwner(owner);
	}, [isLoaded, owner]);

	const all = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
	const scope = chapterPrefix(translation, book, chapter);

	useEffect(() => {
		if (owner) store.refreshChapter(translation, book, chapter);
	}, [owner, translation, book, chapter]);

	const highlights = useMemo(() => chapterView(all, scope), [all, scope]);

	const setColor = useCallback(
		(verse: number, color: string) => {
			store.setHighlight({ translation, book, chapter, verse, color }).catch(() => {});
		},
		[translation, book, chapter]
	);

	const remove = useCallback(
		(verse: number) => {
			store.removeHighlight({ translation, book, chapter, verse }).catch(() => {});
		},
		[translation, book, chapter]
	);

	return { highlights, setColor, remove };
}
