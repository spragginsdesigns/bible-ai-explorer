"use client";

import { Fragment } from "react";
import { BookOpen, Headphones } from "lucide-react";
import VersePopover from "@/components/VersePopover";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { parseVerseReferences } from "@/utils/verseParser";
import type { LiveTurn, ReadingState } from "./voiceEngine";

/**
 * The live transcript: what the listener said, what SureWord said (with every
 * reference it named linked the way chat links them), and each passage the
 * narrated KJV read, with the verse being read highlighted as it plays.
 */
export default function VoiceTranscript({ turns }: { turns: readonly LiveTurn[] }) {
	if (turns.length === 0) return null;
	return (
		<ol aria-label="Conversation" aria-live="polite" className="space-y-4">
			{turns.map((turn) => (
				<li key={turn.key}>
					{turn.role === "user" ? (
						<UserLine turn={turn} />
					) : turn.role === "assistant" ? (
						<AssistantLine turn={turn} />
					) : turn.reading ? (
						<ReadingCard reading={turn.reading} />
					) : null}
				</li>
			))}
		</ol>
	);
}

function UserLine({ turn }: { turn: LiveTurn }) {
	return (
		<div className="flex justify-end">
			<p className="max-w-[85%] rounded-[18px] rounded-br-md bg-[#24281f]/[.07] px-4 py-2.5 text-[16px] leading-6 dark:bg-white/[.08]">
				<span className="sr-only">You: </span>
				{turn.text || <span className="text-neutral-500 dark:text-[#b3ad9e]">Listening...</span>}
			</p>
		</div>
	);
}

function AssistantLine({ turn }: { turn: LiveTurn }) {
	return (
		<div className="max-w-[92%]">
			<p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-500 dark:text-[#b3ad9e]">
				<span className="h-1.5 w-1.5 rounded-full bg-[#e5b664]" aria-hidden />
				SureWord
			</p>
			<p className="text-[17px] leading-7">
				{parseVerseReferences(stripDashes(turn.text)).map((segment, index) =>
					segment.type === "verse-ref" ? (
						<VersePopover key={index} reference={segment.value}>
							{segment.value}
						</VersePopover>
					) : (
						<Fragment key={index}>{segment.value}</Fragment>
					),
				)}
				{turn.live && !turn.text && <span className="text-neutral-500 dark:text-[#b3ad9e]">...</span>}
			</p>
			{turn.interrupted && <p className="mt-1 text-xs font-semibold text-neutral-500 dark:text-[#b3ad9e]">Interrupted</p>}
		</div>
	);
}

const READING_STATUS: Record<ReadingState["status"], string> = {
	loading: "Opening the recording",
	playing: "Reading now. Speak to stop it.",
	paused: "Paused while you speak",
	done: "Read aloud",
	stopped: "Stopped",
	unavailable: "No recording for this passage. The words are here.",
};

/** Keeps the verse being read in view inside the card's own scroll box, never scrolling the page. */
function keepInView(node: HTMLElement | null) {
	const box = node?.parentElement;
	if (!node || !box || box.scrollHeight <= box.clientHeight) return;
	const offset = node.getBoundingClientRect().top - box.getBoundingClientRect().top;
	if (offset < 0 || offset > box.clientHeight - node.offsetHeight) box.scrollTo({ top: box.scrollTop + offset - 24, behavior: "smooth" });
}

function ReadingCard({ reading }: { reading: ReadingState }) {
	const playing = reading.status === "playing" || reading.status === "paused";
	return (
		<section aria-label={`Reading ${reading.reference}`} className="rounded-[22px] border border-black/[.09] bg-white/50 p-4 dark:border-white/[.09] dark:bg-white/[.03] sm:p-5">
			<header className="flex items-center justify-between gap-3">
				<h3 className="flex min-w-0 items-center gap-2 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-none">
					<BookOpen size={18} className="shrink-0 text-amber-700 dark:text-[#e5b664]" aria-hidden />
					<span className="truncate">{reading.reference}</span>
				</h3>
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e5b664]/20 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:text-[#e5b664]">
					<Headphones size={13} aria-hidden /> Narrated KJV
				</span>
			</header>
			<div className={`mt-3 space-y-1.5 overflow-y-auto pr-1 font-[family-name:var(--font-cormorant)] text-[20px] leading-8 ${reading.verses.length > 6 ? "max-h-[22rem]" : ""}`}>
				{reading.verses.map((row) => {
					const current = reading.current === row.verse && playing;
					return (
						<p
							key={row.verse}
							data-current={current || undefined}
							ref={current ? keepInView : undefined}
							className={current ? "rounded-xl border-l-2 border-[#e5b664] bg-[#e5b664]/[.16] px-2.5 py-1" : "px-2.5"}
						>
							<sup className="mr-1.5 font-sans text-xs font-bold text-amber-700 dark:text-[#e5b664]">{row.verse}</sup>
							{row.text}
						</p>
					);
				})}
			</div>
			<p className="mt-3 border-t border-black/[.06] pt-2.5 text-sm text-neutral-600 dark:border-white/[.06] dark:text-[#bbb3a7]">{READING_STATUS[reading.status]}</p>
		</section>
	);
}
