import { ArrowUpRight, Gauge, Lightbulb, MessageCircleQuestion, ScrollText } from "lucide-react";
import {
	CHECK_VERDICT_LABEL,
	NO_AGAINST_VERSES,
	TUTOR_HINT_STEPS,
	TUTOR_STAGE_LABEL,
	type TutorCheckVerdict,
	type TutorCitation,
	type TutorCitationSource,
	type TutorTurn,
	type TutorVerdict,
} from "@/lib/beta/tutor/tutor-rules";

/**
 * One turn of a close reading, as the session screen shows it. Every verse
 * the tutor cites carries its KJV text from the bundled Bible, so the founder
 * reads the Word itself beside what the tutor says about it.
 */

const SOURCE_LABEL: Record<TutorCitationSource, string> = {
	passage: "In the passage",
	chapter: "Same chapter",
	preceding: "The chapter before",
	"cross-reference": "Cross-reference",
	search: "Elsewhere in Scripture",
};

const VERDICT: Record<TutorVerdict, { label: string; tone: string }> = {
	affirm: { label: "The text supports this", tone: "bg-emerald-600/[.12] text-emerald-900 dark:bg-emerald-300/[.12] dark:text-emerald-200" },
	partly: { label: "Partly there", tone: "bg-amber-500/[.16] text-amber-900 dark:bg-amber-300/[.14] dark:text-amber-200" },
	correct: { label: "Look again", tone: "bg-rose-600/[.11] text-rose-900 dark:bg-rose-300/[.12] dark:text-rose-200" },
	unclear: { label: "Back to the question", tone: "bg-black/[.05] text-neutral-700 dark:bg-white/[.06] dark:text-neutral-200" },
};

const CHECK_TONE: Record<TutorCheckVerdict, string> = {
	supported: VERDICT.affirm.tone,
	partly: VERDICT.partly.tone,
	corrected: VERDICT.correct.tone,
};

const chip = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold";
const tutorCard = "rounded-[22px] border border-black/[.09] bg-white/55 p-4 dark:border-white/[.09] dark:bg-white/[.03]";

export function Citations({ items, label }: { items: readonly TutorCitation[]; label?: string }) {
	if (!items.length) return null;
	return (
		<div className="mt-3">
			{label ? <p className="mb-1.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">{label}</p> : null}
			<ul className="flex flex-col gap-2">
				{items.map((citation) => (
					<li key={`${citation.reference}-${citation.why}`} className="rounded-2xl border-l-[3px] border-amber-600/60 bg-[#f6f2e9] px-3 py-2 dark:border-[#e5b664]/60 dark:bg-[#0d100d]">
						<p className="flex flex-wrap items-baseline gap-x-2 text-sm">
							<span className="font-bold">{citation.reference}</span>
							<span className="text-xs text-neutral-600 dark:text-[#b3ad9e]">{SOURCE_LABEL[citation.source]}</span>
						</p>
						<p className="mt-0.5 font-[family-name:var(--font-cormorant)] text-[18px] leading-snug">{citation.text}</p>
						{citation.why ? <p className="mt-1 text-sm text-neutral-700 dark:text-[#d9d1c3]">{citation.why}</p> : null}
					</li>
				))}
			</ul>
		</div>
	);
}

