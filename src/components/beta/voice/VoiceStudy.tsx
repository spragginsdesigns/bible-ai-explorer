"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mic, MicOff, NotebookPen, PhoneOff } from "lucide-react";
import { DESTINATION_TILE, IconTile, StatusChip } from "@/components/beta/visuals";
import type { VoiceSessionSummary } from "@/lib/beta/voice/sessions";
import { VOICE_IDLE_END_MS, VOICE_MAX_SESSION_MS } from "@/lib/beta/voice/voice-rules";
import { useMicPermission, useVoiceStudy } from "./useVoiceStudy";
import VoiceSessions from "./VoiceSessions";
import VoiceTranscript from "./VoiceTranscript";
import type { MicProblem, VoiceSnapshot } from "./voiceEngine";

const TRY_SAYING = [
	"What does Romans 5 teach about peace with God?",
	"Read me Psalm 23.",
	"Say that another way.",
	"Who was Melchizedek?",
	"Can we continue our conversation about James?",
];

const PROBLEMS: Record<MicProblem, { title: string; body: string; steps?: string[] }> = {
	denied: {
		title: "The microphone is blocked",
		body: "SureWord needs the microphone to hear you, and this browser has been told not to share it with this site. Allow it, then try again.",
		steps: [
			"Chrome: tap the icon at the left of the address bar, then Permissions or Site settings, and set Microphone to Allow.",
			"Safari on iPhone or iPad: tap the page menu in the address bar, then Website Settings, and set Microphone to Allow.",
			"Safari on a Mac: Safari, Settings, Websites, Microphone, and allow this site.",
		],
	},
	missing: { title: "No microphone found", body: "Connect a microphone or a headset, then try again." },
	busy: { title: "The microphone is busy", body: "Another app or tab is using it. Close that, then try again." },
	unsupported: { title: "This browser cannot hold a voice conversation", body: "Open SureWord in a current version of Chrome, Safari or Edge." },
	insecure: { title: "Voice needs a secure connection", body: "Open SureWord at its https address to talk with it." },
};

const ENDED: Record<NonNullable<VoiceSnapshot["endReason"]>, string> = {
	user: "Conversation ended.",
	idle: `Ended after ${VOICE_IDLE_END_MS / 60_000} quiet minutes, so nothing listens longer than it needs to.`,
	limit: `Ended at the ${VOICE_MAX_SESSION_MS / 60_000} minute limit. Start again to keep going.`,
	dropped: "The connection dropped. Start again to keep going.",
	left: "Conversation ended.",
};

function status(snapshot: VoiceSnapshot): { label: string; hint: string } {
	if (snapshot.muted) return { label: "Muted", hint: "Tap the microphone to listen again" };
	const reading = [...snapshot.turns].reverse().find((turn) => turn.reading && (turn.reading.status === "playing" || turn.reading.status === "loading"))?.reading;
	switch (snapshot.phase) {
		case "starting":
			return { label: "Connecting", hint: "Allow the microphone if your browser asks" };
		case "hearing":
			return { label: "Hearing you", hint: "Keep going; pause when you are done" };
		case "thinking":
			return { label: snapshot.activity ?? "Thinking", hint: "Talk any time to change course" };
		case "speaking":
			return { label: "Speaking", hint: "Just talk to interrupt" };
		case "reading":
			return { label: reading ? `Reading ${reading.reference}` : "Reading", hint: "Speak to stop the reading" };
		default:
			return { label: "Listening", hint: "Just talk, and interrupt any time" };
	}
}

function Elapsed({ since }: { since: number | null }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	if (!since) return null;
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	return <span className="tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
}

/**
 * Voice Study (LC-17653, docs/beta/voice.md): a hands-free spoken conversation
 * about Scripture. The microphone is asked for only when "Start talking" is
 * tapped; a blocked one is explained before anything is attempted.
 */
