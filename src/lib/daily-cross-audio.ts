import "server-only";

import { generateText, Output } from "ai";
import { put } from "@vercel/blob";
import { z } from "zod";
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
	dailyCrossAudioPathname,
	estimateSpokenDurationSec,
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
 * Generated on first tap, never ahead of time - see the route for why.
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
	if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
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
	/** Short-lived signed URL; only present when status is "ready". */
	url: string | null;
	title: string | null;
	script: string | null;
	durationSec: number | null;
	generatedAt: string | null;
}

const NO_AUDIO: DailyCrossAudio = {
	status: "none",
	url: null,
	title: null,
	script: null,
	durationSec: null,
	generatedAt: null,
};

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
 */
async function toClientAudio(row: AudioRow): Promise<DailyCrossAudio> {
	const generatedAt = row.audioGeneratedAt?.toISOString() ?? null;

	if (row.audioStatus === "ready" && row.audioPathname) {
		const { previewUrl } = await createAttachmentPreviewUrl(row.audioPathname);
		return {
			status: "ready",
			url: previewUrl,
			title: row.audioTitle,
			script: row.audioScript,
			durationSec: row.audioDurationSec,
			generatedAt,
		};
	}

	if (row.audioStatus === "pending" || row.audioStatus === "failed") {
		return {
			status: row.audioStatus,
			url: null,
			title: row.audioTitle,
			script: row.audioScript,
			durationSec: row.audioDurationSec,
			generatedAt,
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
	const cross = await findTodayCross(userId);
	if (!cross) return NO_AUDIO;

	const row = await prisma.verseOfDay.findUnique({
		where: { id: cross.id },
		select: AUDIO_SELECT,
	});
	if (!row) return NO_AUDIO;
	return toClientAudio(row);
}

/**
 * Today's devotional audio, generating it if there is none. Returns "none" when
 * the user has no day yet - the cross itself is the other route's job, and
 * generating one here would hide that the two screens disagree.
 *
 * A "pending" row younger than its TTL is returned as-is so two clients tapping
 * play at once never pay for two narrations of the same day.
 */
export async function getOrCreateDailyCrossAudio(userId: string): Promise<DailyCrossAudio> {
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
