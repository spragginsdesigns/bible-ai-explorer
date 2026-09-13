/**
 * Verses SureWord suggests you learn.
 *
 * Two signals, and a verse needs both. WEIGHT is objective and identical for
 * everyone: how many inbound cross-references a verse carries in the bundled
 * corpus, precomputed by scripts/build-verse-significance.mjs. NEARNESS is
 * personal: the verse is one they marked, read, asked about, carried as their
 * cross, or quoted in a note. Weight alone never qualifies a verse, because
 * "famous" is not the same as "yours"; nearness alone never qualifies one
 * either, because a verse nothing else in Scripture leans on is a poor use of
 * the weeks it takes to learn something by heart.
 *
 * The ranking is pure and lives at the top of this file so it can be tested
 * without a database. The Prisma reads below only gather signals for it.
 *
 * Every reason must be true of stored data. The one place the product is
 * allowed to speak without a personal signal is the fallback, and it says so
 * in the reason itself rather than dressing a generic pick up as intimacy.
 */
import verseSignificanceFile from "@/data/learn/verse-significance.json";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import type { TranslationId } from "@/lib/bible/translations";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { formatLearnReference, learnTimezone, learnVerseText } from "@/lib/learn";
import { highlightLabelFor, type HighlightLabels } from "@/lib/preferences-contract";
import { prisma } from "@/lib/prisma";
import { recentReadingChapters } from "@/lib/reading-log";
import { parseVerseReferences } from "@/utils/verseParser";

/** Where the nearness came from, in the contract's own vocabulary. */
export type SuggestionSource = "highlight" | "reading" | "chat" | "cross" | "note";

/**
 * Strongest first. This is the contract's priority order, and it outranks
 * recency: a verse the user marked with their own hand says more about what
 * they are carrying than a verse that happened to be quoted back at them in a
 * chat an hour ago. Recency only separates two signals of the same kind.
 */
const SOURCE_RANK: Record<SuggestionSource, number> = {
	highlight: 5,
	reading: 4,
	chat: 3,
	cross: 2,
	note: 1,
};

/**
 * Inbound cross-references at or above which the reason may say so out loud.
 * Set at the 95th percentile of the index (40), so the clause is a real claim
 * about a load-bearing verse rather than a number stapled to every card.
 */
export const HIGH_WEIGHT = 40;

/** The most the endpoint ever returns, per the contract. */
export const MAX_SUGGESTIONS = 5;

/**
 * How many suggestions one kind of signal may take before the rest of the
 * user's walk gets a turn. Without it an account with a page of highlights
 * gets five cards that all say "you marked this", which reads like a list of
 * highlights rather than like the product noticing anything. The cap is a
 * first pass only: if the other signals cannot fill the screen, the strongest
 * remaining candidates do, so a user who only ever highlights still gets five.
 */
const SOURCE_CAP = 2;

export interface VerseSignal {
	source: SuggestionSource;
	/** Canonical book order, 1-66. */
	book: number;
	chapter: number;
	/** Absent for a reading signal: the reader logs chapters, not verses. */
	verse?: number;
	at: Date;
	/** Preset colour name for a highlight ("Blue"), null for a custom hex. */
	colorName?: string | null;
	/** What this user calls that colour ("Promises"), when they have named it. */
	colorLabel?: string;
	/** Conversation title for a chat signal, note title for a note signal. */
	title?: string;
}

export interface RankedSuggestion {
	book: number;
	chapter: number;
	verse: number;
	weight: number;
	source: SuggestionSource;
	reason: string;
}

/** The weight index, as the ranking sees it. */
export interface VerseWeights {
	/** Inbound cross-references for one verse; 0 when it is not in the index. */
	of(book: number, chapter: number, verse: number): number;
	/** Verses of one chapter that carry weight, heaviest first. */
	chapter(book: number, chapter: number): { verse: number; weight: number }[];
}

export interface VerseSignificanceFile {
	/** The threshold the index was built at; verses below it are absent. */
	minCount: number;
	/** "book:chapter:verse" to inbound cross-reference count. */
	verses: Record<string, number>;
}

export function verseKey(book: number, chapter: number, verse: number): string {
	return `${book}:${chapter}:${verse}`;
}

