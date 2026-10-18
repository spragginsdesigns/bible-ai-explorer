import "server-only";

import { prisma } from "@/lib/prisma";
import {
	buildIcs,
	churchAppFor,
	dedupeEvents,
	icsFileName,
	isUpcoming,
	toEventView,
	type ChurchApp,
	type ChurchEventRecord,
	type ChurchEventView,
} from "@/lib/church-events-rules";

/**
 * Coming events at the reader's own church, announced during recorded services
 * and stored by the sermon ingest (`POST /api/sermon-studies/ingest/events`).
 *
 * The access rule is the sermon studies' rule: the channel on the reader's
 * UserChurch. A reader with no church, or a church nothing is ingested for,
 * gets no events and the card never renders.
 */

export interface ChurchEventsResult {
	events: ChurchEventView[];
	/** The church's own app, where an unsure time can be checked. */
	churchApp: ChurchApp | null;
}

const EMPTY: ChurchEventsResult = { events: [], churchApp: null };

/** How many events one read hands back. */
const MAX_EVENTS = 20;

const EVENT_SELECT = {
	id: true,
	studyId: true,
	title: true,
	details: true,
	audience: true,
	location: true,
	startsAt: true,
	endsAt: true,
	allDay: true,
	timeZone: true,
	certain: true,
	sourceQuote: true,
	sourceMs: true,
	study: { select: { videoId: true, serviceDate: true } },
} as const;

type EventRow = Omit<ChurchEventRecord, "videoId" | "serviceDate"> & {
	study: { videoId: string; serviceDate: Date | null };
};

function toRecord(row: EventRow): ChurchEventRecord {
	const { study, ...rest } = row;
	return { ...rest, videoId: study.videoId, serviceDate: study.serviceDate };
}

/** Where an event with no stated place happens: the church itself. */
function defaultLocation(church: { name: string; address: string }): string {
	return [church.name, church.address].filter(Boolean).join(", ");
}

async function readerChurch(userId: string) {
	const church = await prisma.userChurch.findUnique({
		where: { userId },
		select: { youtubeChannelId: true, name: true, address: true },
	});
	return church?.youtubeChannelId ? { ...church, channelId: church.youtubeChannelId } : null;
}

/**
 * Every upcoming gathering at the church, merged across the services that
 * announced it. Both screens and the .ics read this one list, so a time that
 * one service gave and a later one left out is unconfirmed everywhere, and a
 * study screen shows the newest time rather than what was said that week.
 */
async function upcomingGatherings(channelId: string, now: Date) {
	// An all-day event started at local midnight, so look back a day to keep
	// today's in the list until the day is over; isUpcoming does the real cut.
	const rows = await prisma.churchEvent.findMany({
		where: { channelId, startsAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) } },
		orderBy: { startsAt: "asc" },
		take: 200,
		select: EVENT_SELECT,
	});
	return dedupeEvents(rows.map(toRecord)).filter((event) => isUpcoming(event, now));
}

/**
 * Upcoming events, soonest first. `studyId` narrows to the gatherings
 * announced at one service, which is what a study screen shows.
 */
export async function listChurchEvents(
	userId: string,
	options: { studyId?: string; now?: Date } = {}
): Promise<ChurchEventsResult> {
	const church = await readerChurch(userId);
	if (!church) return EMPTY;
	const app = churchAppFor(church.channelId);
	const location = defaultLocation(church);
	const events = (await upcomingGatherings(church.channelId, options.now ?? new Date()))
		.filter((event) => !options.studyId || event.announcedIn.includes(options.studyId))
		.slice(0, MAX_EVENTS)
		.map((event) => toEventView(event, event.location ?? location, app));
	return { events, churchApp: app };
}

/**
 * The events for a sermon screen, or none if they cannot be read. The events
 * ride along with the studies, so a failure here must never take the studies
 * down with it.
 */
export async function churchEventsForScreen(
	userId: string,
	options: { studyId?: string } = {}
): Promise<ChurchEventsResult> {
	try {
		return await listChurchEvents(userId, options);
	} catch (error) {
		console.error("[church-events] read failed", error);
		return EMPTY;
	}
}

/**
 * One event as an .ics file, or null when it does not exist, is over, or
 * belongs to another church. It is built from the same merged record the card
 * shows, never the raw row, so an unconfirmed time says so in the file too.
 */
export async function churchEventIcs(
	userId: string,
	id: string,
	now: Date = new Date()
): Promise<{ fileName: string; body: string } | null> {
	const church = await readerChurch(userId);
	if (!church) return null;
	const event = (await upcomingGatherings(church.channelId, now)).find((gathering) => gathering.id === id);
	if (!event) return null;
	return {
		fileName: icsFileName(event.title),
		body: buildIcs(event, event.location ?? defaultLocation(church), churchAppFor(church.channelId)),
	};
}
