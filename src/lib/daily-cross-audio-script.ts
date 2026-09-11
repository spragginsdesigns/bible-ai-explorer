/**
 * Pure helpers for the spoken "Pick Up Your Cross" devotional: turning what the
 * model wrote into something safe to hand a text-to-speech engine, estimating
 * how long it will take to say, and deciding whether a stored row still counts
 * as ready, still-generating, or needs generating again.
 *
 * Kept free of Prisma, Blob and the AI SDK on purpose so the rules can be
 * tested directly (`tests/daily-cross-audio.test.mjs`).
 */

/**
 * ElevenLabs caps one `eleven_multilingual_v2` request at 10,000 characters
 * (their model docs). A 900-word devotional lands around 5,500, so this is a
 * guard rail rather than a routine trim - but a runaway generation must be cut
 * before the request, not rejected by the API after we have paid for the model
 * call.
 */
export const MAX_SPOKEN_CHARACTERS = 9_500;

/** Ordinary read-aloud pace; used only to show a total before playback starts. */
export const WORDS_PER_MINUTE = 150;

/**
 * A "pending" row older than this was left behind by a crashed or timed-out
 * generation. Generation itself takes ~30-60s, so three minutes is long enough
 * that two clients polling in parallel never both start work, and short enough
 * that a dead attempt does not wedge the feature until tomorrow.
 */
export const AUDIO_PENDING_TTL_MS = 3 * 60 * 1000;

/** The values stored in `VerseOfDay.audioStatus`. */
export type DailyCrossAudioStatus = "pending" | "ready" | "failed";

/**
 * What a client is told about today's devotional audio.
 *
 * "unavailable" means the server has no ElevenLabs credentials, so this
 * deployment cannot make audio at all - distinct from "none" (it could, nobody
 * has asked yet) and from "failed" (it tried and could not). Clients render
 * nothing for it: an unconfigured server must show no Listen card rather than
 * a button that can only ever fail.
 *
 * "locked" means the deployment can narrate but this user is not on SureWord
 * Pro. It is answered before any database write, model call or ElevenLabs
 * request, so a free account never costs a cent, and the clients show the Pro
 * card rather than hiding the feature - a locked benefit should be visible.
 */
export type DailyCrossAudioClientStatus =
	| DailyCrossAudioStatus
	| "none"
	| "unavailable"
	| "locked";

/**
 * Whether this deployment can synthesize speech at all. Checked before any
 * database or model work, because the answer is the same for every user and
 * costs nothing to reach.
 */
export function isSpeechConfigured(apiKey: string | undefined | null): apiKey is string {
	return typeof apiKey === "string" && apiKey.trim().length > 0;
}

/**
 * Strip everything a model adds for a reader that a narrator would read out
 * loud by mistake: markdown emphasis and headings, list bullets, block quotes,
 * and bracketed stage directions like "[pause]" or "(warmly)".
 */
