/**
 * Ways to Serve on Android: shared types and pure helpers (GitHub issue #28).
 *
 * The mode list mirrors `src/lib/serve-rules.ts` by hand; everything a reader
 * sees (the faith-first intro, the ways, their verses, the journal wording)
 * comes from `GET /api/serve`, so the doctrine lives on the server in one
 * place and this client never writes its own. Salvation is by grace through
 * faith, not works (Ephesians 2:8-9), so nothing here counts, scores or
 * streaks what a reader does.
 *
 * Kept free of React and Expo imports so the vitest suite (plain node) can
 * load it, the same split as `features/church/church.ts`.
 */

/** Mirror of `SERVE_MODES` in `src/lib/serve-rules.ts`. */
export const SERVE_MODES = ["off", "nearby", "online", "both"] as const;
export type ServeMode = (typeof SERVE_MODES)[number];

export const SERVE_MODE_LABELS: Record<ServeMode, string> = {
	off: "Off",
	nearby: "Nearby",
	online: "Online",
	both: "Both",
};

export function isServeMode(value: unknown): value is ServeMode {
	return typeof value === "string" && (SERVE_MODES as readonly string[]).includes(value);
}

/** Mirror of `WayAction` in `src/lib/serve-rules.ts`. */
export const WAY_ACTIONS = [
	"share-verse",
	"pray",
	"reach-out",
	"nearby",
	"church",
	"give-church",
	"give-need",
	"journal",
] as const;
export type WayAction = (typeof WAY_ACTIONS)[number];

export interface VerseView {
	reference: string;
	text: string;
}

export interface WayView {
	id: string;
	kind: "online" | "nearby";
	title: string;
	detail: string;
	action: WayAction | null;
	needsChurch?: boolean;
	giving?: "church" | "need";
	verse: VerseView;
}

export interface ServeSettings {
	mode: ServeMode;
	givesToChurch: boolean;
}

export interface ServeView {
	title: string;
	settings: ServeSettings;
	intro: { text: string; verses: VerseView[] };
	today: WayView | null;
	ways: WayView[];
	church: { name: string; website: string | null } | null;
	nearby: { available: boolean; searches: { id: string; label: string }[] };
	journal: { title: string; prompt: string; verse: VerseView };
}

export interface ServeEntryView {
	id: string;
	text: string;
	verseRef: string | null;
	createdAt: string;
}

export interface ServePlace {
	placeId: string;
	name: string;
	address: string;
	phone: string | null;
	website: string | null;
	mapsUrl: string | null;
}

export type ServeNearbyResponse = { status: "unavailable" } | { status: "ok"; results: ServePlace[] };

/** Mirror of `cleanLocation` bounds; the server 400s outside them. */
export const MIN_LOCATION_LENGTH = 2;
export const MAX_LOCATION_LENGTH = 80;
/** Mirror of `MAX_ENTRY_LENGTH`. */
export const MAX_ENTRY_LENGTH = 1000;

