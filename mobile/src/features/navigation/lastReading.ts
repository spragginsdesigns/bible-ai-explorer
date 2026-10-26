import { BOOKS } from "@/features/bible/books";
import { isTranslationId, type TranslationId } from "@/features/bible/translations";

export interface LastRead {
	book: string;
	chapter: number;
	translation: TranslationId;
	readAt: string;
}

export function parseLastRead(value: unknown): LastRead | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.book !== "string" || typeof candidate.chapter !== "number"
		|| !Number.isInteger(candidate.chapter) || typeof candidate.readAt !== "string"
		|| !Number.isFinite(Date.parse(candidate.readAt))
		|| !isTranslationId(candidate.translation)) return null;
	const book = BOOKS.find((item) => item.name === candidate.book);
	if (!book || candidate.chapter < 1 || candidate.chapter > book.chapters) return null;
	return { book: book.name, chapter: candidate.chapter, translation: candidate.translation, readAt: candidate.readAt };
}
