/**
 * Reading plans: the KJV chapter table, the built-in preset plans, and the
 * validation every plan (preset or AI-written) has to survive before it is
 * stored.
 *
 * Deliberately dependency-free - no prisma, no `ai`, no path aliases - so the
 * plan shape and the preset arithmetic can be tested directly by
 * `tests/reading-plans.test.mjs`, the same split `daily-cross-audio-script.ts`
 * has from `daily-cross-audio.ts`.
 *
 * The presets are GENERATED, never typed out: a 365-day plan is 365 rows of
 * chapter arithmetic, and hand-typed lists of that size are wrong somewhere by
 * construction.
 */

/** One chapter to read. `book` is always a canonical KJV book name. */
export interface ReadingPlanReading {
	book: string;
	chapter: number;
}

/** One day of a plan: what to read, and one line on what to look for. */
export interface ReadingPlanDay {
	/** 1-based, contiguous. */
	day: number;
	readings: ReadingPlanReading[];
	focus: string;
}

/** A preset as the clients list it before anything is started. */
export interface ReadingPlanPresetSummary {
	key: string;
	title: string;
	description: string;
	dayCount: number;
}

/** Shortest and longest plan we will build or accept from the model. */
export const MIN_PLAN_DAYS = 7;
export const MAX_PLAN_DAYS = 365;

/** More than this in one day is not a plan, it is a wish. */
export const MAX_READINGS_PER_DAY = 6;

/** No plan can be longer than the Book it reads. */
export const MAX_PLAN_CHAPTERS = 1189;

/**
 * Chapter counts for the 66 books, in canonical order. Mirrored from
 * `src/data/books.json` (the bundle the reader itself uses); the test asserts
 * the two agree, so this copy can never drift silently. It lives here rather
 * than behind an import because this module must stay loadable by a plain
 * `node --experimental-strip-types` test.
 */
export const KJV_BOOK_CHAPTERS: readonly { readonly name: string; readonly chapters: number }[] = [
	{ name: "Genesis", chapters: 50 },
	{ name: "Exodus", chapters: 40 },
	{ name: "Leviticus", chapters: 27 },
	{ name: "Numbers", chapters: 36 },
	{ name: "Deuteronomy", chapters: 34 },
	{ name: "Joshua", chapters: 24 },
	{ name: "Judges", chapters: 21 },
	{ name: "Ruth", chapters: 4 },
	{ name: "1 Samuel", chapters: 31 },
	{ name: "2 Samuel", chapters: 24 },
	{ name: "1 Kings", chapters: 22 },
	{ name: "2 Kings", chapters: 25 },
	{ name: "1 Chronicles", chapters: 29 },
	{ name: "2 Chronicles", chapters: 36 },
	{ name: "Ezra", chapters: 10 },
	{ name: "Nehemiah", chapters: 13 },
	{ name: "Esther", chapters: 10 },
	{ name: "Job", chapters: 42 },
	{ name: "Psalms", chapters: 150 },
	{ name: "Proverbs", chapters: 31 },
	{ name: "Ecclesiastes", chapters: 12 },
	{ name: "Song of Solomon", chapters: 8 },
	{ name: "Isaiah", chapters: 66 },
	{ name: "Jeremiah", chapters: 52 },
	{ name: "Lamentations", chapters: 5 },
	{ name: "Ezekiel", chapters: 48 },
	{ name: "Daniel", chapters: 12 },
	{ name: "Hosea", chapters: 14 },
	{ name: "Joel", chapters: 3 },
	{ name: "Amos", chapters: 9 },
	{ name: "Obadiah", chapters: 1 },
	{ name: "Jonah", chapters: 4 },
	{ name: "Micah", chapters: 7 },
	{ name: "Nahum", chapters: 3 },
	{ name: "Habakkuk", chapters: 3 },
	{ name: "Zephaniah", chapters: 3 },
	{ name: "Haggai", chapters: 2 },
	{ name: "Zechariah", chapters: 14 },
	{ name: "Malachi", chapters: 4 },
	{ name: "Matthew", chapters: 28 },
	{ name: "Mark", chapters: 16 },
	{ name: "Luke", chapters: 24 },
	{ name: "John", chapters: 21 },
	{ name: "Acts", chapters: 28 },
	{ name: "Romans", chapters: 16 },
	{ name: "1 Corinthians", chapters: 16 },
	{ name: "2 Corinthians", chapters: 13 },
	{ name: "Galatians", chapters: 6 },
	{ name: "Ephesians", chapters: 6 },
	{ name: "Philippians", chapters: 4 },
	{ name: "Colossians", chapters: 4 },
	{ name: "1 Thessalonians", chapters: 5 },
	{ name: "2 Thessalonians", chapters: 3 },
	{ name: "1 Timothy", chapters: 6 },
	{ name: "2 Timothy", chapters: 4 },
	{ name: "Titus", chapters: 3 },
	{ name: "Philemon", chapters: 1 },
	{ name: "Hebrews", chapters: 13 },
	{ name: "James", chapters: 5 },
	{ name: "1 Peter", chapters: 5 },
	{ name: "2 Peter", chapters: 3 },
	{ name: "1 John", chapters: 5 },
	{ name: "2 John", chapters: 1 },
	{ name: "3 John", chapters: 1 },
	{ name: "Jude", chapters: 1 },
	{ name: "Revelation", chapters: 22 },
];

