"use client";

import { useEffect, useState } from "react";
import { Delete, Lock } from "lucide-react";
import {
	PARENT_CHECK_DIGITS,
	checkParentAnswer,
	makeParentChallenge,
	parentChallengeText,
	parentLockSeconds,
	type ParentChallenge,
} from "@/lib/beta/kids/kids-rules";
import { readGateState, writeGateState } from "./kids-lock";

const KEY = "flex h-16 items-center justify-center rounded-[18px] border border-black/[.12] bg-white/70 text-2xl font-semibold text-[#24281f] transition-colors active:bg-[#e5b664]/40 disabled:opacity-40 dark:border-white/[.14] dark:bg-white/[.06] dark:text-[#f1eadc]";

/**
 * The only way out of Kids mode (docs/beta/kids.md): a sum written in words
 * whose answer is three digits, typed on this pad. A wrong answer brings a new
 * sum; every third wrong answer locks the pad for longer (30 s up to 5 min),
 * and the count survives a reload. Nothing typed here is stored or sent.
 */
export default function ParentGate({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
	const [challenge, setChallenge] = useState<ParentChallenge>(() => makeParentChallenge(Math.random));
	const [typed, setTyped] = useState("");
	const [missed, setMissed] = useState(false);
	const [lockedUntil, setLockedUntil] = useState(() => readGateState().lockedUntil);
	const [now, setNow] = useState(() => Date.now());
	const locked = lockedUntil > now;

	useEffect(() => {
		if (!locked) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [locked]);

	const press = (digit: string) => {
		setMissed(false);
		setTyped((value) => (value.length >= PARENT_CHECK_DIGITS ? value : value + digit));
	};

	const submit = () => {
		if (checkParentAnswer(challenge, typed)) {
			writeGateState({ misses: 0, lockedUntil: 0 });
			onPass();
			return;
		}
		const misses = readGateState().misses + 1;
		const wait = parentLockSeconds(misses);
		const until = wait ? Date.now() + wait * 1000 : 0;
		writeGateState({ misses, lockedUntil: until });
		setLockedUntil(until);
		setNow(Date.now());
		setMissed(true);
		setTyped("");
		setChallenge(makeParentChallenge(Math.random));
	};

	const secondsLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

	return (
		<section aria-labelledby="kids-gate-title" className="mx-auto flex w-full max-w-sm flex-col items-center px-5 pb-10 pt-8 text-center">
			<span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e5b664]/25 text-amber-900 dark:text-[#e5b664]" aria-hidden>
				<Lock size={26} strokeWidth={1.8} />
			</span>
			<h2 id="kids-gate-title" className="mt-4 font-[family-name:var(--font-cormorant)] text-[34px] font-semibold leading-none">For grown-ups</h2>
			<p className="mt-2 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">Answer this to leave SureWord Kids.</p>
			{/* Non-breaking hyphens, so "sixty-four" never splits across lines. */}
			<p className="mt-5 text-balance text-xl font-semibold leading-8" aria-live="polite">{parentChallengeText(challenge).replace(/-/g, "\u2011")}</p>

			<div className="mt-5 flex gap-2" aria-label={`Your answer: ${typed || "nothing yet"}`} role="status">
				{Array.from({ length: PARENT_CHECK_DIGITS }, (_, index) => (
					<span key={index} className="flex h-14 w-12 items-center justify-center rounded-[14px] border-2 border-black/[.14] text-2xl font-semibold dark:border-white/[.18]">
						{typed[index] ?? ""}
					</span>
				))}
			</div>

			<p role="alert" className="mt-3 min-h-6 text-sm font-semibold text-amber-900 dark:text-[#e5b664]">
				{locked ? `Too many tries. Try again in ${secondsLeft} seconds.` : missed ? "Not quite. Here is a new one." : ""}
			</p>

			<div className="mt-2 grid w-full grid-cols-3 gap-2.5" role="group" aria-label="Number pad">
				{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
					<button key={digit} type="button" disabled={locked} onClick={() => press(digit)} className={KEY}>{digit}</button>
				))}
				<button type="button" disabled={locked || !typed} onClick={() => setTyped((value) => value.slice(0, -1))} aria-label="Delete" className={KEY}>
					<Delete size={24} aria-hidden />
				</button>
				<button type="button" disabled={locked} onClick={() => press("0")} className={KEY}>0</button>
				<button
					type="button"
					disabled={locked || typed.length === 0}
					onClick={submit}
					className="flex h-16 items-center justify-center rounded-[18px] bg-[#e5b664] text-lg font-bold text-[#1c2118] disabled:opacity-40"
				>
					Enter
				</button>
			</div>

			<button type="button" onClick={onCancel} className="mt-6 min-h-12 rounded-full border border-black/[.12] px-6 text-base font-bold dark:border-white/[.14]">
				Back to Kids
			</button>
		</section>
	);
}
