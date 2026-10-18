/**
 * Pure rules for church events: the gatherings a church announces from the
 * pulpit ("the trustees meet tomorrow at 6:30"), lifted out of the recorded
 * service by scripts/sermon and stored as `ChurchEvent` rows.
 *
 * Everything here is free of Prisma and `server-only` so it can be tested
 * directly (`tests/church-events-rules.test.mjs`). The server module that reads
 * the rows is `src/lib/church-events.ts`.
 *
 * The one editorial rule: a time we are not sure of is never shown as if we
 * were. Such an event still appears, labelled as needing a check, and points
 * the reader at the church's own app, which is where the real time lives.
 */

/** Where every church event is placed in time unless a church says otherwise. */
export const DEFAULT_CHURCH_TIME_ZONE = "America/Los_Angeles";

/** How long an event with no stated end is assumed to run, for calendars. */
export const DEFAULT_EVENT_MINUTES = 90;

/** Furthest ahead an announcement is believed; past this it is a misreading. */
export const MAX_EVENT_DAYS_AHEAD = 120;

/** A church's own app, the source of truth for an exact time. */
export interface ChurchApp {
	name: string;
	androidUrl: string;
	iosUrl: string;
}

/**
 * Churches whose services are ingested, keyed by YouTube channel. Only these
 * have events at all, so this is the whole list, not a lookup table that could
 * be missing someone.
 */
const CHURCH_APPS: Record<string, ChurchApp> = {
	// First Missionary Baptist Church, Fresno. Their Subsplash app.
	UCiTssyWZc2PJ25OAZOaN7Ag: {
		name: "FMBC Fresno",
		androidUrl: "https://play.google.com/store/apps/details?id=com.subsplashconsulting.s_W98M7N",
		iosUrl: "https://apps.apple.com/us/app/fmbc-fresno/id1567963142",
	},
};

export function churchAppFor(channelId: string | null | undefined): ChurchApp | null {
	return (channelId && CHURCH_APPS[channelId]) || null;
}

/** One stored event, as the server reads it back. */
export interface ChurchEventRecord {
	id: string;
	studyId: string;
	videoId: string;
	title: string;
	details: string | null;
	audience: string | null;
	location: string | null;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	timeZone: string;
	certain: boolean;
	sourceQuote: string;
	sourceMs: number;
	/** When the service this was announced at took place. */
	serviceDate: Date | null;
}

