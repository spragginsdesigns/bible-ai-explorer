/**
 * The Learn a verse ladder: pure scheduling and masking, no Prisma and no
 * network, so tests/learn-schedule.test.mjs can drive day boundaries directly
 * and every client can port the same rules.
 *
 * Days are the user's calendar days, not 24-hour buckets, for the same reason
 * the reading streak uses them: "due tomorrow" has to mean what it means on the
 * user's wall clock. The day helpers are reused from reading-history so there
 * is one definition of a local day in the codebase.
 *
 * maskVerse returns the shape every client renders:
 *
 *   { stage, words: [{ index, word, prefix, body, suffix, hidden }] }
 *
 * `words` is the verse split on whitespace, in order. For each word `prefix` is
 * the leading punctuation, `suffix` the trailing punctuation and `body` what is
 * left between them, so `word === prefix + body + suffix` always holds. Render
 * `prefix` and `suffix` as text always; render `body` as a blank the reader can
 * tap to reveal when `hidden` is true, and as text when it is false. A token
 * that is punctuation only has an empty `body` and is never hidden.
 */
import { localDayKey, resolveReadingTimezone, shiftDayKey } from "@/lib/reading-history";

/** How many cards one day's session holds, at most. */
export const LEARN_DAILY_LIMIT = 3;

/** The interval at which a verse counts as known, once and for good. */
export const LEARN_KNOWN_INTERVAL_DAYS = 16;

/** Stage 3 is the last rung: the whole verse from the reference alone. */
export const LEARN_MAX_STAGE = 3;

export type LearnStage = 0 | 1 | 2 | 3;

export type LearnResult = "again" | "good";

/** What the ladder reads off a stored card. */
export interface LearnScheduleState {
	stage: number;
	intervalDays: number;
	knownAt: Date | null;
}

/** What one review writes back. */
export interface LearnScheduleUpdate {
	stage: LearnStage;
	intervalDays: number;
	dueAt: Date;
	lastReviewedAt: Date;
	knownAt: Date | null;
}

export interface MaskedWord {
	/** Position in the whitespace split, which is what the ladder counts on. */
	index: number;
	/** The token exactly as it appears in the verse. */
	word: string;
	/** Leading punctuation, always visible. */
	prefix: string;
	/** The maskable part of the token. Empty for a punctuation-only token. */
	body: string;
	/** Trailing punctuation, always visible, so "world:" becomes a blank plus ":". */
	suffix: string;
	/** True when `body` renders as a blank until the reader taps it. */
	hidden: boolean;
}

export interface MaskedVerse {
	stage: LearnStage;
	words: MaskedWord[];
}

export function isLearnResult(value: unknown): value is LearnResult {
	return value === "again" || value === "good";
}

/** Clamp whatever the column holds into the ladder's range. */
export function toLearnStage(value: number): LearnStage {
	if (!Number.isFinite(value)) return 0;
	const stage = Math.min(Math.max(Math.trunc(value), 0), LEARN_MAX_STAGE);
	return stage as LearnStage;
}

/**
 * How far ahead of UTC the zone's wall clock is at `instant`, in ms. Read back
 * through Intl rather than assumed, so a zone with a half-hour offset or a DST
 * change is handled by the same code path.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(instant);
	const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");
	const asUtc = Date.UTC(
		part("year"),
		part("month") - 1,
		part("day"),
		part("hour") % 24,
		part("minute"),
		part("second"),
	);
	// formatToParts resolves to the second, so compare like for like.
	return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant midnight begins on `dayKey` ("YYYY-MM-DD") in `timeZone`.
 *
 * Due dates are stored as that instant, so "due today" is simply `dueAt` at or
 * before now. The offset is resolved twice because the offset that applies at
 * UTC midnight is not always the one that applies at local midnight; the second
 * pass uses the offset at the candidate instant, which settles a DST switch.
 */
