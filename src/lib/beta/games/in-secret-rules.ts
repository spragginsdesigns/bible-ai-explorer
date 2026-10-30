/**
 * In Secret (LC-17908, docs/beta/games.md), Matthew 6:1-6: "Take heed that ye
 * do not your alms before men, to be seen of them ... when thou prayest,
 * enter into thy closet, and when thou hast shut thy door, pray to thy Father
 * which is in secret". Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * A street seen from the side. A disciple crosses it, left to right: past a
 * poor man by the way (the alms are given as he reaches him) and on into his
 * closet, where he shuts the door. He walks only while the walk is held.
 * Hypocrites stand along the street sounding trumpets "to be seen of men";
 * from time to time one turns toward the street, with a warning first (he
 * lifts his trumpet and turns his head), then he looks. Moving while any of
 * them looks is being seen: a strike, a stumble and a step back. Standing
 * still is never seen. The third strike loses ("They have their reward").
 * Some warnings are feints that turn away again, some looks are quick, and
 * later two of them look at once. Won: the door shut within the round.
 */

export const SECRET_STEP = 1 / 60;
export const SECRET_SECONDS = 15;
/** The street, in the 400-unit picture: where he starts, the poor man, the closet door. */
export const SECRET_START_X = 40;
export const SECRET_POOR_X = 196;
export const SECRET_DOOR_X = 350;
/** His walking pace, units a second. */
export const SECRET_SPEED = 56;
export const SECRET_HYPOCRITES = 3;
export const SECRET_STRIKES = 3;
/** A strike steps him back this far and holds him still this long. */
export const SECRET_PUSH = 30;
export const SECRET_STUMBLE = 0.55;
/** How long a hypocrite's warning lasts before he looks (or, on a feint, turns away). */
export const SECRET_WARN = [0.62, 0.5] as const;
/** The finished time a perfect round's score starts losing points from. */
export const SECRET_PAR = 10;

/**
 * The fastest the round can be won: walking the whole street without one
 * pause. A strike only steps him back, so no round is faster. Floored to the
 * tenth, as a reported time is rounded to tenths.
 */
export const SECRET_MIN_SECONDS = Math.floor(((SECRET_DOOR_X - SECRET_START_X) / SECRET_SPEED) * 10) / 10;

export interface SecretLook {
	/** Which hypocrite, 0 to SECRET_HYPOCRITES - 1. */
	who: number;
	/** He lifts his trumpet and turns (warn), looks from `from` to `to`; a feint turns away at `from`. */
	warn: number;
	from: number;
	to: number;
	feint: boolean;
	/** Was the disciple seen during this look. */
	seen: boolean;
}

export type SecretAlert = "clear" | "warn" | "look";

