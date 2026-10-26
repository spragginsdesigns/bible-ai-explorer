import type { AppTarget, TourStop } from "@/lib/onboarding-rules";

/**
 * The spotlight ("glow") registry and state for "Walk with me"
 * (docs/onboarding/PLAN.md, "The spotlight").
 *
 * Targets are named, not positioned: an element joins the registry by
 * carrying `data-spotlight="<APP_TARGETS key>"`, which `spotlightTarget()`
 * types so a misspelled key fails the build. That works from server
 * components too, and the same key can sit on two elements (the phone tab bar
 * and the desktop sidebar both carry `tab.today`); the overlay lights
 * whichever one is actually on screen.
 *
 * The state is module-level, like the preference cache, so any card or
 * button can start a spotlight without a provider in its tree; the overlay
 * mounted once in the root layout is the only reader.
 */

export const SPOTLIGHT_ATTRIBUTE = "data-spotlight";

/** Spread onto an element to register it: `<Link {...spotlightTarget("tab.today")}>`. */
export function spotlightTarget(target: AppTarget): { "data-spotlight": AppTarget } {
	return { [SPOTLIGHT_ATTRIBUTE]: target } as { "data-spotlight": AppTarget };
}

export type SpotlightState =
	| { kind: "idle" }
	| { kind: "single"; target: AppTarget; caption: string; seq: number }
	| { kind: "tour"; stops: readonly TourStop[]; index: number; seq: number; returnTo?: string };

let state: SpotlightState = { kind: "idle" };
let seq = 0;
const listeners = new Set<() => void>();

function set(next: SpotlightState): void {
	state = next;
	for (const listener of listeners) listener();
}

export function subscribeSpotlight(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getSpotlight(): SpotlightState {
	return state;
}

const IDLE: SpotlightState = { kind: "idle" };
export function getServerSpotlight(): SpotlightState {
	return IDLE;
}

/** Light one target with a caption: a "Show me" card, or a Getting started row. */
export function showSpotlight(target: AppTarget, caption: string): void {
	set({ kind: "single", target, caption, seq: ++seq });
}

/**
 * Walk the stops in order, ending on the last. Nothing happens for an empty
 * list. `returnTo` is where the overlay takes them once the tour is finished
 * or left (the welcome conversation), since the last stop is another screen.
 */
export function startTour(stops: readonly TourStop[], returnTo?: string): void {
	if (stops.length === 0) return;
	set({ kind: "tour", stops, index: 0, seq: ++seq, ...(returnTo ? { returnTo } : {}) });
}

/** Move a tour to its next stop, or end it after the last. */
export function advanceSpotlight(): void {
	if (state.kind !== "tour") {
		set(IDLE);
		return;
	}
	const index = state.index + 1;
	set(index < state.stops.length ? { ...state, index, seq: ++seq } : IDLE);
}

export function closeSpotlight(): void {
	if (state.kind !== "idle") set(IDLE);
}
