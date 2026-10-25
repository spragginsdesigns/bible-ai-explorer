import "server-only";
import { createHash } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { synthesizeSpeech } from "@/lib/daily-cross-audio";
import { devotionalStreamResponseInit, isSpeechConfigured } from "@/lib/daily-cross-audio-script";
import { defaultNarrationVoiceId } from "@/lib/daily-cross-voices";
import {
	DEFAULT_ONBOARDING_VOICE_CHAR_CEILING,
	SCRIPTED_LINES,
	STEP_CARDS,
	readCeiling,
	spokenText,
	type OnboardingStep,
} from "@/lib/onboarding-rules";

/**
 * Voice mode ("Read it to me") for the welcome conversation, in the Listen
 * narrator's voice and free to the person (Austin, 2026-10-25). Kept cheap:
 *
 * - The scripted lines (the welcome and every step's question) are narrated
 *   once, ever, and shared by every account from one cached object.
 * - SureWord's own replies are narrated only when a client asks for that
 *   message, cached per message so a replay is free, and counted against a
 *   per-account character ceiling (ONBOARDING_VOICE_CHAR_CEILING).
 * - ONBOARDING_ELEVENLABS_DISABLED=true switches ElevenLabs off entirely.
 *
 * Whenever ElevenLabs cannot be used (switched off, not configured, over the
 * ceiling, or it failed) the answer is `device`, with the words: every client
 * then speaks them with its free on-device voice instead.
 */

/** Long-form quality for the lines everyone hears, paid for once. */
const SCRIPTED_MODEL_ID = "eleven_multilingual_v2";
/** Half the credits per character and far lower latency, for live replies. */
const REPLY_MODEL_ID = "eleven_flash_v2_5";

export const ONBOARDING_VOICE_STREAM_PATH = "/api/onboarding/audio/stream";

export type OnboardingVoiceSource = "shared" | "cached" | "elevenlabs";
export type OnboardingVoiceFallback = "disabled" | "unavailable" | "ceiling" | "failed";

export type OnboardingVoiceAnswer =
	| { status: "ready"; streamUrl: string; source: OnboardingVoiceSource; characters: number }
	| { status: "device"; text: string; reason: OnboardingVoiceFallback; characters: number };

export function onboardingVoiceCharCeiling(): number {
	return readCeiling(process.env.ONBOARDING_VOICE_CHAR_CEILING, DEFAULT_ONBOARDING_VOICE_CHAR_CEILING);
}

function elevenLabsDisabled(): boolean {
	return process.env.ONBOARDING_ELEVENLABS_DISABLED === "true";
}

/** The cached object's name: same voice, model and words, same audio. */
function audioKey(text: string, voiceId: string, modelId: string): string {
	return createHash("sha256").update(`${voiceId}\n${modelId}\n${text}`).digest("hex").slice(0, 40);
}

function sharedPathname(key: string): string {
	return `onboarding-voice/shared/${key}.mp3`;
}

function personalPathname(userId: string, key: string): string {
	return `onboarding-voice/${userId}/${key}.mp3`;
}

async function exists(pathname: string): Promise<boolean> {
	try {
		await head(pathname);
		return true;
	} catch {
		return false;
	}
}

class NotFound extends Error {}

/** The words to speak for one request, after the ownership checks. */
async function wordsFor(userId: string, request: { messageId?: string; step?: OnboardingStep }): Promise<string> {
	const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingConversationId: true } });
	if (!user?.onboardingConversationId) throw new NotFound();
	if (request.step) {
		if (request.step === "other") throw new NotFound();
		return STEP_CARDS[request.step].question;
	}
	const message = await prisma.message.findFirst({
		where: {
			id: request.messageId,
			role: "assistant",
			conversationId: user.onboardingConversationId,
			conversation: { userId },
		},
		select: { content: true },
	});
	if (!message) throw new NotFound();
	return spokenText(message.content);
}

/**
 * Narrate one welcome message or one step's question. Returns null when the
 * message is not in this account's welcome conversation, which the route
 * answers with a 404.
 */
