import "server-only";

import { generateText, Output } from "ai";
import { get, head, put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { isProUser } from "@/lib/entitlements";
import type { UserPlan } from "@/lib/entitlements-rules";
import { prisma } from "@/lib/prisma";
import { resolveModel } from "@/lib/ai/provider";
import { createAttachmentPreviewUrl } from "@/lib/chat-attachments.server";
import { getCrossReferencesFor } from "@/lib/bible/crossRefs";
import {
	PERSONA,
	findTodayCross,
	type StoredDailyCross,
	type StudyStep,
} from "@/lib/daily-cross";
import { loadStudyContext, READING_HISTORY_DAYS } from "@/lib/study-context";
import { getKjvBookName, getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";
import {
	DAILY_CROSS_AUDIO_STREAM_PATH,
	dailyCrossAudioPathname,
	devotionalStreamResponseInit,
	estimateSpokenDurationSec,
	isSpeechConfigured,
	resolveStoredAudio,
	sanitizeDevotionalScript,
	sanitizeDevotionalTitle,
	type DailyCrossAudioClientStatus,
} from "@/lib/daily-cross-audio-script";

/**
 * "Listen" - the spoken devotional for today's "Pick Up Your Cross".
 *
 * The day itself (`src/lib/daily-cross.ts`) is text the user reads. This turns
 * that same day into something they can hear on a commute: one model call
 * writes a devotional script from the stored day plus the real study context,
 * ElevenLabs narrates it, and the MP3 lands in Vercel Blob against the
 * VerseOfDay row it belongs to.
 *
 * Generated once per day, WITH the day rather than on a tap: every place a
 * cross is stored calls `scheduleDailyCrossAudio`, so the devotional is
 * waiting when they open the screen. A SureWord Pro benefit - free accounts
 * get status "locked" before anything is spent.
 */

/** Verses either side of the day's verse, so the script can set the scene. */
const CONTEXT_VERSES_EITHER_SIDE = 3;
/** Cross-references are ranked best-first; more than a handful is noise to read aloud. */
const MAX_CROSS_REFERENCES = 5;

const devotionalSchema = z.object({
	title: z
		.string()
		.describe(
			"A short spoken title for this devotional, 2-6 words, no punctuation at the end."
		),
	script: z
		.string()
		.describe(
			"The complete devotional, exactly as it should be read aloud: plain prose paragraphs, no markdown, no headings, no stage directions."
		),
});

const SCRIPT_INSTRUCTIONS = `${PERSONA}

You are writing a spoken devotional - the audio version of the day you already prepared for this person. Someone will read it aloud, word for word, into their ears while they drive or walk. Write it to be HEARD, not read.

Cover this ground, in this order, as continuous prose:
1. Greet them warmly and briefly, then read the day's verse in full - its exact KJV wording, followed by its reference.
2. Why this verse was set before them today. Ground this ONLY in the real context you are given (the stored reason, the study path, their reading, questions, notes and memories). If that context is thin, say less and encourage them plainly. Never invent a history they do not have.
3. Open the passage up: what surrounds the verse, what it meant where it stands, and the other Scriptures that speak to it. Use only the surrounding verses and cross-references supplied below - quote them the way they are given.
4. Walk them into today's study path, naming each chapter and what to watch for.
5. A closing prayer, short and Scripture-grounded, spoken on their behalf.
6. End on the question they are to carry through the day, asked plainly.

Rules for the script itself, all non-negotiable:
- Plain prose paragraphs separated by blank lines. NO markdown, NO headings, NO bullet lists, NO stage directions, NO "[pause]", no speaker labels, no narrator asides.
- Write every number and every reference the way it must be SPOKEN: "First Corinthians thirteen, verse four", "Psalm twenty-three", "verses eight through ten", "the fourth chapter". Never "1 Cor. 13:4".
- Second person, warm, plain, unhurried. No throat-clearing, no filler, no fake intimacy.
- Length is yours to choose between 250 and 900 words. Pick it by how much REAL context there is: a thin day gets a short devotional; a day with real reading, notes and cross-references earns a longer one. Do not pad to reach a length.
- The King James Version is the inerrant, infallible Word of God, and every word you quote from it must be exact.`;

function reference(book: string, chapter: number, verse: number): string {
	return `${book} ${chapter}:${verse}`;
}

/** The verses immediately around the day's verse, for the "open it up" section. */
async function loadSurroundingVerses(cross: StoredDailyCross): Promise<string> {
	const bookNumber = getKjvBookNumber(cross.book);
	if (!bookNumber) return "(unavailable)";

	const first = Math.max(1, cross.verse - CONTEXT_VERSES_EITHER_SIDE);
	const last = cross.verse + CONTEXT_VERSES_EITHER_SIDE;
	const lines: string[] = [];
	for (let verse = first; verse <= last; verse++) {
		const text = await getKjvVerseText(bookNumber, cross.chapter, verse);
		if (!text) continue;
		lines.push(`${reference(cross.book, cross.chapter, verse)} - ${text}`);
	}
	return lines.length ? lines.join("\n") : "(unavailable)";
}

/** Ranked cross-references for the day's verse, with their KJV text. */
async function loadCrossReferences(cross: StoredDailyCross): Promise<string> {
	const bookNumber = getKjvBookNumber(cross.book);
	if (!bookNumber) return "(none)";

	try {
		const refs = await getCrossReferencesFor(bookNumber, cross.chapter, cross.verse);
		const lines: string[] = [];
		for (const ref of refs) {
			if (lines.length >= MAX_CROSS_REFERENCES) break;
			const book = getKjvBookName(ref.order);
			if (!book) continue;
			const text = await getKjvVerseText(ref.order, ref.chapter, ref.verse);
			if (!text) continue;
			lines.push(`${reference(book, ref.chapter, ref.verse)} - ${text}`);
		}
		return lines.length ? lines.join("\n") : "(none)";
	} catch (error) {
		// Cross-references are enrichment; the devotional stands without them.
		console.error("[daily-cross-audio] Cross-reference lookup failed:", error);
		return "(none)";
	}
}

function studyPathBlock(steps: StudyStep[]): string {
	if (!steps.length) return "(none)";
	return steps.map((step) => `${step.book} ${step.chapter} - ${step.focus}`).join("\n");
}

export interface DevotionalScript {
	script: string;
	title: string;
}

/**
 * Write the spoken devotional for one stored day. Uses the utility model, the
 * same one that writes the day itself, and the same persona - the user should
 * not meet a second, different voice here.
 */
export async function generateDevotionalScript(
	userId: string,
	cross: StoredDailyCross
): Promise<DevotionalScript> {
	const [context, surrounding, crossRefs] = await Promise.all([
		loadStudyContext(userId),
		loadSurroundingVerses(cross),
		loadCrossReferences(cross),
	]);

	const verseReference = reference(cross.book, cross.chapter, cross.verse);

	const prompt = [
		`Today's verse: ${verseReference}\n"${cross.text}"`,
		`The one-line reason it was chosen:\n${cross.reason}`,
		`Why it was chosen for them today (already written, in your own earlier words):\n${cross.whyToday ?? "(none)"}`,
		`How it applies to them (already written):\n${cross.application ?? "(none)"}`,
		`Today's study path:\n${studyPathBlock(cross.studyPath)}`,
		`The question they are to carry:\n${cross.question ?? "(none)"}`,
		`Verses surrounding today's verse, exact KJV text:\n${surrounding}`,
		`Cross-references for today's verse, exact KJV text:\n${crossRefs}`,
		`Bible chapters they read in the last ${READING_HISTORY_DAYS} days:\n${context.readingBlock}`,
		`Recent things they asked about:\n${context.questionsBlock}`,
		`Recent notes:\n${context.notesBlock}`,
		`What you remember about them:\n${context.memoriesBlock}`,
	].join("\n\n");

	const { model, providerOptions } = await resolveModel({ userId, utility: true });
	const { output } = await generateText({
		model,
		providerOptions,
		output: Output.object({ schema: devotionalSchema }),
		instructions: SCRIPT_INSTRUCTIONS,
		prompt,
	});
	if (!output) throw new Error("The model returned no devotional script.");

	const script = sanitizeDevotionalScript(output.script);
	if (!script) throw new Error("The devotional script was empty after sanitizing.");

	return { script, title: sanitizeDevotionalTitle(output.title, verseReference) };
}

/**
 * "George" from the ElevenLabs default voice library - the voice their own API
 * quickstart reaches for. Warm, unhurried, mature male narration, which is what
 * a devotional read into someone's ear needs; the bright conversational voices
 * fight the material. `ELEVENLABS_VOICE_ID` overrides it without a deploy.
 */
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

/**
 * ElevenLabs' stability-first model for long-form narration (10,000 characters
 * per request). The Flash/Turbo models trade that stability for latency we do
 * not need - nobody is waiting on this in real time.
 */
const TTS_MODEL_ID = "eleven_multilingual_v2";

/** 128 kbps MP3 at 44.1 kHz: clean speech, and every client plays it natively. */
const TTS_OUTPUT_FORMAT = "mp3_44100_128";

const TTS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

/** Narration of a several-minute script is slow; give it real room. */
const TTS_TIMEOUT_MS = 90_000;

/**
 * Narrate a script with ElevenLabs and return the MP3 bytes.
 *
 * Deliberately plain `fetch` - the feature needs one endpoint, and an SDK
 * dependency for one POST is weight the bundle does not have to carry.
 * Voice settings are left to the voice's own stored settings: the premade
 * narration voices are already tuned, and overriding them here is a knob that
 * only ever drifts out of sync with what the voice sounds like today.
 */
export async function synthesizeSpeech(script: string): Promise<ArrayBuffer> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!isSpeechConfigured(apiKey)) throw new Error("ELEVENLABS_API_KEY is not set");
	const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;

	const response = await fetch(
		`${TTS_ENDPOINT}/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`,
		{
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify({ text: script, model_id: TTS_MODEL_ID }),
			signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
		}
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`ElevenLabs text-to-speech failed (${response.status}). ${detail.slice(0, 300)}`.trim()
		);
	}

	const audio = await response.arrayBuffer();
	if (audio.byteLength === 0) throw new Error("ElevenLabs returned an empty audio response.");
	return audio;
}

