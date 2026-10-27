"use client";

import Link from "next/link";
import { History } from "lucide-react";
import { VAULT_KIND_LABEL, type VaultEntry } from "@/lib/beta/vault/vault-rules";
import { KindTile, card, muted, shortDate, smallChip, tapChip } from "./vaultUi";

/**
 * One thing studied, as a card: what kind it is and when, its title (which
 * opens it where it lives in SureWord), its own words, the passages and topics
 * it touches, and the way into its history over time.
 */
export default function VaultEntryCard({
	entry,
	number,
	onPassage,
	onTopic,
	onOverTime,
	highlighted = false,
}: {
	entry: VaultEntry & { answer?: string | null };
	/** Ask's source number, shown as "[3]". */
	number?: number;
	onPassage?: (label: string) => void;
	onTopic?: (topic: string) => void;
	onOverTime?: (subject: string) => void;
	highlighted?: boolean;
}) {
	const quote = entry.kind === "highlight" || entry.kind === "verse";
	const subject = entry.passages.find((chip) => chip.filter)?.filter ?? entry.topics[0] ?? null;
	const meaningOnly = entry.matched?.includes("meaning") && !entry.matched.includes("words");
	const passages = entry.passages;
	return (
		<article
			id={number ? `vault-source-${number}` : undefined}
			className={`${card} min-w-0 scroll-mt-24 px-4 py-4 sm:px-5 ${highlighted ? "border-amber-700/50 dark:border-amber-300/50" : ""}`}
		>
			<div className="flex items-center gap-3">
				<KindTile kind={entry.kind} />
				<p className={`min-w-0 flex-1 truncate text-sm font-semibold ${muted}`}>
					{number ? <span className="mr-1.5 font-bold text-amber-800 dark:text-[#e5b664]">[{number}]</span> : null}
					{VAULT_KIND_LABEL[entry.kind]} · {shortDate(entry.date)}
					{entry.detail ? <span className="font-normal"> · {entry.detail}</span> : null}
				</p>
			</div>
			<h3 className="mt-3 font-[family-name:var(--font-cormorant)] text-[24px] font-semibold leading-tight">
				<Link href={entry.href} className="rounded hover:underline focus-visible:outline-amber-600">
					{entry.title}
				</Link>
			</h3>
			{entry.excerpt ? (
				quote ? (
					<blockquote className="mt-2 border-l-2 border-[#e5b664] pl-3 font-[family-name:var(--font-cormorant)] text-[19px] italic leading-7 text-neutral-800 dark:text-[#e6dfd1]">
						{entry.excerpt}
					</blockquote>
				) : (
					<p className="mt-1.5 whitespace-pre-line text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{entry.excerpt}</p>
				)
			) : null}
			{entry.answer ? (
				<div className="mt-3 rounded-2xl bg-black/[.035] px-3.5 py-3 dark:bg-white/[.04]">
					<p className="text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]">SureWord answered</p>
					<p className="mt-1 text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">{entry.answer}</p>
				</div>
			) : null}
			{entry.links && (entry.links.outgoing.length > 0 || entry.links.incoming.length > 0) ? (
				<p className={`mt-2 text-sm leading-6 ${muted}`}>
					{entry.links.outgoing.length ? <>Links to {entry.links.outgoing.map((title) => `[[${title}]]`).join(", ")}</> : null}
					{entry.links.outgoing.length && entry.links.incoming.length ? " · " : null}
					{entry.links.incoming.length ? <>Linked from {entry.links.incoming.map((title) => `[[${title}]]`).join(", ")}</> : null}
				</p>
			) : null}
			{passages.length || entry.topics.length || meaningOnly ? (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{passages.map(({ label, filter }) =>
						onPassage && filter ? (
							<button key={label} type="button" onClick={() => onPassage(filter)} className={tapChip} aria-label={`Everything on ${filter}`}>
								{label}
							</button>
						) : (
							<span key={label} className={smallChip}>{label}</span>
						),
					)}
					{entry.topics.map((topic) =>
						onTopic ? (
							<button key={topic} type="button" onClick={() => onTopic(topic)} className={tapChip} aria-label={`Everything about ${topic}`}>
								#{topic}
							</button>
						) : (
							<span key={topic} className={smallChip}>#{topic}</span>
						),
					)}
					{meaningOnly ? <span className={`text-xs font-semibold ${muted}`}>Found by meaning</span> : null}
				</div>
			) : null}
			{onOverTime && subject ? (
				<div className="mt-1 flex justify-end">
					<button
						type="button"
						onClick={() => onOverTime(subject)}
						className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]"
					>
						<History size={16} aria-hidden /> {subject} over time
					</button>
				</div>
			) : null}
		</article>
	);
}
