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

/**
 * The writer sometimes labels its own teaching inside the prose. Every client
 * renders that label itself, so leaving it in prints it twice. Stripping here
 * rather than at ingest also cleans rows that were stored before this existed.
 */
function stripTeachingLabel(text: string): string {
	return String(text ?? "")
		.replace(/^\s*SureWord['’]?s teaching[:.]?\s*/i, "")
		.trim();
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
	rest.explanation = stripTeachingLabel(rest.explanation);
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

/**
 * Every study this reader's church has, newest first. `images: false` skips the
 * thumbnail signing for readers that show no pictures (the chat tools).
 */
export async function listSermonStudies(
	userId: string,
	options: { images?: boolean; limit?: number } = {}
): Promise<SermonStudySummary[]> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return [];
	const images = options.images !== false;
	const rows = await prisma.sermonStudy.findMany({
		where: { channelId },
		orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }],
		take: Math.min(options.limit ?? LIST_LIMIT, LIST_LIMIT),
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
		imageUrl: images ? await firstSignedImage(sectionsOf(row.sections)) : null,
		}))
	);
}

/**
 * A section with its illustration dropped rather than signed. Signing costs a
 * network round trip per picture and produces a URL that expires, which is
 * exactly wrong for a reader that cannot see images anyway - the chat tools.
 */
function withoutImage(section: SermonSection): SermonSection {
	const { imagePathname, ...rest } = section;
	void imagePathname;
	rest.explanation = stripTeachingLabel(rest.explanation);
	return { ...rest, imageUrl: null };
}

type SermonStudyRow = {
	id: string;
	videoId: string;
	title: string;
	serviceTitle: string;
	serviceDate: Date | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
	summary: string;
	application: string;
	prayer: string;
	sections: unknown;
	sermonStartMs: number | null;
	durationSec: number | null;
};

async function toDetail(row: SermonStudyRow, images: boolean): Promise<SermonStudyDetail> {
	const sections = images
		? await Promise.all(sectionsOf(row.sections).map(withSignedImage))
		: sectionsOf(row.sections).map(withoutImage);
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

/**
 * One study, or null when it does not exist or belongs to another church. The
 * channel check is deliberately part of the lookup rather than a later guard,
 * so an id guessed from somewhere else cannot read another congregation's study.
 *
 * `images: false` is for readers that render no pictures (the chat tools): the
 * study comes back whole, minus the signing round trips.
 */
export async function getSermonStudy(
	userId: string,
	id: string,
	options: { images?: boolean } = {}
): Promise<SermonStudyDetail | null> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return null;
	const row = await prisma.sermonStudy.findFirst({ where: { id, channelId } });
	if (!row) return null;
	return toDetail(row, options.images !== false);
}

/**
 * How a chat tool names the study it wants. Every field is optional, and with
 * none of them the answer is the newest study - which is what "the sermon" and
 * "Sunday's message" almost always mean.
 */
export interface SermonStudyLookup {
	/** The id of a study already named in this conversation or in the day block. */
	studyId?: string;
	/** "YYYY-MM-DD", the day of the service the user asked about. */
	date?: string;
	/** Words from the title, the announced text, or what the sermon was about. */
	query?: string;
}

/**
 * How the study that came back was found. The caller reports this, so a study
 * that is merely the nearest one to a date is never presented as the one that
 * was asked for.
 */
export type SermonStudyMatch = "id" | "date" | "nearest-date" | "query" | "latest";

/**
 * Why a lookup came back empty. "no-channel" is the feature being invisible to
 * this reader (no home church, or a church nothing is ingested for) and
 * "no-match" is a church that has studies, none of which is the one asked for.
 * Chat has to tell those two apart or it will report a church that has studies
 * as a church that has none.
 */
export type SermonStudyResult =
	| { found: true; study: SermonStudyDetail; matchedBy: SermonStudyMatch }
	| { found: false; reason: "no-channel" | "no-match" };

/** Newest service first, falling back to ingest order for undated rows. */
const NEWEST_FIRST = [{ serviceDate: "desc" as const }, { createdAt: "desc" as const }];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day a "YYYY-MM-DD" names, or null when it is not one. */
function dayRange(date: string): { gte: Date; lt: Date } | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	const start = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(start.getTime())) return null;
	return { gte: start, lt: new Date(start.getTime() + DAY_MS) };
}

const SEARCH_STOP_WORDS = new Set([
	"the", "and", "for", "from", "that", "this", "with", "about", "sermon",
	"study", "message", "pastor", "preached", "service", "sunday", "wednesday",
]);

/**
 * The phrase, then the words in it worth searching on their own. A user rarely
 * quotes a title exactly, so "the message on waiting" has to be able to find
 * "Waiting On The Lord" - but only on words that carry meaning, or every study
 * matches every question.
 */
