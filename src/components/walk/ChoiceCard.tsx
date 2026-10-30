"use client";

import React, { useEffect, useState } from "react";
import { Check, Keyboard, Loader2, MapPin, Search } from "lucide-react";
import {
	DAILY_TIME_HOURS,
	TEXT_SCALE_FACTORS,
	TEXT_SCALE_VALUES,
	TOUR_STOPS,
	questionSegments,
	type ChoiceCardOutput,
	type GlossaryTerm,
} from "@/lib/onboarding-rules";
import { useVoiceActionScope } from "../voice/VoiceControlProvider";
import GlossaryDialog from "./GlossaryDialog";
import type { CardState } from "@/lib/guide-cards";
import { trackOnboardingStep } from "@/lib/analytics/client";
import { setTextScalePreference, usePreference } from "@/lib/preferencesSync";
import { readVoiceModePref } from "@/lib/preferences";
import { startTour } from "@/lib/spotlight";
import {
	getWebNotificationSettings,
	requestWebNotificationPermission,
	setWebVerseOfDayEnabled,
	setWebVerseOfDayHour,
} from "@/lib/web-notifications";
import { formatNotifyHour } from "@/lib/web-notification-rules";
import {
	CHURCH_SEARCH_DEBOUNCE_MS,
	MIN_CHURCH_QUERY_LENGTH,
	saveChurch,
	searchChurches,
	type ChurchSearchResult,
} from "@/lib/church-client";

interface ChoiceCardProps {
	card: ChoiceCardOutput;
	/** The welcome conversation, so the tour can bring them back to it. */
	conversationId?: string;
	state: CardState;
	/** Send the answer as the person's next message, through the normal chat send. */
	onAnswer: (text: string) => void;
	/** "Type my own": put the cursor in the composer. */
	onTypeOwn: () => void;
}

const OPTION_CLASS =
	"flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-5 py-3 text-left text-base font-semibold transition-colors disabled:cursor-default";
const OPTION_IDLE =
	"border-black/[0.12] bg-white/60 text-neutral-900 hover:border-amber-600/40 hover:bg-amber-500/[0.06] dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-neutral-100 dark:hover:border-amber-300/40 dark:hover:bg-amber-300/[0.06]";
const OPTION_CHOSEN =
	"border-amber-600/50 bg-amber-500/10 text-amber-800 dark:border-amber-300/40 dark:bg-amber-300/10 dark:text-amber-200";
const QUIET_CLASS =
	"min-h-11 rounded-lg px-2 text-base text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Turn the daily word on for a chosen hour and ask for notification
 * permission while the tap is still a user gesture (browsers refuse the
 * dialog otherwise). Already on: just move the hour and ask if the browser
 * has never been asked.
 */
function scheduleDailyWord(hour: number): void {
	setWebVerseOfDayHour(hour);
	if (getWebNotificationSettings().enabled) void requestWebNotificationPermission("settings-enabled");
	else void setWebVerseOfDayEnabled(true);
}

/**
 * The big tap-to-answer card under one of SureWord's welcome messages
 * (docs/onboarding/PLAN.md, "Tap, don't type"). Each tap does the step's own
 * work on this device first (text size, the daily word's hour, the church),
 * then sends the option's words as the person's reply, so the transcript
 * reads naturally on every client.
 *
 * Only the newest unanswered card takes taps; the rest stay on screen as a
 * record of what was asked and answered.
 */
