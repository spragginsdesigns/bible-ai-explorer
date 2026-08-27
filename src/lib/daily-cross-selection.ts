import { z } from "zod";

/** The two user-facing ways a Daily Cross can be selected. */
export const DAILY_CROSS_MODES = ["theme", "focus"] as const;
export type DailyCrossMode = (typeof DAILY_CROSS_MODES)[number];

/**
 * Stable labels used for novelty checks. Keep this list finite: prose labels
 * are useful to people, but a free-form label cannot be compared reliably.
 */
export const PRIMARY_THEME_KEYS = [
	"assurance",
	"comfort",
	"courage",
	"creation",
	"church",
	"doctrine",
	"evangelism",
	"family",
	"faith",
	"forgiveness",
	"grace",
	"gratitude",
	"hope",
	"holiness",
	"identity",
	"love",
	"obedience",
	"parenting",
	"peace",
	"perseverance",
	"prayer",
	"repentance",
	"relationships",
	"rest",
	"salvation",
	"scripture",
	"service",
	"speech",
	"stewardship",
	"temptation",
	"trust",
	"wisdom",
	"work",
	"worship",
] as const;
export type PrimaryThemeKey = (typeof PRIMARY_THEME_KEYS)[number];

export const primaryThemeKeySchema = z.enum(PRIMARY_THEME_KEYS);

export interface VerseReference {
	book: string;
	chapter: number;
	verse: number;
}

export interface SelectionEvidence {
	kind: string;
	id: string | null;
	summary: string;
	origin: string | null;
}

export interface DailyCrossSelection extends VerseReference {
	mode: DailyCrossMode;
	primaryTheme: string;
	primaryThemeKey: PrimaryThemeKey;
	secondaryThemeKeys: PrimaryThemeKey[];
	selectionReason: string;
	noveltyReason: string;
	evidence: SelectionEvidence[];
	confidence: number;
}

export interface RecentDailyCross extends VerseReference {
	sentAt: Date | string | number;
	primaryTheme?: string | null;
	primaryThemeKey?: PrimaryThemeKey | string | null;
	selectionReason?: string | null;
}

export interface SelectionValidation {
	ok: boolean;
	errors: string[];
	blockedByVerse: boolean;
	blockedByTheme: boolean;
}