/** Canonical order (1-66) for the first New Testament book. */
const FIRST_NT_ORDER = 40;

const BOOK_NAME_ALIASES: Record<string, string> = {
	psalm: "psalms",
	"song of songs": "song of solomon",
	canticles: "song of solomon",
	revelations: "revelation",
};

/**
 * Same normalization the KJV corpus reader uses (`src/utils/kjvBible.ts`), so
 * a model that writes "Psalm 23", "1st John" or "II Kings" is understood here
 * exactly as it is there.
 */
function normalizeBookName(name: string): string {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/\./g, "")
		.replace(/^(i{1,3})\s/, (_match, numerals: string) => `${numerals.length} `)
		.replace(/^1st\s/, "1 ")
		.replace(/^2nd\s/, "2 ")
		.replace(/^3rd\s/, "3 ")
		.replace(/\s+/g, " ");
	return BOOK_NAME_ALIASES[normalized] ?? normalized;
}

/** The canonical spelling of a book the user or a model named, if it exists. */
export function canonicalKjvBookName(name: string): string | undefined {
	const normalized = normalizeBookName(name);
	return KJV_BOOK_CHAPTERS.find((book) => book.name.toLowerCase() === normalized)?.name;
}

/** How many chapters a book has, by any spelling of its name. */
export function kjvChapterCount(name: string): number | undefined {
	const normalized = normalizeBookName(name);
	return KJV_BOOK_CHAPTERS.find((book) => book.name.toLowerCase() === normalized)?.chapters;
}

/** Every chapter of the books in the given canonical-order range, in order. */
function chaptersInRange(firstOrder: number, lastOrder: number): ReadingPlanReading[] {
	const readings: ReadingPlanReading[] = [];
	for (let order = firstOrder; order <= lastOrder; order++) {
		const book = KJV_BOOK_CHAPTERS[order - 1];
		if (!book) continue;
		for (let chapter = 1; chapter <= book.chapters; chapter++) {
			readings.push({ book: book.name, chapter });
		}
	}
	return readings;
}

/** Every chapter of one named book, in order. */
function chaptersOf(name: string): ReadingPlanReading[] {
	const count = kjvChapterCount(name) ?? 0;
	const book = canonicalKjvBookName(name) ?? name;
	return Array.from({ length: count }, (_unused, index) => ({ book, chapter: index + 1 }));
}

