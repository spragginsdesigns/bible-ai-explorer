/**
 * Sermon studies, Android mirror of `src/lib/sermon-studies.ts`.
 *
 * The server owns everything: which studies this account may see (the channel
 * on their UserChurch), how they are built, and what a section contains. This
 * file is the shape the screens render and nothing more.
 */
import { apiJson } from "@/lib/api";

type GetToken = Parameters<typeof apiJson>[0];

export interface SermonSection {
	heading: string;
	startMs: number;
	/** Verbatim from the recording, or null when nothing quotable was verified. */
	pastorQuote: string | null;
	passage: string | null;
	passageText: { verse: number; text: string }[] | null;
	/** SureWord's own teaching, always labelled as such on screen. */
	explanation: string;
	reflection: string;
	imageUrl: string | null;
}

export interface SermonStudySummary {
	id: string;
	videoId: string;
	title: string;
	serviceTitle: string;
	serviceDate: string | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
	imageUrl: string | null;
}

export interface SermonStudyDetail extends SermonStudySummary {
	summary: string;
	application: string;
	prayer: string;
	sections: SermonSection[];
	sermonStartMs: number | null;
	durationSec: number | null;
}

/**
 * A gathering announced at a service, mirror of `ChurchEventView` in
 * `src/lib/church-events-rules.ts`. The server has already done the time zone
 * work: `when` is the label, the calendar links are built.
 */
export interface ChurchEvent {
	id: string;
	studyId: string;
	title: string;
	details: string | null;
	audience: string | null;
	location: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	timeZone: string;
	when: string;
	/** False means the time needs checking in the church's app. */
	certain: boolean;
	sourceQuote: string;
	sourceUrl: string;
	googleCalendarUrl: string;
	icsPath: string;
}

/** The church's own app, where an unsure time can be checked. */
export interface ChurchApp {
	name: string;
	androidUrl: string;
	iosUrl: string;
}

export interface ChurchEvents {
	events: ChurchEvent[];
	churchApp: ChurchApp | null;
}

type WithEvents = { events?: ChurchEvent[]; churchApp?: ChurchApp | null };

const eventsOf = (data: WithEvents): ChurchEvents => ({
	events: data.events ?? [],
	churchApp: data.churchApp ?? null,
});

export async function fetchSermonStudies(getToken: GetToken): Promise<SermonStudySummary[]> {
	return (await fetchSermonHome(getToken)).studies;
}

/** The studies list, with the church's coming events riding along. */
export async function fetchSermonHome(
	getToken: GetToken
): Promise<ChurchEvents & { studies: SermonStudySummary[] }> {
	const data = await apiJson<{ studies?: SermonStudySummary[] } & WithEvents>(
		getToken,
		"/api/sermon-studies"
	);
	return { studies: data.studies ?? [], ...eventsOf(data) };
}

/** One study, with the still-upcoming events announced at that service. */
export async function fetchSermonStudy(
	getToken: GetToken,
	id: string
): Promise<ChurchEvents & { study: SermonStudyDetail }> {
	const data = await apiJson<{ study: SermonStudyDetail } & WithEvents>(
		getToken,
		`/api/sermon-studies/${encodeURIComponent(id)}`
	);
	return { study: data.study, ...eventsOf(data) };
}

/** Deep link into the recording, at a moment when one is given. */
export function watchUrl(videoId: string, atMs?: number | null): string {
	const base = `https://www.youtube.com/watch?v=${videoId}`;
	return typeof atMs === "number" ? `${base}&t=${Math.floor(atMs / 1000)}s` : base;
}

export function formatTimestamp(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

export function formatServiceDate(date: string | null): string | null {
	if (!date) return null;
	const parsed = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
}
