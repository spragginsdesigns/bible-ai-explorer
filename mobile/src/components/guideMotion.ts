export type GuidePhase = "idle" | "thinking" | "answering";

/** Tool events are still thought; praise starts when answer text arrives. */
export function guidePhase(isStreaming: boolean, content: string): GuidePhase {
	if (!isStreaming) return "idle";
	return content.trim().length > 0 ? "answering" : "thinking";
}
