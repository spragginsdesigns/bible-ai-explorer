"use client";

import { childrenOf, type ConceptMap, type MapNode } from "@/lib/beta/maps/map-rules";
import type { MapTarget } from "./ConceptMapCanvas";

/**
 * The same map as a nested outline (LC-17654): every node and connection in
 * reading order, for a narrow screen, a screen reader or anyone who would
 * rather read down a list than pan a canvas. Interpretations sit side by side
 * here too.
 */
export default function MapOutline({ map, onOpen }: { map: ConceptMap; onOpen: (target: MapTarget) => void }) {
	const root = map.nodes[0];
	if (!root) return null;
	const byId = new Map(map.nodes.map((node) => [node.id, node]));

	const nodeButton = (node: MapNode, large = false) => (
		<button type="button" onClick={() => onOpen({ kind: "node", id: node.id })} className="group flex min-h-11 w-full flex-col items-start rounded-2xl px-3 py-2 text-left hover:bg-black/[.04] dark:hover:bg-white/[.04]">
			<span className={`font-[family-name:var(--font-cormorant)] font-semibold leading-tight group-hover:underline ${large ? "text-[24px]" : "text-[19px]"}`}>{node.label}</span>
			<span className="text-xs font-bold text-amber-800 dark:text-[#e5b664]">{node.refs.join(" · ")}</span>
		</button>
	);

	const branch = (node: MapNode): React.ReactNode => {
		const children = childrenOf(map, node.id);
		if (!children.length) return null;
		if (node.kind === "question") {
			return (
				<div className="mt-1 rounded-[20px] border border-dashed border-amber-700/40 p-3 dark:border-amber-300/35">
					<p className="px-1 text-xs font-bold uppercase tracking-[.14em] text-amber-900/80 dark:text-amber-200/80">Interpretations, side by side · none settled</p>
					<ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
						{children.map((reading) => (
							<li key={reading.id} className="rounded-2xl border border-black/[.08] bg-white/60 dark:border-white/[.08] dark:bg-white/[.03]">
								{nodeButton(reading)}
							</li>
						))}
					</ul>
				</div>
			);
		}
		return (
			<ul className="ml-3 border-l border-black/10 pl-3 dark:border-white/10">
				{children.map((child) => (
					<li key={child.id} className="mt-1">
						{/* The connection itself opens from the node's sheet ("How it connects"). */}
						{child.via?.label && <p className="ml-3 pt-1 text-xs font-bold text-neutral-500 dark:text-neutral-400">{child.via.label} ›</p>}
						{child.kind === "question" && <p className="ml-3 text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-amber-200">Christians read this differently</p>}
						{nodeButton(child)}
						{branch(child)}
					</li>
				))}
			</ul>
		);
	};

	return (
		<nav aria-label="Map outline" className="rounded-[22px] border border-black/[.09] bg-white/35 p-3 dark:border-white/[.09] dark:bg-white/[.025]">
			{nodeButton(root, true)}
			{branch(root)}
			{map.links.length > 0 && (
				<section className="mt-4 border-t border-black/[.08] pt-3 dark:border-white/[.08]">
					<h3 className="px-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">Links across the map</h3>
					<ul className="mt-1">
						{map.links.map((link) => (
							<li key={link.id}>
								<button type="button" onClick={() => onOpen({ kind: "link", id: link.id })} className="flex min-h-11 w-full flex-wrap items-baseline gap-x-1.5 rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.04]">
									<span className="font-bold">{byId.get(link.from)?.label}</span>
									<span className="text-amber-900 dark:text-amber-200">· {link.label} ·</span>
									<span className="font-bold">{byId.get(link.to)?.label}</span>
									<span className="w-full text-xs font-bold text-amber-800 dark:text-[#e5b664]">{link.refs.join(" · ")}</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			)}
		</nav>
	);
}
