"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Sparkles, X } from "lucide-react";
import { GRAPH_KIND_LABEL, GRAPH_KIND_PLURAL, followTopic, neighbourhood, type GraphEdge, type GraphNode, type StudyGraph } from "@/lib/beta/graph/graph-rules";
import { card, eyebrow, muted, tapChip } from "../vault/vaultUi";

const OPEN_LABEL: Record<GraphNode["kind"], string> = {
	passage: "Open in the reader",
	topic: "",
	note: "Open note",
	chat: "Open chat",
	sermon: "Open sermon study",
	study: "Open study",
};

const EDGE_LABEL: Record<GraphEdge["kind"], string> = {
	passage: "Studies this passage",
	topic: "Topic",
	wikilink: "Wikilink",
	link: "Connected",
	suggested: "Suggested",
	crossref: "Cross-reference",
	contains: "Part of",
};

export function formatDate(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function monthLabel(month: string): string {
	const [year, m] = month.split("-").map(Number);
	if (!year || !m) return "Undated";
	return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function edgeNote(edge: GraphEdge, node: GraphNode, self: GraphNode): string | null {
	if (edge.kind === "crossref") return edge.verses?.map(([a, b]) => `${a} ↔ ${b}`).join(" · ") ?? null;
	if (edge.kind === "link" || edge.kind === "suggested") return edge.reason ?? null;
	if (edge.kind === "wikilink") return edge.both ? `Links to ${node.label}, and back` : edge.source === self.id ? `Links to ${node.label}` : `Linked from ${node.label} (a backlink)`;
	if (edge.kind === "contains") return edge.source === self.id ? "Inside this study" : "This study is inside it";
	return null;
}

export interface DetailActions {
	onSelect: (id: string, centre?: boolean) => void;
	onAnswer: (linkId: string, action: "accept" | "dismiss") => void;
	onSuggest: (itemId: string) => void;
	busy: string | null;
	canSuggest: (node: GraphNode) => boolean;
}

export default function GraphDetail({ graph, node, actions }: { graph: StudyGraph; node: GraphNode; actions: DetailActions }) {
	const around = neighbourhood(graph, node.id);
	const bookName = (order: number) => graph.nodes.find((n) => n.kind === "passage" && n.book === order)?.label.replace(/\s+\d+$/, "") ?? `Book ${order}`;
	const trail = node.kind === "topic" ? followTopic(graph, node.id, bookName) : null;
	const groups = new Map<string, { node: GraphNode; edge: GraphEdge }[]>();
	for (const entry of around) {
		const key = entry.edge.kind === "suggested" ? "Suggested connections" : entry.edge.kind === "link" ? "Connections" : GRAPH_KIND_PLURAL[entry.node.kind];
		const list = groups.get(key) ?? [];
		list.push(entry);
		groups.set(key, list);
	}

	return (
		<section aria-labelledby="graph-detail-title" className={`${card} p-5`}>
			<p className={eyebrow}>{GRAPH_KIND_LABEL[node.kind]}</p>
			<h2 id="graph-detail-title" className="mt-1 font-[family-name:var(--font-cormorant)] text-[1.9rem] font-semibold leading-tight">
				{node.kind === "topic" ? <span className="capitalize">{node.label}</span> : node.label}
			</h2>
			{node.detail || node.date ? (
				<p className={`mt-1 text-sm ${muted}`}>{[node.detail, node.date ? `Last studied ${formatDate(node.date)}` : null].filter(Boolean).join(" · ")}</p>
			) : null}

			<div className="mt-4 flex flex-wrap gap-2">
				{node.href ? (
					<Link href={node.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#24281f] px-4 text-sm font-bold text-white hover:bg-black dark:bg-[#e5b664] dark:text-[#1c2118] dark:hover:bg-[#efc679]">
						{OPEN_LABEL[node.kind]} <ArrowUpRight size={16} aria-hidden />
					</Link>
				) : null}
				{node.kind === "passage" ? (
					<Link href={`/connections?book=${node.book}&chapter=${node.chapter}`} className={`${tapChip} gap-1.5`}>
						Its cross-references in Connections
					</Link>
				) : null}
				{node.kind === "topic" ? (
					<Link href={`/beta/library/vault?view=time&subject=${encodeURIComponent(node.label)}`} className={`${tapChip} gap-1.5`}>
						Over time in the Vault
					</Link>
				) : null}
				{node.kind === "study" && node.itemId && actions.canSuggest(node) ? (
					<button type="button" disabled={actions.busy !== null} onClick={() => actions.onSuggest(node.itemId!)} className={`${tapChip} gap-1.5 disabled:opacity-60`}>
						<Sparkles size={15} aria-hidden /> {actions.busy === `suggest:${node.itemId}` ? "Looking…" : "Find connections for this study"}
					</button>
				) : null}
			</div>

			{trail ? (
				<div className="mt-6 space-y-5">
					<div>
						<h3 className={eyebrow}>Across books</h3>
						{trail.books.length ? (
							<ul className="mt-2 space-y-2">
								{trail.books.map((book) => (
									<li key={book.book} className="flex flex-wrap items-center gap-2">
										<span className="min-w-24 text-sm font-bold">{book.name}</span>
										{book.passages.map((passage) => (
											<button key={passage.id} type="button" onClick={() => actions.onSelect(passage.id, true)} className={tapChip}>
												{passage.label}
											</button>
										))}
									</li>
								))}
							</ul>
						) : (
							<p className={`mt-2 text-sm ${muted}`}>Nothing studied on this topic names a passage yet.</p>
						)}
					</div>
					<div>
						<h3 className={eyebrow}>Over time</h3>
						<ol className="mt-2 space-y-3">
							{trail.months.map((month) => (
								<li key={month.month}>
									<p className="text-sm font-bold">{monthLabel(month.month)}</p>
									<ul className="mt-1 space-y-1">
										{month.nodes.map((entry) => (
											<li key={entry.id}>
												<button type="button" onClick={() => actions.onSelect(entry.id, true)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5">
													<span className={`shrink-0 text-xs font-bold uppercase tracking-wide ${muted}`}>{GRAPH_KIND_LABEL[entry.kind]}</span>
													<span className="min-w-0 flex-1 truncate">{entry.label}</span>
													<span className={`shrink-0 text-xs ${muted}`}>{formatDate(entry.date)}</span>
												</button>
											</li>
										))}
									</ul>
								</li>
							))}
						</ol>
					</div>
				</div>
			) : null}

			{node.folded?.length ? (
				<div className="mt-6">
					<h3 className={eyebrow}>Highlighted, learned and read here</h3>
					<ul className="mt-2 space-y-1">
						{node.folded.slice(0, 12).map((item, i) => (
							<li key={`${item.href}-${i}`}>
								<Link href={item.href} className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
									<span className={`shrink-0 text-xs font-bold uppercase tracking-wide ${muted}`}>{item.kind === "verse" ? "Learning" : item.kind === "highlight" ? "Highlight" : "Read"}</span>
									<span className="min-w-0 flex-1 truncate">{item.label}</span>
									<span className={`shrink-0 text-xs ${muted}`}>{formatDate(item.date)}</span>
								</Link>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{[...groups.entries()].map(([title, entries]) => (
				<div key={title} className="mt-6">
					<h3 className={eyebrow}>
						{title} <span className="font-semibold normal-case tracking-normal">({entries.length})</span>
					</h3>
					<ul className="mt-2 space-y-2">
						{entries.slice(0, 40).map(({ node: other, edge }) => {
							const note = edgeNote(edge, other, node);
							return (
								<li key={edge.id} className="rounded-2xl border border-black/[.07] p-2 dark:border-white/[.07]">
									<button type="button" onClick={() => actions.onSelect(other.id, true)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
										<span className={`shrink-0 text-xs font-bold uppercase tracking-wide ${muted}`}>{edge.kind === "passage" || edge.kind === "topic" ? GRAPH_KIND_LABEL[other.kind] : EDGE_LABEL[edge.kind]}</span>
										<span className={`min-w-0 flex-1 truncate font-semibold ${other.kind === "topic" ? "capitalize" : ""}`}>{other.label}</span>
									</button>
									{note ? <p className="px-2 pb-1 text-sm leading-6 text-neutral-700 dark:text-[#d9d1c3]">{note}</p> : null}
									{edge.kind === "suggested" && edge.linkId ? (
										<SuggestionButtons linkId={edge.linkId} busy={actions.busy} onAnswer={actions.onAnswer} />
									) : null}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</section>
	);
}

export function SuggestionButtons({ linkId, busy, onAnswer }: { linkId: string; busy: string | null; onAnswer: (linkId: string, action: "accept" | "dismiss") => void }) {
	return (
		<div className="flex gap-2 px-2 pb-1 pt-1">
			<button type="button" disabled={busy !== null} onClick={() => onAnswer(linkId, "accept")} className={`${tapChip} gap-1 disabled:opacity-60`}>
				<Check size={15} aria-hidden /> Connect
			</button>
			<button type="button" disabled={busy !== null} onClick={() => onAnswer(linkId, "dismiss")} className={`${tapChip} gap-1 disabled:opacity-60`}>
				<X size={15} aria-hidden /> Not related
			</button>
		</div>
	);
}
