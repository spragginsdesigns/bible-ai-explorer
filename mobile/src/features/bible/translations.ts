/**
 * Chapter loading for the Bible reader. KJV, BSB, the American Standard
 * Version and the Bibles in other languages (Reina-Valera 1909, Lutherbibel
 * 1912) are bundled with the app and resolve synchronously; NKJV is fetched from bolls.life per chapter with a
 * timeout and cached in memory for the session.
 */
import { getBsbChapter } from "./bsb";
import { getForeignBibleChapter } from "./ebible";
import { getKjvChapter } from "./kjv";

/** The languages SureWord answers in and has a Bible for. */
export const BIBLE_LANGUAGES = ["en", "es", "de"] as const;
export type BibleLanguage = (typeof BIBLE_LANGUAGES)[number];

/** Each language's name in that language, for pickers. */
export const BIBLE_LANGUAGE_NAMES: Readonly<Record<BibleLanguage, string>> = {
	en: "English",
	es: "Español",
	de: "Deutsch",
};

/** Every translation id this build reads. The one list; parse anything else through it. */
export const TRANSLATION_IDS = ["KJV", "NKJV", "BSB", "ASV", "RV1909", "LUT1912"] as const;
export type TranslationId = (typeof TRANSLATION_IDS)[number];

export interface TranslationInfo {
	id: TranslationId;
	label: string;
	copyright: string;
	language: BibleLanguage;
}

export const TRANSLATIONS: Record<TranslationId, TranslationInfo> = {
	BSB: { id: "BSB", label: "Berean Standard Bible", copyright: "Public domain · BSB Publishing", language: "en" },
	KJV: { id: "KJV", label: "KJV", copyright: "Public domain", language: "en" },
	NKJV: { id: "NKJV", label: "NKJV", copyright: "© Thomas Nelson — text via bolls.life", language: "en" },
	ASV: { id: "ASV", label: "American Standard Version", copyright: "Public domain", language: "en" },
	RV1909: { id: "RV1909", label: "Reina-Valera 1909", copyright: "Public domain", language: "es" },
	LUT1912: { id: "LUT1912", label: "Lutherbibel 1912", copyright: "Public domain", language: "de" },
};

/** The Bible each language opens to, and the one its answers quote. */
export const LANGUAGE_BIBLES: Readonly<Record<BibleLanguage, TranslationId>> = {
	en: "KJV",
	es: "RV1909",
	de: "LUT1912",
};

export function isTranslationId(value: unknown): value is TranslationId {
	return typeof value === "string" && (TRANSLATION_IDS as readonly string[]).includes(value);
}

/** Parse a stored or routed value without letting an arbitrary string change reader state. */
export function parseTranslationId(value: unknown): TranslationId | null {
	return isTranslationId(value) ? value : null;
}

/** Picker label: "Reina-Valera 1909 · Español" for a Bible outside English, the short id ("KJV") otherwise. */
export function translationPickerLabel(id: TranslationId): string {
	const { label, language } = TRANSLATIONS[id];
	return language === "en" ? id : `${label} · ${BIBLE_LANGUAGE_NAMES[language]}`;
}

export const CHAPTER_LOAD_ERROR =
	"That chapter could not be loaded. Check your connection and try again.";

const NKJV_TIMEOUT_MS = 15000;

const nkjvCache = new Map<string, string[]>();
const nkjvPending = new Map<string, Promise<string[]>>();

interface BollsVerseRow {
	verse: number;
	text: string;
}

async function fetchNkjvChapter(order: number, chapter: number): Promise<string[]> {
	const key = `${order}:${chapter}`;
	const cached = nkjvCache.get(key);
	if (cached) return cached;
	const existing = nkjvPending.get(key);
	if (existing) return existing;
	const request = loadNkjvChapter(order, chapter).finally(() => nkjvPending.delete(key));
	nkjvPending.set(key, request);
	return request;
}

async function loadNkjvChapter(order: number, chapter: number): Promise<string[]> {
	const key = `${order}:${chapter}`;
	const cached = nkjvCache.get(key);
	if (cached) return cached;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), NKJV_TIMEOUT_MS);
	try {
		const response = await fetch(
			`https://bolls.life/get-chapter/NKJV/${order}/${chapter}/`,
			{ signal: controller.signal }
		);
		if (!response.ok) throw new Error(`bolls.life responded ${response.status}`);
		const rows: unknown = await response.json();
		if (!Array.isArray(rows)) throw new Error("Unexpected bolls.life payload");
		const verses = (rows as BollsVerseRow[])
			.slice()
			.sort((a, b) => a.verse - b.verse)
			.map((row) => String(row.text ?? "").replace(/ {2,}/g, " ").trim());
		nkjvCache.set(key, verses);
		return verses;
	} catch {
		throw new Error(CHAPTER_LOAD_ERROR);
	} finally {
		clearTimeout(timer);
	}
}

export async function getChapter(
	translation: TranslationId,
	order: number,
	chapter: number
): Promise<string[]> {
	if (translation === "BSB") return getBsbChapter(order, chapter).map(verse => verse.text);
	if (translation === "ASV" || translation === "RV1909" || translation === "LUT1912") {
		try {
			return getForeignBibleChapter(translation, order, chapter);
		} catch {
			throw new Error(CHAPTER_LOAD_ERROR);
		}
	}
	if (translation === "KJV") {
		try {
			return getKjvChapter(order, chapter);
		} catch {
			throw new Error(CHAPTER_LOAD_ERROR);
		}
	}
	return fetchNkjvChapter(order, chapter);
}