export interface SecretState {
	t: number;
	x: number;
	walking: boolean;
	strikes: number;
	stumbleUntil: number;
	alms: boolean;
	looks: SecretLook[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type SecretEvent =
	| { type: "warn"; who: number }
	| { type: "look"; who: number }
	| { type: "feint"; who: number }
	| { type: "seen"; who: number; strikes: number }
	| { type: "alms" }
	| { type: "shut" }
	| { type: "reward" }
	| { type: "time" };

function random(seed: number) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The round's looks, from the seed: a first full look to learn on, then feints, quick looks and, later, two at once. */
function scheduleLooks(seed: number): SecretLook[] {
	const next = random(seed);
	const looks: SecretLook[] = [];
	let prev = -1;
	const pick = (not: number[]) => {
		const open = [0, 1, 2].filter((who) => !not.includes(who));
		return open[Math.floor(next() * open.length) % open.length];
	};
	let at = 1.1 + next() * 0.5;
	for (let index = 0; at < SECRET_SECONDS; index++) {
		const who = pick([prev]);
		const late = at > 6;
		const warn = late ? SECRET_WARN[1] : SECRET_WARN[0];
		const feint = index > 1 && next() < 0.3;
		const quick = index > 0 && next() < 0.32;
		const look = quick ? 0.45 + next() * 0.2 : 0.9 + next() * 0.5;
		const from = at + warn;
		looks.push({ who, warn: at, from, to: feint ? from : from + look, feint, seen: false });
		let end = feint ? from + 0.2 : from + look;
		// Later, a second hypocrite turns while the first still looks.
		if (late && !feint && next() < 0.5) {
			const other = pick([who]);
			const warn2 = from + 0.1 + next() * Math.max(0.1, Math.min(0.5, look - 0.4));
			const look2 = 0.5 + next() * 0.4;
			looks.push({ who: other, warn: warn2, from: warn2 + warn, to: warn2 + warn + look2, feint: false, seen: false });
			end = Math.max(end, warn2 + warn + look2);
			prev = other;
		} else prev = who;
		at = end + 0.85 + next() * 0.7;
	}
	return looks;
}

export function newSecret(seed: number): SecretState {
	return { t: 0, x: SECRET_START_X, walking: false, strikes: 0, stumbleUntil: 0, alms: false, looks: scheduleLooks(seed), phase: "playing", endedAt: null };
}

/** What one hypocrite is doing at `t`: turned away, warning (turning), or looking. */
export function hypocriteAt(state: SecretState, who: number, t = state.t): { mode: "away" | "warn" | "look"; look: SecretLook | null } {
	let warning: SecretLook | null = null;
	for (const look of state.looks) {
		if (look.who !== who) continue;
		if (!look.feint && t >= look.from && t < look.to) return { mode: "look", look };
		if (t >= look.warn && t < look.from) warning = look;
	}
	return warning ? { mode: "warn", look: warning } : { mode: "away", look: null };
}

/** The street at a glance: someone looks, someone is about to, or no one. */
export function secretAlert(state: SecretState, t = state.t): SecretAlert {
	let alert: SecretAlert = "clear";
	for (let who = 0; who < SECRET_HYPOCRITES; who++) {
		const mode = hypocriteAt(state, who, t).mode;
		if (mode === "look") return "look";
		if (mode === "warn") alert = "warn";
	}
	return alert;
}

/** True while a strike holds him still. */
export function stumbling(state: SecretState): boolean {
	return state.t < state.stumbleUntil;
}

export function stepSecret(state: SecretState, input: { walk: boolean }, events: SecretEvent[] = []): SecretState {
	if (state.phase !== "playing") return state;
	const dt = SECRET_STEP;
	const before = state.t;
	state.t += dt;
	const now = state.t;
	for (const look of state.looks) {
		if (before < look.warn && now >= look.warn) events.push({ type: "warn", who: look.who });
		if (before < look.from && now >= look.from) events.push({ type: look.feint ? "feint" : "look", who: look.who });
	}
	const moving = input.walk && !stumbling(state);
	state.walking = false;
	if (moving) {
		const watcher = state.looks.find((look) => !look.feint && now >= look.from && now < look.to);
		if (watcher) {
			watcher.seen = true;
			state.strikes += 1;
			state.x = Math.max(SECRET_START_X, state.x - SECRET_PUSH);
			state.stumbleUntil = now + SECRET_STUMBLE;
			events.push({ type: "seen", who: watcher.who, strikes: state.strikes });
			if (state.strikes >= SECRET_STRIKES) {
				state.phase = "lost";
				state.endedAt = now;
				events.push({ type: "reward" });
				return state;
			}
		} else {
			state.walking = true;
			state.x = Math.min(SECRET_DOOR_X, state.x + SECRET_SPEED * dt);
		}
	}
	if (!state.alms && state.x >= SECRET_POOR_X) {
		state.alms = true;
		events.push({ type: "alms" });
	}
	if (state.x >= SECRET_DOOR_X - 1e-9) {
		state.phase = "won";
		state.endedAt = now;
		events.push({ type: "shut" });
	} else if (now >= SECRET_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = now;
		events.push({ type: "time" });
	}
	return state;
}

/** Looks he stood still through, unseen, so far. */
export function unseenLooks(state: SecretState): number {
	const t = state.endedAt ?? state.t;
	return state.looks.filter((look) => !look.feint && !look.seen && look.to <= t).length;
}

/** The round's result once it has ended: no strikes and a quick crossing score highest. */
export function secretResult(state: SecretState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const score = won ? Math.round(Math.max(5, Math.min(100, 100 - state.strikes * 32 - Math.max(0, state.endedAt - SECRET_PAR) * 6))) : 0;
	return { won, score, count: Math.min(500, unseenLooks(state)), seconds };
}
