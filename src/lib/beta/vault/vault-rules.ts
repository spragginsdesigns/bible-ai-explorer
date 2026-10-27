/**
 * Pure rules for the Knowledge Vault (LC-17645, docs/beta/vault.md): the one
 * shape every study source is read into, the passage keys found in free text,
 * the filters a search carries, the time window a question names, how ranked
 * lists are fused, what an answer may cite, and the export's Markdown.
 *
 * No imports on purpose: `tests/beta-vault.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. Anything that needs
 * the Bible's book table takes a resolver from the caller instead.
 */

/** Every kind of study the Vault reads, in the order its filters list them. */
export const VAULT_KINDS = ["note", "highlight", "chat", "reading", "verse", "memory", "sermon", "study"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export const VAULT_KIND_LABEL: Record<VaultKind, string> = {
	note: "Note",
	highlight: "Highlight",
	chat: "Chat",
	reading: "Reading",
	verse: "Learning by heart",
	memory: "Memory",
	sermon: "Sermon study",
	study: "Beta study",
};

/** Plural labels for the filter chips. */
export const VAULT_KIND_PLURAL: Record<VaultKind, string> = {
	note: "Notes",
	highlight: "Highlights",
	chat: "Chats",
	reading: "Reading",
	verse: "Learning by heart",
	memory: "Memories",
	sermon: "Sermon studies",
	study: "Beta studies",
};

export function isVaultKind(value: unknown): value is VaultKind {
	return typeof value === "string" && (VAULT_KINDS as readonly string[]).includes(value);
}

/**
 * One thing studied, read in place from wherever SureWord keeps it. `id` is
 * `<kind>:<source id>` and stable; `href` opens it where it lives.
 */
export interface VaultEntry {
	id: string;
	kind: VaultKind;
	sourceId: string;
	title: string;
	/** A short passage of the source's own words, focused on the match when there is one. */
	excerpt: string;
	/** When it was studied (ISO): written, read, asked or last changed. */
	date: string;
	/** When it began, if different (a note first written, a chat first asked). */
	startedAt?: string | null;
	href: string;
	/** Passage keys, "<book>.<chapter>" and "<book>.<chapter>.<verse>", as the beta store writes them. */
	refs: string[];
	/** The passages it touches, in Bible order, each with a filter that finds everything on it. */
	passages: VaultPassageChip[];
	topics: string[];
	/** Beta items: the module that owns it, by registry slug. */
	module?: string;
	/** Kind-specific detail a card shows, already formatted ("Promises", "Known by heart"). */
	detail?: string | null;
	/** Notes: titles this note links to and titles linking here. */
	links?: { outgoing: string[]; incoming: string[] } | null;
	/** Why it matched a search: "words", "meaning", "passage", or several. */
	matched?: VaultMatch[];
}

export type VaultMatch = "words" | "meaning" | "passage" | "topic";

/**
 * One passage as a chip: what it reads ("Romans 8:28-30, 32") and what a tap
 * searches for. A label with several verses cannot be read back as one
 * reference, so the filter is the single verse when there is one, else the
 * chapter. "+3 more" has no filter.
 */
export interface VaultPassageChip {
	label: string;
	filter: string | null;
}

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

export interface VaultLocation {
	order: number;
	chapter: number;
	verse?: number;
}

/** The caller's reference parser (src/lib/bible/books.ts `resolveReference`). */
export type VaultResolver = (input: string) => VaultLocation | null;

/** A passage key, the same format as the beta store's `betaRefKey`. */
export function vaultRefKey(book: number, chapter: number, verse?: number): string {
	return verse === undefined ? `${book}.${chapter}` : `${book}.${chapter}.${verse}`;
}

const KEY_PATTERN = /^(\d{1,2})(?:\.(\d{1,3})(?:\.(\d{1,3}))?)?$/;

/** "45", "45.8" or "45.8.28" into its parts, or null. A bare book is a valid filter. */
export function parseVaultKey(key: string): { book: number; chapter?: number; verse?: number } | null {
	const match = KEY_PATTERN.exec(key.trim());
	if (!match) return null;
	const book = Number(match[1]);
	const chapter = match[2] === undefined ? undefined : Number(match[2]);
	const verse = match[3] === undefined ? undefined : Number(match[3]);
	if (book < 1 || book > 66 || chapter === 0 || verse === 0) return null;
	return { book, chapter, verse };
}

/** The most verses one written range ("Psalm 119:1-176") adds as verse keys. */
const RANGE_MAX = 176;

/**
 * Candidate references in prose: an optional leading 1-3, a book name (one
 * word, or "Song of Solomon"), a chapter, and optionally ":verse" and a range.
 * The resolver decides whether the name is a book at all. A colon after the
 * verse ("Romans 8:15: ye have received") ends it; only a colon followed by
 * a digit means the reference goes on.
 */
const CANDIDATE = /(?<![\w:])([1-3]\s?)?([A-Za-z][A-Za-z]+(?:\s+of\s+[A-Za-z]+)?)\.?\s?(\d{1,3})(?:\s?:\s?(\d{1,3})(?:\s?[-\u2013\u2014]\s?(\d{1,3})(?!\s?:\s?\d))?)?(?!\w|\s?:\s?\d)/g;

/**
 * Every passage key a piece of text mentions, de-duplicated in Bible order.
 * A verse brings its chapter key, and a range brings each verse in it, so
 * "Romans 8:28-30" matches a search for 8:29.
 *
 * A chapter-only mention ("Romans 8") must be written with a capital, so
 * "chapter 3" or "in 2 days" never reads as a passage; with a verse, any case
 * is accepted ("john 3:16"), because the colon is already a strong signal.
 */
export function scanPassageKeys(text: string, resolve: VaultResolver, limit = 400): string[] {
	if (!text) return [];
	const keys = new Map<string, [number, number, number]>();
	const add = (book: number, chapter: number, verse?: number) => {
		keys.set(vaultRefKey(book, chapter, verse), [book, chapter, verse ?? 0]);
	};
	for (const match of text.matchAll(CANDIDATE)) {
		if (keys.size >= limit) break;
		const [, digit, name, chapterText, verseText, endText] = match;
		if (verseText === undefined && !/^[A-Z]/.test(name)) continue;
		const place = `${chapterText}${verseText === undefined ? "" : `:${verseText}`}`;
		// "the Gospel of John 3:16": when "Gospel of John" is no book, the last word may be.
		const names = [`${digit ? `${digit.trim()} ` : ""}${name}`];
		if (/\sof\s/.test(name)) names.push(name.split(/\s+/).pop()!);
		const location = names.map((book) => resolve(`${book} ${place}`)).find((hit) => hit !== null) ?? null;
		if (!location) continue;
		add(location.order, location.chapter);
		if (location.verse === undefined) continue;
		add(location.order, location.chapter, location.verse);
		const end = endText === undefined ? undefined : Number(endText);
		if (end !== undefined && end > location.verse) {
			for (let verse = location.verse + 1; verse <= Math.min(end, location.verse + RANGE_MAX); verse++) {
				add(location.order, location.chapter, verse);
			}
		}
	}
	return [...keys.entries()]
		.sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[1][2] - b[1][2])
		.map(([key]) => key);
}

