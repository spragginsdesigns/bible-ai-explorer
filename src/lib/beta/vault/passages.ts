import { bookByOrder, foldAccents, LOCALIZED_BOOK_NAMES, resolveReference } from "@/lib/bible/books";
import {
	passageChips,
	passageLabels,
	scanPassageKeys,
	vaultRefKey,
	type VaultLocation,
	type VaultPassageChip,
} from "@/lib/beta/vault/vault-rules";

/**
 * The Knowledge Vault's view of the Bible's book table: the resolver the pure
 * rules take, readable passage labels, and the passage a person typed into
 * the filter ("John 3", "Romans 8:28", or just "Romans").
 */

export function resolveVaultReference(input: string): VaultLocation | null {
	const ref = resolveReference(input);
	return ref ? { order: ref.order, chapter: ref.chapter, verse: ref.verse } : null;
}

export function vaultBookName(order: number): string | null {
	return bookByOrder(order)?.name ?? null;
}

export function scanText(text: string): string[] {
	return scanPassageKeys(text, resolveVaultReference);
}

export function labelsFor(refs: readonly string[], max = 6): string[] {
	return passageLabels(refs, vaultBookName, max);
}

export function chipsFor(refs: readonly string[], max = 6): VaultPassageChip[] {
	return passageChips(refs, vaultBookName, max);
}

export interface VaultPassage {
	/** "45" (a book), "45.8" (a chapter) or "45.8.28" (a verse). */
	key: string;
	label: string;
	book: number;
	chapter?: number;
	verse?: number;
}

/** A passage the person typed, or null when it names none. */
export function parseVaultPassage(input: string | null | undefined): VaultPassage | null {
	const text = (input ?? "").trim();
	if (!text) return null;
	// The keys themselves, as entry chips link them ("45.8").
	const keyMatch = /^(\d{1,2})(?:\.(\d{1,3})(?:\.(\d{1,3}))?)?$/.exec(text);
	if (keyMatch) {
		const book = bookByOrder(Number(keyMatch[1]));
		const chapter = keyMatch[2] === undefined ? undefined : Number(keyMatch[2]);
		const verse = keyMatch[3] === undefined ? undefined : Number(keyMatch[3]);
		if (!book || (chapter !== undefined && (chapter < 1 || chapter > book.chapters)) || verse === 0) return null;
		return toPassage(book.order, chapter, verse);
	}
	const ref = resolveReference(text);
	if (ref) return toPassage(ref.order, ref.chapter, ref.verse);
	// A bare book: it resolves once a chapter is added, and it ends in no number.
	if (!/\d$/.test(text)) {
		const asBook = resolveReference(`${text} 1`);
		if (asBook) return toPassage(asBook.order);
	}
	return null;
}

function toPassage(book: number, chapter?: number, verse?: number): VaultPassage | null {
	const name = vaultBookName(book);
	if (!name) return null;
	if (chapter === undefined) return { key: String(book), label: name, book };
	if (verse === undefined) return { key: vaultRefKey(book, chapter), label: `${name} ${chapter}`, book, chapter };
	return { key: vaultRefKey(book, chapter, verse), label: `${name} ${chapter}:${verse}`, book, chapter, verse };
}

/** Short forms people write that books.json does not carry (mirrors books.ts). */
const EXTRA_NAMES: Record<number, string[]> = {
	2: ["exod"],
	19: ["psalm"],
	21: ["eccles"],
	22: ["song of songs"],
	31: ["ob"],
	41: ["mk"],
	42: ["lk"],
	43: ["jn"],
	56: ["tit"],
	62: ["1 jn"],
	63: ["2 jn"],
	64: ["3 jn"],
};

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A Postgres `~*` pattern that any text mentioning the passage must match:
 * the book's name or a short form, then its chapter. Only a cheap prefilter;
 * `scanText` and `refsTouch` decide the match.
 */
export function passagePrefilter(passage: VaultPassage): string {
	const book = bookByOrder(passage.book);
	// Every name the reference scan accepts, Spanish and German included ("Juan 3:16"),
	// so the prefilter never drops a row the scan would keep.
	const localized = LOCALIZED_BOOK_NAMES.filter(([, order]) => order === passage.book).flatMap(([name]) => [name, foldAccents(name)]);
	const names = [book?.name ?? "", book?.abbr ?? "", ...(EXTRA_NAMES[passage.book] ?? []), ...localized]
		.map((name) => name.toLowerCase().replace(/\.$/, "").trim())
		.filter(Boolean);
	const alternatives = [...new Set(names)].map((name) => escapeRegex(name).replace(/\s+/g, "\\s*")).join("|");
	const chapter = passage.chapter === undefined ? "\\d" : `${passage.chapter}\\M`;
	return `\\m(?:${alternatives})\\.?\\s*${chapter}`;
}
