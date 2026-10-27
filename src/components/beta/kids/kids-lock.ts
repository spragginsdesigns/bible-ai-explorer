/**
 * Kids mode's lock (docs/beta/kids.md), kept for this browser tab only.
 *
 * Opening Kids mode for a child writes the child's id here, and only passing
 * the parent check clears it. The parent's page reads it on load and sends
 * anyone who reached it some other way (a back gesture, a typed address)
 * straight back into Kids mode. The parent check's wrong-answer count lives
 * here too, so reloading the page does not reset its lock.
 */
const LOCK_KEY = "sureword.kids.lock";
const GATE_KEY = "sureword.kids.gate";

export const KIDS_PARENT_HREF = "/beta/together/kids";

export function kidsPlayHref(childId: string): string {
	return `${KIDS_PARENT_HREF}/play?child=${encodeURIComponent(childId)}`;
}

function store(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

export function readKidsLock(): string | null {
	return store()?.getItem(LOCK_KEY) ?? null;
}

export function setKidsLock(childId: string): void {
	store()?.setItem(LOCK_KEY, childId);
}

export function clearKidsLock(): void {
	store()?.removeItem(LOCK_KEY);
	store()?.removeItem(GATE_KEY);
}

export interface GateState {
	misses: number;
	lockedUntil: number;
}

export function readGateState(): GateState {
	try {
		const value = JSON.parse(store()?.getItem(GATE_KEY) ?? "null") as Partial<GateState> | null;
		return {
			misses: Number.isInteger(value?.misses) ? Math.max(0, value!.misses!) : 0,
			lockedUntil: Number.isFinite(value?.lockedUntil) ? value!.lockedUntil! : 0,
		};
	} catch {
		return { misses: 0, lockedUntil: 0 };
	}
}

export function writeGateState(state: GateState): void {
	store()?.setItem(GATE_KEY, JSON.stringify(state));
}
