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

export async function fetchSermonStudies(getToken: GetToken): Promise<SermonStudySummary[]> {
	const data = await apiJson<{ studies?: SermonStudySummary[] }>(getToken, "/api/sermon-studies");
	return data.studies ?? [];
}

export async function fetchSermonStudy(
	getToken: GetToken,
	id: string
): Promise<SermonStudyDetail> {
	const data = await apiJson<{ study: SermonStudyDetail }>(
		getToken,
		`/api/sermon-studies/${encodeURIComponent(id)}`
	);
	return data.study;
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
