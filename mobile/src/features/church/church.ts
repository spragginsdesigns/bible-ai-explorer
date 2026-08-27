/**
 * "My church" shared types and pure helpers (Settings -> MY CHURCH).
 *
 * Kept free of React and of every Expo import on purpose: the vitest suite
 * runs in a plain node environment, so anything reaching `@/lib/api` (and
 * through it `expo-constants` / `expo/fetch`) cannot be unit tested. Network
 * calls and state live in `churchStore.ts`, the UI in `ChurchSection.tsx`.
 *
 * The shapes here mirror `src/lib/church-client.ts` on the web exactly - both
 * clients call the same `/api/church` routes and must behave identically.
 */

export interface ChurchProfile {
	placeId: string;
	name: string;
	address: string;
	phone: string | null;
	website: string | null;
	mapsUrl: string | null;
	/** Absolute URL (the church's own logo, or our photo proxy). */
	photoUrl: string | null;
	mission: string | null;
	about: string | null;
	/** Page the mission statement was read from, for the "From ..." credit. */
	missionSource: string | null;
	updatedAt: string;
}

export interface ChurchSearchResult {
	placeId: string;
	name: string;
	address: string;
	hasPhoto: boolean;
}

/**
 * Every route answers `unavailable` when the server has no Places key
 * configured. Both clients then render nothing at all for the whole section,
 * the same way the Listen card disappears without an ElevenLabs key.
 */
export type ChurchResponse =
	| { status: "unavailable" }
	| { status: "ok"; church: ChurchProfile | null };

export type ChurchSearchResponse =
	| { status: "unavailable" }
	| { status: "ok"; results: ChurchSearchResult[] };

/** The server 400s below this, so the client never sends a shorter query. */
export const MIN_CHURCH_QUERY_LENGTH = 3;

/** Keystroke debounce for the search box, in milliseconds. */
export const CHURCH_SEARCH_DEBOUNCE_MS = 350;

/** Collapsed height of the mission statement, in lines. */
export const MISSION_CLAMP_LINES = 6;

/** True when the typed text is worth sending to `/api/church/search`. */
export function shouldSearch(query: string): boolean {
	return query.trim().length >= MIN_CHURCH_QUERY_LENGTH;
}

/**
 * "https://www.gracechapel.org/about" -> "gracechapel.org".
 *
 * Deliberately regex-based rather than `new URL()`: React Native's URL
 * polyfill does not implement the `hostname` getter on every engine, and this
 * only ever labels a link.
 */
export function hostnameOf(url: string | null | undefined): string | null {
	if (!url) return null;
	const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(url.trim());
	if (!match) return null;
	// Strip any userinfo, then the port, then a leading "www.".
	const host = (match[1].split("@").pop() ?? "").replace(/:\d+$/, "").replace(/^www\./i, "");
	return host.length > 0 ? host : null;
}

/**
 * Whether the collapsed mission statement is hiding anything.
 *
 * `onTextLayout` reports the lines actually laid out, which `numberOfLines`
 * has already truncated - so reaching the clamp is the signal that a "Show
 * more" toggle is warranted.
 */
export function needsMissionToggle(lineCount: number): boolean {
	return lineCount >= MISSION_CLAMP_LINES;
}

/**
 * Stale-response guard for search-as-you-type. `apiJson` takes no abort
 * signal, so each request carries a monotonic id and only the newest one is
 * allowed to write to state.
 */
export function isLatestRequest(requestId: number, latestId: number): boolean {
	return requestId === latestId;
}
