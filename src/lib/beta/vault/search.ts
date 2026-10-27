import "server-only";

import { meaningSearch, refreshVaultIndex, type IndexStatus, type MeaningHit } from "@/lib/beta/vault/meaning";
import { parseVaultPassage, type VaultPassage } from "@/lib/beta/vault/passages";
import { READERS, type SourceQuery } from "@/lib/beta/vault/sources";
import {
	VAULT_KINDS,
	filterRange,
	fuseRankings,
	questionTerms,
	refsTouch,
	type VaultEntry,
	type VaultFilters,
	type VaultKind,
	type VaultMatch,
} from "@/lib/beta/vault/vault-rules";

/**
 * The Knowledge Vault's search (docs/beta/vault.md). With nothing typed it is
 * the library, newest first across every kind, a page at a time. With words
 * it is full-text plus meaning, fused by rank. A passage or topic narrows
 * either; on its own it lists everything on that passage or topic by date.
 */

export class VaultInputError extends Error {}

export interface VaultSearchResult {
	entries: VaultEntry[];
	/** Pass back as `before` for the next page; null when this is the last. */
	nextBefore: string | null;
	/** The passage the search was narrowed to, read back so the client can show it. */
	passage: VaultPassage | null;
	/** True when the words typed were themselves a passage ("John 3") and were searched as one. */
	queryWasPassage: boolean;
	mode: "library" | "search" | "filter";
	/** Meaning search's index, when it ran. */
	index: IndexStatus | null;
}

/** A Prisma or Postgres error's codes, never its message: messages can carry study text. */
export function errorTag(error: unknown): string {
	if (!(error instanceof Error)) return "UnknownError";
	const coded = error as Error & { code?: unknown; meta?: { code?: unknown } };
	return [error.name, typeof coded.code === "string" ? coded.code : null, typeof coded.meta?.code === "string" ? coded.meta.code : null].filter(Boolean).join(" ");
}

/** One kind that fails to read costs that kind, never the whole vault. */
export function readSafely(kind: VaultKind, query: SourceQuery): Promise<VaultEntry[]> {
	return READERS[kind](query).catch((error: unknown) => {
		console.error("[beta/vault] a reader failed", kind, errorTag(error));
		return [] as VaultEntry[];
	});
}

/** How many of each kind a word search reads before fusing. */
const PER_KIND = 18;

/** A query that is only a reference or a book ("John 3", "Romans 8:28", "Psalms") is a passage search. */
function passageInQuery(q: string): VaultPassage | null {
	if (!q || q.length > 30 || q.split(/\s+/).length > 4) return null;
	return parseVaultPassage(q);
}

export async function searchVault(userId: string, filters: VaultFilters, options: { meaning?: boolean } = {}): Promise<VaultSearchResult> {
	let passage = parseVaultPassage(filters.passage);
	if (filters.passage && !passage) throw new VaultInputError("That passage could not be read. Try a reference like John 3 or Romans 8:28.");
	let q = filters.q;
	let queryWasPassage = false;
	if (!passage) {
		const inQuery = passageInQuery(q);
		if (inQuery) {
			passage = inQuery;
			q = "";
			queryWasPassage = true;
		}
	}
	const kinds: readonly VaultKind[] = filters.kinds.length ? filters.kinds : VAULT_KINDS;
	const range = filterRange(filters);
	const needles = [...questionTerms(q, 8), ...(filters.topic ? [filters.topic] : []), ...(passage ? [passage.label] : [])];
	const base: Omit<SourceQuery, "limit"> = {
		userId,
		range,
		passage,
		topic: filters.topic,
		words: q ? { kind: "web", value: q } : null,
		needles: needles.length ? needles : q.split(/\s+/),
	};

	// Library and filter-only views: newest first, a page at a time.
	if (!q) {
		const lists = await Promise.all(kinds.map((kind) => readSafely(kind, { ...base, limit: filters.limit + 1 })));
		const merged = lists.flat().sort((a, b) => b.date.localeCompare(a.date));
		const entries = merged.slice(0, filters.limit);
		return {
			entries,
			nextBefore: merged.length > filters.limit ? entries[entries.length - 1]?.date ?? null : null,
			passage,
			queryWasPassage,
			mode: passage || filters.topic ? "filter" : "library",
			index: null,
		};
	}

	// Words and meaning, then fused.
	const index = options.meaning === false ? null : await refreshVaultIndex(userId).catch(() => null);
	const [wordLists, meaningHits] = await Promise.all([
		Promise.all(kinds.map((kind) => readSafely(kind, { ...base, limit: PER_KIND }))),
		options.meaning === false ? Promise.resolve([] as MeaningHit[]) : meaningSearch(userId, q, kinds, PER_KIND),
	]);
	const meaningEntries = await hydrateMeaning(base, meaningHits);
	return {
		entries: fuse(wordLists, meaningEntries, filters.limit),
		nextBefore: null,
		passage,
		queryWasPassage,
		mode: "search",
		index,
	};
}

