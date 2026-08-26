import { useCallback, useEffect, useState } from "react";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	archiveReadingPlan,
	fetchReadingPlans,
	setPlanDay,
	startGoalPlan,
	startPresetPlan,
} from "./api";
import type { ReadingPlan, ReadingPlanPreset, ReadingPlansView } from "./types";

/**
 * The plan the user is following, and everything the plan screen does to it.
 *
 * Every mutation answers with the whole plan and fresh progress, so the hook
 * never has to guess what a tick did to the streak - it just swaps the plan in.
 * Mirrors `src/components/plan/useReadingPlan.ts` on web.
 */

const GENERIC_FAILURE = "Your reading plan could not be loaded. Check your connection and try again.";

function messageFor(error: unknown): string {
	return error instanceof Error && error.message ? error.message : GENERIC_FAILURE;
}

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
	const [view, setView] = useState<ReadingPlansView | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		setError(null);
		setLoading(true);
		fetchReadingPlans(getToken)
			.then(setView)
			.catch((err: unknown) => setError(messageFor(err)))
			.finally(() => setLoading(false));
	}, [getToken]);

	useEffect(() => {
		load();
	}, [load]);

	/** Run one mutation, keeping the presets we already have beside the new plan. */
	const mutate = useCallback(
		async (run: () => Promise<ReadingPlan>) => {
			setBusy(true);
			setError(null);
			try {
				const plan = await run();
				setView((previous) => ({ active: plan, presets: previous?.presets ?? [] }));
			} catch (err: unknown) {
				setError(messageFor(err));
			} finally {
				setBusy(false);
			}
		},
		[]
	);

	const startPreset = useCallback(
		(presetKey: string) => mutate(() => startPresetPlan(getToken, presetKey)),
		[getToken, mutate]
	);

	const startGoal = useCallback(
		(goal: string, days: number) => mutate(() => startGoalPlan(getToken, goal, days)),
		[getToken, mutate]
	);

	const plan = view?.active ?? null;

	const setDayDone = useCallback(
		async (day: number, done: boolean) => {
			if (!plan) return;
			await mutate(() => setPlanDay(getToken, plan.id, day, done));
		},
		[getToken, mutate, plan]
	);

	const archive = useCallback(async () => {
		if (!plan) return;
		setBusy(true);
		setError(null);
		try {
			setView(await archiveReadingPlan(getToken, plan.id));
		} catch (err: unknown) {
			setError(messageFor(err));
		} finally {
			setBusy(false);
		}
	}, [getToken, plan]);

	return {
		plan,
		presets: view?.presets ?? [],
		loading,
		busy,
		error,
		reload: load,
		startPreset,
		startGoal,
		setDayDone,
		archive,
	};
}
