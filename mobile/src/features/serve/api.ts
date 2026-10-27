import { ApiError, apiJson, type GetToken } from "@/lib/api";
import {
	parseServeView,
	type ServeEntryView,
	type ServeNearbyResponse,
	type ServeSettings,
	type ServeView,
} from "./serveRules";

/**
 * The `/api/serve*` requests. The same routes serve web and Apple, so a mode
 * picked on the phone is the mode every other client shows.
 */

function viewOrThrow(response: { serve?: unknown }): ServeView {
	const view = parseServeView(response.serve);
	if (!view) throw new ApiError("Ways to Serve could not be read. Try again.");
	return view;
}

export async function fetchServe(getToken: GetToken): Promise<ServeView> {
	return viewOrThrow(await apiJson<{ serve?: unknown }>(getToken, "/api/serve"));
}

export async function patchServe(getToken: GetToken, patch: Partial<ServeSettings>): Promise<ServeView> {
	return viewOrThrow(
		await apiJson<{ serve?: unknown }>(getToken, "/api/serve", { method: "PATCH", body: patch })
	);
}

export function searchServeNearby(getToken: GetToken, location: string, kind: string) {
	return apiJson<ServeNearbyResponse>(
		getToken,
		`/api/serve/nearby?location=${encodeURIComponent(location.trim())}&kind=${encodeURIComponent(kind)}`
	);
}

export async function fetchServeJournal(getToken: GetToken): Promise<ServeEntryView[]> {
	const response = await apiJson<{ entries?: ServeEntryView[] }>(getToken, "/api/serve/journal");
	return Array.isArray(response.entries) ? response.entries : [];
}

export async function addServeJournalEntry(
	getToken: GetToken,
	text: string,
	verseRef: string | null
): Promise<ServeEntryView> {
	const response = await apiJson<{ entry: ServeEntryView }>(getToken, "/api/serve/journal", {
		method: "POST",
		body: verseRef ? { text, verseRef } : { text },
	});
	return response.entry;
}

export async function deleteServeJournalEntry(getToken: GetToken, id: string): Promise<void> {
	await apiJson<unknown>(getToken, `/api/serve/journal/${encodeURIComponent(id)}`, { method: "DELETE" });
}
