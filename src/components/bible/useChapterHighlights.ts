import { useCallback, useEffect, useState } from "react";
import {
	deleteHighlight,
	fetchChapterHighlights,
	putHighlight,
} from "@/lib/highlights";

/**
 * The signed-in user's highlights for the chapter on screen, as verse number
 * -> "#RRGGBB". Writes are optimistic: the map updates immediately and rolls
 * back if the API call fails. Fetch failures (e.g. signed out, offline) just
 * leave the chapter unhighlighted.
 */
export function useChapterHighlights(translation: string, book: number, chapter: number) {
	const [highlights, setHighlights] = useState<Map<number, string>>(new Map());

	useEffect(() => {
		let cancelled = false;
		setHighlights(new Map());
		fetchChapterHighlights(translation, book, chapter)
			.then((rows) => {
				if (!cancelled) {
					setHighlights(new Map(rows.map((row) => [row.verse, row.color])));
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [translation, book, chapter]);

	const setColor = useCallback(
		(verse: number, color: string) => {
			let previous: string | undefined;
			setHighlights((prev) => {
				previous = prev.get(verse);
				const next = new Map(prev);
				next.set(verse, color);
				return next;
			});
			putHighlight({ translation, book, chapter, verse, color }).catch(() => {
				setHighlights((prev) => {
					const next = new Map(prev);
					if (previous === undefined) next.delete(verse);
					else next.set(verse, previous);
					return next;
				});
			});
		},
		[translation, book, chapter]
	);

	const remove = useCallback(
		(verse: number) => {
			let previous: string | undefined;
			setHighlights((prev) => {
				previous = prev.get(verse);
				const next = new Map(prev);
				next.delete(verse);
				return next;
			});
			deleteHighlight({ translation, book, chapter, verse }).catch(() => {
				if (previous === undefined) return;
				const restored = previous;
				setHighlights((prev) => {
					const next = new Map(prev);
					next.set(verse, restored);
					return next;
				});
			});
		},
		[translation, book, chapter]
	);

	return { highlights, setColor, remove };
}
