"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { readTranslationPref } from "@/lib/preferences";
import {
	applyReviewAcknowledgement,
	parseCard,
	parseReviewAcknowledgement,
	parseToday,
	type LearnCard,
	type LearnResult,
	type LearnReviewOperation,
	type LearnToday,
} from "./learn";
import {
	chooseLearnMode,
	resolveLearnMode,
	type LearnMode,
	type LearnModeSelection,
} from "./practice";
import { VersePractice } from "./VersePractice";
import { SuggestedVerses } from "./SuggestedVerses";
import {
	addedConfirmation,
	learnSuggestionsView,
	loadSuggestions,
	suggestionKey,
	type LearnSuggestion,
} from "./suggestions";

type ReviewConflictCode = "revision_conflict" | "operation_id_reused" | "missing";

class LearnRequestError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: ReviewConflictCode,
		readonly currentCard: LearnCard | null = null,
	) {
		super(message);
		this.name = "LearnRequestError";
	}
}

interface PendingReview {
	card: LearnCard;
	payload: LearnReviewOperation;
}

function isConflictCode(value: unknown): value is Exclude<ReviewConflictCode, "missing"> {
	return value === "revision_conflict" || value === "operation_id_reused";
}

async function request(path: string, body?: object): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch(path, {
			method: body ? "POST" : "GET",
			cache: "no-store",
			signal: controller.signal,
			...(body ? {
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			} : {}),
		});
		let data: unknown = null;
		try { data = await response.json(); } catch { /* The status still identifies the failure. */ }
		if (response.ok) return data;
		const errorBody = data as { error?: unknown; code?: unknown; currentCard?: unknown } | null;
		if (response.status === 409 && errorBody && isConflictCode(errorBody.code)) {
			const currentCard = errorBody.currentCard === null || errorBody.currentCard === undefined
				? null
				: parseCard(errorBody.currentCard);
			throw new LearnRequestError(
				typeof errorBody.error === "string" ? errorBody.error : errorBody.code,
				409,
				errorBody.code,
				currentCard,
			);
		}
		if (response.status === 404) {
			throw new LearnRequestError("This verse is no longer available.", 404, "missing");
		}
		throw new LearnRequestError(
			typeof errorBody?.error === "string" ? errorBody.error : "Could not load Learn. Please try again.",
			response.status,
		);
	} finally {
		clearTimeout(timeout);
	}
}

function browserTimezone(): string {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
		return timezone;
	} catch {
		return "UTC";
	}
}

export default function LearnScreen() {
	const { user, isLoaded } = useUser();
	if (!isLoaded) return <p role="status" className="p-6">Loading your verses...</p>;
	if (!user) return <Link href="/sign-in" className="p-6">Sign in to learn your verses</Link>;
	return <LearnSession key={user.id} />;
}

