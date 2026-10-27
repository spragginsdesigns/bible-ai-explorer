"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen, ChevronRight, Loader2, ScanSearch, X } from "lucide-react";
import { useModalFocus } from "@/components/useModalFocus";
import { ancestorsOf, childrenOf, passageReaderHref, type ConceptMap, type MapNode } from "@/lib/beta/maps/map-rules";
import { readPassage } from "@/lib/beta/maps/passages";
import type { MapTarget } from "./ConceptMapCanvas";
import { usePassageTexts } from "./usePassageTexts";

const eyebrow = "text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]";

function readerHref(ref: string): string | null {
	const passage = readPassage(ref);
	return passage ? passageReaderHref(passage) : null;
}

/** The KJV text of each passage, with its reference and a way into the reader. */
function Passages({ refs, compact = false }: { refs: readonly string[]; compact?: boolean }) {
	const states = usePassageTexts(refs, compact ? 8 : 40);
	return (
		<div className="space-y-4">
			{refs.map((ref) => {
				const state = states[ref];
				const href = readerHref(ref);
				return (
					<section key={ref} aria-label={ref}>
						<div className="flex items-center justify-between gap-3">
							<h4 className="text-sm font-bold text-amber-800 dark:text-[#e5b664]">{ref} <span className="font-normal text-neutral-500 dark:text-neutral-400">KJV</span></h4>
							{href && (
								<Link href={href} aria-label={`Open ${ref} in the reader`} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
									<ArrowUpRight size={19} aria-hidden />
								</Link>
							)}
						</div>
						{!state || state.status === "loading" ? (
							<p className="flex items-center gap-2 py-2 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Opening the verses…</p>
						) : state.status === "error" ? (
							<p className="py-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">These verses could not be opened here. Open them in the reader.</p>
						) : (
							<div className={`font-[family-name:var(--font-cormorant)] ${compact ? "text-[17px] leading-[1.5]" : "text-[19px] leading-[1.55]"}`}>
								{state.text.chapters.map((chapter, index) => (
									<p key={chapter.chapter} className={index ? "mt-2" : ""}>
										{chapter.verses.map((verse) => (
											<span key={verse.verse}>
												<sup className="mr-0.5 font-sans text-xs font-bold text-neutral-500 dark:text-neutral-400">{state.text.chapters.length > 1 ? `${chapter.chapter}:${verse.verse}` : verse.verse}</sup>
												{verse.text}{" "}
											</span>
										))}
									</p>
								))}
								{state.text.truncated && href && (
									<Link href={href} className="mt-1 inline-flex min-h-11 items-center font-sans text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">Continue in the reader</Link>
								)}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-6">
			<h3 className={eyebrow}>{title}</h3>
			<div className="mt-3">{children}</div>
		</section>
	);
}

interface Props {
	map: ConceptMap;
	target: MapTarget;
	onClose: () => void;
	onOpen: (target: MapTarget) => void;
	onFocusBranch: (nodeId: string) => void;
	/** The node the canvas is focused on, if any, so "Focus this branch" is not offered for it again. */
	focusedId: string | null;
}

/**
 * What tapping a node, a connection or a cross-link opens (LC-17654): its
 * passages printed from the bundled KJV, SureWord's short note kept apart from
 * them, and the way into the reader. A question shows its interpretations
 * side by side. A bottom sheet on a phone, a side panel on a wide screen.
 */
export default function MapSheet({ map, target, onClose, onOpen, onFocusBranch, focusedId }: Props) {
	const ref = useModalFocus<HTMLDivElement>({ open: true, onClose });
	const byId = new Map(map.nodes.map((node) => [node.id, node]));
	let title = "";
	let eyebrowText = "";
	let body: ReactNode = null;
	let primaryRef: string | null = null;
	let focusable: MapNode | null = null;

	if (target.kind === "node") {
		const node = byId.get(target.id);
		if (!node) return null;
		const parent = node.parentId ? byId.get(node.parentId) : undefined;
		const path = ancestorsOf(map, node.id).map((item) => item.label);
		const children = childrenOf(map, node.id);
		const links = map.links.filter((link) => link.from === node.id || link.to === node.id);
		title = node.label;
		eyebrowText = path.length ? path.join(" › ") : "The whole map";
		primaryRef = node.refs[0] ?? null;
		focusable = children.length && node.parentId && focusedId !== node.id ? node : null;
		body = (
			<>
				{node.kind === "question" && (
					<p className="mt-3 inline-flex rounded-full border border-amber-700/35 bg-[#fbf3df] px-3 py-1 text-xs font-bold text-amber-900 dark:border-amber-300/35 dark:bg-[#1d1a10] dark:text-amber-200">Christians read this differently. These are interpretations; none is presented as settled.</p>
				)}
				{node.kind === "reading" && (
					<p className="mt-3 inline-flex rounded-full border border-dashed border-amber-700/45 px-3 py-1 text-xs font-bold text-amber-900 dark:border-amber-300/45 dark:text-amber-200">Interpretation{parent ? ` · one reading of “${parent.label}”` : ""}</p>
				)}
				{node.note && (
					<>
						<p className="mt-4 text-[17px] leading-7">{node.note}</p>
						<p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">SureWord&rsquo;s note. The verses are the King James text.</p>
					</>
				)}
				{node.kind === "question" && children.length > 0 && (
					<Section title="The readings, side by side">
						<div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2">
							{children.map((reading, index) => (
								<article key={reading.id} className="w-[min(82%,320px)] shrink-0 snap-start rounded-[20px] border border-dashed border-amber-700/45 bg-white/60 p-4 dark:border-amber-300/40 dark:bg-white/[.03]">
									<p className="text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-amber-200">Interpretation {index + 1} of {children.length}</p>
									<h4 className="mt-1 font-[family-name:var(--font-cormorant)] text-[21px] font-semibold leading-tight">{reading.label}</h4>
									{reading.note && <p className="mt-2 text-[15px] leading-6">{reading.note}</p>}
									<p className="mt-2 text-sm font-bold text-amber-800 dark:text-[#e5b664]">{reading.refs.join(" · ")}</p>
									<button type="button" onClick={() => onOpen({ kind: "node", id: reading.id })} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-neutral-700 hover:underline dark:text-neutral-200">
										Read its verses <ChevronRight size={16} aria-hidden />
									</button>
								</article>
							))}
						</div>
					</Section>
				)}
				<Section title={node.kind === "question" ? "The passage in question" : "The verses"}>
					<Passages refs={node.refs} />
				</Section>
				{parent && node.via && (
					<Section title="How it connects">
						<button type="button" onClick={() => onOpen({ kind: "connection", id: node.id })} className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-black/10 px-4 py-2.5 text-left hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.03]">
							<span className="min-w-0 flex-1 text-sm">
								<span className="font-bold">{parent.label}</span>
								<span className="text-neutral-500 dark:text-neutral-400"> {node.via.label ? `· ${node.via.label} ·` : "→"} </span>
								<span className="font-bold">{node.label}</span>
								<span className="block text-xs font-bold text-amber-800 dark:text-[#e5b664]">{node.via.refs.join(" · ")}</span>
							</span>
							<ChevronRight size={18} aria-hidden className="shrink-0 text-neutral-500" />
						</button>
					</Section>
				)}
				{links.length > 0 && (
					<Section title="Linked across the map">
						<ul className="space-y-2">
							{links.map((link) => {
								const other = byId.get(link.from === node.id ? link.to : link.from);
								return (
									<li key={link.id}>
										<button type="button" onClick={() => onOpen({ kind: "link", id: link.id })} className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-dashed border-amber-700/40 px-4 py-2.5 text-left hover:bg-black/[.03] dark:border-amber-300/35 dark:hover:bg-white/[.03]">
											<span className="min-w-0 flex-1 text-sm">
												<span className="text-amber-900 dark:text-amber-200">{link.label}</span>
												<span className="text-neutral-500 dark:text-neutral-400"> · </span>
												<span className="font-bold">{other?.label}</span>
											</span>
											<ChevronRight size={18} aria-hidden className="shrink-0 text-neutral-500" />
										</button>
									</li>
								);
							})}
						</ul>
					</Section>
				)}
			</>
		);
	} else {
		const link = target.kind === "link" ? map.links.find((item) => item.id === target.id) : null;
		const child = target.kind === "connection" ? byId.get(target.id) : null;
		const from = link ? byId.get(link.from) : child?.parentId ? byId.get(child.parentId) : undefined;
		const to = link ? byId.get(link.to) : child ?? undefined;
		const relation = link ? link.label : child?.via?.label ?? "";
		const refs = link ? link.refs : child?.via?.refs ?? [];
		if (!from || !to) return null;
		title = relation || `${from.label} to ${to.label}`;
		eyebrowText = link ? "A link across the map" : "A connection";
		primaryRef = refs[0] ?? null;
		body = (
			<>
				<div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
					{[from, null, to].map((item, index) =>
						item ? (
							<button key={item.id} type="button" onClick={() => onOpen({ kind: "node", id: item.id })} className="min-h-11 rounded-2xl border border-black/10 px-3 py-2 text-left font-[family-name:var(--font-cormorant)] text-[18px] font-semibold leading-tight hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.03]">
								{item.label}
							</button>
						) : (
							<ChevronRight key={`arrow-${index}`} size={20} aria-hidden className="text-neutral-500" />
						),
					)}
				</div>
				<Section title="The verses that show it">
					<Passages refs={refs} />
				</Section>
			</>
		);
	}

	const primaryHref = primaryRef ? readerHref(primaryRef) : null;
	return (
		<div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 lg:items-stretch lg:justify-end lg:bg-black/20" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-labelledby="map-sheet-title"
				tabIndex={-1}
				className="flex max-h-[82dvh] w-full max-w-2xl flex-col rounded-t-[28px] border border-black/10 bg-[#f6f2e9] text-[#24281f] outline-none dark:border-white/10 dark:bg-[#111710] dark:text-[#f1eadc] lg:max-h-none lg:w-[460px] lg:rounded-none lg:rounded-l-[28px]"
			>
				<header className="flex items-start gap-3 border-b border-black/10 px-5 pb-3 pt-4 dark:border-white/10">
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-bold text-neutral-500 dark:text-neutral-400">{eyebrowText}</p>
						<h2 id="map-sheet-title" className="mt-1 font-[family-name:var(--font-cormorant)] text-[28px] font-semibold leading-[1.08]">{title}</h2>
					</div>
					<button type="button" aria-label="Close" onClick={onClose} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5">
						<X size={22} aria-hidden />
					</button>
				</header>
				<div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{body}</div>
				{(primaryHref || focusable) && (
					<footer className="flex gap-2.5 border-t border-black/10 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/10">
						{focusable && (
							<button type="button" onClick={() => onFocusBranch(focusable.id)} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-black/15 text-sm font-bold hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.04]">
								<ScanSearch size={18} aria-hidden /> Focus this branch
							</button>
						)}
						{primaryHref && (
							<Link href={primaryHref} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#e5b664] text-sm font-bold text-[#1c2118] hover:bg-[#ddb05d]">
								<BookOpen size={18} aria-hidden /> Open in reader
							</Link>
						)}
					</footer>
				)}
			</div>
		</div>
	);
}
