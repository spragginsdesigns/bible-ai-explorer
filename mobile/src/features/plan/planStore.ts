import {
	archiveReadingPlan,
	fetchReadingPlans,
	setPlanDay,
	startGoalPlan,
	startPresetPlan,
} from "./api";
import type { GetToken } from "@/lib/api";
import type { ReadingPlansView } from "./types";

/**
 * One shared reading plan for the whole app, modeled on notesStore: a
 * module-level snapshot exposed through useSyncExternalStore.
 *
 * The Bible home card, the plan screen and the Daily Cross study path are all
 * mounted inside the same Expo Router stack, so a per-hook `useState` meant
 * three GETs on entry and, worse, a tick on the plan screen only ever landed in
 * that screen's own state: the other two kept showing yesterday's progress
 * until they remounted. Every consumer now reads one snapshot, so one mutation
 * repaints all of them.
 *
 * Deliberately free of React imports - `useReadingPlan` is the only binding to
 * the component tree, which keeps this testable as plain module state.
 */

const GENERIC_FAILURE = "Your reading plan could not be loaded. Check your connection and try again.";

function messageFor(error: unknown): string {
	return error instanceof Error && error.message ? error.message : GENERIC_FAILURE;
}

export interface PlanSnapshot {
	view: ReadingPlansView | null;
	/** True until the first response, success or failure, has landed. */
	loading: boolean;
	/** True while a start / tick / archive is in flight. */
	busy: boolean;
	error: string | null;
	/**
	 * Bumped by every clear. Exposed so a consumer that was already mounted
	 * when the caches changed hands re-runs its load effect: the request it
	 * had in flight was (rightly) dropped by the generation guard, and a
	 * mount-only effect would otherwise leave it showing "no plan" forever.
	 */
	generation: number;
}

const INITIAL: PlanSnapshot = { view: null, loading: true, busy: false, error: null, generation: 0 };

let snapshot: PlanSnapshot = INITIAL;

const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function setSnapshot(changes: Partial<PlanSnapshot>) {
	snapshot = { ...snapshot, ...changes };
	emit();
}

/**
 * Bumped by every clear, for the same reason as the notes and highlights
 * caches: a request issued before a sign-out is still in flight after it, and
 * would otherwise resolve straight into setSnapshot and hand the next account
 * the previous account's plan. Mirrored into the snapshot (see PlanSnapshot).
 */
let generation = 0;

/** The GET currently in flight, so simultaneous mounts share one request. */
let loadPromise: Promise<void> | null = null;

/** True once a plan view has landed for this generation. */
let loaded = false;

/**
 * Mutations in flight. A count rather than a flag because the store is now
 * shared: two quick day ticks must not have the first one's completion clear
 * `busy` while the second is still running.
 */
let pending = 0;

function beginMutation() {
	pending += 1;
	setSnapshot({ busy: true, error: null });
}

function endMutation() {
	pending = Math.max(0, pending - 1);
	setSnapshot({ busy: pending > 0 });
}

function runLoad(getToken: GetToken): Promise<void> {
	const startedAt = generation;
	setSnapshot({ loading: true, error: null });
	const request = fetchReadingPlans(getToken)
		.then((view) => {
			if (generation !== startedAt) return;
			loaded = true;
			setSnapshot({ view, loading: false });
		})
		.catch((error: unknown) => {
			// Left un-loaded on purpose: the next screen to mount retries, which
			// is what three independent hooks used to do for free.
			if (generation !== startedAt) return;
			setSnapshot({ loading: false, error: messageFor(error) });
		})
		.finally(() => {
			if (generation !== startedAt) return;
			if (loadPromise === request) loadPromise = null;
		});
	loadPromise = request;
	return request;
}

/**
 * Fetch the plan unless it is already here or already on its way. Every screen
 * calls this on mount; only the first one costs a request.
 */
export function ensureLoaded(getToken: GetToken): Promise<void> {
	if (loadPromise) return loadPromise;
	if (loaded) return Promise.resolve();
	return runLoad(getToken);
}

/** The Retry button and any explicit refresh. Joins a GET already in flight. */
export function reloadPlans(getToken: GetToken): Promise<void> {
	if (loadPromise) return loadPromise;
	return runLoad(getToken);
}

/**
 * Run one mutation. Every plan endpoint answers with the whole plan and fresh
 * progress, so nothing here has to guess what a tick did to the streak.
 */
async function mutate(run: () => Promise<ReadingPlansView>): Promise<void> {
	const startedAt = generation;
	beginMutation();
	try {
		const view = await run();
		if (generation !== startedAt) return;
		// A mutation is a response too: a screen that mounts afterwards must not
		// re-fetch what we just wrote.
		loaded = true;
		setSnapshot({ view, loading: false });
	} catch (error: unknown) {
		if (generation !== startedAt) return;
		setSnapshot({ error: messageFor(error) });
	} finally {
		if (generation === startedAt) endMutation();
	}
}

/**
 * Keep the presets we already have beside a mutation's new plan. Callers read
 * `snapshot.view` after their await so a reload that landed mid-flight is kept.
 */
function withPresets(view: ReadingPlansView | null, activeOnly: ReadingPlansView["active"]): ReadingPlansView {
	return { active: activeOnly, presets: view?.presets ?? [] };
}

export function startPlanPreset(getToken: GetToken, presetKey: string): Promise<void> {
	return mutate(async () => {
		const active = await startPresetPlan(getToken, presetKey);
		return withPresets(snapshot.view, active);
	});
}

export function startPlanGoal(getToken: GetToken, goal: string, days: number): Promise<void> {
	return mutate(async () => {
		const active = await startGoalPlan(getToken, goal, days);
		return withPresets(snapshot.view, active);
	});
}

export function setPlanDayDone(getToken: GetToken, day: number, done: boolean): Promise<void> {
	const plan = snapshot.view?.active;
	if (!plan) return Promise.resolve();
	return mutate(async () => {
		const active = await setPlanDay(getToken, plan.id, day, done);
		return withPresets(snapshot.view, active);
	});
}

/** DELETE answers with the whole view already, presets included. */
export function archiveActivePlan(getToken: GetToken): Promise<void> {
	const plan = snapshot.view?.active;
	if (!plan) return Promise.resolve();
	return mutate(() => archiveReadingPlan(getToken, plan.id));
}

export function getPlanSnapshot(): PlanSnapshot {
	return snapshot;
}

export function subscribePlanStore(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Drop the plan held in memory. Called when the signed-in account is not the
 * one the caches were written for, and on sign-out: a plan is personal, and
 * account B must never open the Bible tab on account A's progress.
 *
 * Reset to the pristine snapshot rather than to an empty view, so whichever
 * screen loads next starts from "loading" exactly as on a cold start and never
 * flashes the no-plan state at someone who has one. The cache handover runs
 * from the tabs layout, so a Bible screen can already be mounted at this
 * point; the bumped `generation` in the snapshot is what makes it reload.
 */
export function clearPlanStore(): void {
	generation += 1;
	loadPromise = null;
	loaded = false;
	pending = 0;
	snapshot = { ...INITIAL, generation };
	emit();
}
