import "server-only";

import { createHash } from "node:crypto";
import { BIBLE_TRANSCRIPTION_PROMPT } from "@/lib/audio-transcription-rules";
import { voiceStudyInstructions } from "@/lib/beta/voice/prompt";
import { voiceToolDefinitions } from "@/lib/beta/voice/tools";
import {
	VOICE_MAX_OUTPUT_TOKENS,
	VOICE_MODEL,
	VOICE_NAME,
	VOICE_REASONING_EFFORT,
	VOICE_TRANSCRIPTION_MODEL,
} from "@/lib/beta/voice/voice-rules";

/**
 * Starting a Voice Study conversation (docs/beta/voice.md): the browser's
 * WebRTC offer goes to OpenAI's Realtime API through this server, the
 * "unified interface" in OpenAI's WebRTC guide (`POST /v1/realtime/calls`,
 * verified 2026-10-26). The API key and the session's instructions and tools
 * never reach the browser; it receives only the SDP answer that connects its
 * microphone and speaker to the call.
 */

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_OFFER_BYTES = 64 * 1024;

export async function voiceSessionConfig(): Promise<Record<string, unknown>> {
	return {
		type: "realtime",
		model: VOICE_MODEL,
		instructions: voiceStudyInstructions(),
		output_modalities: ["audio"],
		reasoning: { effort: VOICE_REASONING_EFFORT },
		max_output_tokens: VOICE_MAX_OUTPUT_TOKENS,
		audio: {
			input: {
				// WebRTC negotiates the audio format itself; only how it is heard is set here.
				noise_reduction: { type: "far_field" },
				transcription: { model: VOICE_TRANSCRIPTION_MODEL, prompt: BIBLE_TRANSCRIPTION_PROMPT, languages: ["en"] },
				// Semantic VAD waits out a thinking pause ("what does, um...") and
				// cancels the model's reply the moment the listener talks over it.
				turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
			},
			output: { voice: VOICE_NAME },
		},
		tools: await voiceToolDefinitions(),
		tool_choice: "auto",
		parallel_tool_calls: false,
	};
}

export type VoiceCallResult = { ok: true; answer: string } | { ok: false; status: number; error: string };

/** OpenAI's recommended per-user safety identifier: stable, and not the raw id. */
function safetyIdentifier(userId: string): string {
	return createHash("sha256").update(`sureword-voice:${userId}`).digest("hex");
}

export function isPlausibleOffer(sdp: string): boolean {
	return sdp.length > 0 && sdp.length <= MAX_OFFER_BYTES && sdp.startsWith("v=0") && /\bm=audio\b/.test(sdp);
}

export async function createVoiceCall(userId: string, offer: string): Promise<VoiceCallResult> {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) return { ok: false, status: 503, error: "Voice Study is not available right now." };
	const form = new FormData();
	form.set("sdp", offer);
	form.set("session", JSON.stringify(await voiceSessionConfig()));
	try {
		const response = await fetch(CALLS_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Safety-Identifier": safetyIdentifier(userId) },
			body: form,
			signal: AbortSignal.timeout(20_000),
		});
		const body = await response.text();
		if (!response.ok) {
			// The status and OpenAI's own message, never the key or the offer.
			console.error("beta voice: realtime call refused", response.status, body.slice(0, 500));
			return { ok: false, status: 502, error: "The voice connection could not be opened. Try again in a moment." };
		}
		return { ok: true, answer: body };
	} catch (error) {
		console.error("beta voice: realtime call failed", error instanceof Error ? error.message : error);
		return { ok: false, status: 502, error: "The voice connection could not be opened. Try again in a moment." };
	}
}