export async function requestOnboardingVoice(
	userId: string,
	request: { messageId?: string; step?: OnboardingStep },
): Promise<OnboardingVoiceAnswer | null> {
	let text: string;
	try {
		text = await wordsFor(userId, request);
	} catch (error) {
		if (error instanceof NotFound) return null;
		throw error;
	}
	const characters = text.length;
	const device = (reason: OnboardingVoiceFallback): OnboardingVoiceAnswer => ({ status: "device", text, reason, characters });
	if (!text) return device("unavailable");
	if (elevenLabsDisabled()) return device("disabled");
	if (!isSpeechConfigured(process.env.ELEVENLABS_API_KEY)) return device("unavailable");

	const voiceId = defaultNarrationVoiceId();
	const scripted = SCRIPTED_LINES.includes(text);
	const modelId = scripted ? SCRIPTED_MODEL_ID : REPLY_MODEL_ID;
	const key = audioKey(text, voiceId, modelId);
	const pathname = scripted ? sharedPathname(key) : personalPathname(userId, key);
	const streamUrl = `${ONBOARDING_VOICE_STREAM_PATH}?key=${scripted ? "shared" : "mine"}-${key}`;

	if (await exists(pathname)) {
		return { status: "ready", streamUrl, source: scripted ? "shared" : "cached", characters };
	}

	// A reply is charged to the account before it is generated, atomically, so
	// two devices asking at once cannot both slip under the ceiling.
	if (!scripted) {
		const ceiling = onboardingVoiceCharCeiling();
		const reserved = await prisma.user.updateMany({
			where: { id: userId, onboardingVoiceChars: { lte: Math.max(-1, ceiling - characters) } },
			data: { onboardingVoiceChars: { increment: characters } },
		});
		if (reserved.count === 0) return device("ceiling");
	}

	try {
		const mp3 = await synthesizeSpeech(text, { voiceId, modelId });
		await put(pathname, mp3, {
			access: "private",
			contentType: "audio/mpeg",
			addRandomSuffix: false,
			// Same key, same bytes: a second device racing the first may overwrite harmlessly.
			allowOverwrite: true,
		});
		return { status: "ready", streamUrl, source: scripted ? "shared" : "elevenlabs", characters };
	} catch (error) {
		console.error("[onboarding-voice] narration failed:", error);
		if (!scripted) {
			await prisma.user
				.update({ where: { id: userId }, data: { onboardingVoiceChars: { decrement: characters } } })
				.catch(() => undefined);
		}
		return device("failed");
	}
}

/** `shared-<key>` or `mine-<key>` from the stream URL, resolved to a blob path for this caller. */
export function streamPathname(userId: string, raw: string | null): string | null {
	const match = /^(shared|mine)-([0-9a-f]{40})$/.exec(raw ?? "");
	if (!match) return null;
	return match[1] === "shared" ? sharedPathname(match[2]) : personalPathname(userId, match[2]);
}

/** Proxy a cached narration through our own origin, Range included (see the Listen stream route). */
export async function openOnboardingVoiceStream(pathname: string, range: string | null) {
	const result = await get(pathname, { access: "private", ...(range ? { headers: { Range: range } } : {}) });
	if (!result || result.statusCode !== 200) return null;
	const { status, headers } = devotionalStreamResponseInit({
		contentType: result.blob.contentType,
		contentLength: result.headers.get("content-length"),
		contentRange: result.headers.get("content-range"),
	});
	return { status, headers, body: result.stream };
}

export async function describeOnboardingVoiceStream(pathname: string) {
	try {
		const metadata = await head(pathname);
		return devotionalStreamResponseInit({
			contentType: metadata.contentType,
			contentLength: String(metadata.size),
			contentRange: null,
		});
	} catch {
		return null;
	}
}

/**
 * Narrate every scripted line that is not cached yet. Run in the background
 * when a welcome opens, so by the time anyone turns voice mode on, the lines
 * everyone hears are already waiting. Charged to no account.
 */
export async function warmScriptedVoice(): Promise<void> {
	if (elevenLabsDisabled() || !isSpeechConfigured(process.env.ELEVENLABS_API_KEY)) return;
	const voiceId = defaultNarrationVoiceId();
	for (const text of SCRIPTED_LINES) {
		const pathname = sharedPathname(audioKey(text, voiceId, SCRIPTED_MODEL_ID));
		if (await exists(pathname)) continue;
		try {
			const mp3 = await synthesizeSpeech(text, { voiceId, modelId: SCRIPTED_MODEL_ID });
			await put(pathname, mp3, { access: "private", contentType: "audio/mpeg", addRandomSuffix: false, allowOverwrite: true });
		} catch (error) {
			console.error("[onboarding-voice] warming a scripted line failed:", error);
			return;
		}
	}
}
