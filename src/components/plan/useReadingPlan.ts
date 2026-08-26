"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReadingPlan, ReadingPlanPreset, ReadingPlansView } from "./types";

/**
 * The plan the user is following, and everything the plan page does to it.
 *
 * Every mutation answers with the whole plan and fresh progress, so the hook
 * never has to guess what a tick did to the streak - it just swaps the plan in.
 * Mirrors `mobile/src/features/plan/useReadingPlan.ts`.
 */

const GENERIC_FAILURE = "Your reading plan could not be loaded. Try again.";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		const data = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(data?.error ?? GENERIC_FAILURE);
	}
	return (await res.json()) as T;
}

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
	const [view, setView] = useState<ReadingPlansView | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		setError(null);
		setLoading(true);
		requestJson<ReadingPlansView>("/api/reading-plans")
			.then(setView)
			.catch((err: unknown) => setError(messageFor(err)))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	/** Run one mutation, keeping the presets we already have beside the new plan. */
	const mutate = useCallback(async (run: () => Promise<ReadingPlan>) => {
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
	}, []);

	const startPreset = useCallback(
		(presetKey: string) =>
			mutate(() =>
				requestJson<ReadingPlan>("/api/reading-plans", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ presetKey }),
				})
			),
		[mutate]
	);

	const startGoal = useCallback(
		(goal: string, days: number) =>
			mutate(() =>
				requestJson<ReadingPlan>("/api/reading-plans", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ goal, days }),
				})
			),
		[mutate]
	);

	const plan = view?.active ?? null;

	const setDayDone = useCallback(
		async (day: number, done: boolean) => {
			if (!plan) return;
			await mutate(() =>
				requestJson<ReadingPlan>(`/api/reading-plans/${plan.id}/days/${day}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ done }),
				})
			);
		},
		[mutate, plan]
	);

	const archive = useCallback(async () => {
		if (!plan) return;
		setBusy(true);
		setError(null);
		try {
			setView(
				await requestJson<ReadingPlansView>(`/api/reading-plans/${plan.id}`, { method: "DELETE" })
			);
		} catch (err: unknown) {
			setError(messageFor(err));
		} finally {
			setBusy(false);
		}
	}, [plan]);

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
