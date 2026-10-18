import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
	DEFAULT_CHURCH_TIME_ZONE,
	isLocalDate,
	isLocalTime,
	zonedTimeToUtc,
} from "@/lib/church-events-rules";

/**
 * Where the events announced at a service arrive, from the same machine and
 * behind the same SERMON_INGEST_SECRET as the study itself
 * (`../route.ts`). Posted after the study, keyed by its video, and replaces
 * whatever that service had before, so re-running the pipeline never doubles
 * an event.
 *
 * The pipeline resolves "tomorrow evening" into a local date and clock time;
 * turning that into an instant happens here, in one place, so every client
 * receives the same moment.
 */

const eventSchema = z.object({
	title: z.string().trim().min(1).max(160),
	details: z.string().trim().max(600).nullish(),
	audience: z.string().trim().max(120).nullish(),
	location: z.string().trim().max(200).nullish(),
	date: z.string().refine(isLocalDate, "date must be YYYY-MM-DD"),
	startTime: z.string().refine(isLocalTime, "startTime must be HH:MM").nullish(),
	endTime: z.string().refine(isLocalTime, "endTime must be HH:MM").nullish(),
	certain: z.boolean(),
	unsureWhy: z.string().trim().max(300).nullish(),
	sourceQuote: z.string().trim().min(1).max(1200),
	sourceMs: z.number().int().nonnegative(),
});

const bodySchema = z.object({
	videoId: z.string().regex(/^[\w-]{11}$/),
	timeZone: z.string().min(1).max(64).nullish(),
	events: z.array(eventSchema).max(40),
});

function validTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export async function POST(request: Request) {
	const secret = process.env.SERMON_INGEST_SECRET?.trim();
	if (!secret) {
		return NextResponse.json({ error: "Ingest is not configured" }, { status: 503 });
	}
	if (request.headers.get("x-ingest-secret") !== secret) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let parsed;
	try {
		parsed = bodySchema.safeParse(await request.json());
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	if (!parsed.success) {
		return NextResponse.json(
			{ error: "Invalid events", issues: parsed.error.issues.slice(0, 8) },
			{ status: 400 }
		);
	}
	const body = parsed.data;
	const timeZone = body.timeZone ?? DEFAULT_CHURCH_TIME_ZONE;
	if (!validTimeZone(timeZone)) {
		return NextResponse.json({ error: "Unknown time zone" }, { status: 400 });
	}

	const study = await prisma.sermonStudy.findUnique({
		where: { videoId: body.videoId },
		select: { id: true, channelId: true },
	});
	if (!study) {
		return NextResponse.json({ error: "Publish the study first" }, { status: 404 });
	}

	const rows = body.events.map((event) => {
		const allDay = !event.startTime;
		const startsAt = zonedTimeToUtc(event.date, event.startTime ?? null, timeZone);
		const endsAt =
			event.startTime && event.endTime ? zonedTimeToUtc(event.date, event.endTime, timeZone) : null;
		return {
			studyId: study.id,
			channelId: study.channelId,
			title: event.title,
			details: event.details ?? null,
			audience: event.audience ?? null,
			location: event.location ?? null,
			startsAt,
			endsAt: endsAt && endsAt > startsAt ? endsAt : null,
			allDay,
			timeZone,
			// A day with no clock time can never be certain, whatever was sent.
			certain: event.certain && !allDay,
			unsureWhy: event.unsureWhy ?? null,
			sourceQuote: event.sourceQuote,
			sourceMs: event.sourceMs,
		};
	});

	try {
		await prisma.$transaction([
			prisma.churchEvent.deleteMany({ where: { studyId: study.id } }),
			prisma.churchEvent.createMany({ data: rows }),
		]);
		return NextResponse.json({ studyId: study.id, stored: rows.length });
	} catch (error) {
		console.error("[sermon-studies] event ingest failed", error);
		return NextResponse.json({ error: "Failed to store events" }, { status: 500 });
	}
}
