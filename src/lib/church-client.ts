/**
 * Client helpers for the "My church" feature (Settings -> MY CHURCH). Mirrors
 * the Android client: same /api/church endpoints, same behavior. All calls are
 * same-origin and carry the Clerk session cookie.
 *
 * Every route can answer `{ status: "unavailable" }` when the server has no
 * Places API key configured. Callers must render nothing at all in that case,
 * the same way the Listen card disappears without an ElevenLabs key.
 */

export interface ChurchProfile {
	placeId: string;
	name: string;
	address: string;
	phone: string | null;
	website: string | null;
	mapsUrl: string | null;
	photoUrl: string | null;
	mission: string | null;
	about: string | null;
	missionSource: string | null;
	updatedAt: string;
}

export interface ChurchSearchResult {
	placeId: string;
	name: string;
	address: string;
	hasPhoto: boolean;
}

export type ChurchResponse =
	| { status: "unavailable" }
	| { status: "ok"; church: ChurchProfile | null };

export type ChurchSearchResponse =
	| { status: "unavailable" }
	| { status: "ok"; results: ChurchSearchResult[] };

/** The server rejects anything shorter, so the client never sends it. */
export const MIN_CHURCH_QUERY_LENGTH = 3;

/** Debounce for the search box, in milliseconds. */
export const CHURCH_SEARCH_DEBOUNCE_MS = 350;

async function parseError(res: Response): Promise<never> {
	const data = (await res.json().catch(() => null)) as { error?: string } | null;
	throw new Error(data?.error ?? `Request failed (${res.status})`);
}

export async function fetchChurch(): Promise<ChurchResponse> {
	const res = await fetch("/api/church", { credentials: "same-origin" });
	if (!res.ok) return parseError(res);
	return (await res.json()) as ChurchResponse;
}

/**
 * `signal` lets the caller drop a stale keystroke's request. An aborted fetch
 * rejects with an AbortError, which the caller is expected to ignore.
 */
export async function searchChurches(
	query: string,
	signal?: AbortSignal
): Promise<ChurchSearchResponse> {
	const res = await fetch(`/api/church/search?q=${encodeURIComponent(query)}`, {
		credentials: "same-origin",
		signal,
	});
	if (!res.ok) return parseError(res);
	return (await res.json()) as ChurchSearchResponse;
}

/**
 * Saves the pick. Slow on purpose: the server resolves the place, then reads
 * the church's own website to extract its mission statement, so this can take
 * the better part of half a minute. A 404 means the place could not be
 * resolved and the user should try another result.
 */
export async function saveChurch(placeId: string): Promise<ChurchProfile> {
	const res = await fetch("/api/church", {
		method: "PUT",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ placeId }),
	});
	if (res.status === 404) {
		throw new Error("Couldn't load that church, try another result.");
	}
	if (!res.ok) return parseError(res);
	const data = (await res.json()) as { status: "ok"; church: ChurchProfile };
	return data.church;
}

export async function removeChurch(): Promise<void> {
	const res = await fetch("/api/church", {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (!res.ok) return parseError(res);
}

/** "www.gracechapel.org" -> "gracechapel.org", for the mission source link. */
export function hostnameOf(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}