/**
 * Split a sequence into `buckets` contiguous groups of near-equal size.
 *
 * Boundaries come from `floor(i * n / buckets)` rather than "give the first few
 * buckets the remainder", so the longer days are spread through the plan
 * instead of stacked at the start - a year plan that opens with a hundred
 * four-chapter days and coasts afterwards is the classic way these die in
 * February.
 */
export function splitEvenly<T>(items: readonly T[], buckets: number): T[][] {
	if (buckets < 1) return [];
	const groups: T[][] = [];
	for (let index = 0; index < buckets; index++) {
		const start = Math.floor((index * items.length) / buckets);
		const end = Math.floor(((index + 1) * items.length) / buckets);
		groups.push(items.slice(start, end));
	}
	return groups;
}

/**
 * A day's readings as one short human line: "Matthew 1-3", "Psalms 1-5,
 * Proverbs 1". Runs of consecutive chapters in the same book collapse; both
 * clients render this rather than inventing their own formatting.
 */
export function describeReadings(readings: readonly ReadingPlanReading[]): string {
	const parts: string[] = [];
	let index = 0;
	while (index < readings.length) {
		const start = readings[index];
		let end = start;
		let next = index + 1;
		while (
			next < readings.length &&
			readings[next].book === end.book &&
			readings[next].chapter === end.chapter + 1
		) {
			end = readings[next];
			next += 1;
		}
		parts.push(
			end.chapter === start.chapter
				? `${start.book} ${start.chapter}`
				: `${start.book} ${start.chapter}-${end.chapter}`
		);
		index = next;
	}
	return parts.join(", ");
}

/** Deterministic focus line for a day, cycling a preset's own lines. */
function rotate(lines: readonly string[], day: number): string {
	return lines[(day - 1) % lines.length];
}

interface PresetDefinition extends ReadingPlanPresetSummary {
	build: () => ReadingPlanDay[];
}

const GOSPEL_FOCUS = [
	"Watch the Lord Jesus Himself - what He does, and what He says about who He is.",
	"Mark one thing He asks of those who would follow Him.",
	"Notice who comes to Him today, and what He does with them.",
	"Read His words slowly, and let them search you before you explain them.",
	"Look for the cross standing at the end of the road He is walking.",
];

const PSALMS_PROVERBS_FOCUS = [
	"Pray the psalms back to God in your own words, and let the proverb search you.",
	"Mark every place the psalmist tells God the plain truth about how he feels.",
	"Carry one proverb into the day and watch for the hour it applies.",
	"Find the psalm that says what you cannot say, and make it your own prayer.",
];

const NEW_TESTAMENT_FOCUS = [
	"Read it as a letter written to you, and mark what it actually commands.",
	"Find the gospel in today's reading - Christ crucified, buried, risen.",
	"Note one thing this passage says about God, and one it says about you.",
	"Read to the end of the thought, not just to the end of the chapter.",
];

const WHOLE_BIBLE_FOCUS = [
	"Note one thing today's reading shows you about God Himself.",
	"Watch for the promise of the coming Redeemer running underneath it.",
	"Read for the story God is telling, not only for the verse you already like.",
	"Mark what you do not understand and bring it back to the Lord in prayer.",
];

/** Assemble numbered days from pre-split reading groups and a focus rotation. */
function daysFromGroups(groups: ReadingPlanReading[][], focusLines: readonly string[]): ReadingPlanDay[] {
	return groups.map((readings, index) => ({
		day: index + 1,
		readings,
		focus: rotate(focusLines, index + 1),
	}));
}