/** Keys from structured references ("John 3:16"), as chat answers store them. */
export function keysForReferences(references: readonly string[], resolve: VaultResolver): string[] {
	return scanPassageKeys(references.join("; "), resolve);
}

/**
 * Does an entry with these keys touch the passage? A book key matches any of
 * its chapters; a chapter key matches the chapter; a verse key matches the
 * verse, or a whole-chapter mention that names no verse in that chapter (a
 * note on "Romans 8" covers 8:28; a note on "Romans 8:1" does not).
 */
export function refsTouch(refs: readonly string[], passageKey: string): boolean {
	const target = parseVaultKey(passageKey);
	if (!target) return false;
	if (target.chapter === undefined) return refs.some((ref) => ref.startsWith(`${target.book}.`));
	const chapterKey = vaultRefKey(target.book, target.chapter);
	if (target.verse === undefined) return refs.includes(chapterKey);
	if (refs.includes(passageKey)) return true;
	if (!refs.includes(chapterKey)) return false;
	return !refs.some((ref) => ref.startsWith(`${chapterKey}.`));
}

/**
 * Readable labels for keys, collapsing verses into their chapter's runs:
 * ["45.8", "45.8.28", "45.8.29", "45.8.30"] -> ["Romans 8:28-30"]. A chapter
 * mentioned without verses reads as "Romans 8".
 */
export function passageLabels(refs: readonly string[], bookName: (order: number) => string | null, max = 6): string[] {
	return passageChips(refs, bookName, max).map((chip) => chip.label);
}