export default function TutorTurnView({
	turn,
	verses,
	isOpen,
}: {
	turn: TutorTurn;
	verses: readonly { verse: number; text: string }[];
	/** The question the founder is answering now. */
	isOpen: boolean;
}) {
	if (turn.role === "you") {
		if (turn.kind === "hint" || turn.kind === "reading") {
			return (
				<p className="self-center text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-neutral-400">
					{turn.kind === "hint" ? "You asked for a hint" : "You asked for the tutor's reading"}
				</p>
			);
		}
		return (
			<div className="ml-auto max-w-[88%] rounded-[22px] rounded-br-md bg-amber-500/[.15] px-4 py-3 dark:bg-amber-300/[.11]">
				<p className="text-xs font-bold uppercase tracking-[.14em] text-amber-900 dark:text-amber-200">{turn.kind === "conclusion" ? "Your conclusion" : "You"}</p>
				<p className="mt-1 whitespace-pre-wrap text-[16px] leading-6">{turn.text}</p>
			</div>
		);
	}

	switch (turn.kind) {
		case "question": {
			const focus = verses.filter((row) => turn.focus.includes(row.verse));
			return (
				<div className={`${tutorCard} ${isOpen ? "border-amber-700/30 dark:border-amber-300/30" : ""}`} data-turn="question">
					<p className="flex items-center gap-2">
						<span className={`${chip} bg-sky-500/[.13] text-sky-900 dark:bg-sky-300/[.12] dark:text-sky-200`}>
							<MessageCircleQuestion size={13} aria-hidden /> {TUTOR_STAGE_LABEL[turn.stage]}
						</span>
					</p>
					{turn.lead ? <p className="mt-2 text-sm italic text-neutral-700 dark:text-[#d9d1c3]">{turn.lead}</p> : null}
					<p className="mt-2 text-[18px] font-semibold leading-7">{turn.text}</p>
					{focus.length ? (
						<div className="mt-2.5 flex flex-col gap-1">
							{focus.map((row) => (
								<p key={row.verse} className="font-[family-name:var(--font-cormorant)] text-[18px] leading-snug text-neutral-800 dark:text-[#e4dccd]">
									<span className="mr-1.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{row.verse}</span>
									{row.text}
								</p>
							))}
						</div>
					) : null}
					<Citations items={turn.context ?? []} label="Read it with" />
				</div>
			);
		}
		case "feedback":
			return (
				<div className={tutorCard}>
					<span className={`${chip} ${VERDICT[turn.verdict].tone}`}>{VERDICT[turn.verdict].label}</span>
					<p className="mt-2 text-[16px] leading-7">{turn.text}</p>
					<Citations items={turn.citations} />
				</div>
			);
		case "hint":
			return (
				<div className={tutorCard}>
					<span className={`${chip} bg-amber-500/[.16] text-amber-900 dark:bg-amber-300/[.14] dark:text-amber-200`}>
						<Lightbulb size={13} aria-hidden /> Hint {turn.step} of {TUTOR_HINT_STEPS}
					</span>
					<p className="mt-2 text-[16px] leading-7">{turn.text}</p>
					<Citations items={turn.citations} />
				</div>
			);
		case "reading":
			return (
				<div className={tutorCard}>
					<span className={`${chip} border border-black/15 text-neutral-800 dark:border-white/20 dark:text-neutral-100`}>
						<ScrollText size={13} aria-hidden /> The tutor&apos;s reading · interpretation, not Scripture
					</span>
					<p className="mt-2 text-[16px] leading-7">{turn.text}</p>
					<Citations items={turn.forVerses} label="Verses for this reading" />
					{turn.againstVerses.length ? (
						<Citations items={turn.againstVerses} label="Verses to weigh against it" />
					) : (
						<div className="mt-3">
							<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Verses to weigh against it</p>
							<p className="mt-1 text-sm text-neutral-700 dark:text-[#d9d1c3]">{NO_AGAINST_VERSES}</p>
						</div>
					)}
					{turn.consider ? <p className="mt-3 text-[16px] font-semibold leading-7">{turn.consider}</p> : null}
				</div>
			);
		case "check":
			return (
				<div className={`${tutorCard} border-amber-700/25 dark:border-amber-300/25`} data-turn="check">
					<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Your conclusion, checked against the text</p>
					<span className={`${chip} mt-2 ${CHECK_TONE[turn.verdict]}`}>{CHECK_VERDICT_LABEL[turn.verdict]}</span>
					<p className="mt-2 text-[16px] leading-7">{turn.text}</p>
					<Citations items={turn.supports} label="What supports it" />
					<Citations items={turn.corrects} label="What corrects or completes it" />
					<Citations items={turn.context} label="The wider context" />
					{turn.takeaways.length ? (
						<div className="mt-4 rounded-2xl bg-black/[.035] px-4 py-3 dark:bg-white/[.04]">
							<p className="text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">What this study shows</p>
							<ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-6">
								{turn.takeaways.map((takeaway) => (
									<li key={takeaway}>{takeaway}</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			);
		case "level":
			return (
				<p className="flex items-center gap-2 self-center rounded-full bg-black/[.04] px-3.5 py-1.5 text-sm text-neutral-700 dark:bg-white/[.05] dark:text-[#d9d1c3]">
					<Gauge size={15} aria-hidden /> {turn.text}
				</p>
			);
	}
}

export function NoteLink({ noteId }: { noteId: string }) {
	return (
		<a href={`/notes?note=${encodeURIComponent(noteId)}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
			Open note <ArrowUpRight size={15} aria-hidden />
		</a>
	);
}