/** One event as every client renders it. Clients do no time zone math. */
export interface ChurchEventView {
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
	/** "Monday, October 13 at 6:30 PM", in the church's own time zone. */
	when: string;
	/** False means the time needs checking in the church's app. */
	certain: boolean;
	/** What was said, verbatim from the recording. */
	sourceQuote: string;
	/** The recording at the moment it was announced. */
	sourceUrl: string;
	googleCalendarUrl: string;
	/** The notes a calendar entry carries, for clients that build the event natively. */
	calendarNotes: string;
	/** When the calendar entry ends: the stated end, or a default length, or the next midnight. */
	calendarEndsAt: string;
	/** Where the calendar entry is, defaulting to the church itself. */
	calendarLocation: string | null;
	/** Relative path of the .ics for Apple Calendar and every other calendar. */
	icsPath: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const m = value.match(DATE);
	if (!m) return false;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function isLocalTime(value: unknown): value is string {
	return typeof value === "string" && TIME.test(value);
}

/** Wall clock parts of an instant in a time zone. */
function partsIn(instant: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(instant);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return {
		year: get("year"),
		month: get("month"),
		day: get("day"),
		hour: get("hour"),
		minute: get("minute"),
		second: get("second"),
	};
}

/**
 * The instant a wall clock time names in a time zone. Two passes, because the
 * offset is only known once you know which side of a DST change you are on.
 */
export function zonedTimeToUtc(date: string, time: string | null, timeZone: string): Date {
	const [y, mo, d] = date.split("-").map(Number);
	const [h, mi] = (time ?? "00:00").split(":").map(Number);
	const wall = Date.UTC(y, mo - 1, d, h, mi);
	let guess = wall;
	for (let i = 0; i < 2; i += 1) {
		const p = partsIn(new Date(guess), timeZone);
		const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
		guess += wall - seen;
	}
	return new Date(guess);
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function localDateOf(instant: Date, timeZone: string): string {
	const p = partsIn(instant, timeZone);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** When an event stops being worth showing. */
export function eventEndsAt(event: Pick<ChurchEventRecord, "startsAt" | "endsAt" | "allDay" | "timeZone">): Date {
	if (event.endsAt) return event.endsAt;
	if (event.allDay) {
		const next = addDays(localDateOf(event.startsAt, event.timeZone), 1);
		return zonedTimeToUtc(next, null, event.timeZone);
	}
	return new Date(event.startsAt.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
}

export function isUpcoming(
	event: Pick<ChurchEventRecord, "startsAt" | "endsAt" | "allDay" | "timeZone">,
	now: Date = new Date()
): boolean {
	return eventEndsAt(event).getTime() > now.getTime();
}

/** "Monday, October 13 at 6:30 PM", or "Sunday, October 19" for a day with no time. */
export function formatEventWhen(
	event: Pick<ChurchEventRecord, "startsAt" | "endsAt" | "allDay" | "timeZone">
): string {
	const day = new Intl.DateTimeFormat("en-US", {
		timeZone: event.timeZone,
		weekday: "long",
		month: "long",
		day: "numeric",
	}).format(event.startsAt);
	if (event.allDay) return day;
	const clock = new Intl.DateTimeFormat("en-US", {
		timeZone: event.timeZone,
		hour: "numeric",
		minute: "2-digit",
	});
	const start = clock.format(event.startsAt);
	return event.endsAt ? `${day}, ${start} to ${clock.format(event.endsAt)}` : `${day} at ${start}`;
}

const normalizeTitle = (title: string) =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\b(the|a|an|s)\b/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * "Ladies fellowship" and "Ladies' fellowship lunch" on one day are one
 * gathering. The same title on the same day announced at another service is
 * one gathering even at another time (a reschedule, which the newest
 * announcement settles), but from one service it is two sessions ("Bible
 * study at 10 and again at 6:30"). A title that only contains the other must
 * also agree on the time, or "Choir rehearsal" at 5 would swallow "Youth
 * choir rehearsal" at 7.
 */
function sameGathering(a: ChurchEventRecord, b: ChurchEventRecord): boolean {
	if (localDateOf(a.startsAt, a.timeZone) !== localDateOf(b.startsAt, b.timeZone)) return false;
	const x = normalizeTitle(a.title);
	const y = normalizeTitle(b.title);
	if (!x || !y) return false;
	const sameTime = a.allDay || b.allDay || a.startsAt.getTime() === b.startsAt.getTime();
	if (x === y) return sameTime || a.studyId !== b.studyId;
	if (!x.includes(y) && !y.includes(x)) return false;
	return sameTime;
}

const announcedAt = (event: ChurchEventRecord) => event.serviceDate?.getTime() ?? 0;

/**
 * The same gathering announced at several services (a revival announced three
 * Sundays running) is one event. The latest announcement wins, because a time
 * that changed was changed most recently. The one exception is a latest
 * announcement that gave no time when an earlier one did: the earlier time is
 * kept, but as unconfirmed, since nobody restated it.
 *
 * `announcedIn` lists every study that announced the gathering, so a study
 * screen can show the merged event (with the newest time) for its service.
 */
export function dedupeEvents<T extends ChurchEventRecord>(events: T[]): (T & { announcedIn: string[] })[] {
	const groups: T[][] = [];
	for (const event of events) {
		const group = groups.find((members) => members.some((member) => sameGathering(member, event)));
		if (group) group.push(event);
		else groups.push([event]);
	}
	const kept = groups.map((members) => {
		const announcedIn = [...new Set(members.map((member) => member.studyId))];
		const newest = [...members].sort(
			(a, b) => announcedAt(b) - announcedAt(a) || Number(b.certain) - Number(a.certain)
		);
		const latest = newest[0];
		if (!latest.allDay) return { ...latest, announcedIn };
		const timed = newest.find((member) => !member.allDay);
		return timed ? { ...timed, certain: false, announcedIn } : { ...latest, announcedIn };
	});
	return kept.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function eventWatchUrl(videoId: string, atMs: number): string {
	return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(Math.max(0, atMs) / 1000)}s`;
}

/** The words that go in a calendar entry's notes. */
export function calendarDescription(event: ChurchEventRecord, app: ChurchApp | null): string {
	const lines: string[] = [];
	if (event.details) lines.push(event.details);
	if (event.audience) lines.push(`For: ${event.audience}`);
	if (!event.certain) {
		lines.push(
			app
				? `The time was not clear in the recording. Check the ${app.name} app for the exact time.`
				: "The time was not clear in the recording. Check with the church for the exact time."
		);
	}
	lines.push(`Announced at church: "${event.sourceQuote}"`);
	lines.push(`Hear the announcement: ${eventWatchUrl(event.videoId, event.sourceMs)}`);
	if (!event.certain && app) lines.push(`${app.name}: ${app.androidUrl} or ${app.iosUrl}`);
	lines.push("Added from SureWord.");
	return lines.join("\n\n");
}

const compact = (instant: Date) => instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compactDate = (date: string) => date.replace(/-/g, "");

function calendarSpan(event: ChurchEventRecord): { start: string; end: string } {
	if (event.allDay) {
		const day = localDateOf(event.startsAt, event.timeZone);
		return { start: compactDate(day), end: compactDate(addDays(day, 1)) };
	}
	return { start: compact(event.startsAt), end: compact(eventEndsAt(event)) };
}

/** Google Calendar's own "add event" page, prefilled. */
export function googleCalendarUrl(
	event: ChurchEventRecord,
	location: string | null,
	app: ChurchApp | null
): string {
	const { start, end } = calendarSpan(event);
	const query = new URLSearchParams({
		action: "TEMPLATE",
		text: event.title,
		dates: `${start}/${end}`,
		details: calendarDescription(event, app),
		ctz: event.timeZone,
	});
	if (location) query.set("location", location);
	return `https://calendar.google.com/calendar/render?${query}`;
}

/** RFC 5545 text escaping. */
function icsText(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Lines longer than 75 octets are folded, without splitting a character. */
function fold(line: string): string {
	const out: string[] = [];
	let current = "";
	let bytes = 0;
	for (const char of line) {
		const size = Buffer.byteLength(char);
		if (bytes + size > (out.length ? 74 : 75)) {
			out.push(current);
			current = "";
			bytes = 0;
		}
		current += char;
		bytes += size;
	}
	out.push(current);
	return out.join("\r\n ");
}

/** One event as an .ics file, which Apple Calendar, Outlook and the rest open. */
export function buildIcs(
	event: ChurchEventRecord,
	location: string | null,
	app: ChurchApp | null,
	now: Date = new Date()
): string {
	const { start, end } = calendarSpan(event);
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//SureWord//Church events//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:${event.id}@sureword.app`,
		`DTSTAMP:${compact(now)}`,
		event.allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
		event.allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
		`SUMMARY:${icsText(event.title)}`,
		`DESCRIPTION:${icsText(calendarDescription(event, app))}`,
		...(location ? [`LOCATION:${icsText(location)}`] : []),
		"END:VEVENT",
		"END:VCALENDAR",
	];
	return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A file name a phone will show the reader, from the event title. */
export function icsFileName(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return `${slug || "church-event"}.ics`;
}

export function toEventView(
	event: ChurchEventRecord,
	location: string | null,
	app: ChurchApp | null
): ChurchEventView {
	return {
		id: event.id,
		studyId: event.studyId,
		title: event.title,
		details: event.details,
		audience: event.audience,
		location: event.location,
		startsAt: event.startsAt.toISOString(),
		endsAt: event.endsAt?.toISOString() ?? null,
		allDay: event.allDay,
		timeZone: event.timeZone,
		when: formatEventWhen(event),
		certain: event.certain,
		sourceQuote: event.sourceQuote,
		sourceUrl: eventWatchUrl(event.videoId, event.sourceMs),
		googleCalendarUrl: googleCalendarUrl(event, location, app),
		calendarNotes: calendarDescription(event, app),
		calendarEndsAt: eventEndsAt(event).toISOString(),
		calendarLocation: location,
		icsPath: `/api/church-events/${encodeURIComponent(event.id)}/ics`,
	};
}

/** Coming events at their church, as the chat model reads them. */
export function formatChurchEventsForModel(events: ChurchEventView[], app: ChurchApp | null): string {
	if (events.length === 0) {
		return "Nothing coming up has been announced at their church in the recorded services SureWord has. Say so plainly, never invent an event, and suggest they check with the church" +
			(app ? ` or the ${app.name} app.` : ".");
	}
	const rows = events.map((event) => {
		const parts = [
			`- ${event.title}: ${event.when}`,
			event.location ? `at ${event.location}` : null,
			event.audience ? `(for ${event.audience})` : null,
		].filter(Boolean);
		const flag = event.certain
			? ""
			: " TIME NOT CONFIRMED: the recording was unclear, so tell them to check" +
				(app ? ` the ${app.name} app` : " with the church") +
				" before relying on it.";
		return `${parts.join(" ")}.${flag} Announced as: "${event.sourceQuote}"`;
	});
	return [
		"Coming up at their church, announced from the pulpit in recent services (soonest first):",
		...rows,
		"These come from what was said aloud, so give the time exactly as listed and never add details that were not announced." +
			(app
				? ` The church's own app, ${app.name}, has the official schedule: Android ${app.androidUrl}, iPhone ${app.iosUrl}.`
				: ""),
		"Every event has Add to Google Calendar and Apple Calendar buttons in the Sermon studies screen.",
	].join("\n");
}
