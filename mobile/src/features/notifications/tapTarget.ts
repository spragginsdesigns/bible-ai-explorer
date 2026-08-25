/**
 * Pure routing decision for a notification tap, kept free of native imports so
 * it can be unit-tested. The hook in usePushNotifications.ts owns the
 * actual navigation.
 */

function asInt(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Where a notification tap should land. Notifications carry `screen: "cross"`
 * (the guided day) or `screen: "chat"` with the conversation whose answer
 * finished while the app was away; older ones carry only a verse reference and
 * fall back to the Bible reader; anything else navigates nowhere.
 */
export function notificationTapTarget(
	data: Record<string, unknown>
): { screen: "cross" } | { screen: "chat"; conversationId: string } | { reference: string } | null {
	if (data.screen === "cross") return { screen: "cross" };
	if (data.screen === "chat") {
		return typeof data.conversationId === "string" && data.conversationId
			? { screen: "chat", conversationId: data.conversationId }
			: null;
	}
	const chapter = asInt(data.chapter);
	const verse = asInt(data.verse);
	if (typeof data.book !== "string" || chapter === null || verse === null) return null;
	return { reference: `${data.book} ${chapter}:${verse}` };
}
