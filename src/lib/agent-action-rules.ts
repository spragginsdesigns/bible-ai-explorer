import { createHash } from "node:crypto";

/** Stable fingerprints bind a decision to the exact action and target state. */
export function actionFingerprint(value: unknown): string {
	const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sort(value)])) : item;
	return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}

export type ProtectedAction = "setDailyCross" | "startReadingPlan" | "saveTestimony" | "saveAboutMe" | "setChurch";

export function actionPayload(action: ProtectedAction, input: Record<string, unknown>): Record<string, string | number> {
	const result: Record<string, string | number> = {};
	const keys = action === "setDailyCross" ? ["focus", "book", "chapter", "verse"] : action === "startReadingPlan" ? ["presetKey", "goal", "days"] : action === "setChurch" ? ["placeId"] : ["text"];
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) result[key] = value.trim();
		else if (typeof value === "number") result[key] = value;
	}
	if (action === "startReadingPlan") {
		if (result.presetKey) { delete result.goal; delete result.days; }
		else if (result.goal && !result.days) result.days = 30;
	}
	return result;
}