function LearnSession() {
	const [today, setToday] = useState<LearnToday | null>(null);
	// A finished review starts a fresh round even when the card stays on screen.
	const [round, setRound] = useState(0);
	const [selection, setSelection] = useState<LearnModeSelection | null>(null);
	const [typedRound, setTypedRound] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<PendingReview | null>(null);
	const [conflict, setConflict] = useState<ReviewConflictCode | null>(null);
	const [suggestions, setSuggestions] = useState<LearnSuggestion[]>([]);
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
	const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
	const [confirmation, setConfirmation] = useState<string | null>(null);
	const [translation] = useState<"KJV" | "NKJV">(() => readTranslationPref());
	const operation = useRef(false);
	const mounted = useRef(true);
	const touch = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);

	const load = useCallback(async (recoverAttempt = false) => {
		if (operation.current) return;
		operation.current = true;
		setBusy(true);
		setError(null);
		try {
			const data = parseToday(await request("/api/learn/today"));
			if (mounted.current) {
				setToday(data);
				setRound((value) => value + 1);
				if (recoverAttempt) {
					setPending(null);
					setConflict(null);
				}
			}
		} catch (caught) {
			if (mounted.current) {
				setError(caught instanceof Error ? caught.message : "Could not load Learn.");
			}
		} finally {
			operation.current = false;
			if (mounted.current) setBusy(false);
		}
	}, []);

	useEffect(() => { void load(); }, [load]);

	// Suggestions are additive: loadSuggestions turns any failure into no rows,
	// which leaves today's cards exactly as they were.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const rows = await loadSuggestions(() => request("/api/learn/suggestions"));
			if (!cancelled) setSuggestions(rows);
		})();
		return () => { cancelled = true; };
	}, []);

	const sendReview = async (attempt: PendingReview) => {
		if (!today || operation.current) return;
		operation.current = true;
		setBusy(true);
		setError(null);
		try {
			const acknowledgement = parseReviewAcknowledgement(
				await request(
					`/api/learn/${encodeURIComponent(attempt.card.id)}/review`,
					attempt.payload,
				),
				attempt.payload.operationId,
			);
			const next = applyReviewAcknowledgement(
				today,
				attempt.card,
				attempt.payload,
				acknowledgement,
				new Date(),
				browserTimezone(),
			);
			if (mounted.current) {
				setToday(next);
				setPending(null);
				setConflict(null);
				setRound((value) => value + 1);
			}
		} catch (caught) {
			if (!mounted.current) return;
			if (caught instanceof LearnRequestError && caught.code) {
				setConflict(caught.code);
				setError(caught.code === "operation_id_reused"
					? "This review identifier was already used for different data. Load the latest schedule."
					: "A newer schedule exists for this verse. Choose Use latest schedule before continuing.");
			} else {
				setError("The response was lost or the review failed. Retry sends the exact same review safely.");
			}
		} finally {
			operation.current = false;
			if (mounted.current) setBusy(false);
		}
	};

	const card = today?.cards[0];
	// How well the verse is known picks the mode; the reader may change it for
	// the card in front of them, and nothing about that reaches the server.
	const practice = card ? resolveLearnMode(card, selection) : null;
	const mode: LearnMode = practice?.mode ?? "blanks";
	const practiceRound = card ? `${card.id}:${card.revision}:${round}:${mode}` : "";
	// Type it out passes "good" only when every word matched, so a swipe and the
	// button answer to the same gate.
	const typedReady = mode !== "typed" || (Boolean(practiceRound) && typedRound === practiceRound);

	const review = (result: LearnResult) => {
		const card = today?.cards[0];
		if (!card || operation.current || pending || !card.text.trim()) return;
		if (result === "good" && !typedReady) return;
		const payload: LearnReviewOperation = Object.freeze({
			result,
			operationId: crypto.randomUUID(),
			expectedRevision: card.revision,
			reviewedAt: new Date().toISOString(),
			timezone: browserTimezone(),
		});
		const attempt = { card, payload };
		setPending(attempt);
		void sendReview(attempt);
	};

	const suggestionsView = useMemo(() => learnSuggestionsView({
		suggestions,
		dismissed,
		added,
		hasCard: Boolean(card),
	}), [suggestions, dismissed, added, card]);

	const dismissSuggestion = (suggestion: LearnSuggestion) => {
		setDismissed((old) => new Set(old).add(suggestionKey(suggestion)));
	};

	const acceptSuggestion = (suggestion: LearnSuggestion) => {
		setAdded((old) => new Set(old).add(suggestionKey(suggestion)));
		setConfirmation(addedConfirmation(suggestion.reference));
		// With nothing due, the added verse is the session, so fetch it. With a
		// card already on screen the queue only grew, and reloading would wipe
		// the words the user has revealed.
		if (!card) void load();
		else setToday((old) => old ? { ...old, queueCount: old.queueCount + 1 } : old);
	};

	const controlsDisabled = busy || Boolean(pending) || !card?.text.trim();
	const buttonClass = "min-h-11 rounded-xl border border-neutral-300 px-4 py-3 text-sm dark:border-white/20 disabled:opacity-50";

	return <main className="min-h-[100dvh] bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
		<div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col gap-8 px-5 py-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<Link href="/bible" className="min-h-11 py-3 text-sm text-amber-700 dark:text-amber-400">‹ Bible</Link>
				<h1 className="text-sm font-semibold">Learn a verse</h1>
				{today ? <span className="text-sm text-neutral-600 dark:text-neutral-400">{today.knownCount} verses you know</span> : <span />}
			</header>

			{error ? <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-sm">
				<p>{error}</p>
				<div className="mt-3 flex flex-wrap gap-3">
					{pending && !conflict ? <button disabled={busy} onClick={() => void sendReview(pending)} className={buttonClass}>Retry same review</button> : null}
					{pending ? <button disabled={busy} onClick={() => void load(true)} className={buttonClass}>{conflict ? "Use latest schedule" : "Reload schedule"}</button> :
						<button disabled={busy} onClick={() => void load()} className={buttonClass}>Reload verses</button>}
				</div>
			</div> : null}

			{!today && !error ? <p role="status" className="my-auto text-center">Loading your verses...</p> : null}
			{today && !card && suggestionsView.showEmptyText ? <section className="my-auto text-center">
				<h2 className="font-serif text-3xl">No verses are due right now.</h2>
				<p className="mt-4 text-neutral-600 dark:text-neutral-400">Return when a saved verse is due, or choose Learn this verse from the Bible reader to add one.</p>
			</section> : null}

			{card ? <section
				className="my-auto py-4"
				aria-label="Verse practice"
				onTouchStart={(event) => {
					const point = event.touches[0];
					touch.current = { x: point.clientX, y: point.clientY };
				}}
				onTouchEnd={(event) => {
					const start = touch.current;
					touch.current = null;
					if (!start) return;
					const point = event.changedTouches[0];
					if (start.x - point.clientX > 70 && Math.abs(start.y - point.clientY) < 45) review("good");
				}}
			>
				<h2 className="mb-8 text-center text-base text-amber-700 dark:text-amber-400">{card.reference} · {card.translation}</h2>
				{card.text.trim() ? <>
					<VersePractice
						key={practiceRound}
						mode={mode}
						text={card.text}
						stage={card.stage}
						seed={card.revision}
						disabled={controlsDisabled}
						onModeChange={(next) => setSelection(chooseLearnMode(card, next))}
						onTypedScore={(perfect) => setTypedRound(perfect ? practiceRound : null)}
					/>
					<div className="mt-8 grid grid-cols-2 gap-3">
						<button disabled={controlsDisabled} onClick={() => review("again")} className={buttonClass}>Practice again</button>
						<button disabled={controlsDisabled || !typedReady} onClick={() => review("good")} className={`${buttonClass} border-amber-500 bg-amber-400 font-semibold text-neutral-950`}>
							{busy ? "Saving..." : card.stage === 3 ? "I remembered" : "Continue"}
						</button>
					</div>
				</> : <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-center">
					<p className="font-semibold">{card.translation} text is temporarily unavailable.</p>
					<p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">Reload before practicing. SureWord will keep the requested translation.</p>
					<button disabled={busy} onClick={() => void load()} className={`mt-3 ${buttonClass}`}>Reload verse</button>
				</div>}
			</section> : null}

			{today ? <SuggestedVerses
				view={suggestionsView}
				translation={translation}
				confirmation={confirmation}
				onAdded={acceptSuggestion}
				onDismiss={dismissSuggestion}
			/> : null}
		</div>
	</main>;
}
