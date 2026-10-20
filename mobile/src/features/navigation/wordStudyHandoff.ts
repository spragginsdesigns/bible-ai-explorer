import { bookByOrder } from "@/features/bible/books";
import { getKjvChapter } from "@/features/bible/kjv";

export function wordStudyHandoff(target: { order: number; chapter: number; verse: number }, prompt: string, attach: boolean, handoffId: string) {
	const base = { prompt, handoffId, clearAttachment: attach ? "0" : "1", attachRef: "", attachText: "", attachTranslation: "", verseOfDayId: "" };
	if (!attach) return base;
	const book = bookByOrder(target.order);
	if (!book) return null;
	try {
		const text = getKjvChapter(target.order, target.chapter)[target.verse - 1];
		if (!text?.trim()) return null;
		return { ...base, attachRef: `${book.name} ${target.chapter}:${target.verse}`, attachText: text, attachTranslation: "KJV" };
	} catch { return null; }
}