export function sanitizeDevotionalScript(raw: string): string {
	const withoutDirections = raw
		// "[pause]", "[Narrator]", "(softly)" - a whole line or an inline aside.
		.replace(/\[[^\]\n]{0,60}\]/g, " ")
		.replace(/\((?:pause|beat|softly|warmly|gently|slowly)[^)\n]{0,40}\)/gi, " ");

	const lines = withoutDirections.split(/\r?\n/).map((line) =>
		line
			// Headings, block quotes and list bullets at the start of a line.
			.replace(/^\s{0,3}#{1,6}\s+/, "")
			.replace(/^\s{0,3}>\s?/, "")
			.replace(/^\s{0,3}[-*+]\s+/, "")
			.replace(/^\s{0,3}\d+[.)]\s+/, "")
			// Emphasis and code marks anywhere in the line.
			.replace(/\*\*|__|`+/g, "")
			.replace(/(^|[\s(])[*_]([^*_\n]+)[*_]($|[\s.,;:!?)])/g, "$1$2$3")
			.replace(/[ \t]+/g, " ")
			.trim()
	);

	const script = lines
		.join("\n")
		// Any run of blank lines becomes one paragraph break.
		.replace(/\n{2,}/g, "\n\n")
		.trim();

	return truncateAtBoundary(script, MAX_SPOKEN_CHARACTERS);
}

/**
 * The pause ElevenLabs is asked to hold between paragraphs. Blank lines in the
 * text are not a reliable pause in `eleven_multilingual_v2`; a `<break>` tag
 * is (their "Prompting" docs). Just under a second is a reader taking a breath
 * between thoughts, not a dramatic silence; their docs warn that long or many
 * breaks make the voice unstable.
 */
export const PARAGRAPH_BREAK = '<break time="0.9s" />';

/**
 * The text actually sent to the narrator: the stored script with a breath at
 * every paragraph boundary. Applied at synthesis only - the stored script is
 * what "Read along" shows, and a break tag on screen is a bug.
 */
export function withSpokenPauses(script: string): string {
	return script
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.join(` ${PARAGRAPH_BREAK} `);
}

/**
 * The first name to greet someone by, from the display name Clerk gave us.
 * Null when there is nothing usable, so the script greets without a name
 * rather than saying "hey null" or reading out an email address.
 */
export function firstNameOf(name: string | null | undefined): string | null {
	if (!name) return null;
	const first = name.trim().split(/\s+/)[0] ?? "";
	if (!first || first.includes("@") || first.length > 30) return null;
	return first;
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/**
 * Where the listener is in their day, so the greeting can say "good morning"
 * only when it is. The devotional is written at their notify hour, so this is
 * the hour it will most likely be heard. Null when the timezone is unknown or
 * invalid; the greeting then stays time-neutral.
 */
export function partOfDayIn(timezone: string | null | undefined, now: Date = new Date()): PartOfDay | null {
	if (!timezone) return null;
	let hour: number;
	try {
		const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).formatToParts(now);
		const part = parts.find((item) => item.type === "hour");
		if (!part) return null;
		// hour12: false can render midnight as "24" in some ICU versions.
		hour = Number(part.value) % 24;
	} catch {
		return null;
	}
	if (Number.isNaN(hour)) return null;
	if (hour < 5) return "night";
	if (hour < 12) return "morning";
	if (hour < 17) return "afternoon";
	if (hour < 21) return "evening";
	return "night";
}

/**
 * How a past devotional opened - its first two sentences - so the writer can
 * be told what not to say again. A daily voice that greets the same way every
 * day stops sounding like a person by the third day.
 */
export function openingOf(script: string, maxChars = 220): string {
	const firstParagraph = script.trim().split(/\n{2,}/)[0] ?? "";
	const sentences = firstParagraph.match(/[^.!?]+[.!?]+["'”’]?/g);
	const opening = sentences ? sentences.slice(0, 2).join("").trim() : firstParagraph;
	return opening.length > maxChars ? `${opening.slice(0, maxChars).trimEnd()}...` : opening;
}

/**
 * Cut to `limit` characters at the last paragraph break, else the last sentence
 * end, so a trimmed script never ends mid-word.
 */
function truncateAtBoundary(script: string, limit: number): string {
	if (script.length <= limit) return script;
	const head = script.slice(0, limit);
	const paragraph = head.lastIndexOf("\n\n");
	if (paragraph > limit * 0.5) return head.slice(0, paragraph).trim();
	const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
	if (sentence > limit * 0.5) return head.slice(0, sentence + 1).trim();
	return head.trim();
}

/** A title is one plain line: no markdown, no trailing punctuation, no quotes. */
export function sanitizeDevotionalTitle(raw: string, fallback: string): string {
	const title = raw
		.replace(/[*_`#>]/g, "")
		.replace(/\s+/g, " ")
		.replace(/^["'“‘]+|["'”’]+$/g, "")
		.replace(/[.:;,]+$/, "")
		.trim()
		.slice(0, 80);
	return title || fallback;
}

export function countSpokenWords(script: string): number {
	const words = script.trim().match(/\S+/g);
	return words ? words.length : 0;
}

/**
 * Roughly how long the narration runs, from the word count. The MP3's real
 * duration is only knowable by decoding it, and every client re-reads the true
 * duration from the audio element once it loads - this is what fills the "/ 4:12"
 * before a byte has been fetched.
 */
export function estimateSpokenDurationSec(script: string): number {
	const words = countSpokenWords(script);
	if (words === 0) return 0;
	return Math.max(1, Math.round((words / WORDS_PER_MINUTE) * 60));
}

/** What to do with the audio columns already on today's row. */
export type StoredAudioDecision = "ready" | "pending" | "generate";

export interface StoredAudioColumns {
	audioStatus: string | null;
	audioPathname: string | null;
	audioGeneratedAt: Date | null;
}

/**
 * Whether today's stored audio can be served as is, is still being made by
 * another request, or should be generated now. A "failed" row, a "pending" row
 * that has gone stale, and a "ready" row whose blob path went missing all mean
 * the same thing: generate.
 */
export function resolveStoredAudio(
	row: StoredAudioColumns,
	now: number = Date.now()
): StoredAudioDecision {
	if (row.audioStatus === "ready" && row.audioPathname) return "ready";
	if (
		row.audioStatus === "pending" &&
		row.audioGeneratedAt &&
		now - row.audioGeneratedAt.getTime() < AUDIO_PENDING_TTL_MS
	) {
		return "pending";
	}
	return "generate";
}

/** The blob path today's devotional is stored at. One per cross entry. */
export function dailyCrossAudioPathname(userId: string, verseOfDayId: string): string {
	return `daily-cross-audio/${userId}/${verseOfDayId}.mp3`;
}

/**
 * Where clients play the narration from: our own origin, not the blob host.
 * Relative on purpose - web hands it straight to an `<audio>` element and
 * Android joins it onto `API_URL`. See the route for why the proxy exists.
 */
export const DAILY_CROSS_AUDIO_STREAM_PATH = "/api/verse-of-day/audio/stream";

/** The upstream blob response, reduced to the three headers that matter here. */
export interface UpstreamAudioHeaders {
	contentType?: string | null;
	contentLength?: string | null;
	contentRange?: string | null;
}

/** Status line and headers for one proxied chunk of the narration. */
export interface AudioStreamResponseInit {
	status: 200 | 206;
	headers: Record<string, string>;
}

/** A byte range the blob host actually served, e.g. "bytes 0-1023/4096". */
const CONTENT_RANGE_PATTERN = /^bytes \d+-\d+\/(?:\d+|\*)$/;

/**
 * Turn what the blob host answered into what we answer.
 *
 * The upstream decides whether a range was honoured, not the incoming request:
 * a client can ask for `bytes=0-` and be handed the whole file with a plain
 * 200, and answering 206 to that would be a lie a media player acts on. So the
 * presence of a well-formed `Content-Range` is the single thing that makes this
 * a partial response.
 *
 * `Content-Type` is pinned to audio: the file is one we wrote ourselves as
 * `audio/mpeg`, and a blob host that ever answers `application/octet-stream`
 * would put a media element straight back into the state this proxy exists to
 * fix. `Cache-Control: private` keeps one listener's devotional out of any
 * shared cache - it is written for them by name.
 */
export function devotionalStreamResponseInit(
	upstream: UpstreamAudioHeaders
): AudioStreamResponseInit {
	const contentType = upstream.contentType?.trim().toLowerCase().startsWith("audio/")
		? upstream.contentType.trim()
		: "audio/mpeg";

	const headers: Record<string, string> = {
		"Content-Type": contentType,
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, max-age=0",
		"Content-Disposition": "inline",
	};

	const contentLength = upstream.contentLength?.trim();
	if (contentLength && /^\d+$/.test(contentLength)) headers["Content-Length"] = contentLength;

	const contentRange = upstream.contentRange?.trim();
	if (contentRange && CONTENT_RANGE_PATTERN.test(contentRange)) {
		headers["Content-Range"] = contentRange;
		return { status: 206, headers };
	}

	return { status: 200, headers };
}
