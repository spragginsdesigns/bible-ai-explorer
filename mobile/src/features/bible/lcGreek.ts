/**
 * The LC Greek in the reader (LC-15842, see LC_GREEK in ./audioBible): fetched
 * per chapter from `GET /api/bible/lc-greek` and cached in memory for the
 * session, like the NKJV. Mirrors readChapterTexts in web's ChapterReader.
 */
import { API_URL } from "@/lib/api";
import { parseLcGreek } from "./audioBible";
import { CHAPTER_LOAD_ERROR, getChapter, type TranslationId } from "./translations";

const LC_GREEK_TIMEOUT_MS = 15000;

const lcGreekCache = new Map<string, string[]>();

export async function getLcGreekChapter(book: number, chapter: number): Promise<string[]> {
	const key = `${book}:${chapter}`;
	const cached = lcGreekCache.get(key);
	if (cached) return cached;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), LC_GREEK_TIMEOUT_MS);
	try {
		const response = await fetch(`${API_URL}/api/bible/lc-greek?book=${book}&chapter=${chapter}`, {
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`lc-greek responded ${response.status}`);
		const verses = parseLcGreek(await response.json(), book, chapter);
		if (!verses) throw new Error("Unusable lc-greek payload");
		lcGreekCache.set(key, verses);
		return verses;
	} catch {
		throw new Error(CHAPTER_LOAD_ERROR);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The verses the reader shows, and the ones its study tools read. They differ
 * only on the LC Greek: it is shown, while highlights, Explain, Learn, Ask AI
 * and Listen keep working on the KJV verse with the same number.
 */
export async function getChapterTexts(
	lcGreek: boolean,
	translation: TranslationId,
	book: number,
	chapter: number,
): Promise<{ shown: string[]; study: string[] }> {
	if (!lcGreek) {
		const verses = await getChapter(translation, book, chapter);
		return { shown: verses, study: verses };
	}
	const [shown, study] = await Promise.all([getLcGreekChapter(book, chapter), getChapter("KJV", book, chapter)]);
	return { shown, study };
}
