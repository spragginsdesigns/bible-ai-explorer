/** Deliberately bounded choices, applied to speech only, never Scripture text. */
export const NARRATION_STYLES = [
	{ id: "calm", label: "Calm", description: "Steady and reflective", stability: 0.75, style: 0 },
	{ id: "natural", label: "Natural", description: "Warm and conversational", stability: 0.5, style: 0 },
	{ id: "expressive", label: "Expressive", description: "More feeling and emphasis", stability: 0.35, style: 0.25 },
] as const;

export type NarrationStyle = (typeof NARRATION_STYLES)[number]["id"];
export interface NarrationOptions { voiceId?: string; style?: NarrationStyle }
export interface NarrationVoice { id: string; name: string; description: string; previewUrl: string | null }
export interface NarrationVoices { voices: NarrationVoice[]; defaultVoiceId: string }

export function narrationSettings(style: NarrationStyle = "natural") {
	const choice = NARRATION_STYLES.find((item) => item.id === style) ?? NARRATION_STYLES[1];
	return { stability: choice.stability, style: choice.style, similarity_boost: 0.75, use_speaker_boost: true };
}