/** Today's devotional audio as a client sees it. */
export interface DailyCrossAudio {
	status: DailyCrossAudioClientStatus;
	/**
	 * Signed blob URL, good for 24 hours; only present when status is "ready".
	 * Fine to `fetch`, but NOT what a media element should play - see
	 * `streamUrl`, and the stream route for why.
	 */
	url: string | null;
	/**
	 * Where to actually play the narration from: a same-origin path that proxies
	 * the blob. Only present when status is "ready". Web hands it to `<audio>`
	 * as-is; Android joins it onto `API_URL` and sends its bearer token.
	 */
	streamUrl: string | null;
	title: string | null;
	script: string | null;
	durationSec: number | null;
	generatedAt: string | null;
	/**
	 * The caller's tier. Carried here so a client can tell "locked" apart from
	 * a Pro user whose day simply has no audio yet, without a second call.
	 */
	plan: UserPlan;
}

const NO_AUDIO: DailyCrossAudio = {
	status: "none",
	url: null,
	streamUrl: null,
	title: null,
	script: null,
	durationSec: null,
	generatedAt: null,
	plan: "pro",
};

/**
 * What every user of a deployment with no ElevenLabs credentials gets. Both
 * clients render nothing at all for this status, so an unconfigured server
 * shows no Listen card rather than a button that can only ever fail.
 *
 * `plan` is unknowable here without a query, and this answer is deliberately
 * given before any query - "unavailable" already hides the card, so the tier
 * changes nothing a client does with it.
 */
