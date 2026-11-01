import Link from "next/link";
import { BookOpen } from "lucide-react";
import { VERDICT_LABELS, type MarkedWord, type QuotationFinding } from "@/lib/beta/verify/verify-rules";
import { CARD, EYEBROW, MARK_CLASS, MARK_NOTE, MUTED, SCRIPTURE, SCRIPTURE_TEXT, TEACHING, TEACHING_TEXT, TEXT_LINK, VERDICT_CHIP, readerHref } from "./ui";

/** One word with its mark; a marked word carries a note for screen readers. */
function Marked({ word }: { word: MarkedWord }) {
	const note = MARK_NOTE[word.mark];
	if (!note) return <span className={MARK_CLASS[word.mark]}>{word.text}</span>;
	return (
		<span className={MARK_CLASS[word.mark]} title={note} data-mark={word.mark}>
			{word.text}
			<span className="sr-only"> ({note})</span>
		</span>
	);
}

function Words({ words }: { words: MarkedWord[] }) {
	return (
		<>
			{words.map((word, index) => (
				<span key={index}>
					{index > 0 ? " " : null}
					<Marked word={word} />
				</span>
			))}
		</>
	);
}

/** The passage side, with each verse's number before its words. */
function PassageWords({ words, verses }: { words: MarkedWord[]; verses: number[] }) {
	return (
		<>
			{words.map((word, index) => {
				const startsVerse = word.verse !== undefined && (index === 0 || words[index - 1].verse !== word.verse);
				return (
					<span key={index}>
						{index > 0 ? " " : null}
						{startsVerse && verses.length > 1 ? (
							<sup className="mr-0.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verses[word.verse ?? 0]}</sup>
						) : null}
						<Marked word={word} />
					</span>
				);
			})}
		</>
	);
}

/**
 * One quotation beside the Scripture it was checked with. The teaching's
 * words on the left (on the dashed rule), the bundled text on the right (on
 * the gold rule), each word marked where they differ.
 */
export default function QuotationCard({ quotation }: { quotation: QuotationFinding }) {
	const { verdict, cited, passage, comparedWith } = quotation;
	const showPassage = quotation.passageWords.length > 0;
	return (
		<article className={`${CARD} p-4 sm:p-5`} aria-label={`${VERDICT_LABELS[verdict]}: ${passage?.label ?? "quotation"}`} data-verdict={verdict}>
			<div className="flex flex-wrap items-center gap-2">
				<span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold uppercase tracking-[.12em] ${VERDICT_CHIP[verdict]}`}>{VERDICT_LABELS[verdict]}</span>
				<span className={`text-sm ${MUTED}`}>
					{cited ? `Cited as ${cited.label}` : "Not cited"}
					{quotation.statedTranslation ? ` (${quotation.statedTranslation})` : ""}
				</span>
			</div>
			<p className="mt-2 text-[15px] leading-6 text-neutral-800 dark:text-[#e2dacb]">{quotation.note}</p>

			<div className={`mt-4 grid gap-4 ${showPassage ? "md:grid-cols-2" : ""}`}>
				<section aria-label="As quoted">
					<h3 className={EYEBROW}>As quoted</h3>
					<p className={`mt-1.5 ${TEACHING} ${TEACHING_TEXT}`}>
						<Words words={quotation.quoteWords} />
					</p>
				</section>
				{showPassage ? (
					<section aria-label={`${comparedWith} ${passage?.label ?? ""}`}>
						<h3 className={EYEBROW}>
							{comparedWith}
							{passage ? ` · ${passage.label}` : ""}
						</h3>
						<p className={`mt-1.5 ${SCRIPTURE} ${SCRIPTURE_TEXT}`}>
							<PassageWords words={quotation.passageWords} verses={quotation.passageVerses} />
						</p>
					</section>
				) : null}
			</div>

			<div className="mt-2 flex flex-wrap gap-x-5">
				{passage ? (
					<Link href={readerHref(passage.book, passage.chapter, passage.verse)} className={TEXT_LINK}>
						<BookOpen size={16} aria-hidden /> Open {passage.label} in the reader
					</Link>
				) : null}
				{cited && passage && cited.label !== passage.label ? (
					<Link href={readerHref(cited.book, cited.chapter, cited.verse)} className={TEXT_LINK}>
						<BookOpen size={16} aria-hidden /> Open the cited {cited.label}
					</Link>
				) : null}
			</div>
		</article>
	);
}