export default function VoiceStudy({ initialSessions }: { initialSessions: VoiceSessionSummary[] }) {
	const levelRef = useRef<HTMLSpanElement>(null);
	const { snapshot, start, end, setMuted, saveNote } = useVoiceStudy(levelRef);
	const permission = useMicPermission();
	const [sessions, setSessions] = useState(initialSessions);
	const active = snapshot.phase !== "idle" && snapshot.phase !== "ended";
	const problem = snapshot.problem ?? (!active && permission === "denied" ? "denied" : null);
	const { label, hint } = status(snapshot);
	const canSave = snapshot.turns.some((turn) => turn.role === "user" && turn.text) && snapshot.turns.some((turn) => turn.role !== "user" && turn.text);

	// A kept conversation or a saved note shows up in Recent conversations.
	useEffect(() => {
		if (snapshot.saveState !== "saved") return;
		let cancelled = false;
		fetch("/api/beta/voice/sessions", { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((body: { sessions?: VoiceSessionSummary[] } | null) => {
				if (!cancelled && body?.sessions) setSessions(body.sessions);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [snapshot.saveState, snapshot.noteState, snapshot.sessionId]);

	// Follow the conversation while it is on: keep its newest line in view above
	// the dock. Scrolling up by hand stops that; scrolling back down resumes it.
	const endRef = useRef<HTMLDivElement>(null);
	const followRef = useRef(true);
	const turnCount = snapshot.turns.length;
	const lastText = snapshot.turns.at(-1)?.text.length ?? 0;
	const readingVerse = snapshot.turns.findLast((turn) => turn.reading)?.reading?.current ?? null;
	useEffect(() => {
		const userScrolled = () =>
			requestAnimationFrame(() => {
				const end = endRef.current?.getBoundingClientRect().top;
				if (end !== undefined) followRef.current = end < window.innerHeight + 200;
			});
		const events = ["wheel", "touchmove", "keydown"] as const;
		for (const name of events) window.addEventListener(name, userScrolled, { passive: true });
		return () => {
			for (const name of events) window.removeEventListener(name, userScrolled);
		};
	}, []);
	useEffect(() => {
		if (snapshot.phase === "starting") followRef.current = true;
	}, [snapshot.phase]);
	useEffect(() => {
		if (active && followRef.current) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [active, turnCount, lastText, readingVerse]);

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={Mic} tone={DESTINATION_TILE.study} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Voice Study</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">Study hands-free, out loud</p>
					<div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
						<StatusChip status="live" />
						<span>Inspired by voice assistants</span>
					</div>
				</div>
			</header>

			<p className="mt-6 text-[17px] leading-7">
				Ask a question out loud and talk it through. Interrupt whenever you like, ask for it another way, or ask it to read you a passage. Scripture is read from the narrated King James Bible, word for word, never by the assistant&apos;s own voice.
			</p>

			{!active && (
				<section aria-label="Start a conversation" className="mt-6 rounded-[22px] border border-black/[.09] bg-white/35 p-5 dark:border-white/[.09] dark:bg-white/[.025] sm:p-7">
					{problem ? (
						<MicProblemPanel problem={problem} onRetry={start} />
					) : (
						<div className="flex flex-col items-center text-center">
							<button
								type="button"
								onClick={start}
								className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-[#e5b664] bg-white text-[#24281f] transition-transform active:scale-95 dark:bg-[#1a1d17] dark:text-[#f1eadc]"
							>
								<Mic size={38} strokeWidth={1.7} aria-hidden />
								<span className="sr-only">Start talking</span>
							</button>
							<p className="mt-4 text-lg font-bold">{snapshot.phase === "ended" ? "Start again" : "Start talking"}</p>
							<p className="mt-1 max-w-md text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
								{snapshot.phase === "ended" && snapshot.endReason ? ENDED[snapshot.endReason] : "Your browser asks for the microphone when you tap. It listens only while a conversation is on."}
							</p>
							{snapshot.error && (
								<p role="alert" className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">
									{snapshot.error}
								</p>
							)}
							{snapshot.phase !== "ended" && (
								<div className="mt-6 w-full text-left">
									<p className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">Try saying</p>
									<ul className="mt-2 flex flex-wrap gap-2">
										{TRY_SAYING.map((line) => (
											<li key={line} className="rounded-full border border-black/10 px-3 py-1.5 text-sm dark:border-white/10">
												&ldquo;{line}&rdquo;
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}
				</section>
			)}

			{snapshot.turns.length > 0 && (
				<section aria-label="Transcript" className="mt-6">
					<VoiceTranscript turns={snapshot.turns} />
				</section>
			)}
			<div ref={endRef} aria-hidden className="scroll-mb-[calc(var(--sureword-mobile-tab-clearance)+112px)] lg:scroll-mb-32" />

			{snapshot.phase === "ended" && canSave && (
				<div className="mt-6 flex flex-wrap items-center gap-3 rounded-[22px] border border-black/[.09] bg-white/35 p-4 dark:border-white/[.09] dark:bg-white/[.025]">
					<p className="min-w-0 flex-1 text-sm text-neutral-700 dark:text-[#d9d1c3]">
						{snapshot.saveState === "saved" ? "Kept in your recent conversations." : snapshot.saveState === "failed" ? "This conversation could not be kept." : "Keeping this conversation..."}
					</p>
					<NoteButton snapshot={snapshot} onSave={saveNote} />
				</div>
			)}

			{active && (
				<div className="sticky bottom-[calc(var(--sureword-mobile-tab-clearance)+12px)] z-20 mt-6 lg:bottom-6">
					<div className="flex items-center gap-3 rounded-[22px] border border-black/[.09] bg-[#f6f2e9] p-3 shadow-[0_4px_16px_rgba(36,40,31,0.08)] dark:border-white/[.1] dark:bg-[#151913]">
						<button
							type="button"
							onClick={() => setMuted(!snapshot.muted)}
							aria-pressed={snapshot.muted}
							aria-label={snapshot.muted ? "Unmute the microphone" : "Mute the microphone"}
							className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#e5b664] bg-white text-[#24281f] dark:bg-[#1a1d17] dark:text-[#f1eadc]"
						>
							<span
								ref={levelRef}
								aria-hidden
								className="pointer-events-none absolute inset-0 rounded-full bg-[#e5b664]/30 transition-transform duration-75"
								style={{ transform: "scale(calc(1 + var(--voice-level, 0) * 0.45))" }}
							/>
							{snapshot.phase === "starting" ? <Loader2 size={22} className="relative animate-spin" aria-hidden /> : snapshot.muted ? <MicOff size={22} className="relative" aria-hidden /> : <Mic size={22} className="relative" aria-hidden />}
						</button>
						<div className="min-w-0 flex-1" aria-live="polite">
							<p className="line-clamp-2 font-bold leading-tight">{label}</p>
							<p className="truncate text-sm text-neutral-600 dark:text-[#bbb3a7]">
								{hint}
								{snapshot.startedAt ? " · " : ""}
								<Elapsed since={snapshot.startedAt} />
							</p>
						</div>
						{/* On a phone the live dock keeps only what a hands-free talk needs; Save as note follows End. */}
						{canSave && (
							<div className="hidden sm:block">
								<NoteButton snapshot={snapshot} onSave={saveNote} />
							</div>
						)}
						<button
							type="button"
							onClick={end}
							aria-label="End"
							className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#24281f] px-3 text-sm font-bold text-white dark:bg-[#e5b664] dark:text-[#1c2118] sm:px-4"
						>
							<PhoneOff size={16} aria-hidden /> <span className="hidden sm:inline">End</span>
						</button>
					</div>
				</div>
			)}

			<VoiceSessions sessions={sessions} onChange={setSessions} />

			<p className="mt-8 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
				Answers are grounded in SureWord&apos;s Scripture search, with every passage it cites linked above. The microphone is on only during a conversation, which ends after {VOICE_IDLE_END_MS / 60_000} quiet minutes or {VOICE_MAX_SESSION_MS / 60_000} minutes in all. The voice is AI-generated.
			</p>
		</main>
	);
}

function NoteButton({ snapshot, onSave }: { snapshot: VoiceSnapshot; onSave: () => void }) {
	if (snapshot.note && snapshot.noteState === "saved") {
		return (
			<Link href={`/notes?note=${encodeURIComponent(snapshot.note.id)}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 text-sm font-bold dark:border-white/15">
				<CheckCircle2 size={16} className="text-amber-700 dark:text-[#e5b664]" aria-hidden />
				Note saved
			</Link>
		);
	}
	const saving = snapshot.noteState === "saving";
	return (
		<button
			type="button"
			onClick={onSave}
			disabled={saving}
			className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-black/10 px-3 text-sm font-bold disabled:opacity-60 dark:border-white/15"
		>
			{saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <NotebookPen size={16} aria-hidden />}
			{saving ? "Saving..." : snapshot.noteState === "failed" ? "Try saving again" : "Save as note"}
		</button>
	);
}

function MicProblemPanel({ problem, onRetry }: { problem: MicProblem; onRetry: () => void }) {
	const copy = PROBLEMS[problem];
	return (
		<div role="alert" className="flex flex-col items-center text-center">
			<span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-700 dark:text-red-300" aria-hidden>
				<MicOff size={30} strokeWidth={1.7} />
			</span>
			<h2 className="mt-4 font-[family-name:var(--font-cormorant)] text-[28px] font-semibold leading-none">{copy.title}</h2>
			<p className="mt-2 max-w-md text-[16px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{copy.body}</p>
			{copy.steps && (
				<ul className="mt-4 max-w-md space-y-2 text-left text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">
					{copy.steps.map((step) => (
						<li key={step} className="rounded-xl bg-black/[.035] px-3 py-2 dark:bg-white/[.04]">
							{step}
						</li>
					))}
				</ul>
			)}
			{problem !== "unsupported" && problem !== "insecure" && (
				<button type="button" onClick={onRetry} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#24281f] px-5 text-sm font-bold text-white dark:bg-[#e5b664] dark:text-[#1c2118]">
					<Mic size={16} aria-hidden /> Try again
				</button>
			)}
		</div>
	);
}