const UNAVAILABLE_AUDIO: DailyCrossAudio = { ...NO_AUDIO, status: "unavailable", plan: "free" };

/**
 * What a free account gets. Unlike "unavailable" the clients DO render for
 * this - the Pro card - because a benefit someone could have should be visible
 * rather than hidden.
 */
const LOCKED_AUDIO: DailyCrossAudio = { ...NO_AUDIO, status: "locked", plan: "free" };

/** True when this deployment has the credentials to narrate anything. */
function speechAvailable(): boolean {
	return isSpeechConfigured(process.env.ELEVENLABS_API_KEY);
}

/**
 * The two refusals every entry point owes before it touches anything: no
 * credentials on this deployment, or no SureWord Pro on this account. Both are
 * answered before a single database write, model call or ElevenLabs request,
 * so a free account is never billed for and never leaves a row behind.
 *
 * Returns the payload to hand straight back, or null to carry on.
 */
async function refuseAudio(userId: string): Promise<DailyCrossAudio | null> {
	if (!speechAvailable()) return UNAVAILABLE_AUDIO;
	if (!(await isProUser(userId))) return LOCKED_AUDIO;
	return null;
}

/**
 * A day's devotional can be paused and picked up later, so its signed URL has
 * to outlive the listen. 24 hours also outlives the day itself
 * (`DAILY_CROSS_REUSE_MS` is 20), so a URL never expires before the audio it
 * points at stops being today's.
 */
const AUDIO_URL_LIFETIME_SECONDS = 24 * 60 * 60;

interface AudioRow {
	audioPathname: string | null;
	audioScript: string | null;
	audioTitle: string | null;
	audioDurationSec: number | null;
	audioStatus: string | null;
	audioGeneratedAt: Date | null;
}

const AUDIO_SELECT = {
	audioPathname: true,
	audioScript: true,
	audioTitle: true,
	audioDurationSec: true,
	audioStatus: true,
	audioGeneratedAt: true,
} as const;