export default function ChoiceCard({ card, conversationId, state, onAnswer, onTypeOwn }: ChoiceCardProps) {
	const [sent, setSent] = useState(false);
	const sentRef = React.useRef(false);
	const [picking, setPicking] = useState(false);
	const [pickHour, setPickHour] = useState(() => getWebNotificationSettings().hour);
	const [openTerm, setOpenTerm] = useState<GlossaryTerm | null>(null);
	const live = state.active && !sent;
	const welcomeNarration = usePreference(readVoiceModePref, false);

	const answer = (text: string, outcome: "answered" | "skipped") => {
		if (!live || sentRef.current) return;
		sentRef.current = true;
		setSent(true);
		trackOnboardingStep(card.step, outcome);
		onAnswer(text);
	};

	const choose = (option: string) => {
		if (!live || sentRef.current) return;
		if (card.step === "textScale") {
			const scale = TEXT_SCALE_VALUES[option as keyof typeof TEXT_SCALE_VALUES];
			if (scale) void setTextScalePreference(scale);
		} else if (card.step === "dailyTime") {
			if (option === "Pick a time") {
				setPicking(true);
				return;
			}
			const hour = DAILY_TIME_HOURS[option];
			if (hour !== undefined) scheduleDailyWord(hour);
		}
		answer(option, "answered");
		// After the send, so "Show me around" lands in the chat before the tour
		// starts walking the tabs. The tour ends in the reader, so it brings
		// them back to the welcome, where SureWord's reply is waiting.
		if (card.step === "tour") {
			startTour(TOUR_STOPS, conversationId ? `/?conversationId=${encodeURIComponent(conversationId)}` : undefined);
		}
	};

	const confirmPickedHour = () => {
		if (!live || sentRef.current) return;
		scheduleDailyWord(pickHour);
		answer(formatNotifyHour(pickHour), "answered");
	};

	const chosen = state.answer;
	const options = card.step === "church" ? [] : card.options;
	useVoiceActionScope(live && !openTerm ? {
		key: `${conversationId ?? "welcome"}:${card.step}:${card.question}`,
		question: picking ? "Choose the time for your daily word." : card.question,
		priority: 10,
		narrateQuestion: !welcomeNarration,
		...(card.allowOther && !picking ? { onText: (text: string) => answer(text, "answered") } : {}),
		actions: [
			...(picking ? HOURS.map(hour => ({ label: formatNotifyHour(hour), run: () => {
				if (!live || sentRef.current) return;
				scheduleDailyWord(hour); answer(formatNotifyHour(hour), "answered");
			} })) : options.map(option => ({ label: option, run: () => choose(option) }))),
			{ label: card.skipLabel, run: () => answer(card.skipLabel, "skipped") },
		],
	} : null);

	return (
		<div className="mt-4 flex flex-col gap-3" aria-label={card.question} role="group">
			<p className="text-lg font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
				{questionSegments(card.question, card.terms).map((segment, index) =>
					segment.term ? (
						<button
							key={index}
							type="button"
							onClick={() => setOpenTerm(segment.term ?? null)}
							aria-haspopup="dialog"
							className="font-semibold text-amber-700 underline decoration-2 underline-offset-4 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
						>
							{segment.text}
						</button>
					) : (
						<React.Fragment key={index}>{segment.text}</React.Fragment>
					),
				)}
			</p>
			{openTerm && (
				<GlossaryDialog
					term={openTerm}
					onClose={() => setOpenTerm(null)}
					onAsk={
						live
							? (question) => {
									setOpenTerm(null);
									setSent(true);
									trackOnboardingStep(card.step, "asked");
									onAnswer(question);
								}
							: undefined
					}
				/>
			)}

			{options.length > 0 && (
				<div className="flex flex-col gap-2">
					{options.map((option) => {
						const isChosen = chosen !== null && chosen === option;
						const scale = card.step === "textScale" ? TEXT_SCALE_VALUES[option as keyof typeof TEXT_SCALE_VALUES] : undefined;
						return (
							<button
								key={option}
								type="button"
								disabled={!live}
								onClick={() => choose(option)}
								aria-pressed={isChosen}
								className={`${OPTION_CLASS} ${isChosen ? OPTION_CHOSEN : OPTION_IDLE} ${!live && !isChosen ? "opacity-60" : ""}`}
								// Each size previews itself at its real size, so the root
								// scale already applied is divided back out.
								style={scale ? { fontSize: `calc(1.0625rem * ${TEXT_SCALE_FACTORS[scale]} / var(--sw-text-scale, 1))` } : undefined}
							>
								<span>{option}</span>
								{isChosen && <Check className="h-5 w-5 shrink-0" aria-hidden />}
							</button>
						);
					})}
				</div>
			)}

			{card.step === "dailyTime" && picking && live && (
				<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[0.1] p-3 dark:border-white/[0.1]">
					<label htmlFor="walk-pick-hour" className="text-base font-semibold">
						Send it at
					</label>
					<select
						id="walk-pick-hour"
						value={pickHour}
						onChange={(event) => setPickHour(Number(event.target.value))}
						className="min-h-12 rounded-xl border border-black/[0.12] bg-white px-3 text-base dark:border-white/[0.12] dark:bg-neutral-900"
					>
						{HOURS.map((hour) => (
							<option key={hour} value={hour}>
								{formatNotifyHour(hour)}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={confirmPickedHour}
						className="min-h-12 rounded-xl bg-[#e5b664] px-5 text-base font-bold text-[#1c2118] hover:bg-[#f0c77f]"
					>
						Set this time
					</button>
				</div>
			)}

			{card.step === "church" && live && (
				<ChurchSearch
					onSaved={(name) => answer(`I saved ${name} as my home church.`, "answered")}
					onUnavailable={onTypeOwn}
					onSkip={() => answer(card.skipLabel, "skipped")}
					skipLabel={card.skipLabel}
				/>
			)}

			{live && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
					{(card.allowOther || card.step === "church") && (
						<button
							type="button"
							onClick={() => {
								trackOnboardingStep(card.step, "own");
								onTypeOwn();
							}}
							className={`${QUIET_CLASS} flex items-center gap-2`}
						>
							<Keyboard className="h-4 w-4" aria-hidden />
							Type my own
						</button>
					)}
					<button type="button" onClick={() => answer(card.skipLabel, "skipped")} className={QUIET_CLASS}>
						{card.skipLabel}
					</button>
				</div>
			)}
		</div>
	);
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

/**
 * The church step's own search, on the same /api/church routes as Settings →
 * My church. Saving can take the better part of half a minute (the server
 * reads the church's website for its mission), so the pick says so.
 */
function ChurchSearch({ onSaved, onUnavailable, onSkip, skipLabel }: { onSaved: (name: string) => void; onUnavailable: () => void; onSkip: () => void; skipLabel: string }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ChurchSearchResult[]>([]);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const [savingId, setSavingId] = useState<string | null>(null);

	// Every keystroke cancels the request before it, so a slow answer for
	// "grace" can never replace the results for "grace chapel".
	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed.length < MIN_CHURCH_QUERY_LENGTH) {
			setResults([]);
			setPending(false);
			return;
		}
		setPending(true);
		const controller = new AbortController();
		const timer = setTimeout(() => {
			searchChurches(trimmed, controller.signal)
				.then((data) => {
					if (controller.signal.aborted) return;
					if (data.status === "unavailable") {
						setUnavailable(true);
						return;
					}
					setResults(data.results);
					setError(null);
					setPending(false);
				})
				.catch((err: unknown) => {
					if (controller.signal.aborted || isAbortError(err)) return;
					setResults([]);
					setError("Couldn't search right now. Try again in a moment.");
					setPending(false);
				});
		}, CHURCH_SEARCH_DEBOUNCE_MS);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [query]);

	const pick = async (result: ChurchSearchResult) => {
		if (savingId) return;
		setSavingId(result.placeId);
		setError(null);
		try {
			const church = await saveChurch(result.placeId);
			onSaved(church.name);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't save that church. Try again.");
			setSavingId(null);
		}
	};

	useVoiceActionScope({
		key: "welcome-church-search",
		priority: 20,
		narrateQuestion: true,
		question: unavailable ? "Church search is unavailable. You can skip this step." : results.length ? "Choose your home church." : "Say your church name and city to search, or say skip for now.",
		actions: savingId ? [] : [
			...results.map(result => ({ label: `${result.name}, ${result.address}`, run: () => pick(result) })),
			{ label: skipLabel, run: onSkip },
		],
		...(!savingId && !unavailable ? { onText: (text: string) => setQuery(text) } : {}),
	});

	if (unavailable) {
		return (
			<p className="text-base text-neutral-600 dark:text-neutral-400">
				Church search isn&apos;t available right now. Tell me its name instead, and I will remember it.{" "}
				<button type="button" onClick={onUnavailable} className="font-semibold text-amber-700 underline dark:text-amber-300">
					Type it
				</button>
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="relative">
				<Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden />
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Church name and city"
					aria-label="Search for your church by name and city"
					disabled={savingId !== null}
					className="min-h-14 w-full rounded-2xl border border-black/[0.12] bg-white pl-12 pr-4 text-base text-neutral-900 outline-none focus:border-amber-500/60 disabled:opacity-60 dark:border-white/[0.12] dark:bg-neutral-900 dark:text-neutral-100"
				/>
				{pending && (
					<Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-neutral-400" aria-hidden />
				)}
			</div>
			{results.map((result) => (
				<button
					key={result.placeId}
					type="button"
					disabled={savingId !== null}
					onClick={() => void pick(result)}
					className={`${OPTION_CLASS} ${OPTION_IDLE} ${savingId && savingId !== result.placeId ? "opacity-60" : ""}`}
				>
					<span className="min-w-0">
						<span className="block">{result.name}</span>
						<span className="mt-0.5 flex items-start gap-1.5 text-sm font-normal text-neutral-500 dark:text-neutral-400">
							<MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
							{result.address}
						</span>
					</span>
					{savingId === result.placeId && <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />}
				</button>
			))}
			{savingId && (
				<p role="status" className="text-base text-neutral-600 dark:text-neutral-400">
					Saving your church. This can take a little while.
				</p>
			)}
			{error && (
				<p role="alert" className="text-base text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
		</div>
	);
}
