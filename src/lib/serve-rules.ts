/**
 * Pure rules for Ways to Serve (docs/FEATURES.md, GitHub issue #28).
 *
 * Ways to Serve offers, never requires. Salvation is by grace through faith,
 * not of works (Ephesians 2:8-9); serving is the fruit of that faith, never its
 * root (Ephesians 2:10). So nothing here counts, scores, streaks or ranks
 * anything a reader does, and every way is written as an invitation. Austin,
 * 2026-10-27: "it shouldn't be mandatory, faith is always first not works".
 *
 * The ways are a fixed, hand-written list with a KJV verse each, not model
 * output: the wording is Austin's to approve, costs nothing per reader, and
 * cannot drift into a works-based message. The verse text is filled in from
 * the bundled KJV by the caller.
 *
 * Import-free so `tests/serve-rules.test.mjs` can load it under `node --test`.
 * Mirrored by hand on Android (`mobile/src/features/serve/serveRules.ts`) and
 * Apple (`macos/Shared/Serve/ServeRules.swift`) only for the mode list; every
 * client reads the ways themselves from `GET /api/serve`.
 */

export const SERVE_MODES = ["off", "nearby", "online", "both"] as const;
export type ServeMode = (typeof SERVE_MODES)[number];
/** Online needs no location, so nobody is asked where they live to start. */
export const DEFAULT_SERVE_MODE: ServeMode = "online";

export function isServeMode(value: unknown): value is ServeMode {
	return typeof value === "string" && (SERVE_MODES as readonly string[]).includes(value);
}

/** A stored column that is null or no longer a mode reads as the default. */
export function readServeMode(value: unknown): ServeMode {
	return isServeMode(value) ? value : DEFAULT_SERVE_MODE;
}

export interface VerseRef {
	book: string;
	chapter: number;
	verse: number;
}

export function formatRef(ref: VerseRef): string {
	return `${ref.book} ${ref.chapter}:${ref.verse}`;
}

/** Shown at the top of Ways to Serve on every client, before any way. */
export const SERVE_TITLE = "Ways to Serve";
export const FAITH_FIRST_TEXT =
	"Serving never saves you. Jesus does, by grace through faith alone. But faith loves people, so if you're feeling thankful, restless, or ready to give back, here are a few simple ways to serve. None of them is required.";
/** One verse, kept short on purpose (Austin, 2026-10-27: "shorter"). */
export const FAITH_FIRST_REFS: readonly VerseRef[] = [{ book: "Ephesians", chapter: 2, verse: 8 }];

export type WayKind = "online" | "nearby";
/** What a client's button does with the way. */
export type WayAction =
	| "share-verse" // open the share-a-verse flow
	| "pray" // open chat to pray for someone by name
	| "reach-out" // open chat to help write a kind message
	| "nearby" // open the nearby search
	| "church" // open My church
	| "give-church" // the church's own website (its giving page lives there)
	| "give-need" // nearby search for food banks, or a giving search
	| "journal" // nothing to open; the journal is right there
	| null;

export interface ServeWay {
	id: string;
	kind: WayKind;
	title: string;
	detail: string;
	ref: VerseRef;
	action: WayAction;
	/** Shown only to a reader with a church saved in My church. */
	needsChurch?: boolean;
	/** A giving suggestion: governed by "I already give to my church". */
	giving?: "church" | "need";
}

export const ONLINE_WAYS: readonly ServeWay[] = [
	{
		id: "encourage",
		kind: "online",
		title: "Send someone a verse",
		detail: "Think of one person who needs hope today and send them a verse with a word of encouragement.",
		ref: { book: "Hebrews", chapter: 3, verse: 13 },
		action: "share-verse",
	},
	{
		id: "pray-for",
		kind: "online",
		title: "Pray for someone by name",
		detail: "Pick one person and pray for them by name today. SureWord can remember them and ask how they're doing later.",
		ref: { book: "James", chapter: 5, verse: 16 },
		action: "pray",
	},
	{
		id: "check-on",
		kind: "online",
		title: "Check on someone",
		detail: "Text someone who's been on your heart and ask how they're really doing. Then listen.",
		ref: { book: "Galatians", chapter: 6, verse: 2 },
		action: "reach-out",
	},
	{
		id: "call-alone",
		kind: "online",
		title: "Call someone who's alone",
		detail: "A widow, a shut-in, someone who just lost someone. A phone call can be a visit.",
		ref: { book: "James", chapter: 1, verse: 27 },
		action: "reach-out",
	},
	{
		id: "thank",
		kind: "online",
		title: "Thank someone who served you",
		detail: "A pastor, a teacher, a parent, a friend. Tell them what their faithfulness meant to you.",
		ref: { book: "Romans", chapter: 12, verse: 10 },
		action: "reach-out",
	},
	{
		id: "testify",
		kind: "online",
		title: "Tell someone what God has done for you",
		detail: "Share a piece of your testimony with someone who needs to hear that God still saves.",
		ref: { book: "Psalms", chapter: 66, verse: 16 },
		action: "share-verse",
	},
	{
		id: "forgive",
		kind: "online",
		title: "Reach out to someone you need to forgive",
		detail: "Forgive as you've been forgiven. If it's safe and wise, let them know.",
		ref: { book: "Ephesians", chapter: 4, verse: 32 },
		action: "reach-out",
	},
	{
		id: "give-church",
		kind: "online",
		title: "Give to your church",
		detail: "Support the work of your own church, as you purpose in your heart.",
		ref: { book: "2 Corinthians", chapter: 9, verse: 7 },
		action: "give-church",
		needsChurch: true,
		giving: "church",
	},
	{
		id: "give-need",
		kind: "online",
		title: "Give where there's real need",
		detail: "A food bank, a shelter, or a ministry feeding people. Only as you purpose in your heart, never out of pressure.",
		ref: { book: "1 John", chapter: 3, verse: 18 },
		action: "give-need",
		giving: "need",
	},
];