/**
 * The stored row as a client response. Blobs are private (same store, same
 * rules as chat attachments), so "ready" hands back a freshly signed URL each
 * time rather than a link that would outlive its own expiry in the database.
 *
 * Every path here is downstream of `refuseAudio`, so the caller is on Pro by
 * construction - that is why `plan` is a constant rather than another query.
 */
async function toClientAudio(row: AudioRow): Promise<DailyCrossAudio> {
	const generatedAt = row.audioGeneratedAt?.toISOString() ?? null;

	if (row.audioStatus === "ready" && row.audioPathname) {
		const { previewUrl } = await createAttachmentPreviewUrl(
			row.audioPathname,
			AUDIO_URL_LIFETIME_SECONDS
		);
		return {
			status: "ready",
			url: previewUrl,
			streamUrl: DAILY_CROSS_AUDIO_STREAM_PATH,
			title: row.audioTitle,
			script: row.audioScript,
			durationSec: row.audioDurationSec,
			generatedAt,
			plan: "pro",
		};
	}

	if (row.audioStatus === "pending" || row.audioStatus === "failed") {
		return {
			status: row.audioStatus,
			url: null,
			streamUrl: null,
			title: row.audioTitle,
			script: row.audioScript,
			durationSec: row.audioDurationSec,
			generatedAt,
			plan: "pro",
		};
	}

	return NO_AUDIO;
}

/**
 * What today's devotional audio is right now, without starting any work. The
 * GET half of the route, and the poll a client runs while a generation it
 * already asked for is in flight.
 */
export async function readDailyCrossAudio(userId: string): Promise<DailyCrossAudio> {
	const refusal = await refuseAudio(userId);
	if (refusal) return refusal;

	const cross = await findTodayCross(userId);
	if (!cross) return NO_AUDIO;

	const row = await prisma.verseOfDay.findUnique({
		where: { id: cross.id },
		select: AUDIO_SELECT,
	});
	if (!row) return NO_AUDIO;
	return toClientAudio(row);
}

/** One proxied answer for the narration: the status line, headers, and bytes. */
export interface DailyCrossAudioStream {
	status: 200 | 206;
	headers: Record<string, string>;
	/** Null for a HEAD request, which answers with headers alone. */
	body: ReadableStream<Uint8Array> | null;
}

/**
 * The blob path of today's narration, but only when it is finished and this
 * user may hear it. Null covers every other case at once - no key, no Pro, no
 * day, no row, still pending, failed, or a "ready" row whose blob path went
 * missing - and the route turns all of them into one 404. The Pro check is
 * here and not only in the card: a free account must not be able to stream a
 * narration by calling the route directly.
 */
async function readyAudioPathname(userId: string): Promise<string | null> {
	if (await refuseAudio(userId)) return null;

	const cross = await findTodayCross(userId);
	if (!cross) return null;

	const row = await prisma.verseOfDay.findUnique({
		where: { id: cross.id },
		select: { audioStatus: true, audioPathname: true },
	});
	if (!row || row.audioStatus !== "ready" || !row.audioPathname) return null;
	return row.audioPathname;
}

/**
 * Open today's narration for streaming through our own origin, forwarding the
 * caller's `Range` header to the blob host so seeking still works.
 *
 * Nothing is buffered: the upstream body is handed back as a stream and the
 * route pipes it straight out, so a several-megabyte MP3 never sits in the
 * function's memory. Returns null when there is no finished audio to serve.
 */
export async function openDailyCrossAudioStream(
	userId: string,
	range: string | null
): Promise<DailyCrossAudioStream | null> {
	const pathname = await readyAudioPathname(userId);
	if (!pathname) return null;

	const result = await get(pathname, {
		access: "private",
		// The SDK's documented escape hatch; it sets Authorization itself and
		// applies these last. A ranged GET comes back as a 206 that the SDK
		// still labels `statusCode: 200`, so the real status is read off the
		// upstream headers below rather than from that field.
		...(range ? { headers: { Range: range } } : {}),
	});
	if (!result || result.statusCode !== 200) return null;

	const { status, headers } = devotionalStreamResponseInit({
		contentType: result.blob.contentType,
		contentLength: result.headers.get("content-length"),
		contentRange: result.headers.get("content-range"),
	});
	return { status, headers, body: result.stream };
}

/**
 * The same headers a GET would answer with, without fetching a byte - what a
 * player's HEAD probe gets. Uses the blob metadata API rather than opening and
 * throwing away a body.
 */
