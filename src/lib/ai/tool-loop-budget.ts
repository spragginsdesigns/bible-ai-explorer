/**
 * A wall-clock limit for the tool-calling loop.
 *
 * The platform kills a function that overruns `maxDuration` without running
 * any callback, so an overrunning turn is never persisted and never even
 * logged: the user's question is saved and their answer disappears. Seen in
 * production on 2026-09-12, a BYOK provider four tool steps into a turn at the
 * old 120s limit. Stopping the loop ourselves, well before the platform would,
 * means the turn ends normally: the answer streams, persists, and is measured.
 */
export const TOOL_LOOP_BUDGET_MS = 210_000;

/** Stop condition: true once this turn has been running longer than `budgetMs`. */
export function isOverTimeBudget(
	startedAtMs: number,
	budgetMs: number = TOOL_LOOP_BUDGET_MS,
	now: () => number = Date.now,
): () => boolean {
	return () => now() - startedAtMs >= budgetMs;
}
