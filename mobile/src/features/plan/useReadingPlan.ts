import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	archiveActivePlan,
	ensureLoaded,
	getPlanSnapshot,
	reloadPlans,
	setPlanDayDone,
	startPlanGoal,
	startPlanPreset,
	subscribePlanStore,
} from "./planStore";
import type { ReadingPlan, ReadingPlanPreset } from "./types";

/**
 * The plan the user is following, and everything the plan screen does to it.
 *
 * A thin binding over `planStore`: the state and every mutation live in that
 * module, so the Bible home card, the plan screen and the Daily Cross study
 * path share one plan and one fetch instead of three of each.
 * Mirrors `src/components/plan/useReadingPlan.ts` on web.
 */

export interface UseReadingPlan {
	plan: ReadingPlan | null;
	presets: ReadingPlanPreset[];
	/** True until the first response, success or failure, has landed. */
	loading: boolean;
	/** True while a start / tick / archive is in flight. */
	busy: boolean;
	error: string | null;
	reload: () => void;
	startPreset: (presetKey: string) => Promise<void>;
	startGoal: (goal: string, days: number) => Promise<void>;
	setDayDone: (day: number, done: boolean) => Promise<void>;
	archive: () => Promise<void>;
}

export function useReadingPlan(): UseReadingPlan {
	const getToken = useStableGetToken();
	const snapshot = useSyncExternalStore(subscribePlanStore, getPlanSnapshot);

	// `getToken` is identity-stable, so this runs on mount - the store dedupes
	// it, so three screens mounting together cost one request - and again
	// whenever the store is cleared under a mounted screen (account handover),
	// because the load that was in flight at that moment was dropped.
	useEffect(() => {
		void ensureLoaded(getToken);
	}, [getToken, snapshot.generation]);

	const reload = useCallback(() => {
		void reloadPlans(getToken);
	}, [getToken]);

	const startPreset = useCallback(
		(presetKey: string) => startPlanPreset(getToken, presetKey),
		[getToken]
	);

	const startGoal = useCallback(
		(goal: string, days: number) => startPlanGoal(getToken, goal, days),
		[getToken]
	);

	const setDayDone = useCallback(
		(day: number, done: boolean) => setPlanDayDone(getToken, day, done),
		[getToken]
	);

	const archive = useCallback(() => archiveActivePlan(getToken), [getToken]);

	return {
		plan: snapshot.view?.active ?? null,
		presets: snapshot.view?.presets ?? [],
		loading: snapshot.loading,
		busy: snapshot.busy,
		error: snapshot.error,
		reload,
		startPreset,
		startGoal,
		setDayDone,
		archive,
	};
}
