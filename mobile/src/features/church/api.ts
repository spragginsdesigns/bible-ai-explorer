import { apiJson, type GetToken } from "@/lib/api";
import type { ChurchProfile, ChurchResponse, ChurchSearchResponse } from "./church";

/**
 * The four `/api/church*` requests, kept apart from the screen hook so the
 * settings-data store can prefetch the profile at sign-in without importing
 * React state (`churchStore.ts` imports the store; the store imports this).
 */

/**
 * Saving is slow on purpose: the server resolves the place, fetches the
 * church's own website and has the model extract the mission statement, which
 * has been measured at up to ~20s. The default 30s API timeout leaves almost
 * no headroom on a slow connection.
 */
const SAVE_TIMEOUT_MS = 60_000;

export function fetchChurch(getToken: GetToken) {
	return apiJson<ChurchResponse>(getToken, "/api/church");
}

export function searchChurches(getToken: GetToken, query: string) {
	return apiJson<ChurchSearchResponse>(
		getToken,
		`/api/church/search?q=${encodeURIComponent(query)}`
	);
}

export function saveChurch(getToken: GetToken, placeId: string) {
	return apiJson<{ status: "ok"; church: ChurchProfile }>(
		getToken,
		"/api/church",
		{ method: "PUT", body: { placeId } },
		{ timeoutMs: SAVE_TIMEOUT_MS }
	);
}

export function removeChurch(getToken: GetToken) {
	return apiJson<{ status: "ok"; church: null }>(getToken, "/api/church", { method: "DELETE" });
}
