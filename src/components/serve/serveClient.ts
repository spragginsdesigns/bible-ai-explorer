/**
 * Same-origin calls for Ways to Serve (`/api/serve/**`). None of these routes
 * calls a model, so they use plain `fetch` and never the AI consent gate: a
 * reader who declined AI can still use every part of Ways to Serve.
 */

import type { ServeEntryView, ServeSettings, ServeView } from "@/lib/serve";
import type { ServePlace } from "@/lib/google-places";

export type { ServeEntryView, ServeSettings, ServeView, ServePlace };

async function readError(res: Response): Promise<never> {
	const data = (await res.json().catch(() => null)) as { error?: string } | null;
	throw new Error(data?.error ?? `Request failed (${res.status})`);
}

export async function fetchServe(signal?: AbortSignal): Promise<ServeView> {
	const res = await fetch("/api/serve", { credentials: "same-origin", cache: "no-store", signal });
	if (!res.ok) return readError(res);
	return ((await res.json()) as { serve: ServeView }).serve;
}

export async function patchServe(patch: Partial<ServeSettings>): Promise<ServeView> {
	const res = await fetch("/api/serve", {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!res.ok) return readError(res);
	return ((await res.json()) as { serve: ServeView }).serve;
}

export type NearbyResponse = { status: "unavailable" } | { status: "ok"; results: ServePlace[] };

export async function searchNearby(location: string, kind: string, signal?: AbortSignal): Promise<NearbyResponse> {
	const params = new URLSearchParams({ location, kind });
	const res = await fetch(`/api/serve/nearby?${params}`, { credentials: "same-origin", signal });
	if (!res.ok) return readError(res);
	return (await res.json()) as NearbyResponse;
}

export async function fetchJournal(signal?: AbortSignal): Promise<ServeEntryView[]> {
	const res = await fetch("/api/serve/journal", { credentials: "same-origin", cache: "no-store", signal });
	if (!res.ok) return readError(res);
	return ((await res.json()) as { entries: ServeEntryView[] }).entries;
}

export async function addJournalEntry(text: string, verseRef: string | null): Promise<ServeEntryView> {
	const res = await fetch("/api/serve/journal", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(verseRef ? { text, verseRef } : { text }),
	});
	if (!res.ok) return readError(res);
	return ((await res.json()) as { entry: ServeEntryView }).entry;
}

export async function deleteJournalEntry(id: string): Promise<void> {
	const res = await fetch(`/api/serve/journal/${encodeURIComponent(id)}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	// Already gone is the outcome the reader asked for.
	if (!res.ok && res.status !== 404) return readError(res);
}