/** The same labels as chips that can be tapped (see `VaultPassageChip`). */
export function passageChips(refs: readonly string[], bookName: (order: number) => string | null, max = 6): VaultPassageChip[] {
	const chapters = new Map<string, { book: number; chapter: number; verses: number[] }>();
	for (const ref of refs) {
		const key = parseVaultKey(ref);
		if (!key || key.chapter === undefined) continue;
		const id = vaultRefKey(key.book, key.chapter);
		const entry = chapters.get(id) ?? { book: key.book, chapter: key.chapter, verses: [] };
		if (key.verse !== undefined) entry.verses.push(key.verse);
		chapters.set(id, entry);
	}
	const labels: VaultPassageChip[] = [];
	for (const { book, chapter, verses } of [...chapters.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter)) {
		const name = bookName(book);
		if (!name) continue;
		if (!verses.length) {
			labels.push({ label: `${name} ${chapter}`, filter: `${name} ${chapter}` });
			continue;
		}
		const sorted = [...new Set(verses)].sort((a, b) => a - b);
		const runs: string[] = [];
		let start = sorted[0];
		let prev = sorted[0];
		for (const verse of [...sorted.slice(1), Number.NaN]) {
			if (verse === prev + 1) {
				prev = verse;
				continue;
			}
			runs.push(start === prev ? `${start}` : `${start}-${prev}`);
			start = verse;
			prev = verse;
		}
		labels.push({ label: `${name} ${chapter}:${runs.join(", ")}`, filter: sorted.length === 1 ? `${name} ${chapter}:${sorted[0]}` : `${name} ${chapter}` });
	}
	return labels.length > max ? [...labels.slice(0, max), { label: `+${labels.length - max} more`, filter: null }] : labels;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const VAULT_QUERY_MAX = 200;
export const VAULT_TOPIC_MAX = 60;
export const VAULT_PASSAGE_MAX = 40;
export const VAULT_PAGE_SIZE = 30;
export const VAULT_PAGE_MAX = 60;

export interface VaultFilters {
	q: string;
	kinds: VaultKind[];
	/** Inclusive calendar days, "YYYY-MM-DD", read in UTC. */
	from: string | null;
	to: string | null;
	/** What the person typed ("John 3"), resolved separately. */
	passage: string | null;
	topic: string | null;
	/** Entries strictly older than this ISO instant (the next page). */
	before: string | null;
	limit: number;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string | null): value is string {
	if (!value || !DAY_PATTERN.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Filters from query parameters (or a JSON body read the same way), clamped and cleaned. */
export function parseVaultFilters(get: (name: string) => string | null | undefined): VaultFilters {
	const text = (name: string, max: number) => {
		const value = (get(name) ?? "").replace(/\s+/g, " ").trim();
		return value ? value.slice(0, max) : null;
	};
	const kinds = (get("kind") ?? "")
		.split(",")
		.map((kind) => kind.trim())
		.filter(isVaultKind);
	const from = text("from", 10);
	const to = text("to", 10);
	const before = text("before", 40);
	const limit = Number.parseInt(get("limit") ?? "", 10);
	return {
		q: text("q", VAULT_QUERY_MAX) ?? "",
		kinds: [...new Set(kinds)],
		from: isDay(from) ? from : null,
		to: isDay(to) ? to : null,
		passage: text("passage", VAULT_PASSAGE_MAX),
		topic: text("topic", VAULT_TOPIC_MAX)?.toLowerCase() ?? null,
		before: before && Number.isFinite(new Date(before).getTime()) ? new Date(before).toISOString() : null,
		limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), VAULT_PAGE_MAX) : VAULT_PAGE_SIZE,
	};
}

/** The instant range a filter's days cover: from midnight to the end of `to`. */
export function filterRange(filters: Pick<VaultFilters, "from" | "to" | "before">): { since: Date | null; until: Date | null } {
	const since = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
	let until = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
	if (filters.before) {
		const before = new Date(new Date(filters.before).getTime() - 1);
		if (!until || before < until) until = before;
	}
	return { since, until };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
	(
		"a an and are as at be been but by can did do does for from had has have how i if in into is it its me my " +
		"of on or our over so than that the their them then there these they this those to up was we were what " +
		"when where which who whom why will with would you your about across during since past last previous recent " +
		"recently ever all any some studied study studying studies learned learn learning learnt read reading notes " +
		"note wrote written say said tell show find look looked think thought month months week weeks year years day " +
		"days today yesterday one two three four five six seven eight nine ten eleven twelve few couple lately time " +
		"times bible scripture vault library january february march april may june july august september october " +
		"november december"
	).split(" "),
);

/**
 * The words of a question that carry its subject, for an OR full-text search:
 * "What have I studied about the Holy Spirit over the last six months?" ->
 * ["holy", "spirit"]. Lowercase letters and digits only, so the result is
 * safe to join into a `to_tsquery` without quoting.
 */
export function questionTerms(question: string, max = 8): string[] {
	const words = question
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
	return [...new Set(words)].slice(0, max);
}

/** A `to_tsquery` OR expression over prefix-matched terms, or null when there are none. */
export function orTsQuery(terms: readonly string[]): string | null {
	const safe = terms.map((term) => term.replace(/[^a-z0-9]/g, "")).filter(Boolean);
	return safe.length ? safe.map((term) => `${term}:*`).join(" | ") : null;
}

/** Collapse whitespace and cut to `max` characters at a word boundary. */
export function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const cut = flat.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A window of the text around the first place any term (or phrase) appears,
 * or its opening when none does. Case-insensitive; never longer than `max`.
 */
export function excerptAround(text: string, needles: readonly string[], max = 240): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const lower = flat.toLowerCase();
	let at = -1;
	for (const needle of needles) {
		const value = needle.toLowerCase().trim();
		if (value.length < 2) continue;
		const index = lower.indexOf(value);
		if (index >= 0 && (at < 0 || index < at)) at = index;
	}
	if (at < 0) return clip(flat, max);
	const start = Math.max(0, at - Math.floor(max / 3));
	const end = Math.min(flat.length, start + max);
	const from = start === 0 ? 0 : flat.indexOf(" ", start) + 1 || start;
	const body = flat.slice(from, end);
	const to = end === flat.length ? body.length : body.lastIndexOf(" ") > body.length * 0.6 ? body.lastIndexOf(" ") : body.length;
	return `${from > 0 ? "…" : ""}${body.slice(0, to).trim()}${end < flat.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// Time a question names
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
	a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
	eleven: 11, twelve: 12, few: 3, "couple of": 2, couple: 2, several: 3,
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30.4375, year: 365.25 };

export interface TimeWindow {
	since: Date | null;
	until: Date | null;
	/** How the window reads back: "the last 6 months", "2025", "since March". */
	label: string;
}

/**
 * The period a question asks about, read in UTC: "over the last six months",
 * "past 3 weeks", "this year", "since March", "in 2025", "yesterday". Null
 * when it names none, so the whole history is in scope.
 */
export function parseTimeWindow(question: string, now: Date): TimeWindow | null {
	const text = question.toLowerCase();
	const span = /\b(?:last|past|previous)\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple of|couple|several)?\s*(day|week|month|year)s?\b/.exec(text);
	if (span) {
		const count = span[1] === undefined ? 1 : /^\d+$/.test(span[1]) ? Number(span[1]) : NUMBER_WORDS[span[1]] ?? 1;
		if (count >= 1) {
			const since = new Date(now.getTime() - count * UNIT_DAYS[span[2]] * 86_400_000);
			return { since, until: null, label: `the last ${count === 1 ? span[2] : `${count} ${span[2]}s`}` };
		}
	}
	const startOf = (unit: "week" | "month" | "year") => {
		const d = new Date(Date.UTC(now.getUTCFullYear(), unit === "year" ? 0 : now.getUTCMonth(), unit === "week" ? now.getUTCDate() - now.getUTCDay() : 1));
		return d;
	};
	const current = /\bthis\s+(week|month|year)\b/.exec(text);
	if (current) return { since: startOf(current[1] as "week" | "month" | "year"), until: null, label: `this ${current[1]}` };
	if (/\btoday\b/.test(text)) {
		return { since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), until: null, label: "today" };
	}
	if (/\byesterday\b/.test(text)) {
		const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
		return { since, until: new Date(since.getTime() + 86_400_000 - 1), label: "yesterday" };
	}
	const sinceMonth = new RegExp(`\\bsince\\s+(${MONTHS.join("|")})\\b`).exec(text);
	if (sinceMonth) {
		const month = MONTHS.indexOf(sinceMonth[1]);
		const year = month > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
		return { since: new Date(Date.UTC(year, month, 1)), until: null, label: `since ${sinceMonth[1][0].toUpperCase()}${sinceMonth[1].slice(1)}` };
	}
	const year = /\b(?:in|during|from)\s+(20\d{2})\b/.exec(text);
	if (year) {
		const y = Number(year[1]);
		return { since: new Date(Date.UTC(y, 0, 1)), until: new Date(Date.UTC(y + 1, 0, 1) - 1), label: String(y) };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Reciprocal rank fusion: each list is ids best-first, and an id's score is
 * the sum of 1 / (k + rank) over the lists it appears in. Words and meaning
 * rank on different scales, so their ranks are what can be combined.
 */
export function fuseRankings(lists: readonly (readonly string[])[], k = 60): Map<string, number> {
	const scores = new Map<string, number>();
	for (const list of lists) {
		list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
	}
	return scores;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface AnswerPoint {
	text: string;
	/** 1-based numbers of the sources it rests on. */
	sources: number[];
}

/**
 * What a model's answer may keep: points that cite at least one real source,
 * with every citation in range, de-duplicated, and stray "[3]" or "[S3]"
 * markers taken out of the prose (the cards carry the citations). A point
 * with no valid source is dropped, because an uncited claim about someone's
 * own study history is exactly what this feature must never show.
 */
export function checkAnswerPoints(points: readonly { text?: unknown; sources?: unknown }[], sourceCount: number): AnswerPoint[] {
	const out: AnswerPoint[] = [];
	for (const point of points) {
		if (typeof point?.text !== "string") continue;
		const text = stripCitationMarks(point.text);
		if (!text) continue;
		const cited = Array.isArray(point.sources) ? point.sources : [];
		const sources = [...new Set(cited.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= sourceCount))].sort((a, b) => a - b);
		if (!sources.length) continue;
		out.push({ text, sources });
	}
	return out;
}

/**
 * Source numbers a model wrote into its prose ("[3]", "[S2, S4]", "(Sources 2,
 * 4 and 6)", "(source 1)"): the citation chips carry them, so the prose drops them.
 */
export function stripCitationMarks(text: string): string {
	return text
		.replace(/\s*\[(?:s|sources?\s*)?\d{1,3}(?:\s*,\s*(?:s|sources?\s*)?\d{1,3})*\]/gi, "")
		.replace(/\s*\((?:see\s+)?sources?\s*\d{1,3}(?:\s*(?:,|and|&)\s*\d{1,3})*\)/gi, "")
		.replace(/\s+([.,;:])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/** The model's note on what the sources do not show, or null when it says nothing is missing. */
export function cleanUncovered(text: unknown): string | null {
	if (typeof text !== "string") return null;
	const value = stripCitationMarks(text);
	if (!value || /^(?:none|n\/?a|null|nothing|no gaps?|nothing is missing)\.?$/i.test(value)) return null;
	return value;
}

/**
 * Chat answers are Markdown; an excerpt is plain prose. Quote markers,
 * emphasis, headings, list bullets, code ticks and link syntax go; the words
 * stay.
 */
export function plainMarkdown(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/gm, "")
		.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
		.replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/gm, "$1$2")
		.replace(/`/g, "");
}