function searchTerms(query: string): string[] {
	const phrase = query.trim();
	if (!phrase) return [];
	const words = phrase
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length >= 4 && !SEARCH_STOP_WORDS.has(word));
	return [phrase, ...words.filter((word) => word !== phrase.toLowerCase())];
}

function matchingAny(channelId: string, terms: string[]) {
	return {
		channelId,
		OR: terms.flatMap((term) => [
			{ title: { contains: term, mode: "insensitive" as const } },
			{ serviceTitle: { contains: term, mode: "insensitive" as const } },
			{ preachingText: { contains: term, mode: "insensitive" as const } },
			{ bigIdea: { contains: term, mode: "insensitive" as const } },
			{ summary: { contains: term, mode: "insensitive" as const } },
		]),
	};
}

/**
 * The one study a chat question is about, scoped to the reader's own church.
 *
 * Images are never signed here: nothing that reads this can see a picture, and
 * a signed URL would expire long before the conversation did.
 */
export async function resolveSermonStudy(
	userId: string,
	lookup: SermonStudyLookup = {}
): Promise<SermonStudyResult> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return { found: false, reason: "no-channel" };
	const miss = { found: false, reason: "no-match" } as const;

	if (lookup.studyId) {
		const row = await prisma.sermonStudy.findFirst({
			where: { id: lookup.studyId, channelId },
		});
		return row ? { found: true, study: await toDetail(row, false), matchedBy: "id" } : miss;
	}

	const range = lookup.date ? dayRange(lookup.date) : null;
	if (range) {
		const onTheDay = await prisma.sermonStudy.findFirst({
			where: { channelId, serviceDate: range },
			orderBy: NEWEST_FIRST,
		});
		if (onTheDay) return { found: true, study: await toDetail(onTheDay, false), matchedBy: "date" };
		// A service whose date they half-remember is still the service they mean.
		// Answer with the one before it, labelled, rather than with nothing.
		const before = await prisma.sermonStudy.findFirst({
			where: { channelId, serviceDate: { lt: range.gte } },
			orderBy: NEWEST_FIRST,
		});
		if (before)
			return { found: true, study: await toDetail(before, false), matchedBy: "nearest-date" };
		return miss;
	}

	const terms = lookup.query ? searchTerms(lookup.query) : [];
	if (terms.length > 0) {
		const phrase = await prisma.sermonStudy.findFirst({
			where: matchingAny(channelId, [terms[0]]),
			orderBy: NEWEST_FIRST,
		});
		if (phrase) return { found: true, study: await toDetail(phrase, false), matchedBy: "query" };
		if (terms.length > 1) {
			const byWord = await prisma.sermonStudy.findFirst({
				where: matchingAny(channelId, terms.slice(1)),
				orderBy: NEWEST_FIRST,
			});
			if (byWord) return { found: true, study: await toDetail(byWord, false), matchedBy: "query" };
		}
		return miss;
	}

	const latest = await prisma.sermonStudy.findFirst({ where: { channelId }, orderBy: NEWEST_FIRST });
	return latest
		? { found: true, study: await toDetail(latest, false), matchedBy: "latest" }
		: miss;
}

/** The little that the chat day block needs to name a study it has not read. */
export interface SermonStudyBrief {
	id: string;
	title: string;
	/** "YYYY-MM-DD", or null when the service date is unknown. */
	serviceDate: string | null;
	preacher: string | null;
	preachingText: string | null;
	bigIdea: string;
}

/**
 * How recent a study has to be for chat to mention it unprompted. Long enough
 * that Sunday's message is still this week's on Saturday, short enough that a
 * church which stopped ingesting does not have a stale study named every turn.
 */
export const SERMON_RECENT_DAYS = 10;