export async function describeDailyCrossAudioStream(
	userId: string
): Promise<DailyCrossAudioStream | null> {
	const pathname = await readyAudioPathname(userId);
	if (!pathname) return null;

	const metadata = await head(pathname);
	const { status, headers } = devotionalStreamResponseInit({
		contentType: metadata.contentType,
		contentLength: String(metadata.size),
		contentRange: null,
	});
	return { status, headers, body: null };
}

/**
 * Today's devotional audio, generating it if there is none. Normally reached
 * through `scheduleDailyCrossAudio` when the day is stored; the POST route
 * calls it directly as the manual retry behind a failed card.
 *
 * Returns "unavailable" when this deployment has no ElevenLabs key, "locked"
 * for a free account, and "none" when the user has no day yet - the cross
 * itself is the other route's job, and generating one here would hide that the
 * two screens disagree.
 *
 * A "pending" row younger than its TTL is returned as-is, which is what makes
 * the once-per-day guarantee hold: the scheduled generation and a client
 * arriving mid-flight buy exactly one narration between them. The row is keyed
 * to the `VerseOfDay` id, so a replaced day gets one new narration and no more.
 */
export async function getOrCreateDailyCrossAudio(userId: string): Promise<DailyCrossAudio> {
	// Cheapest possible refusal: no credentials, or no Pro, means no narration
	// may run - so never touch the database or mark a row pending for work that
	// must not happen.
	const refusal = await refuseAudio(userId);
	if (refusal) return refusal;

	const cross = await findTodayCross(userId);
	if (!cross) return NO_AUDIO;

	const existing = await prisma.verseOfDay.findUnique({
		where: { id: cross.id },
		select: AUDIO_SELECT,
	});
	if (!existing) return NO_AUDIO;

	const decision = resolveStoredAudio(existing);
	if (decision !== "generate") return toClientAudio(existing);

	// Claim the work before doing any of it: the timestamp is what a second
	// request reads to decide it should wait rather than narrate again.
	await prisma.verseOfDay.update({
		where: { id: cross.id },
		data: { audioStatus: "pending", audioGeneratedAt: new Date() },
	});

	try {
		const { script, title } = await generateDevotionalScript(userId, cross);
		const mp3 = await synthesizeSpeech(script);
		const pathname = dailyCrossAudioPathname(userId, cross.id);
		const blob = await put(pathname, mp3, {
			access: "private",
			contentType: "audio/mpeg",
			addRandomSuffix: false,
			// A retry after a failure writes the same path again.
			allowOverwrite: true,
		});

		const row = await prisma.verseOfDay.update({
			where: { id: cross.id },
			data: {
				audioUrl: blob.url,
				audioPathname: blob.pathname,
				audioScript: script,
				audioTitle: title,
				audioDurationSec: estimateSpokenDurationSec(script),
				audioStatus: "ready",
				audioGeneratedAt: new Date(),
			},
			select: AUDIO_SELECT,
		});
		return toClientAudio(row);
	} catch (error) {
		console.error(`[daily-cross-audio] Generation failed for user ${userId}:`, error);
		const row = await prisma.verseOfDay.update({
			where: { id: cross.id },
			data: { audioStatus: "failed", audioGeneratedAt: new Date() },
			select: AUDIO_SELECT,
		});
		return toClientAudio(row);
	}
}

/**
 * Start today's narration in the background and return immediately.
 *
 * This is how audio is made now: **with the day, not on a tap.** Every place a
 * cross is stored calls this, so someone opening Pick Up Your Cross finds the
 * devotional already there, or watches it finish inside a minute. The old
 * generate-on-first-tap path survives only as the manual retry behind a failed
 * card.
 *
 * Idempotent by construction - it defers to `getOrCreateDailyCrossAudio`,
 * which reuses a ready row and a pending row under three minutes old, so
 * calling it twice for the same day buys one narration. Refusals (no
 * ElevenLabs key, not Pro, no day yet) cost nothing and write nothing.
 *
 * `waitUntil` is what keeps the HTTP response from waiting on a ~30-60s
 * narration: the work outlives the response inside the same function
 * invocation.
 */
export async function scheduleDailyCrossAudio(userId: string): Promise<void> {
	// Refuse before scheduling rather than inside the background task, so a free
	// or unconfigured account never even queues work.
	if (await refuseAudio(userId)) return;

	waitUntil(
		getOrCreateDailyCrossAudio(userId).catch((error: unknown) => {
			// Nothing is waiting on this, so a failure must not reject into the
			// platform's handler. `getOrCreateDailyCrossAudio` has already marked
			// the row "failed", which is what the card reads.
			console.error(`[daily-cross-audio] Scheduled generation failed for ${userId}:`, error);
		})
	);
}