export interface SelectionValidationOptions {
	now?: Date | string | number;
	/** Either this array or `recent` may be used by callers integrating older data. */
	recentSelections?: readonly RecentDailyCross[];
	recent?: readonly RecentDailyCross[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_VERSE_WINDOW_DAYS = 30;
export const RECENT_THEME_WINDOW_DAYS = 3;
export const MAX_EVIDENCE_ITEMS = 6;
export const MAX_EVIDENCE_SUMMARY_LENGTH = 280;

/** Structured schema shared with the model selector and callers that validate model output. */
export const dailyCrossSelectionSchema = z.object({
	mode: z.enum(DAILY_CROSS_MODES),
	primaryTheme: z.string().trim().min(1).max(120),
	primaryThemeKey: primaryThemeKeySchema,
	secondaryThemeKeys: z.array(primaryThemeKeySchema).max(3),
	book: z.string().trim().min(1).max(80),
	chapter: z.number().int().min(1).max(200),
	verse: z.number().int().min(1).max(200),
	selectionReason: z.string().trim().min(1).max(600),
	noveltyReason: z.string().trim().min(1).max(600),
	evidence: z
		.array(
			z.object({
				kind: z.string().trim().min(1).max(60),
				id: z.string().trim().max(120).nullable(),
				summary: z.string().trim().min(1).max(MAX_EVIDENCE_SUMMARY_LENGTH),
				origin: z.string().trim().max(80).nullable(),
			})
		)
		.max(MAX_EVIDENCE_ITEMS),
	confidence: z.number().min(0).max(1),
});

export type DailyCrossSelectionInput = z.input<typeof dailyCrossSelectionSchema>;

function asTimestamp(value: Date | string | number | undefined): number | null {
	if (value instanceof Date) {
		const timestamp = value.getTime();
		return Number.isFinite(timestamp) ? timestamp : null;
	}
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") {
		const timestamp = Date.parse(value);
		return Number.isFinite(timestamp) ? timestamp : null;
	}
	return null;
}

function referenceKey(reference: Pick<VerseReference, "book" | "chapter" | "verse">): string {
	return `${reference.book.trim().replace(/\s+/g, " ").toLowerCase()} ${reference.chapter}:${reference.verse}`;
}

export function dailyCrossReferenceKey(reference: Pick<VerseReference, "book" | "chapter" | "verse">): string {
	return referenceKey(reference);
}

function recentWithin(timestamp: number, now: number, days: number): boolean {
	const age = now - timestamp;
	return age >= 0 && age < days * DAY_MS;
}

function normalizeValidationArgs(
	recentOrOptions: readonly RecentDailyCross[] | SelectionValidationOptions | undefined,
	nowArgument: Date | string | number | undefined,
): { recent: readonly RecentDailyCross[]; now: number } {
	if (Array.isArray(recentOrOptions)) {
		return { recent: recentOrOptions, now: asTimestamp(nowArgument) ?? Date.now() };
	}
	const options = (recentOrOptions ?? {}) as SelectionValidationOptions;
	return {
		recent: options.recentSelections ?? options.recent ?? [],
		now: asTimestamp(nowArgument ?? options.now) ?? Date.now(),
	};
}

/**
 * Deterministic policy gate. A verse is unavailable for 30 rolling days. A
 * primary theme is unavailable for three rolling days, except when the user
 * explicitly chose `focus`; focus changes the theme constraint only.
 */
export function validateDailyCrossSelection(
	selection: unknown,
	recentOrOptions?: readonly RecentDailyCross[] | SelectionValidationOptions,
	nowArgument?: Date | string | number,
): SelectionValidation {
	const parsed = dailyCrossSelectionSchema.safeParse(selection);
	const errors: string[] = [];
	if (!parsed.success) {
		errors.push("Selection does not match the Daily Cross schema.");
		return { ok: false, errors, blockedByVerse: false, blockedByTheme: false };
	}

	const { recent, now } = normalizeValidationArgs(recentOrOptions, nowArgument);
	const candidateReference = referenceKey(parsed.data);
	const recentVerse = recent.some((entry) => {
		const sentAt = asTimestamp(entry.sentAt);
		return sentAt !== null && recentWithin(sentAt, now, RECENT_VERSE_WINDOW_DAYS) && referenceKey(entry) === candidateReference;
	});
	const recentTheme = recent.some((entry) => {
		const sentAt = asTimestamp(entry.sentAt);
		return (
			sentAt !== null &&
			recentWithin(sentAt, now, RECENT_THEME_WINDOW_DAYS) &&
			typeof entry.primaryThemeKey === "string" &&
			entry.primaryThemeKey.trim().toLowerCase() === parsed.data.primaryThemeKey
		);
	});
	if (recentVerse) errors.push(`${candidateReference} was selected within the last 30 days.`);
	if (recentTheme && parsed.data.mode !== "focus") {
		errors.push(`Theme ${parsed.data.primaryThemeKey} was selected within the last 3 days.`);
	}
	return {
		ok: errors.length === 0,
		errors,
		blockedByVerse: recentVerse,
		blockedByTheme: recentTheme && parsed.data.mode !== "focus",
	};
}

export function isDailyCrossSelectionAllowed(
	selection: unknown,
	recentOrOptions?: readonly RecentDailyCross[] | SelectionValidationOptions,
	nowArgument?: Date | string | number,
): boolean {
	return validateDailyCrossSelection(selection, recentOrOptions, nowArgument).ok;
}

interface FallbackCandidate extends VerseReference {
	primaryTheme: string;
	primaryThemeKey: PrimaryThemeKey;
	secondaryThemeKeys: PrimaryThemeKey[];
}

/** Curated across-testament pool. It intentionally does not contain John 3:16. */
export const DAILY_CROSS_FALLBACK_CANDIDATES: readonly FallbackCandidate[] = [
	{ book: "Genesis", chapter: 50, verse: 20, primaryTheme: "God's purpose through hardship", primaryThemeKey: "hope", secondaryThemeKeys: ["trust", "perseverance"] },
	{ book: "Exodus", chapter: 14, verse: 14, primaryTheme: "The Lord fighting for you", primaryThemeKey: "trust", secondaryThemeKeys: ["peace", "courage"] },
	{ book: "Deuteronomy", chapter: 31, verse: 8, primaryTheme: "The Lord goes before you", primaryThemeKey: "courage", secondaryThemeKeys: ["trust", "faith"] },
	{ book: "Joshua", chapter: 1, verse: 9, primaryTheme: "Strength for faithful obedience", primaryThemeKey: "courage", secondaryThemeKeys: ["obedience", "faith"] },
	{ book: "Psalms", chapter: 27, verse: 1, primaryTheme: "Courage in the Lord", primaryThemeKey: "courage", secondaryThemeKeys: ["trust"] },
	{ book: "Psalms", chapter: 23, verse: 4, primaryTheme: "The Shepherd with you in the valley", primaryThemeKey: "comfort", secondaryThemeKeys: ["trust", "courage"] },
	{ book: "Psalms", chapter: 34, verse: 18, primaryTheme: "The Lord near the brokenhearted", primaryThemeKey: "comfort", secondaryThemeKeys: ["hope"] },
	{ book: "Psalms", chapter: 37, verse: 5, primaryTheme: "Commit your way to the Lord", primaryThemeKey: "trust", secondaryThemeKeys: ["obedience", "faith"] },
	{ book: "Psalms", chapter: 46, verse: 1, primaryTheme: "God our refuge", primaryThemeKey: "trust", secondaryThemeKeys: ["comfort", "courage"] },
	{ book: "Psalms", chapter: 51, verse: 10, primaryTheme: "A clean heart before God", primaryThemeKey: "repentance", secondaryThemeKeys: ["holiness", "prayer"] },
	{ book: "Psalms", chapter: 119, verse: 105, primaryTheme: "Light for the next step", primaryThemeKey: "wisdom", secondaryThemeKeys: ["obedience"] },
	{ book: "Proverbs", chapter: 4, verse: 23, primaryTheme: "Guarding the heart", primaryThemeKey: "wisdom", secondaryThemeKeys: ["holiness", "obedience"] },
	{ book: "Proverbs", chapter: 3, verse: 5, primaryTheme: "Trust beyond your own understanding", primaryThemeKey: "trust", secondaryThemeKeys: ["faith", "wisdom"] },
	{ book: "Isaiah", chapter: 40, verse: 31, primaryTheme: "Strength renewed by waiting on the Lord", primaryThemeKey: "perseverance", secondaryThemeKeys: ["hope", "faith"] },
	{ book: "Isaiah", chapter: 41, verse: 10, primaryTheme: "Held and helped by God", primaryThemeKey: "courage", secondaryThemeKeys: ["comfort", "faith"] },
	{ book: "Jeremiah", chapter: 33, verse: 3, primaryTheme: "Calling upon the Lord", primaryThemeKey: "prayer", secondaryThemeKeys: ["faith", "wisdom"] },
	{ book: "Lamentations", chapter: 3, verse: 22, primaryTheme: "Mercy that is new this morning", primaryThemeKey: "hope", secondaryThemeKeys: ["grace", "gratitude"] },
	{ book: "Micah", chapter: 6, verse: 8, primaryTheme: "A faithful walk", primaryThemeKey: "obedience", secondaryThemeKeys: ["holiness", "worship"] },
	{ book: "Matthew", chapter: 6, verse: 33, primaryTheme: "Seek the kingdom first", primaryThemeKey: "obedience", secondaryThemeKeys: ["trust", "faith"] },
	{ book: "Matthew", chapter: 11, verse: 28, primaryTheme: "Rest for the weary", primaryThemeKey: "comfort", secondaryThemeKeys: ["hope", "trust"] },
	{ book: "Matthew", chapter: 5, verse: 16, primaryTheme: "A light that points to the Father", primaryThemeKey: "service", secondaryThemeKeys: ["worship", "obedience"] },
	{ book: "Luke", chapter: 9, verse: 23, primaryTheme: "Following Jesus today", primaryThemeKey: "obedience", secondaryThemeKeys: ["perseverance", "faith"] },
	{ book: "Mark", chapter: 10, verse: 45, primaryTheme: "Following Christ through service", primaryThemeKey: "service", secondaryThemeKeys: ["obedience", "love"] },
	{ book: "John", chapter: 15, verse: 5, primaryTheme: "Abiding in Christ", primaryThemeKey: "faith", secondaryThemeKeys: ["identity", "perseverance"] },
	{ book: "John", chapter: 14, verse: 27, primaryTheme: "The peace Christ gives", primaryThemeKey: "peace", secondaryThemeKeys: ["comfort", "trust"] },
	{ book: "Romans", chapter: 5, verse: 1, primaryTheme: "Peace with God through Christ", primaryThemeKey: "peace", secondaryThemeKeys: ["salvation", "grace"] },
	{ book: "Romans", chapter: 8, verse: 1, primaryTheme: "No condemnation in Christ", primaryThemeKey: "assurance", secondaryThemeKeys: ["grace", "identity"] },
	{ book: "Romans", chapter: 8, verse: 28, primaryTheme: "God working through all things", primaryThemeKey: "hope", secondaryThemeKeys: ["trust", "perseverance"] },
	{ book: "Romans", chapter: 12, verse: 2, primaryTheme: "A renewed mind", primaryThemeKey: "holiness", secondaryThemeKeys: ["obedience", "wisdom"] },
	{ book: "Romans", chapter: 12, verse: 12, primaryTheme: "Hopeful, patient, prayerful", primaryThemeKey: "perseverance", secondaryThemeKeys: ["hope", "prayer"] },
	{ book: "1 Corinthians", chapter: 10, verse: 13, primaryTheme: "A way through temptation", primaryThemeKey: "temptation", secondaryThemeKeys: ["perseverance", "faith"] },
	{ book: "1 Corinthians", chapter: 16, verse: 14, primaryTheme: "Let everything be done with love", primaryThemeKey: "love", secondaryThemeKeys: ["service", "obedience"] },
	{ book: "2 Corinthians", chapter: 12, verse: 9, primaryTheme: "Grace in weakness", primaryThemeKey: "grace", secondaryThemeKeys: ["comfort", "perseverance"] },
	{ book: "2 Corinthians", chapter: 5, verse: 17, primaryTheme: "A new creature in Christ", primaryThemeKey: "identity", secondaryThemeKeys: ["salvation", "holiness"] },
	{ book: "Galatians", chapter: 2, verse: 20, primaryTheme: "Life in Christ", primaryThemeKey: "identity", secondaryThemeKeys: ["faith", "holiness"] },
	{ book: "Galatians", chapter: 5, verse: 22, primaryTheme: "The fruit of the Spirit", primaryThemeKey: "holiness", secondaryThemeKeys: ["love", "obedience"] },
	{ book: "Ephesians", chapter: 2, verse: 8, primaryTheme: "Saved by grace through faith", primaryThemeKey: "salvation", secondaryThemeKeys: ["grace", "faith"] },
	{ book: "Ephesians", chapter: 4, verse: 32, primaryTheme: "Kindness and forgiveness", primaryThemeKey: "forgiveness", secondaryThemeKeys: ["love", "relationships"] },
	{ book: "Philippians", chapter: 4, verse: 6, primaryTheme: "Bring everything to God", primaryThemeKey: "prayer", secondaryThemeKeys: ["trust", "comfort"] },
	{ book: "Philippians", chapter: 4, verse: 13, primaryTheme: "Strength for what is before you", primaryThemeKey: "perseverance", secondaryThemeKeys: ["faith", "courage"] },
	{ book: "Colossians", chapter: 3, verse: 17, primaryTheme: "Doing all in the name of Christ", primaryThemeKey: "worship", secondaryThemeKeys: ["obedience", "gratitude"] },
	{ book: "1 Thessalonians", chapter: 5, verse: 16, primaryTheme: "Rejoicing in the Lord", primaryThemeKey: "gratitude", secondaryThemeKeys: ["worship", "hope"] },
	{ book: "2 Timothy", chapter: 1, verse: 7, primaryTheme: "Power, love, and a sound mind", primaryThemeKey: "courage", secondaryThemeKeys: ["love", "wisdom"] },
	{ book: "Hebrews", chapter: 4, verse: 16, primaryTheme: "Come boldly for mercy", primaryThemeKey: "grace", secondaryThemeKeys: ["prayer", "assurance"] },
	{ book: "Hebrews", chapter: 12, verse: 2, primaryTheme: "Looking unto Jesus", primaryThemeKey: "perseverance", secondaryThemeKeys: ["faith", "hope"] },
	{ book: "James", chapter: 1, verse: 5, primaryTheme: "Ask God for wisdom", primaryThemeKey: "wisdom", secondaryThemeKeys: ["prayer", "faith"] },
	{ book: "James", chapter: 1, verse: 22, primaryTheme: "Doing the Word", primaryThemeKey: "obedience", secondaryThemeKeys: ["scripture", "faith"] },
	{ book: "1 Peter", chapter: 5, verse: 7, primaryTheme: "Cast every care on Him", primaryThemeKey: "comfort", secondaryThemeKeys: ["trust", "prayer"] },
	{ book: "1 Peter", chapter: 2, verse: 9, primaryTheme: "Called out to show His praise", primaryThemeKey: "identity", secondaryThemeKeys: ["worship", "evangelism"] },
	{ book: "1 John", chapter: 1, verse: 9, primaryTheme: "Honest confession and cleansing", primaryThemeKey: "forgiveness", secondaryThemeKeys: ["repentance", "grace"] },
	{ book: "1 John", chapter: 4, verse: 19, primaryTheme: "Loving because He first loved us", primaryThemeKey: "love", secondaryThemeKeys: ["grace", "relationships"] },
	{ book: "Jude", chapter: 1, verse: 24, primaryTheme: "Kept by the Lord", primaryThemeKey: "assurance", secondaryThemeKeys: ["hope", "perseverance"] },
	{ book: "Revelation", chapter: 21, verse: 4, primaryTheme: "The end of sorrow", primaryThemeKey: "hope", secondaryThemeKeys: ["comfort", "assurance"] },
];

function stableHash(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export interface FallbackSelectionOptions extends SelectionValidationOptions {
	mode?: DailyCrossMode;
	focus?: string;
	seed?: string | number;
}

export class NoDailyCrossFallbackAvailableError extends Error {
	constructor() {
		super("No curated Daily Cross candidate remains outside the recent verse and theme windows.");
		this.name = "NoDailyCrossFallbackAvailableError";
	}
}

/**
 * Selects a deterministic, varied fallback. No network or Bible corpus lookup
 * is needed here; the lead can resolve the returned reference text separately.
 */
export function selectDailyCrossFallback(options: FallbackSelectionOptions = {}): DailyCrossSelection {
	const { recent, now } = normalizeValidationArgs(options, undefined);
	const mode = options.mode ?? (options.focus?.trim() ? "focus" : "theme");
	const recentRefs = new Set(
		recent
			.filter((entry) => {
				const sentAt = asTimestamp(entry.sentAt);
				return sentAt !== null && recentWithin(sentAt, now, RECENT_VERSE_WINDOW_DAYS);
			})
			.map(referenceKey)
	);
	const recentThemes = new Set(
		recent
			.filter((entry) => {
				const sentAt = asTimestamp(entry.sentAt);
				return sentAt !== null && recentWithin(sentAt, now, RECENT_THEME_WINDOW_DAYS);
			})
		.map((entry) => (typeof entry.primaryThemeKey === "string" ? entry.primaryThemeKey.trim().toLowerCase() : entry.primaryThemeKey))
		.filter((theme): theme is string => Boolean(theme))
	);
	const eligible = DAILY_CROSS_FALLBACK_CANDIDATES.filter(
		(candidate) => !recentRefs.has(referenceKey(candidate)) && (mode === "focus" || !recentThemes.has(candidate.primaryThemeKey))
	);
	if (eligible.length === 0) throw new NoDailyCrossFallbackAvailableError();
	const seed = String(options.seed ?? Math.floor(now / DAY_MS));
	const candidate = eligible[stableHash(seed) % eligible.length];
	return {
		...candidate,
		mode,
		selectionReason: options.focus?.trim()
			? `A curated Scripture candidate that can speak to this focus: ${options.focus.trim().slice(0, 120)}`
			: `A curated Scripture candidate chosen to keep today's word moving beyond recent themes.`,
		noveltyReason: "The exact verse is outside the rolling 30-day window and its primary theme is outside the rolling 3-day window.",
		evidence: [{ kind: "fallback", id: null, summary: "Curated KJV reference selected locally after recent-verse and recent-theme exclusions.", origin: "daily-cross-fallback" }],
		confidence: 0.55,
	};
}

/** Short alias for integrations that call all selectors `fallback`. */
export const chooseDailyCrossFallback = selectDailyCrossFallback;
