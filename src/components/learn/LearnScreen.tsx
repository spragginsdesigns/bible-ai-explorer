"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { readTranslationPref } from "@/lib/preferences";
import { usePreference } from "@/lib/preferencesSync";
import type { TranslationId } from "@/lib/bible/translations";
import { type LearnResult } from "./learn";
import { fetchLearnSuggestions, fetchLearnToday, reviewLearnCard, type LearnTokenSource } from "./learnApi";
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
	suggestionKey,
	type LearnSuggestion,
} from "./suggestions";
// Android's offline review queue, shared as-is: saved reviews survive a
// reload or a lost connection, sync in order, and surface schedule conflicts.
import {
	LearnSyncStore,
	learnStorageKey,
	type LearnStorage,
	type LearnSyncSnapshot,
} from "../../../mobile/src/features/learn/learnSync";

const RETRY_DELAYS_MS = [1_500, 5_000, 15_000] as const;

/** localStorage behind the store's async storage contract; failures reject. */
const browserStorage: LearnStorage = {
	getItem: async (key) => window.localStorage.getItem(key),
	setItem: async (key, value) => window.localStorage.setItem(key, value),
};

function browserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export default function LearnScreen() {
	const { userId, isLoaded } = useAuth();
	if (!isLoaded) return <p role="status" className="p-6">Loading your verses...</p>;
	if (!userId) return <Link href="/sign-in" className="p-6">Sign in to learn your verses.</Link>;
	return <LearnSession key={userId} userId={userId} />;
}

/**
 * The web twin of mobile/src/features/learn/LearnScreen.tsx: reviews are
 * saved on the device first and synced in order, so practice keeps working
 * offline and a lost response never loses or doubles a review.
 */