export const NEARBY_WAYS: readonly ServeWay[] = [
	{
		id: "food-bank",
		kind: "nearby",
		title: "Help at a food bank",
		detail: "Food banks and pantries near you often need hands to sort, pack and hand out food.",
		ref: { book: "Isaiah", chapter: 58, verse: 10 },
		action: "nearby",
	},
	{
		id: "shelter-meal",
		kind: "nearby",
		title: "Serve a meal at a shelter",
		detail: "Shelters and soup kitchens near you serve meals every day and welcome volunteers.",
		ref: { book: "Matthew", chapter: 25, verse: 35 },
		action: "nearby",
	},
	{
		id: "visit",
		kind: "nearby",
		title: "Visit someone in a care home",
		detail: "Many people in care homes go weeks without a visitor. Sit with someone and listen.",
		ref: { book: "Matthew", chapter: 25, verse: 36 },
		action: "nearby",
	},
	{
		id: "neighbor",
		kind: "nearby",
		title: "Help a neighbor",
		detail: "Groceries, a yard, a ride, a meal. Something practical for someone close by.",
		ref: { book: "Galatians", chapter: 6, verse: 10 },
		action: "journal",
	},
	{
		id: "church-hands",
		kind: "nearby",
		title: "Ask your church where they need hands",
		detail: "Every church has a need someone could meet: greeting, children, meals, cleaning, visiting.",
		ref: { book: "1 Peter", chapter: 4, verse: 10 },
		action: "church",
		needsChurch: true,
	},
];

/** The verse the journal is written under. */
export const JOURNAL_REF: VerseRef = { book: "Matthew", chapter: 25, verse: 40 };
export const JOURNAL_TITLE = "What I did";
export const JOURNAL_PROMPT =
	"A private place to remember moments God gave you to love someone. Just for you, never counted.";
export const MAX_ENTRY_LENGTH = 1000;
export const MAX_ENTRIES_LISTED = 200;

export interface WayContext {
	mode: ServeMode;
	hasChurch: boolean;
	givesToChurch: boolean;
}

/**
 * The ways this reader is offered, in display order. A giving way to their
 * own church never appears once they say they already give there; giving
 * elsewhere stays in the list (it is theirs to ignore), but see `pickToday`
 * for how rarely it is suggested.
 */
export function waysFor(context: WayContext): ServeWay[] {
	const { mode, hasChurch, givesToChurch } = context;
	if (mode === "off") return [];
	const pools = [
		...(mode === "online" || mode === "both" ? ONLINE_WAYS : []),
		...(mode === "nearby" || mode === "both" ? NEARBY_WAYS : []),
	];
	return pools.filter((way) => {
		if (way.needsChurch && !hasChurch) return false;
		if (way.giving === "church" && givesToChurch) return false;
		return true;
	});
}

/** "YYYY-MM-DD" in UTC; the day a suggestion belongs to. */
export function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 16777619);
	}
	return value >>> 0;
}

function dayNumber(key: string): number {
	return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
}

/**
 * Today's one suggestion, or null when the reader turned Ways to Serve off.
 *
 * Deterministic per reader per day, so every device shows the same way, and it
 * walks the reader's list in a shuffled order so nothing repeats until the
 * list has gone round once (at least a week for every mode). Giving is never
 * the daily suggestion for someone who already gives to their church, and for
 * everyone else it comes up at most once a cycle, because it is one entry
 * among the rest.
 */
export function pickToday(userId: string, key: string, context: WayContext): ServeWay | null {
	const ways = waysFor(context).filter((way) => !(context.givesToChurch && way.giving));
	if (ways.length === 0) return null;
	const order = [...ways].sort((a, b) => hash(`${userId}:${a.id}`) - hash(`${userId}:${b.id}`));
	const index = ((dayNumber(key) + (hash(userId) % order.length)) % order.length + order.length) % order.length;
	return order[index] ?? null;
}

/** Trims and bounds a journal entry; null when there is nothing to save. */
export function cleanEntryText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text || text.length > MAX_ENTRY_LENGTH) return null;
	return text;
}

/** A loose "Book C:V" reference, or null. The caller checks it is real KJV. */
export function parseVerseRef(value: unknown): VerseRef | null {
	// The longest real reference is about 25 characters; the cap keeps the lazy
	// book-name match from going quadratic on a long run of spaces.
	if (typeof value !== "string" || value.length > 40) return null;
	const match = /^\s*((?:[1-3]\s)?[A-Za-z][A-Za-z ]*?)\s+(\d{1,3}):(\d{1,3})\s*$/.exec(value);
	if (!match) return null;
	return { book: match[1].replace(/\s+/g, " "), chapter: Number(match[2]), verse: Number(match[3]) };
}

/** Kinds of nearby place the search looks for, as Places text queries. */
export const NEARBY_SEARCHES: readonly { id: string; label: string; query: string }[] = [
	{ id: "food", label: "Food banks and pantries", query: "food bank food pantry" },
	{ id: "shelter", label: "Shelters and soup kitchens", query: "homeless shelter soup kitchen" },
	{ id: "care", label: "Care homes", query: "nursing home assisted living" },
];

export const MAX_LOCATION_LENGTH = 80;

export function cleanLocation(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text.length < 2 || text.length > MAX_LOCATION_LENGTH) return null;
	return text;
}
