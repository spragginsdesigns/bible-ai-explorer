import "server-only";
import type { NarrationVoice, NarrationVoices } from "./daily-cross-audio-options";

export const DEFAULT_NARRATION_VOICE_ID = "UgBBYS2sOqTuMpoF3BR0";
export function defaultNarrationVoiceId() {
	return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_NARRATION_VOICE_ID;
}

interface ProviderVoice {
	voice_id: string; name: string; description?: string; preview_url?: string;
	labels?: Record<string, string>; category?: string;
}
let cached: { key: string; expires: number; value: NarrationVoices } | null = null;
let inflight: { key: string; promise: Promise<NarrationVoices> } | null = null;

function toVoice(voice: ProviderVoice): NarrationVoice {
	let previewUrl: string | null = null;
	try { if (voice.preview_url && new URL(voice.preview_url).protocol === "https:") previewUrl = voice.preview_url; } catch { /* No usable preview. */ }
	return { id: voice.voice_id, name: voice.name, description: [voice.labels?.accent, voice.labels?.gender, voice.labels?.description].filter(Boolean).join(" · ") || voice.description?.slice(0, 100) || "Devotional narrator", previewUrl };
}

/** Voice metadata and existing previews only. This never synthesizes speech. */
export async function readNarrationVoices(): Promise<NarrationVoices> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey?.trim()) throw new Error("Speech is unavailable");
	const defaultVoiceId = defaultNarrationVoiceId();
	const key = `${apiKey}:${defaultVoiceId}`;
	if (cached?.key === key && cached.expires > Date.now()) return cached.value;
	if (inflight?.key === key) return inflight.promise;
	const promise = (async () => {
		const request = async (path: string) => {
			const response = await fetch(`https://api.elevenlabs.io${path}`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
			if (!response.ok) throw new Error(`Voice catalog unavailable (${response.status})`);
			return response.json();
		};
		const [catalog, preferred] = await Promise.all([
			request("/v2/voices?page_size=100&voice_type=default&category=premade&language=en&sort=name&sort_direction=asc"),
			request(`/v1/voices/${encodeURIComponent(defaultVoiceId)}`).catch(() => null),
		]);
		// Account-owned clones and saved character voices must never become a public picker.
		const defaults: ProviderVoice[] = catalog.voices.filter((voice: ProviderVoice) => voice.category === "premade");
		const candidates: ProviderVoice[] = preferred ? [preferred, ...defaults] : defaults;
		const voices = Array.from(new Map(candidates.filter((v) => v.voice_id && v.name).map((v) => [v.voice_id, toVoice(v)])).values()).slice(0, 8);
		if (!voices.length) throw new Error("No narration voices available");
		const value = { voices, defaultVoiceId: voices.some((v) => v.id === defaultVoiceId) ? defaultVoiceId : voices[0].id };
		cached = { key, expires: Date.now() + 15 * 60_000, value };
		return value;
	})();
	inflight = { key, promise };
	try { return await promise; } finally { if (inflight?.promise === promise) inflight = null; }
}