export function startOfLocalDay(dayKey: string, timeZone: string): Date {
	const [year, month, day] = dayKey.split("-").map(Number);
	const naive = Date.UTC(year, month - 1, day);
	const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
	return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone));
}

/** Midnight of the user's today, as an instant. */
export function startOfToday(now: Date, timezone: string | null | undefined): Date {
	const timeZone = resolveReadingTimezone(timezone);
	return startOfLocalDay(localDayKey(now, timeZone), timeZone);
}

/** Midnight of the day after the user's today: the exclusive end of "due today". */
export function startOfTomorrow(now: Date, timezone: string | null | undefined): Date {
	const timeZone = resolveReadingTimezone(timezone);
	return startOfLocalDay(shiftDayKey(localDayKey(now, timeZone), 1), timeZone);
}

/**
 * Apply one review to a card.
 *
 * "good" below stage 3 climbs a rung and leaves the card due the same day, so
 * a verse is read, then thinned, then thinned again, then recalled from the
 * reference alone, all in one sitting. "good" at stage 3 is the only thing that
 * buys time: the interval doubles from 1 (1, 2, 4, 8, 16, 32) and the card
 * leaves for that many days. "again" drops to stage 1 rather than 0, because
 * someone who just failed a recall does not need the verse read to them again,
 * and brings it back today.
 *
 * knownAt is set the first time the interval reaches 16 days and is never
 * cleared, so "verses you know" only ever grows. It is the one number the
 * product counts.
 */
export function reviewCard(
	card: LearnScheduleState,
	result: LearnResult,
	now: Date,
	timezone: string | null | undefined,
): LearnScheduleUpdate {
	const timeZone = resolveReadingTimezone(timezone);
	const today = localDayKey(now, timeZone);
	const stage = toLearnStage(card.stage);
	const intervalDays = Math.max(Math.trunc(card.intervalDays) || 0, 0);

	let nextStage: LearnStage = stage;
	let nextInterval = intervalDays;
	let dueAt: Date;

	if (result === "again") {
		nextStage = 1;
		nextInterval = 0;
		dueAt = startOfLocalDay(today, timeZone);
	} else if (stage < LEARN_MAX_STAGE) {
		nextStage = (stage + 1) as LearnStage;
		dueAt = startOfLocalDay(today, timeZone);
	} else {
		nextInterval = Math.max(1, intervalDays * 2);
		dueAt = startOfLocalDay(shiftDayKey(today, nextInterval), timeZone);
	}

	const knownAt =
		card.knownAt ?? (nextInterval >= LEARN_KNOWN_INTERVAL_DAYS ? new Date(now.getTime()) : null);

	return { stage: nextStage, intervalDays: nextInterval, dueAt, lastReviewedAt: now, knownAt };
}

/** Letters and digits are the body; everything outside them is punctuation. */
const WORD_PARTS = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

function splitWord(word: string): { prefix: string; body: string; suffix: string } {
	const match = WORD_PARTS.exec(word);
	if (!match) return { prefix: "", body: word, suffix: "" };
	return { prefix: match[1], body: match[2], suffix: match[3] };
}

/** Whether the ladder hides the word at `index` at this stage. */
export function isMaskedAtStage(index: number, stage: LearnStage): boolean {
	if (stage === 1) return index % 4 === 3;
	if (stage === 2) return index % 2 === 1;
	return stage === LEARN_MAX_STAGE;
}

/**
 * The verse with this stage's words blanked. Stage 0 shows everything, stage 1
 * hides every fourth word, stage 2 every other word, stage 3 all of them.
 */
export function maskVerse(text: string, stage: LearnStage): MaskedVerse {
	const trimmed = text.trim();
	const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
	return {
		stage,
		words: tokens.map((word, index) => {
			const { prefix, body, suffix } = splitWord(word);
			return {
				index,
				word,
				prefix,
				body,
				suffix,
				hidden: body.length > 0 && isMaskedAtStage(index, stage),
			};
		}),
	};
}
