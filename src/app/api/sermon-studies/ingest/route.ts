import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Where a finished sermon study arrives from the machine that built it.
 *
 * This is the one route in the app that is not Clerk authenticated, because
 * the caller is a scheduled script rather than a person. It is guarded by a
 * shared secret in SERMON_INGEST_SECRET and does nothing at all when that is
 * unset, so an unconfigured deploy cannot be written to.
 *
 * Ingestion has to live outside Vercel: YouTube refuses datacenter ranges with
 * "Sign in to confirm you're not a bot", transcription wants a GPU, and a 76
 * minute service is far past the function budget. See scripts/sermon/ingest.mjs.
 */

const sectionSchema = z.object({
	heading: z.string().min(1),
	startMs: z.number().int().nonnegative(),
	pastorQuote: z.string().nullish(),
	passage: z.string().nullish(),
	passageText: z
		.array(z.object({ verse: z.number().int().positive(), text: z.string() }))
		.nullish(),
	explanation: z.string().min(1),
	reflection: z.string().min(1),
	imageUrl: z.url().nullish(),
});

const bodySchema = z.object({
	videoId: z.string().regex(/^[\w-]{11}$/),
	channelId: z.string().min(1),
	serviceTitle: z.string().min(1),
	serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
	preacher: z.string().nullish(),
	preachingText: z.string().nullish(),
	title: z.string().min(1),
	bigIdea: z.string().min(1),
	summary: z.string().min(1),
	application: z.string().min(1),
	prayer: z.string().min(1),
	sections: z.array(sectionSchema).min(1),
	sermonStartMs: z.number().int().nonnegative().nullish(),
	sermonEndMs: z.number().int().nonnegative().nullish(),
	durationSec: z.number().int().nonnegative().nullish(),
	writerModel: z.string().nullish(),
});

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

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
			{ error: "Invalid study", issues: parsed.error.issues.slice(0, 8) },
			{ status: 400 }
		);
	}

	const body = parsed.data;
	const data = {
		channelId: body.channelId,
		serviceTitle: body.serviceTitle,
		serviceDate: body.serviceDate ? new Date(`${body.serviceDate}T12:00:00Z`) : null,
		preacher: nullable(body.preacher),
		preachingText: nullable(body.preachingText),
		title: body.title,
		bigIdea: body.bigIdea,
		summary: body.summary,
		application: body.application,
		prayer: body.prayer,
		sections: body.sections.map((section) => ({
			heading: section.heading,
			startMs: section.startMs,
			pastorQuote: nullable(section.pastorQuote),
			passage: nullable(section.passage),
			passageText: nullable(section.passageText),
			explanation: section.explanation,
			reflection: section.reflection,
			imageUrl: nullable(section.imageUrl),
		})),
		sermonStartMs: nullable(body.sermonStartMs),
		sermonEndMs: nullable(body.sermonEndMs),
		durationSec: nullable(body.durationSec),
		writerModel: nullable(body.writerModel),
	};

	try {
		// Upsert on the video so re-running the pipeline over a service that was
		// already ingested replaces the study rather than duplicating it.
		const study = await prisma.sermonStudy.upsert({
			where: { videoId: body.videoId },
			create: { videoId: body.videoId, ...data },
			update: data,
			select: { id: true, createdAt: true, updatedAt: true },
		});
		return NextResponse.json({
			id: study.id,
			videoId: body.videoId,
			created: study.createdAt.getTime() === study.updatedAt.getTime(),
		});
	} catch (error) {
		console.error("[sermon-studies] ingest failed", error);
		return NextResponse.json({ error: "Failed to store study" }, { status: 500 });
	}
}
