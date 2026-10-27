import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Alert } from "react-native";
import { useAuth } from "@clerk/expo";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import type { GetToken } from "@/lib/api";
import { fetchServe, patchServe } from "./api";
import { withSettings, type ServeSettings, type ServeView } from "./serveRules";

/**
 * The reader's Ways to Serve view, shared by the Today card, the Settings hub
 * row and the screen itself so the three cost one request and agree on the
 * mode the moment it changes.
 *
 * Memory-only and stamped with the account it was loaded for: a different
 * signed-in account never sees the previous one's view, and nothing is left
 * on the device after sign-out.
 */

interface ServeSnapshot {
	owner: string | null;
	view: ServeView | null;
	loading: boolean;
	error: string | null;
}

let snapshot: ServeSnapshot = { owner: null, view: null, loading: false, error: null };
let inFlight: Promise<void> | null = null;
/** Bumped by every settings change so an older answer never overwrites a newer pick. */
let writeSeq = 0;
/** Settings writes still waiting on the server; a read that lands meanwhile may predate them. */
let pendingWrites = 0;
const listeners = new Set<() => void>();
/** When the view last came from the server; today's way changes with the day. */
let loadedAt = 0;
const STALE_MS = 30 * 60_000;

function setSnapshot(next: Partial<ServeSnapshot>): void {
	snapshot = { ...snapshot, ...next };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

function getSnapshot(): ServeSnapshot {
	return snapshot;
}

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function load(getToken: GetToken, owner: string, force: boolean): Promise<void> {
	if (snapshot.owner !== owner) {
		inFlight = null;
		setSnapshot({ owner, view: null, loading: false, error: null });
	}
	if (inFlight) return inFlight;
	if (!force && snapshot.view && Date.now() - loadedAt < STALE_MS) return Promise.resolve();
	const seq = writeSeq;
	setSnapshot({ loading: true, error: null });
	const request = fetchServe(getToken)
		.then((view) => {
			if (snapshot.owner !== owner || seq !== writeSeq || pendingWrites > 0) return;
			loadedAt = Date.now();
			setSnapshot({ view, error: null });
		})
		.catch((error: unknown) => {
			if (snapshot.owner !== owner) return;
			setSnapshot({ error: message(error, "Couldn't load Ways to Serve.") });
		})
		.finally(() => {
			if (inFlight === request) inFlight = null;
			if (snapshot.owner === owner) setSnapshot({ loading: false });
		});
	inFlight = request;
	return request;
}

async function saveSettings(getToken: GetToken, owner: string, patch: Partial<ServeSettings>): Promise<void> {
	const before = snapshot.view;
	if (!before || snapshot.owner !== owner) return;
	const seq = ++writeSeq;
	setSnapshot({ view: withSettings(before, patch) });
	pendingWrites += 1;
	try {
		const view = await patchServe(getToken, patch);
		if (snapshot.owner === owner && seq === writeSeq) {
			loadedAt = Date.now();
			setSnapshot({ view });
		}
	} catch (error) {
		if (snapshot.owner !== owner || seq !== writeSeq) return;
		// Roll back only the field this write changed; the rest of the view is
		// still what the server last said.
		const current = snapshot.view ?? before;
		const restore: Partial<ServeSettings> = {};
		if (patch.mode !== undefined) restore.mode = before.settings.mode;
		if (patch.givesToChurch !== undefined) restore.givesToChurch = before.settings.givesToChurch;
		setSnapshot({ view: withSettings(current, restore) });
		// An earlier write that failed while this one was in flight was skipped
		// above, so ask the server what actually saved rather than trust the
		// local snapshot.
		void load(getToken, owner, true);
		Alert.alert("Couldn't save that", message(error, "Check your connection and try again."));
	} finally {
		pendingWrites -= 1;
	}
}

export interface UseServe {
	view: ServeView | null;
	loading: boolean;
	error: string | null;
	/** Always asks the server again. */
	reload: () => void;
	/** Asks again only when the cached view is old enough that today's way may have moved on. */
	revalidate: () => void;
	saveSettings: (patch: Partial<ServeSettings>) => void;
}

export function useServe(): UseServe {
	const getToken = useStableGetToken();
	const { userId } = useAuth();
	const state = useSyncExternalStore(subscribe, getSnapshot);

	useEffect(() => {
		if (userId) void load(getToken, userId, false);
	}, [getToken, userId]);

	const revalidate = useCallback(() => {
		if (userId) void load(getToken, userId, false);
	}, [getToken, userId]);

	const reload = useCallback(() => {
		if (userId) void load(getToken, userId, true);
	}, [getToken, userId]);

	const save = useCallback(
		(patch: Partial<ServeSettings>) => {
			if (userId) void saveSettings(getToken, userId, patch);
		},
		[getToken, userId]
	);

	const mine = state.owner === userId;
	return {
		view: mine ? state.view : null,
		loading: mine ? state.loading : Boolean(userId),
		error: mine ? state.error : null,
		reload,
		revalidate,
		saveSettings: save,
	};
}
