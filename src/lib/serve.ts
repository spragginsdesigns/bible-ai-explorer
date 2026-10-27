import "server-only";
import { prisma } from "@/lib/prisma";
import { isPlacesConfigured } from "@/lib/church-rules";
import { searchServePlaces, type ServePlace } from "@/lib/google-places";
import { getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";
import {
	FAITH_FIRST_REFS,
	FAITH_FIRST_TEXT,
	JOURNAL_PROMPT,
	JOURNAL_REF,
	JOURNAL_TITLE,
	MAX_ENTRIES_LISTED,
	NEARBY_SEARCHES,
	SERVE_TITLE,
	dayKey,
	formatRef,
	pickToday,
	readServeMode,
	waysFor,
	type ServeMode,
	type ServeWay,
	type VerseRef,
} from "@/lib/serve-rules";

/**
 * Ways to Serve on the server (docs/FEATURES.md). Every client reads the
 * whole view from `GET /api/serve`, so the ways, their verses and the
 * faith-first wording live in one place: `serve-rules.ts`.
 */

export interface ServeSettings {
	mode: ServeMode;
	givesToChurch: boolean;
}

export interface VerseView {
	reference: string;
	text: string;
}

export interface WayView extends Omit<ServeWay, "ref"> {
	verse: VerseView;
}

export interface ServeEntryView {
	id: string;
	text: string;
	verseRef: string | null;
	createdAt: string;
}

export interface ServeView {
	title: string;
	settings: ServeSettings;
	intro: { text: string; verses: VerseView[] };
	/** One way for today, or null when Ways to Serve is off. */
	today: WayView | null;
	ways: WayView[];
	church: { name: string; website: string | null } | null;
	nearby: { available: boolean; searches: { id: string; label: string }[] };
	journal: { title: string; prompt: string; verse: VerseView };
}

const verseCache = new Map<string, string>();

async function verseView(ref: VerseRef): Promise<VerseView> {
	const reference = formatRef(ref);
	const cached = verseCache.get(reference);
	if (cached !== undefined) return { reference, text: cached };
	const book = getKjvBookNumber(ref.book);
	const text = (book ? await getKjvVerseText(book, ref.chapter, ref.verse) : null) ?? "";
	// Only real verses are cached, so made-up references from journal input
	// cannot grow the map without bound.
	if (text) verseCache.set(reference, text);
	return { reference, text };
}

async function wayView(way: ServeWay): Promise<WayView> {
	const { ref, ...rest } = way;
	return { ...rest, verse: await verseView(ref) };
}

export async function loadServeSettings(userId: string): Promise<ServeSettings> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { serveMode: true, givesToChurch: true } });
	return { mode: readServeMode(user?.serveMode), givesToChurch: user?.givesToChurch ?? false };
}

export async function saveServeSettings(userId: string, patch: Partial<ServeSettings>): Promise<ServeSettings> {
	const user = await prisma.user.update({
		where: { id: userId },
		data: {
			...(patch.mode ? { serveMode: patch.mode } : {}),
			...(typeof patch.givesToChurch === "boolean" ? { givesToChurch: patch.givesToChurch } : {}),
		},
		select: { serveMode: true, givesToChurch: true },
	});
	return { mode: readServeMode(user.serveMode), givesToChurch: user.givesToChurch };
}

export async function buildServeView(userId: string, now: Date = new Date()): Promise<ServeView> {
	const [settings, church] = await Promise.all([
		loadServeSettings(userId),
		prisma.userChurch.findUnique({ where: { userId }, select: { name: true, website: true } }),
	]);
	const context = { mode: settings.mode, hasChurch: Boolean(church), givesToChurch: settings.givesToChurch };
	const today = pickToday(userId, dayKey(now), context);
	const nearbyOn = settings.mode === "nearby" || settings.mode === "both";
	return {
		title: SERVE_TITLE,
		settings,
		intro: { text: FAITH_FIRST_TEXT, verses: await Promise.all(FAITH_FIRST_REFS.map(verseView)) },
		today: today ? await wayView(today) : null,
		ways: await Promise.all(waysFor(context).map(wayView)),
		church: church ? { name: church.name, website: church.website } : null,
		nearby: {
			available: nearbyOn && isPlacesConfigured(process.env.GOOGLE_PLACES_API_KEY),
			searches: NEARBY_SEARCHES.map(({ id, label }) => ({ id, label })),
		},
		journal: { title: JOURNAL_TITLE, prompt: JOURNAL_PROMPT, verse: await verseView(JOURNAL_REF) },
	};
}

/** Real KJV reference or null, so the journal never stores a verse that is not there. */
export async function resolveVerseRef(ref: VerseRef | null): Promise<string | null> {
	if (!ref) return null;
	const view = await verseView(ref);
	return view.text ? view.reference : null;
}

function entryView(entry: { id: string; text: string; verseRef: string | null; createdAt: Date }): ServeEntryView {
	return { id: entry.id, text: entry.text, verseRef: entry.verseRef, createdAt: entry.createdAt.toISOString() };
}

export async function listServeEntries(userId: string): Promise<ServeEntryView[]> {
	const entries = await prisma.serviceEntry.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: MAX_ENTRIES_LISTED,
	});
	return entries.map(entryView);
}

export async function addServeEntry(userId: string, text: string, verseRef: string | null): Promise<ServeEntryView> {
	return entryView(await prisma.serviceEntry.create({ data: { userId, text, verseRef } }));
}

/** False when there was no such entry of theirs; never touches anyone else's. */
export async function deleteServeEntry(userId: string, id: string): Promise<boolean> {
	const result = await prisma.serviceEntry.deleteMany({ where: { id, userId } });
	return result.count > 0;
}

export async function findServePlaces(location: string, searchId: string): Promise<ServePlace[]> {
	const search = NEARBY_SEARCHES.find((candidate) => candidate.id === searchId) ?? NEARBY_SEARCHES[0];
	return searchServePlaces(`${search.query} near ${location}`);
}
