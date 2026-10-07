import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { transcribe } from "ai";
import { houseKeyFor } from "@/lib/ai/house-key";
import { BIBLE_TRANSCRIPTION_PROMPT } from "@/lib/audio-transcription-rules";

/** Cheap and accurate enough for conversational speech; about $0.003 a minute. */
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

export class AudioTranscriptionUnavailableError extends Error {
	constructor() {
		super("Voice messages are not available right now.");
		this.name = "AudioTranscriptionUnavailableError";
	}
}

/**
 * Transcribe one voice message with the house OpenAI key. The caller has already
 * checked the file's type, length and the user's daily allowance; this only
 * turns sound into words.
 */
export async function transcribeAudio(bytes: Uint8Array, abortSignal?: AbortSignal): Promise<string> {
	const apiKey = houseKeyFor(process.env);
	if (!apiKey) throw new AudioTranscriptionUnavailableError();
	const openai = createOpenAI({ apiKey });
	const result = await transcribe({
		model: openai.transcription(TRANSCRIPTION_MODEL),
		audio: bytes,
		providerOptions: { openai: { prompt: BIBLE_TRANSCRIPTION_PROMPT } },
		abortSignal,
	});
	return result.text.trim();
}