/** This week's study from the reader's church, or null when there is none. */
export async function latestSermonStudy(
	userId: string,
	now: Date = new Date()
): Promise<SermonStudyBrief | null> {
	const channelId = await channelIdFor(userId);
	if (!channelId) return null;
	const row = await prisma.sermonStudy.findFirst({
		where: { channelId },
		orderBy: NEWEST_FIRST,
		select: {
			id: true,
			title: true,
			serviceDate: true,
			createdAt: true,
			preacher: true,
			preachingText: true,
			bigIdea: true,
		},
	});
	if (!row) return null;
	// An undated row is dated by when it was ingested, which for this pipeline is
	// the same week as the service.
	const when = row.serviceDate ?? row.createdAt;
	if (now.getTime() - when.getTime() > SERMON_RECENT_DAYS * DAY_MS) return null;
	return {
		id: row.id,
		title: row.title,
		serviceDate: row.serviceDate ? row.serviceDate.toISOString().slice(0, 10) : null,
		preacher: row.preacher,
		preachingText: row.preachingText,
		bigIdea: row.bigIdea,
	};
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Sunday, 14 September 2026" from a stored "YYYY-MM-DD". Built by hand rather
 * than with toLocaleDateString so the words do not change with the server's
 * locale, which is not the reader's.
 */
export function formatServiceDate(date: string | null): string | null {
	const range = date ? dayRange(date) : null;
	if (!range) return null;
	const day = range.gte;
	return `${WEEKDAYS[day.getUTCDay()]}, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

/** "31:07", or "1:02:44" once an hour into the recording. */
export function formatTimestamp(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

/** Past this, a study is clipped rather than allowed to crowd out the answer. */
const MAX_STUDY_CHARS = 18_000;

/**
 * One study written out for the model.
 *
 * The editorial rule the screens enforce with typography has to be enforced
 * here with words, because a model reading flat text has no blockquote to look
 * at: the preacher's own words are quoted and labelled verbatim, and everything
 * else is named as SureWord's own writing. Getting this wrong would have the
 * assistant telling a member of the congregation that their pastor said
 * something he never said.
 */
export function formatSermonStudyForModel(
	study: SermonStudyDetail,
	matchedBy: SermonStudyMatch = "id"
): string {
	const when = formatServiceDate(study.serviceDate);
	const lines: string[] = [];

	if (matchedBy === "nearest-date") {
		lines.push(
			"NOTE: there is no study for the exact date asked about. This is the most recent one before it, so say which service it is before answering from it."
		);
	} else if (matchedBy === "latest") {
		lines.push("This is the most recent study their church has.");
	}

	lines.push(`Sermon study: "${study.title}" (study id ${study.id})`);
	lines.push(
		[
			study.serviceTitle,
			when ? `preached ${when}` : null,
			study.preacher ? `by ${study.preacher}` : null,
		]
			.filter(Boolean)
			.join(", ") + "."
	);
	if (study.preachingText) lines.push(`Announced text: ${study.preachingText}.`);
	lines.push(`The recording: ${watchUrl(study.videoId, study.sermonStartMs)}`);
	lines.push(`Big idea: ${study.bigIdea}`);
	lines.push(`Overview: ${study.summary}`);

	study.sections.forEach((section, index) => {
		lines.push("");
		lines.push(
			`Part ${index + 1} of ${study.sections.length} - ${section.heading} (from ${formatTimestamp(section.startMs)} in the recording: ${watchUrl(study.videoId, section.startMs)})`
		);
		if (section.pastorQuote) {
			lines.push(
				`What the preacher said here, word for word from the recording: "${section.pastorQuote}"`
			);
		} else {
			lines.push(
				"No quotable line was verified for this part, so there is no record of his own words here."
			);
		}
		if (section.passage && section.passageText?.length) {
			lines.push(`Passage taken here, ${section.passage}:`);
			for (const verse of section.passageText) {
				lines.push(`  ${verse.verse} ${verse.text}`);
			}
		} else if (section.passage) {
			lines.push(`Passage taken here: ${section.passage}.`);
		}
		lines.push(
			`SureWord's own teaching on this part (written by SureWord, not said from the pulpit): ${section.explanation}`
		);
		lines.push(`The question the study puts to the reader here: ${section.reflection}`);
	});

	lines.push("");
	lines.push(`This week, how the study asks them to live it out: ${study.application}`);
	lines.push(`The prayer the study closes with: ${study.prayer}`);
	lines.push("");
	lines.push(
		"Only the lines marked as his own words are the preacher's; every other line above was written by SureWord. Never attribute SureWord's teaching to him, and never add anything he is not quoted as saying."
	);

	const text = lines.join("\n");
	return text.length <= MAX_STUDY_CHARS
		? text
		: `${text.slice(0, MAX_STUDY_CHARS)}\n\n[This study is longer than fits here; the later parts are not shown.]`;
}

/** The studies a church has, as a list the model can answer "which ones" from. */
export function formatSermonStudyListForModel(studies: SermonStudySummary[]): string {
	if (studies.length === 0) {
		return "Their church has no sermon studies. Either they have not chosen a home church in Settings, or their church's services are not being turned into studies.";
	}
	const rows = studies.map((study) => {
		const when = formatServiceDate(study.serviceDate) ?? "date unknown";
		const parts = [
			`"${study.title}" (study id ${study.id})`,
			when,
			study.preacher ? `preached by ${study.preacher}` : null,
			study.preachingText ? `text ${study.preachingText}` : null,
		].filter(Boolean);
		return `- ${parts.join(", ")}. Big idea: ${study.bigIdea}`;
	});
	return [
		`Sermon studies from their church, newest first (${studies.length}):`,
		...rows,
		"This list holds nothing the sermon itself said: read one in full with getSermonStudy before answering from it.",
	].join("\n");
}
