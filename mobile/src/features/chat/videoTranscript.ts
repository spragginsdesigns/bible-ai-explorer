/**
 * "/verify <YouTube link>": pull the video's captions on the phone and hand
 * them to the chat as a text attachment, so the answer can weigh what was said
 * against Scripture.
 *
 * Why on the device: YouTube answers every datacenter IP (Vercel, the VPS)
 * with "Sign in to confirm you're not a bot", measured 2026-10-07, while a home
 * or phone connection gets the full caption track in about a second. The phone
 * fetches; the server only reads the text it is sent.
 *
 * The parsing and formatting are pure so the logic suite pins them; only
 * fetchYouTubeTranscript touches the network.
 */

/**
 * About five hours of speech (~75k tokens). The server would take 1 MB, but
 * the transcript rides in every step and every follow-up of the conversation,
 * and the smaller selectable models cannot hold a 250k-token file.
 */
export const MAX_TRANSCRIPT_BYTES = 300 * 1024;

/** One paragraph per this much video, each stamped with where it starts. */
const PARAGRAPH_MS = 30_000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id from any YouTube link shape, or null. */
export function parseYouTubeVideoId(input: string): string | null {
	let url: URL;
	try {
		url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
	let candidate: string | null = null;
	if (host === "youtu.be") {
		candidate = url.pathname.split("/")[1] ?? null;
	} else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		const [, first, second] = url.pathname.split("/");
		if (first === "watch") candidate = url.searchParams.get("v");
		else if (["shorts", "live", "embed", "v", "e"].includes(first ?? "")) candidate = second ?? null;
	}
	return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/**
 * The first YouTube link in a block of text (a share often wraps it in words).
 * The host must start a word, so "notyoutube.com" is not YouTube, and the
 * sentence's own punctuation after a link ("watch this: youtu.be/ID.") is not
 * part of the id.
 */
export function findYouTubeLink(text: string): { url: string; videoId: string } | null {
	const links = /(^|[^\w.-])((?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"')\]]+)/gi;
	for (const match of text.matchAll(links)) {
		const url = match[2].replace(/[.,!?;:]+$/, "");
		const videoId = parseYouTubeVideoId(url);
		if (videoId) return { url, videoId };
	}
	return null;
}

/**
 * A "/verify" message that carries a YouTube link. Anything else, including
 * /verify with only a pasted claim, goes to the model unchanged.
 */
export function verifyVideoRequest(message: string): { url: string; videoId: string } | null {
	if (!/^\/verify(\s|$)/i.test(message.trim())) return null;
	return findYouTubeLink(message);
}

export interface CaptionTrack {
	baseUrl: string;
	languageCode: string;
	/** "asr" for YouTube's automatic captions; absent for uploaded ones. */
	kind?: string;
	name?: string;
	isTranslatable?: boolean;
}

/**
 * Uploaded English beats automatic English, either beats another language, and
 * another language is asked for in English when YouTube can translate it.
 */
export function chooseCaptionTrack(
	tracks: readonly CaptionTrack[],
): { track: CaptionTrack; translated: boolean } | null {
	const english = (track: CaptionTrack) => track.languageCode.toLowerCase().startsWith("en");
	const manualEnglish = tracks.find((track) => english(track) && track.kind !== "asr");
	if (manualEnglish) return { track: manualEnglish, translated: false };
	const autoEnglish = tracks.find(english);
	if (autoEnglish) return { track: autoEnglish, translated: false };
	const translatable = tracks.find((track) => track.isTranslatable) ?? tracks[0];
	if (!translatable) return null;
	return { track: translatable, translated: translatable.isTranslatable === true };
}

/** The json3 caption format: timed events, each a run of text segments. */
export interface Json3Captions {
	events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>;
}

/** "1:02:03" for an hour or more, "2:03" under it. */
export function formatTimestamp(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Caption events folded into ~30-second paragraphs, each led by its start time. */
export function captionsToParagraphs(captions: Json3Captions): string[] {
	const paragraphs: string[] = [];
	let start: number | null = null;
	let words: string[] = [];
	const flush = () => {
		const text = words.join(" ").replace(/\s+/g, " ").trim();
		if (start !== null && text) paragraphs.push(`[${formatTimestamp(start)}] ${text}`);
		start = null;
		words = [];
	};
	for (const event of captions.events ?? []) {
		const text = (event.segs ?? []).map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
		if (!text) continue;
		const at = event.tStartMs ?? 0;
		if (start !== null && at - start >= PARAGRAPH_MS) flush();
		if (start === null) start = at;
		words.push(text);
	}
	flush();
	return paragraphs;
}

export interface VideoTranscript {
	videoId: string;
	url: string;
	title: string;
	channel: string;
	lengthSeconds: number;
	automatic: boolean;
	translated: boolean;
	languageCode: string;
	paragraphs: string[];
}

/**
 * The attachment's text: a header the model reads first, then the paragraphs.
 * A transcript past the attachment cap is cut at a paragraph and says so, so
 * the answer never presents half a video as the whole.
 */
export function transcriptFileText(transcript: VideoTranscript): string {
	const source = transcript.automatic
		? "YouTube automatic captions (machine-made: names and Bible words are often misheard)"
		: "Captions uploaded by the channel";
	const header = [
		"YOUTUBE VIDEO TRANSCRIPT",
		`Title: ${transcript.title}`,
		`Channel: ${transcript.channel}`,
		`Link: https://www.youtube.com/watch?v=${transcript.videoId}`,
		`Length: ${formatTimestamp(transcript.lengthSeconds * 1000)}`,
		`Source: ${source}${transcript.translated ? `, translated to English from "${transcript.languageCode}"` : ""}`,
		"",
		"",
	].join("\n");
	let body = "";
	let bytes = utf8ByteLength(header);
	let kept = 0;
	for (const paragraph of transcript.paragraphs) {
		const size = utf8ByteLength(`${paragraph}\n\n`);
		if (bytes + size > MAX_TRANSCRIPT_BYTES - 200) break;
		body += `${paragraph}\n\n`;
		bytes += size;
		kept += 1;
	}
	if (kept < transcript.paragraphs.length) {
		const last = transcript.paragraphs[kept - 1]?.match(/^\[([^\]]+)\]/)?.[1] ?? "0:00";
		body += `[Transcript cut off after ${last} to fit. Only the part above was read.]\n`;
	}
	return header + body.trimEnd() + "\n";
}

/**
 * Bytes the text takes as UTF-8 (captions carry ♪ and curly quotes), counted
 * by code point so the cap needs nothing from the JS engine. The upload itself
 * declares the file's on-disk size.
 */
export function utf8ByteLength(text: string): number {
	let bytes = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}
	return bytes;
}

/** The composer's last step before the answer's own progress takes over. */
export function videoSendingStatus(lengthSeconds: number): string {
	const minutes = Math.round(lengthSeconds / 60);
	if (minutes >= 90) {
		return `Sending SureWord the transcript (${(lengthSeconds / 3600).toFixed(1)} hours of video, so the answer takes a minute or two)...`;
	}
	if (minutes >= 2) return `Sending SureWord the transcript (${minutes} minutes of video)...`;
	return "Sending SureWord the transcript...";
}

/** A filename the attachment rules accept: letters, digits and dashes, then .txt. */
export function transcriptFilename(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return `YouTube-transcript-${slug || "video"}.txt`;
}

/** Why a video could not be read, worded for the person who shared it. */
export class VideoTranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VideoTranscriptError";
	}
}