/** Wrap a significance file as a weight index, grouping chapters on demand. */
export function createVerseWeights(file: VerseSignificanceFile): VerseWeights {
	const chapters = new Map<string, { verse: number; weight: number }[]>();
	return {
		of(book, chapter, verse) {
			return file.verses[verseKey(book, chapter, verse)] ?? 0;
		},
		chapter(book, chapter) {
			const key = `${book}:${chapter}`;
			const cached = chapters.get(key);
			if (cached) return cached;
			const prefix = `${key}:`;
			const verses: { verse: number; weight: number }[] = [];
			for (const [entry, weight] of Object.entries(file.verses)) {
				if (!entry.startsWith(prefix)) continue;
				verses.push({ verse: Number(entry.slice(prefix.length)), weight });
			}
			verses.sort((a, b) => b.weight - a.weight || a.verse - b.verse);
			chapters.set(key, verses);
			return verses;
		},
	};
}

let bundled: VerseWeights | null = null;

/** The index that ships with the app. Built once per process. */
export function bundledVerseWeights(): VerseWeights {
	// The JSON is a data file, not a typed module; its shape is pinned by
	// tests/learn-suggestions.test.mjs against the generated file itself.
	bundled ??= createVerseWeights(verseSignificanceFile as VerseSignificanceFile);
	return bundled;
}

function localParts(at: Date, timezone: string | null | undefined) {
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone ?? undefined,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const parts = formatter.formatToParts(at);
	const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
	return { year: pick("year"), month: pick("month"), day: pick("day") };
}

function dayKey(at: Date, timezone: string | null | undefined): string {
	const { year, month, day } = localParts(at, timezone);
	return `${year}-${month}-${day}`;
}

/**
 * "today", "yesterday", "on Tuesday" inside the last week, and "on 3
 * September" beyond it, with the year added once the date is in another year.
 * Days are counted in the user's own zone, so a verse marked at 11pm is still
 * "today" to them at midnight.
 */
