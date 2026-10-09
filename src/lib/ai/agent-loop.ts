/** Reserve the last model step for a useful answer rather than another tool. */
export function finishAgentWork(stepNumber: number, startedAt: number, now = Date.now()): boolean {
	return stepNumber >= 7 || now - startedAt >= 180_000;
}

/** A slow final tool can exhaust stopWhen before another model step is allowed. */
export function incompleteAgentNotice(finishReason: string | null | undefined, elapsedMs: number): string | null {
	if (finishReason === "content-filter") return "The model provider stopped this answer before completion. The response above is incomplete. Please ask for a shorter explanation or read the passage in the Bible reader.";
	return finishReason === "tool-calls" && elapsedMs >= 210_000
		? "I reached the time limit before completing your request. Any successful tool results are retained, but I have not finished the requested answer or verified the whole result. You can ask me to continue from this point."
		: null;
}
/** Discovery metadata cannot substitute for the full saved checkpoint. */
export function mustReadStudy(studyWorkRequested: boolean, knownIds: Set<string>, readIds: Set<string>): boolean {
	return studyWorkRequested && knownIds.size > 0 && readIds.size === 0;
}
