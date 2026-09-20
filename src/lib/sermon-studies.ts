import "server-only";

import { prisma } from "@/lib/prisma";
import { createAttachmentPreviewUrl } from "@/lib/chat-attachments.server";

/**
 * Guided studies built from a church's recorded services.
 *
 * A study belongs to a channel, not to a person: one Sunday sermon is the same
 * sermon for the whole congregation, so it is generated once and read by
 * everyone who named that church in Settings. `channelIdFor` is the whole of
 * the access rule, a reader with no church, or a church with no channel wired
 * up, sees nothing and the feature stays invisible to them.
 *
 * The heavy half of the pipeline (download, transcription) cannot run here:
 * YouTube blocks datacenter ranges and a service is well past the function
 * budget. It runs on a trusted machine and posts the finished study to
 * POST /api/sermon-studies/ingest. See scripts/sermon/ingest.mjs.
 */

/** One movement of the sermon, as every client renders it. */
export type SermonSection = {
	heading: string;
	startMs: number;
	/** Verbatim from the recording, or null when nothing quotable was verified. */
	pastorQuote: string | null;
	passage: string | null;
	passageText: { verse: number; text: string }[] | null;
	/** SureWord's own teaching, always labelled as such in the UI. */
	explanation: string;
	reflection: string;
	/** Blob pathname as stored. Never sent to a client. */
	imagePathname?: string | null;
	/** Short-lived signed URL, produced per read. */
	imageUrl: string | null;
};

export type SermonStudySummary = {
	id: string;
	videoId: string;
	title: string;
	serviceTitle: string;
	serviceDate: string | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
	imageUrl: string | null;
};

export type SermonStudyDetail = SermonStudySummary & {
	summary: string;
	application: string;
	prayer: string;
	sections: SermonSection[];
	sermonStartMs: number | null;
	durationSec: number | null;
};

const LIST_LIMIT = 40;

/** The channel this reader is entitled to, or null when there is none. */
export async function channelIdFor(userId: string): Promise<string | null> {
	const church = await prisma.userChurch.findUnique({
		where: { userId },
		select: { youtubeChannelId: true },
	});
	return church?.youtubeChannelId ?? null;
}

export function watchUrl(videoId: string, atMs?: number | null): string {
	const base = `https://www.youtube.com/watch?v=${videoId}`;
	return typeof atMs === "number" ? `${base}&t=${Math.floor(atMs / 1000)}s` : base;
}

function sectionsOf(value: unknown): SermonSection[] {
	return Array.isArray(value) ? (value as SermonSection[]) : [];
}

/**
 * The Blob store is private, so an illustration is stored as a pathname and
 * signed per read, exactly like chat attachments and Listen audio. A signing
 * failure costs the picture, never the study.
 */
async function withSignedImage(section: SermonSection): Promise<SermonSection> {
	const { imagePathname, ...rest } = section;
	if (!imagePathname) return { ...rest, imageUrl: null };
	try {
		const { previewUrl } = await createAttachmentPreviewUrl(imagePathname);
		return { ...rest, imageUrl: previewUrl };
	} catch {
		return { ...rest, imageUrl: null };
	}
}

/** The thumbnail for a list row: the first illustration the study has. */
async function firstSignedImage(sections: SermonSection[]): Promise<string | null> {
	const first = sections.find((s) => s.imagePathname);
	if (!first) return null;
	return (await withSignedImage(first)).imageUrl;
}

export async function listSermonStudies(userId: string): Promise<SermonStudySummary[]> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return [];
	const rows = await prisma.sermonStudy.findMany({
		where: { channelId },
		orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }],
		take: LIST_LIMIT,
		select: {
			id: true,
			videoId: true,
			title: true,
			serviceTitle: true,
			serviceDate: true,
			preacher: true,
			preachingText: true,
			bigIdea: true,
			sections: true,
		},
	});
	return Promise.all(
		rows.map(async (row) => ({
		id: row.id,
		videoId: row.videoId,
		title: row.title,
		serviceTitle: row.serviceTitle,
		serviceDate: row.serviceDate ? row.serviceDate.toISOString().slice(0, 10) : null,
		preacher: row.preacher,
		preachingText: row.preachingText,
		bigIdea: row.bigIdea,
		imageUrl: await firstSignedImage(sectionsOf(row.sections)),
		}))
	);
}

/**
 * One study, or null when it does not exist or belongs to another church. The
 * channel check is deliberately part of the lookup rather than a later guard,
 * so an id guessed from somewhere else cannot read another congregation's study.
 */
export async function getSermonStudy(
	userId: string,
	id: string
): Promise<SermonStudyDetail | null> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return null;
	const row = await prisma.sermonStudy.findFirst({ where: { id, channelId } });
	if (!row) return null;
	const sections = await Promise.all(sectionsOf(row.sections).map(withSignedImage));
	return {
		id: row.id,
		videoId: row.videoId,
		title: row.title,
		serviceTitle: row.serviceTitle,
		serviceDate: row.serviceDate ? row.serviceDate.toISOString().slice(0, 10) : null,
		preacher: row.preacher,
		preachingText: row.preachingText,
		bigIdea: row.bigIdea,
		summary: row.summary,
		application: row.application,
		prayer: row.prayer,
		sections,
		sermonStartMs: row.sermonStartMs,
		durationSec: row.durationSec,
		imageUrl: sections.find((s) => s.imageUrl)?.imageUrl ?? null,
	};
}
