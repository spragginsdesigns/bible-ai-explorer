/**
 * What a reader is told while an answer is checked against Scripture, shared
 * by the chat route's work trail and the landing page's guest box. Austin,
 * 2026-11-06: a minute or more is fine as long as the reader knows what is
 * happening, such as a mistake found in the first answer being corrected.
 */
export const CHECK_STEP = {
	checking: "Checking Scripture quotations and citations",
	firstCorrection: "Found a mistake in the first answer, correcting it now",
	laterCorrection: "Found another problem, correcting it again",
	recheck: "Reviewing the corrected answer against Scripture",
	final: "Final check against Scripture",
} as const;

/** The correction line for the nth correction (1-based). */
export function correctionStep(count: number): string {
	return count <= 1 ? CHECK_STEP.firstCorrection : CHECK_STEP.laterCorrection;
}
