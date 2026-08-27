import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ApiError, apiJson, type GetToken } from "@/lib/api";
import {
	CHURCH_SEARCH_DEBOUNCE_MS,
	isLatestRequest,
	shouldSearch,
	type ChurchProfile,
	type ChurchResponse,
	type ChurchSearchResponse,
	type ChurchSearchResult,
} from "./church";

/**
 * Network calls and screen state for Settings -> MY CHURCH.
 *
 * Pure helpers and the response shapes live in `church.ts`; this module owns
 * everything that talks to the API or holds React state, so `ChurchSection`
 * stays presentational.
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

/** How the section as a whole should render. */
export type ChurchLoadState = "loading" | "unavailable" | "failed" | "ready";

export interface ChurchSectionState {
	load: ChurchLoadState;
	church: ChurchProfile | null;
	/** True while the picker is open: no church saved, or "Change church" tapped. */
	picking: boolean;
	query: string;
	results: ChurchSearchResult[];
	/** A search is in flight (or debouncing) for the current query. */
	searchPending: boolean;
	searchError: string | null;
	/** The result currently being saved, so only its row shows the spinner. */
	savingPlaceId: string | null;
	removing: boolean;
}

export interface ChurchSectionActions {
	reload: () => void;
	setQuery: (query: string) => void;
	clearQuery: () => void;
	pick: (placeId: string) => void;
	startChange: () => void;
	cancelChange: () => void;
	remove: () => void;
}

/** Same shape as `serverMessage` in app/(app)/memories.tsx. */
function serverMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function useChurchSection(getToken: GetToken): ChurchSectionState & ChurchSectionActions {
	const [load, setLoad] = useState<ChurchLoadState>("loading");
	const [church, setChurch] = useState<ChurchProfile | null>(null);
	const [picking, setPicking] = useState(false);
	const [query, setQueryState] = useState("");
	const [results, setResults] = useState<ChurchSearchResult[]>([]);
	const [searchPending, setSearchPending] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [savingPlaceId, setSavingPlaceId] = useState<string | null>(null);
	const [removing, setRemoving] = useState(false);

	// Monotonic id of the newest search; older responses are dropped.
	const searchRequestId = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const reload = useCallback(() => {
		setLoad("loading");
		void (async () => {
			try {
				const data = await fetchChurch(getToken);
				if (!mounted.current) return;
				if (data.status === "unavailable") {
					setLoad("unavailable");
					return;
				}
				setChurch(data.church);
				setPicking(data.church === null);
				setLoad("ready");
			} catch {
				if (!mounted.current) return;
				setLoad("failed");
			}
		})();
	}, [getToken]);

	useEffect(() => {
		reload();
	}, [reload]);

	// Search-as-you-type: debounced, and only the newest response may land.
	useEffect(() => {
		if (!picking) return;
		const trimmed = query.trim();
		if (!shouldSearch(trimmed)) {
			searchRequestId.current += 1;
			setResults([]);
			setSearchPending(false);
			setSearchError(null);
			return;
		}

		setSearchPending(true);
		setSearchError(null);
		const requestId = (searchRequestId.current += 1);
		const timer = setTimeout(() => {
			void (async () => {
				try {
					const data = await searchChurches(getToken, trimmed);
					if (!mounted.current || !isLatestRequest(requestId, searchRequestId.current)) return;
					if (data.status === "unavailable") {
						setLoad("unavailable");
						return;
					}
					setResults(data.results);
				} catch (error) {
					if (!mounted.current || !isLatestRequest(requestId, searchRequestId.current)) return;
					setResults([]);
					// Inline, not an Alert: search runs per keystroke, and a
					// flaky connection would otherwise stack modal dialogs.
					setSearchError(serverMessage(error, "Couldn't search for churches. Try again."));
				} finally {
					if (mounted.current && isLatestRequest(requestId, searchRequestId.current)) {
						setSearchPending(false);
					}
				}
			})();
		}, CHURCH_SEARCH_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [getToken, picking, query]);

	const setQuery = useCallback((next: string) => {
		setQueryState(next);
	}, []);

	const clearQuery = useCallback(() => {
		setQueryState("");
		setSearchError(null);
	}, []);

	const pick = useCallback(
		(placeId: string) => {
			if (savingPlaceId !== null) return;
			setSavingPlaceId(placeId);
			void (async () => {
				try {
					const data = await saveChurch(getToken, placeId);
					if (!mounted.current) return;
					setChurch(data.church);
					setPicking(false);
					setQueryState("");
					setResults([]);
					setSearchError(null);
				} catch (error) {
					if (!mounted.current) return;
					Alert.alert(
						"Could not save that church",
						error instanceof ApiError && error.status === 404
							? "Couldn't load that church, try another result."
							: serverMessage(error, "Try again in a moment.")
					);
				} finally {
					if (mounted.current) setSavingPlaceId(null);
				}
			})();
		},
		[getToken, savingPlaceId]
	);

	const startChange = useCallback(() => {
		setPicking(true);
		setQueryState("");
		setResults([]);
		setSearchError(null);
	}, []);

	/** Only offered while a church is saved, so cancelling returns to its card. */
	const cancelChange = useCallback(() => {
		setPicking(false);
		setQueryState("");
		setResults([]);
		setSearchError(null);
	}, []);

	const remove = useCallback(() => {
		if (removing) return;
		setRemoving(true);
		void (async () => {
			try {
				await removeChurch(getToken);
				if (!mounted.current) return;
				setChurch(null);
				setPicking(true);
				setQueryState("");
				setResults([]);
			} catch (error) {
				if (!mounted.current) return;
				Alert.alert(
					"Could not remove your church",
					serverMessage(error, "Try again in a moment.")
				);
			} finally {
				if (mounted.current) setRemoving(false);
			}
		})();
	}, [getToken, removing]);

	return {
		load,
		church,
		picking,
		query,
		results,
		searchPending,
		searchError,
		savingPlaceId,
		removing,
		reload,
		setQuery,
		clearQuery,
		pick,
		startChange,
		cancelChange,
		remove,
	};
}
