import Link from "next/link";
import { BookOpen, MessageCircleQuestion } from "lucide-react";
import type { BetaAtlasCertainty } from "@/lib/beta/atlas/places";
import type { BetaLaneSource } from "@/lib/beta/atlas/lanes";
import type { AtlasPassage } from "@/lib/beta/atlas/types";
import { readerHrefFor } from "@/components/atlas/atlasLinks";

/** Shared pieces of SureWord Beta's Atlas & Timeline (LC-17655). */

export const atlasCard = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const atlasEyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const atlasChip =
	"inline-flex min-h-11 items-center gap-1.5 rounded-full border border-black/10 bg-white/50 px-3.5 text-sm font-semibold text-neutral-800 transition-colors hover:border-amber-700/40 hover:bg-white/80 dark:border-white/10 dark:bg-white/[.03] dark:text-[#e9e1d2] dark:hover:border-amber-300/40 dark:hover:bg-white/[.06]";
export const atlasChipOn =
	"inline-flex min-h-11 items-center gap-1.5 rounded-full border border-transparent bg-[#24281f] px-3.5 text-sm font-bold text-[#f6f2e9] dark:bg-[#e5b664] dark:text-[#1c2118]";
export const atlasHeading = "font-[family-name:var(--font-cormorant)] font-semibold leading-[1.05]";

export const CERTAINTY_LABEL: Record<BetaAtlasCertainty, string> = {
	known: "Site known",
	traditional: "Traditional site",
	uncertain: "Site uncertain",
};

export const CERTAINTY_HINT: Record<BetaAtlasCertainty, string> = {
	known: "Where this place stood is not in doubt.",
	traditional: "This is the long-held identification of the site; Scripture does not mark the spot on a map.",
	uncertain: "No one knows the exact spot. The marker shows the region Scripture describes.",
};

export const SOURCE_LABEL: Record<BetaLaneSource, string> = {
	ussher: "Ussher",
	corpus: "Traditional dating",
	reigns: "Dated by reigns",
};

export const SOURCE_HINT: Record<BetaLaneSource, string> = {
	ussher: "Years from Ussher's Annals of the World.",
	corpus: "Years from the atlas's traditional dating, the chronology printed in KJV margins after Ussher.",
	reigns: "Scripture dates this by the kings it names; the years are those reigns as Ussher dates them.",
};

/** Under an event's date: what the date is, and what it is not. */
export const EVENT_DATE_NOTE =
	"Traditional dating, as printed in the margins of the King James Bible after Ussher: a reckoning from the genealogies and reigns of Scripture, not part of the text itself.";

/**
 * The timeline's footnote. The kings' and patriarchs' years are Ussher's own
 * (Annals of the World); event dates are the atlas corpus's traditional
 * dating, which follows the KJV margins and in a few places differs from the
 * Annals. Both are said plainly, so no date is called Ussher's that is not.
 */
export const TIMELINE_DATE_NOTE =
	"Years marked Ussher are from James Ussher's Annals of the World (1658). Event dates are the atlas's traditional dating from the KJV margins, which follows Ussher but not everywhere: it burns the temple in 586 BC and dates the crucifixion AD 30, where Ussher has 588 BC and AD 33. Every one is a reckoning from Scripture's genealogies and reigns, not part of the text itself.";

export function CertaintyChip({ certainty }: { certainty: BetaAtlasCertainty }) {
	const tone =
		certainty === "known"
			? "border-emerald-800/25 bg-emerald-600/10 text-emerald-900 dark:border-emerald-300/25 dark:text-emerald-200"
			: certainty === "traditional"
				? "border-amber-800/25 bg-amber-500/10 text-amber-900 dark:border-amber-300/25 dark:text-amber-200"
				: "border-black/15 border-dashed bg-transparent text-neutral-700 dark:border-white/20 dark:text-neutral-300";
	return (
		<span title={CERTAINTY_HINT[certainty]} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${tone}`}>
			{CERTAINTY_LABEL[certainty]}
		</span>
	);
}

export function SourceChip({ source }: { source: BetaLaneSource }) {
	return (
		<span title={SOURCE_HINT[source]} className="inline-flex items-center rounded-full border border-black/10 px-2 py-0.5 text-xs font-bold text-neutral-600 dark:border-white/15 dark:text-[#bbb3a7]">
			{SOURCE_LABEL[source]}
		</span>
	);
}

/** Verses quoted from the bundled KJV, each passage linked into the reader. */
export function Passages({ passages, empty }: { passages: readonly AtlasPassage[]; empty?: string }) {
	if (passages.length === 0) return <p className="text-sm text-neutral-600 dark:text-[#bbb3a7]">{empty ?? "No passages."}</p>;
	return (
		<div className="space-y-4">
			{passages.map((passage) => (
				<figure key={passage.ref}>
					<blockquote className="font-[family-name:var(--font-cormorant)] text-[19px] leading-[1.45] text-[#24281f] dark:text-[#f1eadc]">
						{passage.verses.map((verse) => (
							<span key={verse.verse}>
								<sup className="mr-0.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.verse}</sup>
								{verse.text}{" "}
							</span>
						))}
						{passage.more ? <span aria-hidden className="text-neutral-500">…</span> : null}
					</blockquote>
					<figcaption className="mt-1.5">
						{passage.href ? (
							<Link href={passage.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
								<BookOpen size={15} aria-hidden /> {passage.ref} (KJV){passage.more ? ", read on" : ""}
							</Link>
						) : (
							<span className="text-sm font-bold">{passage.ref} (KJV)</span>
						)}
					</figcaption>
				</figure>
			))}
		</div>
	);
}

/** Reference chips that open the reader. */
export function RefChips({ refs }: { refs: readonly string[] }) {
	return (
		<div className="flex flex-wrap gap-2">
			{refs.map((ref) => {
				const href = readerHrefFor(ref);
				return href ? (
					<Link key={ref} href={href} className={atlasChip}>
						{ref} ›
					</Link>
				) : (
					<span key={ref} className={atlasChip}>
						{ref}
					</span>
				);
			})}
		</div>
	);
}

/** The chat's own deep link: it prefills and focuses, and sending stays the reader's choice. */
export function AskLink({ prompt }: { prompt: string }) {
	return (
		<Link
			href={`/?prompt=${encodeURIComponent(prompt)}`}
			className="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-700/30 bg-amber-500/10 px-4 text-sm font-bold text-amber-900 hover:bg-amber-500/20 dark:border-amber-300/30 dark:text-amber-200"
		>
			<MessageCircleQuestion size={17} aria-hidden /> Ask about this
		</Link>
	);
}

export function ReaderLink({ refText, label = "Open in reader" }: { refText: string; label?: string }) {
	const href = readerHrefFor(refText);
	if (!href) return null;
	return (
		<Link href={href} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#24281f] px-4 text-sm font-bold text-[#f6f2e9] hover:opacity-90 dark:bg-[#e5b664] dark:text-[#1c2118]">
			<BookOpen size={17} aria-hidden /> {label}
		</Link>
	);
}
