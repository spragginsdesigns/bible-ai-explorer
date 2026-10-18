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
 * Upcoming events, soonest first. `studyId` narrows to what was announced at
 * one service, which is what a study screen shows.
 */
export async function listChurchEvents(
	userId: string,
	options: { studyId?: string; now?: Date } = {}
): Promise<ChurchEventsResult> {
	const church = await readerChurch(userId);
	if (!church) return EMPTY;
	const now = options.now ?? new Date();
	// An all-day event started at local midnight, so look back a day to keep
	// today's in the list until the day is over; isUpcoming does the real cut.
	const rows = await prisma.churchEvent.findMany({
		where: {
			channelId: church.channelId,
			startsAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) },
			...(options.studyId ? { studyId: options.studyId } : {}),
		},
		orderBy: { startsAt: "asc" },
		take: MAX_EVENTS * 3,
		select: EVENT_SELECT,
	});
	const app = churchAppFor(church.channelId);
	const location = defaultLocation(church);
	const events = dedupeEvents(rows.map(toRecord))
		.filter((event) => isUpcoming(event, now))
		.slice(0, MAX_EVENTS)
		.map((event) => toEventView(event, event.location ?? location, app));
	return { events, churchApp: app };
}

/**
 * One event as an .ics file, or null when it does not exist or belongs to
 * another church. The channel is part of the lookup, as for studies.
 */
export async function churchEventIcs(
	userId: string,
	id: string
): Promise<{ fileName: string; body: string } | null> {
	const church = await readerChurch(userId);
	if (!church) return null;
	const row = await prisma.churchEvent.findFirst({
		where: { id, channelId: church.channelId },
		select: EVENT_SELECT,
	});
	if (!row) return null;
	const event = toRecord(row);
	return {
		fileName: icsFileName(event.title),
		body: buildIcs(event, event.location ?? defaultLocation(church), churchAppFor(church.channelId)),
	};
}
