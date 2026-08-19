/**
 * Pure routing decision for a notification tap, kept free of native imports so
 * it can be unit-tested. The hook in useVerseOfDayNotifications.ts owns the
 * actual navigation.
 */

function asInt(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Where a notification tap should land. Today's notifications carry
 * `screen: "cross"` (the guided day); older ones carry only a verse reference
 * and fall back to the Bible reader; anything else navigates nowhere.
 */
export function notificationTapTarget(
	data: Record<string, unknown>
): { screen: "cross" } | { reference: string } | null {
	if (data.screen === "cross") return { screen: "cross" };
	const chapter = asInt(data.chapter);
	const verse = asInt(data.verse);
	if (typeof data.book !== "string" || chapter === null || verse === null) return null;
	return { reference: `${data.book} ${chapter}:${verse}` };
}
