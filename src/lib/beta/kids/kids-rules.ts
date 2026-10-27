/**
 * Pure rules for SureWord Kids (LC-17657, docs/beta/kids.md): the one child
 * profile shape every beta module reads, the progress a child earns, the
 * parent check that guards the way out of Kids mode, and the shapes of the
 * checked-in Bible adventures.
 *
 * A child is a `BetaItem` with module "kids" and kind "child" on a parent's
 * account. Its title is always CHILD_ITEM_TITLE and its body is empty: the
 * name lives only in `data`, so nothing that indexes titles and bodies (the
 * Knowledge Vault) can carry a child's name anywhere, least of all to a model.
 * Read a child only through `parseKidsChild`.
 *
 * No imports on purpose: `tests/beta-kids.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

export const KIDS_MODULE = "kids";
export const KIDS_CHILD_KIND = "child";
/** Every child item's title. The name is never a title (see above). */
export const CHILD_ITEM_TITLE = "Child profile";
/** Profiles one parent can keep. */
export const KIDS_MAX_CHILDREN = 8;
export const KIDS_NAME_MAX = 30;

export const AGE_BANDS = ["3-5", "6-8", "9-12"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_BAND_LABEL: Record<AgeBand, string> = { "3-5": "Ages 3-5", "6-8": "Ages 6-8", "9-12": "Ages 9-12" };

export function isAgeBand(value: unknown): value is AgeBand {
	return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

/** What a parent may give: a first name or nickname, letters only (any script), spaces, hyphens, apostrophes and dots. */
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .’-]*$/u;

export type KidsRuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkChildName(raw: unknown): KidsRuleResult<string> {
	if (typeof raw !== "string") return { ok: false, error: "Enter a first name or nickname." };
	const name = raw.trim().replace(/\s+/g, " ");
	if (!name) return { ok: false, error: "Enter a first name or nickname." };
	if (name.length > KIDS_NAME_MAX) return { ok: false, error: `Keep it to ${KIDS_NAME_MAX} letters or fewer.` };
	if (!NAME_PATTERN.test(name)) return { ok: false, error: "Use letters only: a first name or a nickname." };
	return { ok: true, value: name };
}

/** One child as every module sees it. */
export interface KidsChild {
	id: string;
	name: string;
	ageBand: AgeBand;
	/** Adventures finished (quiz answered), as adventure ids. */
	stars: string[];
	/** Adventures whose verse was learned in the memory game. */
	verses: string[];
}

/** The `data` a child item stores. Nothing else about a child is kept anywhere. */
export interface KidsChildData {
	name: string;
	ageBand: AgeBand;
	stars: string[];
	verses: string[];
}

function knownIds(value: unknown, known: readonly string[]): string[] {
	if (!Array.isArray(value)) return [];
	return known.filter((id) => value.includes(id));
}

/**
 * A stored item as a child, or null when it is not a well-formed child item.
 * Progress is filtered to `adventureIds` and kept in catalog order, so an id
 * from a retired adventure simply stops counting.
 */
export function parseKidsChild(
	item: { id: string; module: string; kind: string; data: unknown },
	adventureIds: readonly string[],
): KidsChild | null {
	if (item.module !== KIDS_MODULE || item.kind !== KIDS_CHILD_KIND) return null;
	const data = item.data as Record<string, unknown> | null;
	if (!data || typeof data !== "object") return null;
	const name = checkChildName(data.name);
	if (!name.ok || !isAgeBand(data.ageBand)) return null;
	return {
		id: item.id,
		name: name.value,
		ageBand: data.ageBand,
		stars: knownIds(data.stars, adventureIds),
		verses: knownIds(data.verses, adventureIds),
	};
}

export function childData(child: Pick<KidsChild, "name" | "ageBand" | "stars" | "verses">): KidsChildData {
	return { name: child.name, ageBand: child.ageBand, stars: [...child.stars], verses: [...child.verses] };
}

export type KidsAward = "star" | "verse";

export function isKidsAward(value: unknown): value is KidsAward {
	return value === "star" || value === "verse";
}

/** Adds one finished adventure; the same award twice is a no-op. */
export function awardChild(child: KidsChild, adventureId: string, award: KidsAward, adventureIds: readonly string[]): KidsChild {
	const key = award === "star" ? "stars" : "verses";
	if (!adventureIds.includes(adventureId) || child[key].includes(adventureId)) return child;
	const next = new Set([...child[key], adventureId]);
	return { ...child, [key]: adventureIds.filter((id) => next.has(id)) };
}

// The parent check -----------------------------------------------------------

/**
 * Leaving Kids takes a sum a young child cannot do or tap through: two
 * two-digit numbers, written out in words (so it also takes reading), whose
 * total is three digits, typed on a number pad. A wrong answer brings a new
 * sum, and each run of three wrong answers locks the pad for longer.
 */
export interface ParentChallenge {
	a: number;
	b: number;
}

export const PARENT_CHECK_TRIES = 3;
/** Seconds the pad stays locked after each run of wrong answers. */
export const PARENT_CHECK_LOCKS = [30, 60, 120, 300] as const;
export const PARENT_CHECK_DIGITS = 3;

/** `random` returns [0, 1), like Math.random. */
export function makeParentChallenge(random: () => number): ParentChallenge {
	const pick = () => 51 + Math.floor(random() * 39); // 51-89, so a + b is 102-178
	return { a: pick(), b: pick() };
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 51-99 in words: "sixty-four", "seventy". */
export function numberInWords(value: number): string {
	const tens = Math.floor(value / 10);
	const ones = value % 10;
	return ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
}

export function parentChallengeText(challenge: ParentChallenge): string {
	return `What is ${numberInWords(challenge.a)} plus ${numberInWords(challenge.b)}?`;
}

export function checkParentAnswer(challenge: ParentChallenge, typed: string): boolean {
	return /^\d{1,3}$/.test(typed) && Number(typed) === challenge.a + challenge.b;
}

/** How long the pad stays locked after `misses` wrong answers in a row (0 while tries remain). */
export function parentLockSeconds(misses: number): number {
	if (misses <= 0 || misses % PARENT_CHECK_TRIES !== 0) return 0;
	const run = misses / PARENT_CHECK_TRIES - 1;
	return PARENT_CHECK_LOCKS[Math.min(run, PARENT_CHECK_LOCKS.length - 1)];
}

// The adventures --------------------------------------------------------------

/** A verse range in one chapter of the adventure's book. */
export interface KidsSegment {
	chapter: number;
	from: number;
	to: number;
}

/** "chapter:verse", e.g. "17:49". */
export type KidsVerseKey = string;

/** One sentence of a retelling and the verses it retells. */
export interface KidsLine {
	text: string;
	verses: KidsVerseKey[];
}

/**
 * One quiz question as written. `verses` are where the answer is said; the
 * right answer must be words the verse says (Quiz me's rule, checked by the
 * tests with Quiz me's own functions).
 */
export interface KidsQuestion {
	prompt: string;
	correct: string;
	wrong: string[];
	verses: KidsVerseKey[];
}

export interface KidsAdventure {
	id: string;
	title: string;
	/** Canonical book order, 1-66. */
	book: number;
	segments: KidsSegment[];
	retelling: Record<AgeBand, KidsLine[]>;
	questions: Record<AgeBand, KidsQuestion[]>;
	/** The verse to learn, or the exact words of part of it. */
	memory: { chapter: number; verse: number; text: string };
	/**
	 * A person a retelling names whom the passage itself only calls "he", with
	 * where Scripture names him. Anything else a retelling names must be named
	 * in the passage.
	 */
	alsoNamed?: { name: string; where: string }[];
}

/** Questions per age band, and how many choices each has. */
export const QUIZ_SHAPE: Record<AgeBand, { questions: number; choices: number }> = {
	"3-5": { questions: 2, choices: 3 },
	"6-8": { questions: 3, choices: 3 },
	"9-12": { questions: 4, choices: 4 },
};

export function verseKey(chapter: number, verse: number): KidsVerseKey {
	return `${chapter}:${verse}`;
}

export function parseVerseKey(key: string): { chapter: number; verse: number } | null {
	const match = /^(\d{1,3}):(\d{1,3})$/.exec(key);
	if (!match) return null;
	const chapter = Number(match[1]);
	const verse = Number(match[2]);
	return chapter >= 1 && verse >= 1 ? { chapter, verse } : null;
}

/** Every verse of the passage, in reading order. */
export function passageVerses(segments: readonly KidsSegment[]): { chapter: number; verse: number }[] {
	return segments.flatMap((segment) =>
		Array.from({ length: segment.to - segment.from + 1 }, (_, index) => ({ chapter: segment.chapter, verse: segment.from + index })),
	);
}

/** "Genesis 1:1-31; 2:1-3", "Jonah 1:1-4, 12-17; 2:1, 9-10". */
export function passageReference(bookName: string, segments: readonly KidsSegment[]): string {
	const chapters: { chapter: number; ranges: string[] }[] = [];
	for (const segment of segments) {
		const range = segment.from === segment.to ? `${segment.from}` : `${segment.from}-${segment.to}`;
		const last = chapters[chapters.length - 1];
		if (last && last.chapter === segment.chapter) last.ranges.push(range);
		else chapters.push({ chapter: segment.chapter, ranges: [range] });
	}
	return `${bookName} ${chapters.map((group) => `${group.chapter}:${group.ranges.join(", ")}`).join("; ")}`;
}

/**
 * The memory ladder for each age band, built on Learn a verse's stages (0
 * reads the verse, 1 hides every fourth word, 2 every other word, 3 all of
 * them), and whether the round ends with Learn's "Tap the next word".
 * The little ones tap the words in order only when the verse is short.
 */
export function memoryPlan(band: AgeBand, wordCount: number): { stages: (0 | 1 | 2 | 3)[]; order: boolean } {
	const ladder: (0 | 1 | 2 | 3)[] = band === "3-5" ? [0, 1] : band === "6-8" ? [0, 1, 2] : [0, 1, 2, 3];
	// Stage 1 hides every fourth word, so a verse under four words would hide nothing: it starts at stage 2.
	const stages = [...new Set(ladder.map((stage) => (stage === 1 && wordCount < 4 ? 2 : stage)))];
	return { stages, order: band !== "3-5" || wordCount <= 8 };
}

/** One adventure as Kids mode renders it, for one age band, with its KJV text. */
export interface KidsAdventureView {
	id: string;
	title: string;
	book: number;
	/** "Genesis 1:1-31; 2:1-3". */
	reference: string;
	segments: KidsSegment[];
	/** The passage in reading order, from the bundled KJV. */
	verses: { key: KidsVerseKey; chapter: number; verse: number; text: string }[];
	/** True when the passage spans chapters, so verse labels carry the chapter. */
	multiChapter: boolean;
	retelling: KidsLine[];
	/** Choices already placed (Quiz me's seeded order), with the right one's index. */
	questions: { prompt: string; options: string[]; answerIndex: number; verses: KidsVerseKey[] }[];
	memory: { text: string; reference: string };
}
