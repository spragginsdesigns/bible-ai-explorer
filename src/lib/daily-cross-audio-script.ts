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

/** What a client is told about today's devotional audio. */
export type DailyCrossAudioClientStatus = DailyCrossAudioStatus | "none";

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