function LearnSession({ userId }: { userId: string }) {
	const auth = useAuth();
	const authRef = useRef(auth);
	authRef.current = auth;
	// Keyed by account (LearnScreen remounts per user), so the token source
	// refuses to hand this session's reviews to whoever signs in next.
	const [tokenSource] = useState<LearnTokenSource>(() => async () => {
		if (authRef.current.userId !== userId) throw new Error("Account changed");
		const token = await authRef.current.getToken();
		if (authRef.current.userId !== userId) throw new Error("Account changed");
		return token;
	});
	const [store] = useState(() => new LearnSyncStore(userId, {
		storage: browserStorage,
		fetchToday: () => fetchLearnToday(tokenSource),
		sendReview: (cardId, payload) => reviewLearnCard(tokenSource, cardId, payload),
		createOperationId: () => crypto.randomUUID(),
		now: () => new Date(),
		timezone: browserTimezone,
	}));
	const [snapshot, setSnapshot] = useState<LearnSyncSnapshot>(() => store.getSnapshot());
	// A finished review starts a fresh round even when the card stays on screen.
	const [round, setRound] = useState(0);
	const [selection, setSelection] = useState<LearnModeSelection | null>(null);
	const [typedRound, setTypedRound] = useState<string | null>(null);
	const [interactionBusy, setInteractionBusy] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [suggestions, setSuggestions] = useState<LearnSuggestion[]>([]);
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
	const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
	const [confirmation, setConfirmation] = useState<string | null>(null);
	// Follows the account preference live, as the reader does.
	const translation = usePreference<TranslationId>(readTranslationPref, "KJV");
	const visible = useRef(false);
	const retryAttempt = useRef(0);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const runSyncRef = useRef<(reset?: boolean) => void>(() => undefined);
	const touch = useRef<{ x: number; y: number } | null>(null);

	const clearRetry = useCallback(() => {
		if (retryTimer.current) clearTimeout(retryTimer.current);
		retryTimer.current = null;
	}, []);

	const runSync = useCallback((reset = false) => {
		if (!visible.current || !store.getSnapshot().hydrated) return;
		if (reset) retryAttempt.current = 0;
		clearRetry();
		void store.synchronize().then(() => {
			const next = store.getSnapshot();
			if (!visible.current || next.connection !== "offline" ||
				retryAttempt.current >= RETRY_DELAYS_MS.length) return;
			const delay = RETRY_DELAYS_MS[retryAttempt.current++];
			retryTimer.current = setTimeout(() => runSyncRef.current(false), delay);
		});
	}, [clearRetry, store]);
	runSyncRef.current = runSync;

	// Another tab (or this one, before a reload) may have saved reviews since
	// this store last read the device; re-reading first means a sync never
	// writes over them with an older copy.
	const rehydrateAndSync = useCallback(() => {
		void store.hydrate().then(() => runSyncRef.current(true)).catch(() => undefined);
	}, [store]);

	useEffect(() => {
		store.activate();
		visible.current = document.visibilityState === "visible";
		const unsubscribe = store.subscribe(setSnapshot);
		rehydrateAndSync();
		let cancelled = false;
		// Additive: fetchLearnSuggestions never rejects, so an offline browser
		// or a failed request simply shows no suggestions.
		void fetchLearnSuggestions(tokenSource).then((rows) => {
			if (!cancelled) setSuggestions(rows);
		});
		const onVisibility = () => {
			visible.current = document.visibilityState === "visible";
			if (visible.current) rehydrateAndSync();
			else clearRetry();
		};
		const onOnline = () => runSyncRef.current(true);
		const onStorage = (event: StorageEvent) => {
			if (event.key === learnStorageKey(userId)) void store.hydrate().catch(() => undefined);
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("online", onOnline);
		window.addEventListener("storage", onStorage);
		return () => {
			cancelled = true;
			visible.current = false;
			clearRetry();
			unsubscribe();
			store.dispose();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("online", onOnline);
			window.removeEventListener("storage", onStorage);
		};
	}, [clearRetry, rehydrateAndSync, store, tokenSource, userId]);

	const today = snapshot.today;
	const card = today?.cards[0];
	const verseText = card?.text ?? "";
	// How well the verse is known picks the mode; the reader may change it for
	// the card in front of them, and nothing about that reaches the server.
	const practice = card ? resolveLearnMode(card, selection) : null;
	const mode: LearnMode = practice?.mode ?? "blanks";
	const practiceRound = card ? `${card.id}:${card.revision}:${round}:${mode}` : "";
	// Type it out passes "good" only when every word matched, so a swipe and the
	// button answer to the same gate.
	const typedReady = mode !== "typed" || (Boolean(practiceRound) && typedRound === practiceRound);
	const conflict = snapshot.conflicts[0];
	const cardBlocked = Boolean(card && snapshot.conflicts.some((item) => item.cardId === card.id));
	const suggestionsView = learnSuggestionsView({
		suggestions,
		dismissed,
		added,
		hasCard: Boolean(card),
	});

	const dismissSuggestion = (suggestion: LearnSuggestion) => {
		setDismissed((old) => new Set(old).add(suggestionKey(suggestion)));
	};

	const acceptSuggestion = (suggestion: LearnSuggestion) => {
		setAdded((old) => new Set(old).add(suggestionKey(suggestion)));
		setConfirmation(addedConfirmation(suggestion.reference));
		// With nothing due, the added verse is the session. The store owns the
		// queue, so a sync is what brings the new card and count in.
		if (!card) runSyncRef.current(true);
	};

	const review = async (result: LearnResult) => {
		if (!card || interactionBusy || cardBlocked || !verseText.trim()) return;
		if (result === "good" && !typedReady) return;
		const wasOffline = store.getSnapshot().connection === "offline";
		setInteractionBusy(true);
		setLocalError(null);
		try {
			await store.enqueue(card.id, result);
			setRound((value) => value + 1);
			if (!wasOffline) runSyncRef.current(false);
		} catch (error) {
			setLocalError(error instanceof Error ? error.message : "Could not save this review.");
		} finally {
			setInteractionBusy(false);
		}
	};

	const applyLatestSchedule = async () => {
		if (!conflict || interactionBusy) return;
		setInteractionBusy(true);
		setLocalError(null);
		try {
			await store.useLatestSchedule(conflict.cardId);
			setRound((value) => value + 1);
		} catch (error) {
			setLocalError(error instanceof Error ? error.message : "Could not load the latest schedule.");
		} finally {
			setInteractionBusy(false);
		}
	};

	const disabled = interactionBusy || cardBlocked || !verseText.trim();
	const showInitialLoading = !today &&
		(snapshot.connection === "initializing" || snapshot.connection === "syncing");
	const pendingLabel = `${snapshot.pendingCount} saved review${snapshot.pendingCount === 1 ? "" : "s"}`;
	const buttonClass = "min-h-11 rounded-xl border border-neutral-300 px-4 py-3 text-sm dark:border-white/20 disabled:opacity-50";
	const linkButton = "mt-2 min-h-11 text-sm font-semibold text-amber-700 dark:text-amber-400 disabled:opacity-50";
	const notice = "rounded-xl border border-neutral-300 p-4 text-sm dark:border-white/15";

	return <main className="min-h-[100dvh] bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
		<div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col gap-6 px-5 py-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<Link href="/bible" className="min-h-11 py-3 text-sm text-amber-700 dark:text-amber-400">‹ Bible</Link>
				<h1 className="text-sm font-semibold">Learn a verse</h1>
				{today ? <span className="text-sm text-neutral-600 dark:text-neutral-400">{today.knownCount} verses you know</span> : <span />}
			</header>

			{conflict ? <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
				<p className="font-semibold">Newer schedule found for {conflict.reference}</p>
				<p className="mt-1 text-neutral-600 dark:text-neutral-400">
					{conflict.operationCount} local review{conflict.operationCount === 1 ? "" : "s"} cannot be applied to that newer stage.
				</p>
				<button disabled={interactionBusy} onClick={() => void applyLatestSchedule()} className={linkButton}>
					Use latest schedule
				</button>
			</div> : null}

			{snapshot.pendingCount > 0 && !conflict ? <div className={notice}>
				<p role="status" className="text-neutral-600 dark:text-neutral-400">
					{snapshot.connection === "syncing"
						? `Syncing ${pendingLabel}...`
						: `${pendingLabel} on this device. ${snapshot.connection === "idle" ? "Ready to sync." : "Waiting to sync."}`}
				</p>
				{snapshot.connection !== "syncing" ? <button onClick={() => runSyncRef.current(true)} className={linkButton}>
					Retry sync
				</button> : null}
			</div> : null}

			{snapshot.pendingCount === 0 && snapshot.connection === "offline" ? <div className={notice}>
				<p className="text-neutral-600 dark:text-neutral-400">{snapshot.message}</p>
				<button onClick={() => runSyncRef.current(true)} className={linkButton}>Reconnect</button>
			</div> : null}

			{(localError || (snapshot.connection === "error" && snapshot.message)) ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
				<p className="text-red-600 dark:text-red-400">{localError ?? snapshot.message}</p>
				{snapshot.hydrated ? <button onClick={() => runSyncRef.current(true)} className={linkButton}>Try again</button> : null}
			</div> : null}

			{showInitialLoading ? <p role="status" aria-live="polite" className="my-auto text-center text-neutral-600 dark:text-neutral-400">Loading your verses...</p> : null}
			{!today && !showInitialLoading ? <section className="my-auto text-center">
				<h2 className="font-serif text-3xl">Connect to download your practice verses.</h2>
				<p className="mt-4 text-neutral-600 dark:text-neutral-400">Once downloaded, this session works without a connection.</p>
			</section> : null}
			{today && !card && suggestionsView.showEmptyText ? <section className="my-auto text-center">
				<h2 className="font-serif text-3xl">No verses are due right now.</h2>
				<p className="mt-4 text-neutral-600 dark:text-neutral-400">
					{snapshot.pendingCount
						? "Your practice is saved on this device and will update the schedule after it syncs."
						: today.queueCount
							? "Your next verses will be ready when they are due."
							: snapshot.downloadedCards.length
								? "Your downloaded verses remain saved for the next offline practice session."
								: "Choose Learn this verse from the Bible reader or a highlight."}
				</p>
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
					if (start.x - point.clientX > 70 && Math.abs(start.y - point.clientY) < 45) void review("good");
				}}
			>
				<h2 className="mb-8 text-center text-base text-amber-700 dark:text-amber-400">{card.reference} · {card.translation}</h2>
				{verseText.trim() ? <>
					<VersePractice
						key={practiceRound}
						mode={mode}
						text={verseText}
						stage={card.stage}
						seed={card.revision}
						disabled={disabled}
						onModeChange={(next) => setSelection(chooseLearnMode(card, next))}
						onTypedScore={(perfect) => setTypedRound(perfect ? practiceRound : null)}
					/>
					<div className="mt-8 grid grid-cols-2 gap-3">
						<button disabled={disabled} onClick={() => void review("again")} className={buttonClass}>Practice again</button>
						<button disabled={disabled || !typedReady} onClick={() => void review("good")} className={`${buttonClass} border-amber-500 bg-amber-400 font-semibold text-neutral-950`}>
							{interactionBusy ? "Saving..." : card.stage === 3 ? "I remembered" : "Continue"}
						</button>
					</div>
				</> : <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-center">
					<p className="font-semibold">{card.translation} text is temporarily unavailable.</p>
					<p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">Reconnect and reload before practicing this verse. SureWord will keep the requested translation.</p>
					<button onClick={() => runSyncRef.current(true)} className={`mt-3 ${buttonClass}`}>Reload verse</button>
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
