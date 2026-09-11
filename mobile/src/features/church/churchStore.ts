import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ApiError, type GetToken } from "@/lib/api";
import {
	CHURCH_SEARCH_DEBOUNCE_MS,
	isLatestRequest,
	shouldSearch,
	type ChurchProfile,
	type ChurchSearchResult,
} from "./church";
import { removeChurch, saveChurch, searchChurches } from "./api";
import { noteChurch, refreshChurch, useSettingsData } from "@/features/settings/settingsData";

/**
 * Screen state for Settings -> MY CHURCH.
 *
 * Pure helpers and the response shapes live in `church.ts`, the requests in
 * `api.ts`, and the saved profile itself in the shared settings-data store
 * (prefetched at sign-in and persisted, so the card paints at its real height
 * on the first frame). This module owns only what the picker needs while it
 * is open, so `ChurchSection` stays presentational.
 */

/** How the section as a whole should render. */
export type ChurchLoadState = "loading" | "unavailable" | "failed" | "ready";

export interface ChurchSectionState {
	load: ChurchLoadState;
	/** A profile refresh is in flight; the failed card shows it beside Retry. */
	reloading: boolean;
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
	const slice = useSettingsData().church;
	// "Change church" tapped while a church is saved. With no church saved the
	// picker shows on its own, so this never has to be seeded from the data.
	const [changing, setChanging] = useState(false);
	const [query, setQueryState] = useState("");
	const [results, setResults] = useState<ChurchSearchResult[]>([]);
	const [searchPending, setSearchPending] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [savingPlaceId, setSavingPlaceId] = useState<string | null>(null);
	const [removing, setRemoving] = useState(false);

	const response = slice.data;
	const load: ChurchLoadState =
		response === null
			? slice.failed
				? "failed"
				: "loading"
			: response.status === "unavailable"
				? "unavailable"
				: "ready";
	const church = response?.status === "ok" ? response.church : null;
	const picking = load === "ready" && (church === null || changing);

	// Monotonic id of the newest search; older responses are dropped.
	const searchRequestId = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// Revalidates in place: a card already on screen keeps its content while
	// the fresh profile lands, and a failure only surfaces when there is
	// nothing to show instead. Joins the prefetch if one is still in flight.
	const reload = useCallback(() => {
		refreshChurch(getToken).catch(() => {
			// Reported through the store's `failed` flag.
		});
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
						noteChurch({ status: "unavailable" });
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
					noteChurch({ status: "ok", church: data.church });
					if (!mounted.current) return;
					setChanging(false);
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
		setChanging(true);
		setQueryState("");
		setResults([]);
		setSearchError(null);
	}, []);

	/** Only offered while a church is saved, so cancelling returns to its card. */
	const cancelChange = useCallback(() => {
		setChanging(false);
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
				noteChurch({ status: "ok", church: null });
				if (!mounted.current) return;
				setChanging(false);
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
		reloading: slice.loading,
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
