import { apiJson, type GetToken } from "@/lib/api";
import type { ReadingPlan, ReadingPlansView } from "./types";

/**
 * The reading-plan endpoints. The same routes serve the web client, so a plan
 * started on the phone is the plan the browser shows.
 */

/** Having a plan WRITTEN is a model call; a preset is arithmetic on the server. */
const WRITE_PLAN_TIMEOUT_MS = 120_000;

export function fetchReadingPlans(getToken: GetToken): Promise<ReadingPlansView> {
	return apiJson<ReadingPlansView>(getToken, "/api/reading-plans");
}

/** Start one of SureWord's presets. Archives whatever plan they were on. */
export function startPresetPlan(getToken: GetToken, presetKey: string): Promise<ReadingPlan> {
	return apiJson<ReadingPlan>(getToken, "/api/reading-plans", {
		method: "POST",
		body: { presetKey },
	});
}

/** Have a plan written for a goal they typed. Archives their current plan. */
export function startGoalPlan(
	getToken: GetToken,
	goal: string,
	days: number
): Promise<ReadingPlan> {
	return apiJson<ReadingPlan>(
		getToken,
		"/api/reading-plans",
		{ method: "POST", body: { goal, days } },
		{ timeoutMs: WRITE_PLAN_TIMEOUT_MS }
	);
}

/**
 * Tick or untick one day by hand - only for reading done outside SureWord.
 * Chapters read in the app's own reader mark themselves.
 */
export function setPlanDay(
	getToken: GetToken,
	planId: string,
	day: number,
	done: boolean
): Promise<ReadingPlan> {
	return apiJson<ReadingPlan>(getToken, `/api/reading-plans/${planId}/days/${day}`, {
		method: "POST",
		body: { done },
	});
}

/** Put the plan away. Nothing is deleted; the answer is the empty screen. */
export function archiveReadingPlan(
	getToken: GetToken,
	planId: string
): Promise<ReadingPlansView> {
	return apiJson<ReadingPlansView>(getToken, `/api/reading-plans/${planId}`, { method: "DELETE" });
}