const PRESET_DEFINITIONS: readonly PresetDefinition[] = [
	{
		key: "gospels-30",
		title: "The Gospels in 30 days",
		description:
			"Matthew, Mark, Luke and John straight through in a month - the life, death and resurrection of the Lord Jesus, told four times over.",
		dayCount: 30,
		build: () =>
			daysFromGroups(
				splitEvenly(
					[...chaptersOf("Matthew"), ...chaptersOf("Mark"), ...chaptersOf("Luke"), ...chaptersOf("John")],
					30
				),
				GOSPEL_FOCUS
			),
	},
	{
		key: "psalms-proverbs-31",
		title: "Psalms & Proverbs in 31 days",
		description:
			"A month of prayer and wisdom: about five psalms a day alongside the proverb for the date.",
		dayCount: 31,
		build: () => {
			const psalmGroups = splitEvenly(chaptersOf("Psalms"), 31);
			return psalmGroups.map((psalms, index) => ({
				day: index + 1,
				readings: [...psalms, { book: "Proverbs", chapter: index + 1 }],
				focus: rotate(PSALMS_PROVERBS_FOCUS, index + 1),
			}));
		},
	},
	{
		key: "new-testament-90",
		title: "New Testament in 90 days",
		description:
			"Matthew through Revelation in three months - about three chapters a day, in the order they stand.",
		dayCount: 90,
		build: () =>
			daysFromGroups(splitEvenly(chaptersInRange(FIRST_NT_ORDER, KJV_BOOK_CHAPTERS.length), 90), NEW_TESTAMENT_FOCUS),
	},
	{
		key: "whole-bible-year",
		title: "The Whole Bible in a Year",
		description:
			"Genesis to Revelation in 365 days - three or four chapters a day, every word of it, in order.",
		dayCount: 365,
		build: () =>
			daysFromGroups(splitEvenly(chaptersInRange(1, KJV_BOOK_CHAPTERS.length), 365), WHOLE_BIBLE_FOCUS),
	},
];

/** The presets a client lists, without paying to build every day of each. */
export const READING_PLAN_PRESETS: ReadingPlanPresetSummary[] = PRESET_DEFINITIONS.map(
	({ key, title, description, dayCount }) => ({ key, title, description, dayCount })
);

export interface BuiltPreset extends ReadingPlanPresetSummary {
	days: ReadingPlanDay[];
}

/** Build one preset's full day list, or null when the key is not one of ours. */
export function buildPresetPlan(key: string): BuiltPreset | null {
	const definition = PRESET_DEFINITIONS.find((preset) => preset.key === key);
	if (!definition) return null;
	return {
		key: definition.key,
		title: definition.title,
		description: definition.description,
		dayCount: definition.dayCount,
		days: definition.build(),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Validate anything claiming to be a plan's days - model output, or JSON read
 * back out of the database.
 *
 * Every reading is checked against the real KJV canon and dropped if the book
 * does not exist or the chapter is past the end of it; a day left with no
 * readings is dropped whole; surviving days are renumbered so `day` is always
 * 1..n with no gaps. A model that invents Psalm 151 loses that line, not the
 * plan.
 */
export function sanitizeReadingPlanDays(value: unknown): ReadingPlanDay[] {
	if (!Array.isArray(value)) return [];

	const days: ReadingPlanDay[] = [];
	let totalChapters = 0;

	for (const rawDay of value) {
		if (days.length >= MAX_PLAN_DAYS || totalChapters >= MAX_PLAN_CHAPTERS) break;
		if (!isRecord(rawDay) || !Array.isArray(rawDay.readings)) continue;

		const readings: ReadingPlanReading[] = [];
		for (const rawReading of rawDay.readings) {
			if (readings.length >= MAX_READINGS_PER_DAY) break;
			if (totalChapters + readings.length >= MAX_PLAN_CHAPTERS) break;
			if (!isRecord(rawReading) || typeof rawReading.book !== "string") continue;
			const chapter = rawReading.chapter;
			if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 1) continue;
			const book = canonicalKjvBookName(rawReading.book);
			if (!book) continue;
			if (chapter > (kjvChapterCount(book) ?? 0)) continue;
			readings.push({ book, chapter });
		}
		if (readings.length === 0) continue;

		totalChapters += readings.length;
		days.push({
			day: days.length + 1,
			readings,
			focus: typeof rawDay.focus === "string" ? rawDay.focus.trim() : "",
		});
	}

	return days;
}