// ---------------------------------------------------------------------------
// Continue where you left off
// ---------------------------------------------------------------------------

export type ResumeFeature = "reader" | "chat" | "note" | "learn" | "module";

export interface ResumeTarget {
	feature: ResumeFeature;
	/** "Continue reading", "Back to your chat". */
	action: string;
	title: string;
	detail: string | null;
	href: string;
	at: string;
	/** Beta items: the module slug. */
	module?: string;
}

/**
 * The single most recent study across features, then the latest of each
 * other feature (one per feature, and per beta module), newest first.
 */
export function pickResume(targets: readonly ResumeTarget[], others = 4): { primary: ResumeTarget | null; others: ResumeTarget[] } {
	const valid = targets.filter((target) => Number.isFinite(new Date(target.at).getTime()));
	const sorted = [...valid].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	const seen = new Set<string>();
	const latest: ResumeTarget[] = [];
	for (const target of sorted) {
		const key = target.feature === "module" ? `module:${target.module ?? ""}` : target.feature;
		if (seen.has(key)) continue;
		seen.add(key);
		latest.push(target);
	}
	return { primary: latest[0] ?? null, others: latest.slice(1, 1 + others) };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface VaultExport {
	exportedAt: string;
	notes: { id: string; title: string; createdAt: string; updatedAt: string; tags: string[]; linksTo: string[]; linkedFrom: string[]; text: string }[];
	highlights: { reference: string; translation: string; color: string; label: string | null; text: string | null; createdAt: string; updatedAt: string }[];
	chats: { id: string; title: string; createdAt: string; updatedAt: string; messages: { role: string; createdAt: string; text: string }[] }[];
	reading: { date: string; chapters: string[] }[];
	verses: { reference: string; translation: string; text: string | null; addedAt: string; lastReviewedAt: string | null; knownAt: string | null; dueAt: string }[];
	memories: { category: string; status: string | null; createdAt: string; updatedAt: string; text: string }[];
	sermons: { id: string; title: string; serviceDate: string | null; preacher: string | null; preachingText: string | null; bigIdea: string; summary: string; application: string }[];
	studies: { id: string; module: string; kind: string; title: string; createdAt: string; updatedAt: string; refs: string[]; topics: string[]; body: string | null; data: unknown }[];
	/** Sources that were cut at the export's caps, so the file says it is partial. */
	truncated: string[];
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function quoteBlock(text: string): string {
	return text
		.trim()
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/** The whole vault as one readable Markdown file. */
export function vaultMarkdown(data: VaultExport): string {
	const out: string[] = [`# My SureWord Knowledge Vault`, ``, `Exported ${data.exportedAt.slice(0, 16).replace("T", " ")} UTC.`];
	if (data.truncated.length) out.push(``, `This export stops at its size limits for: ${data.truncated.join(", ")}.`);
	const section = (title: string, count: number) => out.push(``, `## ${title} (${count})`);

	section("Notes", data.notes.length);
	for (const note of data.notes) {
		out.push(``, `### ${note.title}`, ``, `Written ${day(note.createdAt)}, last edited ${day(note.updatedAt)}.`);
		if (note.tags.length) out.push(`Tags: ${note.tags.join(", ")}.`);
		if (note.linksTo.length) out.push(`Links to: ${note.linksTo.map((title) => `[[${title}]]`).join(", ")}.`);
		if (note.linkedFrom.length) out.push(`Linked from: ${note.linkedFrom.map((title) => `[[${title}]]`).join(", ")}.`);
		if (note.text.trim()) out.push(``, note.text.trim());
	}

	section("Highlights", data.highlights.length);
	for (const h of data.highlights) {
		out.push(``, `- **${h.reference}** (${h.translation}${h.label ? `, ${h.label}` : ""}), ${day(h.updatedAt)}${h.text ? `: ${h.text}` : ""}`);
	}

	section("Chats", data.chats.length);
	for (const chat of data.chats) {
		out.push(``, `### ${chat.title}`, ``, `Started ${day(chat.createdAt)}.`);
		for (const message of chat.messages) {
			out.push(``, `**${message.role === "user" ? "You" : "SureWord"}** (${day(message.createdAt)})`, ``, message.role === "user" ? quoteBlock(message.text) : message.text.trim());
		}
	}

	section("Reading", data.reading.length);
	for (const r of data.reading) out.push(`- ${r.date}: ${r.chapters.join(", ")}`);

	section("Learning by heart", data.verses.length);
	for (const v of data.verses) {
		const state = v.knownAt ? `known by heart since ${day(v.knownAt)}` : `due ${day(v.dueAt)}`;
		out.push(`- **${v.reference}** (${v.translation}), added ${day(v.addedAt)}, ${state}${v.text ? `: ${v.text}` : ""}`);
	}

	section("Memories", data.memories.length);
	for (const m of data.memories) out.push(`- (${m.category}${m.status ? `, ${m.status}` : ""}) ${m.text.trim()} [${day(m.updatedAt)}]`);

	section("Sermon studies", data.sermons.length);
	for (const s of data.sermons) {
		out.push(``, `### ${s.title}`, ``, [s.serviceDate && `Preached ${s.serviceDate}`, s.preacher && `by ${s.preacher}`, s.preachingText && `on ${s.preachingText}`].filter(Boolean).join(" ") + ".");
		out.push(``, `Big idea: ${s.bigIdea.trim()}`, ``, s.summary.trim(), ``, `Application: ${s.application.trim()}`);
	}

	section("Beta studies", data.studies.length);
	for (const item of data.studies) {
		out.push(``, `### ${item.title}`, ``, `${item.module} / ${item.kind}, created ${day(item.createdAt)}, last changed ${day(item.updatedAt)}.`);
		if (item.topics.length) out.push(`Topics: ${item.topics.join(", ")}.`);
		if (item.body?.trim()) out.push(``, item.body.trim());
	}
	return `${out.join("\n")}\n`;
}