/**
 * Meaning hits turned into entries through the same readers, so a hit outside
 * the date range, passage or topic is dropped exactly as a word hit would be.
 * The excerpt becomes the words that matched.
 */
export async function hydrateMeaning(base: Omit<SourceQuery, "limit">, hits: readonly MeaningHit[], options: { wholeChunk?: boolean } = {}): Promise<VaultEntry[][]> {
	const byKind = new Map<VaultKind, MeaningHit[]>();
	for (const hit of hits) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
	return Promise.all(
		[...byKind.entries()].map(async ([kind, list]) => {
			const entries = await readSafely(kind, { ...base, ids: list.map((hit) => hit.sourceId), limit: list.length });
			const byId = new Map(entries.map((entry) => [entry.sourceId, entry]));
			return list
				.map((hit): VaultEntry | null => {
					const entry = byId.get(hit.sourceId);
					if (!entry) return null;
					// The chat list reader cannot check a passage or topic in SQL; check the hit here instead.
					if (kind === "chat" && !chatHitFits(base, entry, hit.excerpt)) return null;
					const matched: VaultMatch[] = [...new Set([...(entry.matched ?? []).filter((m) => m !== "words"), "meaning" as const])];
					const words = options.wholeChunk ? hit.chunkText ?? hit.excerpt : hit.excerpt;
					return { ...entry, excerpt: words && kind !== "highlight" && kind !== "verse" ? words : entry.excerpt, matched };
				})
				.filter((entry): entry is VaultEntry => entry !== null);
		}),
	);
}

function chatHitFits(base: Omit<SourceQuery, "limit">, entry: VaultEntry, excerpt: string | null): boolean {
	if (base.passage && !refsTouch(entry.refs, base.passage.key)) return false;
	if (base.topic) {
		const words = `${entry.title} ${entry.excerpt} ${excerpt ?? ""}`.toLowerCase();
		if (!words.includes(base.topic)) return false;
	}
	return true;
}

/** Rank fusion over every list; an entry found by words and by meaning carries both marks. */
export function fuse(wordLists: readonly VaultEntry[][], meaningLists: readonly VaultEntry[][], limit: number): VaultEntry[] {
	const all = new Map<string, VaultEntry>();
	for (const entry of wordLists.flat()) all.set(entry.id, entry);
	for (const entry of meaningLists.flat()) {
		const seen = all.get(entry.id);
		all.set(entry.id, seen ? { ...seen, matched: [...new Set([...(seen.matched ?? []), ...(entry.matched ?? [])])] } : entry);
	}
	const scores = fuseRankings([...wordLists, ...meaningLists].map((list) => list.map((entry) => entry.id)));
	return [...all.values()]
		.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || b.date.localeCompare(a.date))
		.slice(0, limit);
}