export function isSearchableLocation(value: string): boolean {
	const text = value.trim();
	return text.length >= MIN_LOCATION_LENGTH && text.length <= MAX_LOCATION_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function parseVerse(value: unknown): VerseView | null {
	if (!isRecord(value)) return null;
	const reference = str(value.reference);
	if (!reference) return null;
	return { reference, text: str(value.text) ?? "" };
}

function parseWay(value: unknown): WayView | null {
	if (!isRecord(value)) return null;
	const id = str(value.id);
	const title = str(value.title);
	const verse = parseVerse(value.verse);
	if (!id || !title || !verse) return null;
	const action = WAY_ACTIONS.find((candidate) => candidate === value.action) ?? null;
	return {
		id,
		kind: value.kind === "nearby" ? "nearby" : "online",
		title,
		detail: str(value.detail) ?? "",
		action,
		...(value.needsChurch === true ? { needsChurch: true } : {}),
		...(value.giving === "church" || value.giving === "need" ? { giving: value.giving } : {}),
		verse,
	};
}

/**
 * The `serve` object of `GET`/`PATCH /api/serve`, or null when it is not one.
 * Defensive because a newer server may add an action this build does not
 * know: that way still renders, just without a button, rather than the whole
 * screen failing.
 */
export function parseServeView(value: unknown): ServeView | null {
	if (!isRecord(value)) return null;
	const settings = isRecord(value.settings) ? value.settings : null;
	const intro = isRecord(value.intro) ? value.intro : null;
	const journal = isRecord(value.journal) ? value.journal : null;
	const nearby = isRecord(value.nearby) ? value.nearby : null;
	const searches: unknown = nearby?.searches;
	const title = str(value.title);
	if (!settings || !intro || !journal || !title || !isServeMode(settings.mode)) return null;
	const journalVerse = parseVerse(journal.verse);
	if (!journalVerse) return null;
	const church = isRecord(value.church) && str(value.church.name)
		? { name: value.church.name as string, website: str(value.church.website) }
		: null;
	return {
		title,
		settings: { mode: settings.mode, givesToChurch: settings.givesToChurch === true },
		intro: {
			text: str(intro.text) ?? "",
			verses: Array.isArray(intro.verses)
				? intro.verses.map(parseVerse).filter((verse): verse is VerseView => verse !== null)
				: [],
		},
		today: parseWay(value.today),
		ways: Array.isArray(value.ways)
			? value.ways.map(parseWay).filter((way): way is WayView => way !== null)
			: [],
		church,
		nearby: {
			available: nearby?.available === true,
			searches: Array.isArray(searches)
				? searches.flatMap((search: unknown) =>
					isRecord(search) && str(search.id) && str(search.label)
						? [{ id: search.id as string, label: search.label as string }]
						: []
				)
				: [],
		},
		journal: { title: str(journal.title) ?? "", prompt: str(journal.prompt) ?? "", verse: journalVerse },
	};
}

/** The view with a new choice painted in, before the server confirms it. */
export function withSettings(view: ServeView, patch: Partial<ServeSettings>): ServeView {
	return { ...view, settings: { ...view.settings, ...patch } };
}

/** The Today card shows only when the reader has the feature on and there is a way for today. */
export function todayCardWay(view: ServeView | null): WayView | null {
	if (!view || view.settings.mode === "off") return null;
	return view.today;
}

/** What a way's button does on this client. */
export type ServeStep =
	| { kind: "share-verse"; reference: string }
	| { kind: "chat"; prompt: string }
	| { kind: "nearby" }
	| { kind: "church" }
	| { kind: "url"; url: string }
	| { kind: "journal"; reference: string | null };

export const PRAY_PROMPT = "I want to pray for someone by name today.";
export const NEARBY_FALLBACK_PROMPT = "Where could I help or give near me?";

export function shareVersePrompt(reference: string): string {
	return `Help me send someone ${reference} with a word of encouragement`;
}

export function reachOutPrompt(title: string): string {
	return `Help me write a kind message to ${title.toLowerCase()}.`;
}

export interface StepContext {
	nearbyAvailable: boolean;
	churchWebsite: string | null;
	/** The share-a-verse sheet can take this reference (Android's Send a word). */
	canShareVerse: boolean;
}

/** Null means the way has no button (no action, or no church website to open). */
export function stepFor(way: WayView, context: StepContext): ServeStep | null {
	switch (way.action) {
		case "share-verse":
			return context.canShareVerse && way.verse.reference
				? { kind: "share-verse", reference: way.verse.reference }
				: { kind: "chat", prompt: shareVersePrompt(way.verse.reference) };
		case "pray":
			return { kind: "chat", prompt: PRAY_PROMPT };
		case "reach-out":
			return { kind: "chat", prompt: reachOutPrompt(way.title) };
		case "nearby":
		case "give-need":
			return context.nearbyAvailable ? { kind: "nearby" } : { kind: "chat", prompt: NEARBY_FALLBACK_PROMPT };
		case "church":
			return { kind: "church" };
		case "give-church":
			// Places data, but still only ever hand Linking a web page.
			return context.churchWebsite && /^https?:\/\//i.test(context.churchWebsite)
				? { kind: "url", url: context.churchWebsite }
				: null;
		case "journal":
			return { kind: "journal", reference: way.verse.reference || null };
		default:
			return null;
	}
}

/** The button's words. Plain invitations: nothing reads as a task to complete. */
export function stepLabel(step: ServeStep): string {
	switch (step.kind) {
		case "share-verse":
			return "Send this verse";
		case "chat":
			return "Ask SureWord";
		case "nearby":
			return "Find a place near me";
		case "church":
			return "Open My church";
		case "url":
			return "Visit your church's website";
		case "journal":
			return "Write it down";
	}
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 27, 2026" in the device's local day; empty for an unreadable date. */
export function entryDateLabel(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "tel:" link for a listed phone number, keeping only what a dialer reads. */
export function telUrl(phone: string): string {
	return `tel:${phone.replace(/[^+\d]/g, "")}`;
}