/**
 * Innertube clients that return caption tracks without a proof-of-origin
 * token. WEB and MWEB do not (measured: "Video unavailable" / "needs to be
 * reloaded"), so they are not tried. A second client covers the first being
 * retired by a YouTube update.
 */
const PLAYER_CLIENTS = [
	{
		context: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" },
		userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
		clientId: "3",
	},
	{
		context: {
			clientName: "IOS",
			clientVersion: "20.10.4",
			deviceMake: "Apple",
			deviceModel: "iPhone16,2",
			osName: "iPhone",
			osVersion: "18.3.2.22D82",
			hl: "en",
			gl: "US",
		},
		userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
		clientId: "5",
	},
] as const;

interface PlayerResponse {
	playabilityStatus?: { status?: string; reason?: string };
	videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
	captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

const REQUEST_TIMEOUT_MS = 20_000;

const NO_CAPTIONS =
	"This video has no captions, so SureWord can't read what's said in it. Paste the part you want checked instead.";

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Fetch a video's captions from this device's own connection. `onStage` hears
 * each step in words the composer can show while the user waits.
 */
export async function fetchYouTubeTranscript(
	videoId: string,
	url: string,
	onStage?: (label: string) => void,
): Promise<VideoTranscript> {
	let lastReason = "";
	onStage?.("Finding the video...");
	for (const client of PLAYER_CLIENTS) {
		let player: PlayerResponse;
		try {
			const response = await fetchWithTimeout("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": client.userAgent,
					"X-YouTube-Client-Name": client.clientId,
					"X-YouTube-Client-Version": client.context.clientVersion,
				},
				body: JSON.stringify({ context: { client: client.context }, videoId, contentCheckOk: true, racyCheckOk: true }),
			});
			if (!response.ok) {
				lastReason = `YouTube answered ${response.status}.`;
				continue;
			}
			player = (await response.json()) as PlayerResponse;
		} catch {
			lastReason = "Couldn't reach YouTube. Check your connection and try again.";
			continue;
		}

		const status = player.playabilityStatus?.status;
		const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
		if (status !== "OK" && tracks.length === 0) {
			lastReason = player.playabilityStatus?.reason
				? `YouTube says: ${player.playabilityStatus.reason}`
				: "YouTube would not open this video.";
			continue;
		}
		const chosen = chooseCaptionTrack(tracks);
		if (!chosen) {
			// The next client may still see tracks this one was not given.
			lastReason = NO_CAPTIONS;
			continue;
		}

		const title = player.videoDetails?.title?.trim() || "Untitled video";
		const length = Number(player.videoDetails?.lengthSeconds) || 0;
		onStage?.(`Reading the captions of "${title.slice(0, 48)}"${length ? ` (${formatTimestamp(length * 1000)})` : ""}...`);
		let captionUrl = chosen.track.baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
		if (chosen.translated) captionUrl += "&tlang=en";
		let captions: Json3Captions;
		try {
			const response = await fetchWithTimeout(captionUrl, { headers: { "User-Agent": client.userAgent } });
			const body = await response.text();
			if (!response.ok || !body) {
				lastReason = "YouTube didn't send the captions.";
				continue;
			}
			captions = JSON.parse(body) as Json3Captions;
		} catch {
			lastReason = "YouTube didn't send the captions.";
			continue;
		}

		const paragraphs = captionsToParagraphs(captions);
		if (paragraphs.length === 0) {
			lastReason = "The captions for this video are empty.";
			continue;
		}
		return {
			videoId,
			url,
			title,
			channel: player.videoDetails?.author?.trim() || "Unknown channel",
			lengthSeconds: length,
			automatic: chosen.track.kind === "asr",
			translated: chosen.translated,
			languageCode: chosen.track.languageCode,
			paragraphs,
		};
	}
	throw new VideoTranscriptError(
		lastReason === NO_CAPTIONS
			? NO_CAPTIONS
			: `Couldn't get this video's transcript. ${lastReason || "Try again in a moment."}`,
	);
}