export function describeWhen(at: Date, now: Date, timezone?: string | null): string {
	const then = dayKey(at, timezone);
	const today = dayKey(now, timezone);
	if (then === today) return "today";

	const daysApart = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${then}T00:00:00Z`)) / 86_400_000);
	if (daysApart === 1) return "yesterday";
	if (daysApart > 1 && daysApart < 7) {
		return `on ${new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? undefined, weekday: "long" }).format(at)}`;
	}
	const sameYear = localParts(at, timezone).year === localParts(now, timezone).year;
	const date = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone ?? undefined,
		day: "numeric",
		month: "long",
		...(sameYear ? {} : { year: "numeric" }),
	}).format(at);
	return `on ${date}`;
}

function bookName(book: number): string {
	return bookByOrder(book)?.name ?? String(book);
}

/** The weight half of the reason, when the verse is heavy enough to earn it. */
function weightClause(weight: number): string {
	return weight >= HIGH_WEIGHT ? `, and Scripture points back to it ${weight} times.` : ".";
}

/**
 * One plain sentence naming why this verse was chosen. Every branch states
 * something the caller has already read out of the database; nothing here
 * infers a feeling, a habit, or an intention the user never recorded.
 */
export function suggestionReason(
	signal: VerseSignal,
	weight: number,
	now: Date,
	timezone?: string | null,
): string {
	const when = describeWhen(signal.at, now, timezone);
	let base: string;
	switch (signal.source) {
		case "highlight": {
			const hue = signal.colorName?.toLowerCase();
			base = !hue
				? `You highlighted this ${when}`
				: signal.colorLabel
					? `You marked this in ${hue} for ${signal.colorLabel} ${when}`
					: `You marked this in ${hue} ${when}`;
			break;
		}
		case "reading":
			base = `You read ${bookName(signal.book)} ${signal.chapter} ${when}`;
			break;
		case "chat":
			base = signal.title
				? `This came up in your chat "${signal.title}" ${when}`
				: `This came up in a chat you had ${when}`;
			break;
		case "cross":
			base = when === "today" ? "This is your cross today" : `This was your cross ${when}`;
			break;
		case "note":
			base = signal.title
				? `You quoted it in your note "${signal.title}" ${when}`
				: `You quoted it in one of your notes ${when}`;
			break;
	}
	return `${base}${weightClause(weight)}`;
}

/**
 * What the fallback says, word for word: no personal signal, so this is the
 * heaviest verse of the last chapter they read, and the card admits it.
 */
export function fallbackReason(book: number, chapter: number, weight: number): string {
	return (
		`You have no recent marks or reading to go on, so this is one of the verses the rest of ` +
		`Scripture leans on most in ${bookName(book)} ${chapter}, the last chapter you read` +
		weightClause(weight)
	);
}

/** How many verses of a read chapter are offered to the ranking. */
const READING_CANDIDATES = 3;

/**
 * The weight a verse must carry to be suggested off a reading signal alone.
 *
 * Every other signal names the verse itself, so being in the index at all is
 * evidence enough. Reading names only the chapter, and the heaviest verse of a
 * narrative chapter is often just the most cross-referenced piece of the story:
 * the corpus points at Job 1:3, the inventory of Job's livestock, about as
 * often as it points at Job 1:21. Asking for a genuinely load-bearing verse is
 * what keeps "you read this chapter" from putting a sheep count on a memory
 * card. The weaker the nearness, the stronger the weight has to be.
 */
const READING_MIN_WEIGHT = HIGH_WEIGHT;

interface Candidate {
	book: number;
	chapter: number;
	verse: number;
	weight: number;
	signal: VerseSignal;
}

export interface RankInput {
	signals: readonly VerseSignal[];
	weights: VerseWeights;
	/** "book:chapter:verse" already in the user's Learn queue, at any stage. */
	excluded: ReadonlySet<string>;
	/** The newest chapter the user ever read, for the no-signal fallback. */
	lastChapterRead?: { book: number; chapter: number } | null;
	now: Date;
	timezone?: string | null;
	limit?: number;
}

/**
 * Rank the signals into at most `limit` suggestions.
 *
 * Order is source strength, then the day the signal happened (newer first),
 * then weight, then the reference, so the same account and the same day always
 * produce the same list. Duplicates collapse to their strongest signal, and
 * only one verse per chapter survives, because five cards out of one chapter
 * is a reading plan, not a memory queue. Filling the five then runs twice:
 * once holding each source to SOURCE_CAP so the screen spans the user's week,
 * and once more without the cap so an account with only one kind of signal
 * still gets a full screen.
 */
export function rankSuggestions(input: RankInput): RankedSuggestion[] {
	const { signals, weights, excluded, now, timezone } = input;
	const limit = input.limit ?? MAX_SUGGESTIONS;

	const candidates: Candidate[] = [];
	for (const signal of signals) {
		if (signal.verse === undefined) {
			const heaviest = weights
				.chapter(signal.book, signal.chapter)
				.filter(({ weight }) => weight >= READING_MIN_WEIGHT)
				.slice(0, READING_CANDIDATES);
			for (const { verse, weight } of heaviest) {
				candidates.push({ book: signal.book, chapter: signal.chapter, verse, weight, signal });
			}
			continue;
		}
		const weight = weights.of(signal.book, signal.chapter, signal.verse);
		// Weight of zero means the verse is below the index threshold: near to
		// this user, but not load-bearing enough to ask them to memorise it.
		if (weight === 0) continue;
		candidates.push({ book: signal.book, chapter: signal.chapter, verse: signal.verse, weight, signal });
	}

	const best = new Map<string, Candidate>();
	for (const candidate of candidates) {
		const key = verseKey(candidate.book, candidate.chapter, candidate.verse);
		if (excluded.has(key)) continue;
		const held = best.get(key);
		if (!held || compareCandidates(candidate, held, timezone) < 0) best.set(key, candidate);
	}

	const ordered = [...best.values()].sort((a, b) => compareCandidates(a, b, timezone));
	const chosen: Candidate[] = [];
	const usedChapters = new Set<string>();
	const perSource = new Map<SuggestionSource, number>();

	const take = (candidate: Candidate) => {
		const chapterKey = `${candidate.book}:${candidate.chapter}`;
		if (usedChapters.has(chapterKey)) return;
		usedChapters.add(chapterKey);
		perSource.set(candidate.signal.source, (perSource.get(candidate.signal.source) ?? 0) + 1);
		chosen.push(candidate);
	};

	for (const candidate of ordered) {
		if (chosen.length >= limit) break;
		if ((perSource.get(candidate.signal.source) ?? 0) >= SOURCE_CAP) continue;
		take(candidate);
	}
	// Second pass: the cap was about variety, not about leaving the screen half
	// empty, so anything still unused now competes on rank alone.
	for (const candidate of ordered) {
		if (chosen.length >= limit) break;
		if (chosen.includes(candidate)) continue;
		take(candidate);
	}

	if (chosen.length > 0) {
		return chosen.map((candidate) => ({
			book: candidate.book,
			chapter: candidate.chapter,
			verse: candidate.verse,
			weight: candidate.weight,
			source: candidate.signal.source,
			reason: suggestionReason(candidate.signal, candidate.weight, now, timezone),
		}));
	}

	return fallbackSuggestions(input, limit);
}

/** The heaviest verses of the last chapter they read, labelled as exactly that. */
function fallbackSuggestions(input: RankInput, limit: number): RankedSuggestion[] {
	const anchor = input.lastChapterRead;
	if (!anchor) return [];
	return input.weights
		.chapter(anchor.book, anchor.chapter)
		.filter(({ verse }) => !input.excluded.has(verseKey(anchor.book, anchor.chapter, verse)))
		.slice(0, limit)
		.map(({ verse, weight }) => ({
			book: anchor.book,
			chapter: anchor.chapter,
			verse,
			weight,
			source: "reading" as const,
			reason: fallbackReason(anchor.book, anchor.chapter, weight),
		}));
}

function compareCandidates(a: Candidate, b: Candidate, timezone: string | null | undefined): number {
	const rank = SOURCE_RANK[b.signal.source] - SOURCE_RANK[a.signal.source];
	if (rank !== 0) return rank;
	const day = dayKey(b.signal.at, timezone).localeCompare(dayKey(a.signal.at, timezone));
	if (day !== 0) return day;
	if (a.weight !== b.weight) return b.weight - a.weight;
	return (
		a.book - b.book ||
		a.chapter - b.chapter ||
		a.verse - b.verse
	);
}

/* ---------------------------------------------------------------------- */
/* The database half: gathering the signals the ranking above consumes.    */
/* ---------------------------------------------------------------------- */

/** A chapter read this recently still counts as part of the user's walk. */
const READING_WINDOW_DAYS = 30;
const HIGHLIGHT_SCAN = 40;
const READING_SCAN = 120;
const CHAT_SCAN = 40;
const CROSS_SCAN = 30;
const NOTE_SCAN = 20;
/** Verses from one tool result. A whole-chapter pull must not drown the rest. */
const CHAT_VERSES_PER_MESSAGE = 12;
/** Enough of a note to catch the passages it is built on, without loading a book. */
const NOTE_CHARS = 20_000;

function logFailure(what: string): (error: unknown) => null {
	return (error: unknown) => {
		console.error(`[learn-suggestions] ${what} failed; continuing without it:`, error);
		return null;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "John 3:16" to coordinates, or null when it is not a single resolvable verse. */
function locate(reference: string): { book: number; chapter: number; verse: number } | null {
	const resolved = resolveReference(reference);
	if (!resolved || resolved.verse === undefined) return null;
	return { book: resolved.order, chapter: resolved.chapter, verse: resolved.verse };
}

/** Every `verses[].reference` carried by the tool parts of one assistant message. */
export function toolVerseReferences(metadata: unknown): string[] {
	if (!isRecord(metadata) || !Array.isArray(metadata.parts)) return [];
	const references: string[] = [];
	for (const part of metadata.parts) {
		if (!isRecord(part) || !isRecord(part.output)) continue;
		const verses = part.output.verses;
		if (!Array.isArray(verses)) continue;
		for (const verse of verses) {
			if (references.length >= CHAT_VERSES_PER_MESSAGE) return references;
			if (isRecord(verse) && typeof verse.reference === "string") references.push(verse.reference);
		}
	}
	return references;
}

export interface LearnSignalContext {
	signals: VerseSignal[];
	lastChapterRead: { book: number; chapter: number } | null;
	excluded: Set<string>;
	timezone: string | null;
}

/**
 * Read every personal signal for one user. Each read fails soft: a suggestion
 * list missing its notes is still a useful screen, an error page is not.
 */
export async function loadLearnSignals(
	userId: string,
	now: Date,
	labels: HighlightLabels = {},
): Promise<LearnSignalContext> {
	const since = new Date(now.getTime() - READING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

	const [timezone, highlights, reading, messages, crosses, notes, queued] = await Promise.all([
		learnTimezone(userId).catch(logFailure("Timezone lookup")),
		prisma.verseHighlight
			.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: HIGHLIGHT_SCAN,
				select: { book: true, chapter: true, verse: true, color: true, updatedAt: true },
			})
			.catch(logFailure("Highlight lookup")),
		recentReadingChapters(userId, since, READING_SCAN).catch(logFailure("Recent reading lookup")),
		prisma.message
			.findMany({
				where: { role: "assistant", conversation: { userId } },
				orderBy: { createdAt: "desc" },
				take: CHAT_SCAN,
				select: { createdAt: true, metadata: true, conversation: { select: { title: true } } },
			})
			.catch(logFailure("Chat citation lookup")),
		prisma.verseOfDay
			.findMany({
				where: { userId },
				orderBy: { sentAt: "desc" },
				take: CROSS_SCAN,
				select: { book: true, chapter: true, verse: true, sentAt: true },
			})
			.catch(logFailure("Daily cross lookup")),
		prisma.note
			.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: NOTE_SCAN,
				select: { title: true, plainText: true, updatedAt: true },
			})
			.catch(logFailure("Note lookup")),
		prisma.verseMemory
			.findMany({ where: { userId }, select: { book: true, chapter: true, verse: true } })
			.catch(logFailure("Learn queue lookup")),
	]);

	const signals: VerseSignal[] = [];

	for (const highlight of highlights ?? []) {
		const preset = HIGHLIGHT_COLORS.find(
			(color) => color.hex.toLowerCase() === highlight.color.trim().toLowerCase(),
		);
		const colorName = preset?.name ?? null;
		const colorLabel = highlightLabelFor(labels, colorName);
		signals.push({
			source: "highlight",
			book: highlight.book,
			chapter: highlight.chapter,
			verse: highlight.verse,
			at: highlight.updatedAt,
			colorName,
			...(colorLabel ? { colorLabel } : {}),
		});
	}

	// recentReadingChapters reports the book by name, and it merges the legacy
	// ReadingEvent rows in for accounts that were never backfilled.
	for (const entry of reading ?? []) {
		const located = resolveReference(`${entry.book} ${entry.chapter}:1`);
		if (!located) continue;
		signals.push({ source: "reading", book: located.order, chapter: entry.chapter, at: entry.readAt });
	}

	for (const message of messages ?? []) {
		const title = message.conversation?.title?.trim();
		for (const reference of toolVerseReferences(message.metadata)) {
			const located = locate(reference);
			if (!located) continue;
			signals.push({
				source: "chat",
				...located,
				at: message.createdAt,
				...(title ? { title } : {}),
			});
		}
	}

	for (const cross of crosses ?? []) {
		const located = locate(`${cross.book} ${cross.chapter}:${cross.verse}`);
		if (!located) continue;
		signals.push({ source: "cross", ...located, at: cross.sentAt });
	}

	for (const note of notes ?? []) {
		const title = note.title.trim();
		const seen = new Set<string>();
		for (const segment of parseVerseReferences(note.plainText.slice(0, NOTE_CHARS))) {
			if (segment.type !== "verse-ref") continue;
			const located = locate(segment.value);
			if (!located) continue;
			const key = verseKey(located.book, located.chapter, located.verse);
			if (seen.has(key)) continue;
			seen.add(key);
			signals.push({ source: "note", ...located, at: note.updatedAt, ...(title ? { title } : {}) });
		}
	}

	let lastChapterRead: { book: number; chapter: number } | null = null;
	const newestRead = (reading ?? [])[0];
	if (newestRead) {
		const located = resolveReference(`${newestRead.book} ${newestRead.chapter}:1`);
		if (located) lastChapterRead = { book: located.order, chapter: newestRead.chapter };
	} else {
		// Nothing inside the window, so reach back for the anchor the fallback
		// needs. One row, and only for an account that has gone quiet.
		const older = await recentReadingChapters(userId, new Date(0), 1).catch(logFailure("Last reading lookup"));
		const entry = (older ?? [])[0];
		const located = entry ? resolveReference(`${entry.book} ${entry.chapter}:1`) : null;
		if (entry && located) lastChapterRead = { book: located.order, chapter: entry.chapter };
	}

	return {
		signals,
		lastChapterRead,
		excluded: new Set((queued ?? []).map((card) => verseKey(card.book, card.chapter, card.verse))),
		timezone: timezone ?? null,
	};
}

/** One suggestion as the clients render it. */
export interface LearnSuggestion {
	book: number;
	chapter: number;
	verse: number;
	reference: string;
	text: string;
	reason: string;
	weight: number;
	source: SuggestionSource;
}

/**
 * The suggestions for one user, text resolved in their translation. A verse
 * whose text cannot be resolved is dropped rather than shipped blank: a card
 * with no words on it is nothing to learn.
 */
export async function suggestVerses(
	userId: string,
	translation: TranslationId,
	labels: HighlightLabels = {},
	now: Date = new Date(),
): Promise<LearnSuggestion[]> {
	const context = await loadLearnSignals(userId, now, labels);
	const ranked = rankSuggestions({
		signals: context.signals,
		weights: bundledVerseWeights(),
		excluded: context.excluded,
		lastChapterRead: context.lastChapterRead,
		now,
		timezone: context.timezone,
	});

	const withText = await Promise.all(
		ranked.map(async (suggestion) => {
			const text = await learnVerseText(translation, suggestion.book, suggestion.chapter, suggestion.verse);
			if (!text) return null;
			return {
				...suggestion,
				reference: formatLearnReference(suggestion.book, suggestion.chapter, suggestion.verse),
				text,
			};
		}),
	);
	return withText.filter((suggestion): suggestion is LearnSuggestion => suggestion !== null);
}
