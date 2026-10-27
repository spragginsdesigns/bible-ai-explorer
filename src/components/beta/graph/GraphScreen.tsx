"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Search, Sparkles } from "lucide-react";
import { GRAPH_KIND_LABEL, GRAPH_KIND_PLURAL as PLURAL, neighbourhood, searchGraph, type GraphNode, type GraphNodeKind, type StudyGraph } from "@/lib/beta/graph/graph-rules";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import { card, chip, chipOff, chipOn, eyebrow, muted, vaultFetch } from "../vault/vaultUi";
import GraphCanvas from "./GraphCanvas";
import GraphDetail, { SuggestionButtons } from "./GraphDetail";

interface GraphResponse extends StudyGraph {
	suggestable: string[];
}

const FILTERS: GraphNodeKind[] = ["passage", "topic", "note", "study", "chat", "sermon"];

export default function GraphScreen() {
	const { userId } = useAuth();
	// A different account must never see the previous one's graph, even briefly.
	return <GraphContent key={userId ?? "guest"} />;
}

function GraphContent() {
	const pathname = usePathname();
	const params = useSearchParams();
	const [graph, setGraph] = useState<GraphResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [hidden, setHidden] = useState<Set<GraphNodeKind>>(new Set());
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [centre, setCentre] = useState<{ id: string; key: number } | null>(null);

	// The selected node lives in the URL (`?node=`), and a module's `?item=<id>` opens that study.
	const requested = params.get("node") ?? (params.get("item") ? `study:${params.get("item")}` : null);
	const selectedId = graph && requested && graph.nodes.some((node) => node.id === requested) ? requested : null;

	const load = useCallback(async () => {
		try {
			setGraph(await vaultFetch<GraphResponse>("/api/beta/graph"));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Your study graph could not be drawn just now.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Centre once on a node the page was opened with (?node= or ?item=), when the graph first arrives; a tap never moves the view.
	const opened = useRef(requested);
	useEffect(() => {
		const id = opened.current;
		if (!graph || !id) return;
		opened.current = null;
		if (graph.nodes.some((node) => node.id === id)) setCentre((current) => current ?? { id, key: 1 });
	}, [graph]);

	// replaceState, not a navigation: selecting a node must not ask the server for the page again (Next keeps useSearchParams in step).
	const select = useCallback(
		(id: string | null, centre = false) => {
			opened.current = null;
			const next = new URLSearchParams(params.toString());
			next.delete("item");
			if (id) next.set("node", id);
			else next.delete("node");
			const search = next.toString();
			window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
			if (centre && id) setCentre((current) => ({ id, key: (current?.key ?? 0) + 1 }));
		},
		[params, pathname],
	);
	const selectOnCanvas = useCallback((id: string | null) => select(id), [select]);

	const visible = useMemo(() => {
		if (!graph) return null;
		const nodes = graph.nodes.filter((node) => !hidden.has(node.kind) || node.id === selectedId);
		const ids = new Set(nodes.map((node) => node.id));
		return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
	}, [graph, hidden, selectedId]);

	const focus = useMemo(() => {
		if (!graph || !selectedId) return null;
		return new Set([selectedId, ...neighbourhood(graph, selectedId).map(({ node }) => node.id)]);
	}, [graph, selectedId]);

	const results = useMemo(() => (graph && query.trim() ? searchGraph(graph.nodes, query) : []), [graph, query]);
	const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
	const pending = useMemo(() => {
		if (!graph) return [];
		const byId = new Map(graph.nodes.map((node) => [node.id, node]));
		return graph.edges.filter((edge) => edge.kind === "suggested").map((edge) => ({ edge, from: byId.get(edge.source)!, to: byId.get(edge.target)! }));
	}, [graph]);
	const suggestable = useMemo(() => new Set(graph?.suggestable ?? []), [graph]);

	const suggest = async (itemId?: string) => {
		setBusy(itemId ? `suggest:${itemId}` : "suggest");
		setNotice(null);
		try {
			const { suggested } = await vaultFetch<{ suggested: number }>("/api/beta/graph/suggest", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(itemId ? { itemId } : {}),
			});
			setNotice(suggested ? `${suggested} new suggested connection${suggested === 1 ? "" : "s"}, each with its reason.` : "No new connections found. They come from shared topics, shared passages and cross-references between your studies.");
			await load();
		} catch (err) {
			setNotice(err instanceof Error ? err.message : "Connections could not be suggested just now.");
		} finally {
			setBusy(null);
		}
	};

	const answer = async (linkId: string, action: "accept" | "dismiss") => {
		setBusy(`link:${linkId}`);
		try {
			await vaultFetch(`/api/beta/graph/links/${encodeURIComponent(linkId)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});
			setNotice(action === "accept" ? "Connected." : "Dismissed. It will not be suggested again.");
			await load();
		} catch (err) {
			setNotice(err instanceof Error ? err.message : "That connection could not be updated just now.");
		} finally {
			setBusy(null);
		}
	};

	const empty = graph && graph.nodes.length === 0;
	const studies = graph?.counts.study ?? 0;

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/library" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Library
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("graph", "library")} tone={DESTINATION_TILE.library} size="lg" />
				<div className="min-w-0 flex-1">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Living Study Graph</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">See how everything you study connects</p>
				</div>
			</header>

			{error ? (
				<div className={`${card} mt-6 p-5`} role="alert">
					<p className="font-semibold">{error}</p>
					<button type="button" onClick={() => void load()} className={`${chip} ${chipOff} mt-3`}>
						Try again
					</button>
				</div>
			) : !graph ? (
				<p className={`mt-8 ${muted}`} role="status">
					Drawing your study graph…
				</p>
			) : empty ? (
				<div className={`${card} mt-6 p-6`}>
					<h2 className="font-[family-name:var(--font-cormorant)] text-2xl font-semibold">Your graph grows as you study</h2>
					<p className={`mt-2 ${muted}`}>Write a note, highlight a verse, ask a question or start a study, and it will appear here, joined to the passages and topics it touches.</p>
					<div className="mt-4 flex flex-wrap gap-2">
						<Link href="/bible" className={`${chip} ${chipOff}`}>
							Open the Bible
						</Link>
						<Link href="/notes" className={`${chip} ${chipOff}`}>
							Write a note
						</Link>
					</div>
				</div>
			) : (
				<>
					<p className={`mt-4 text-sm ${muted}`}>
						{FILTERS.filter((kind) => graph.counts[kind]).map((kind) => `${graph.counts[kind]} ${(graph.counts[kind] === 1 ? GRAPH_KIND_LABEL[kind] : PLURAL[kind]).toLowerCase()}`).join(" · ")}
						{graph.truncated ? " · only the first 700 are drawn: studies first, then the newest of the rest" : ""}
					</p>

					<div className="relative mt-4">
						<label htmlFor="graph-search" className="sr-only">
							Search the graph
						</label>
						<Search size={18} className={`pointer-events-none absolute left-4 top-3.5 ${muted}`} aria-hidden />
						<input
							id="graph-search"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && results[0]) {
									select(results[0].id, true);
									setQuery("");
								}
							}}
							placeholder="Search passages, topics, notes and studies"
							autoComplete="off"
							className="min-h-12 w-full rounded-2xl border border-black/10 bg-white/60 pl-11 pr-4 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/50 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-[#8f887c]"
						/>
						{query.trim() ? (
							<ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-[#fbf8f1] p-1 shadow-lg dark:border-white/10 dark:bg-[#161a15]" aria-label="Search results">
								{results.length ? (
									results.map((node) => (
										<li key={node.id}>
											<button
												type="button"
												onClick={() => {
													select(node.id, true);
													setQuery("");
												}}
												className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-black/5 dark:hover:bg-white/5"
											>
												<span className={`w-20 shrink-0 text-xs font-bold uppercase tracking-wide ${muted}`}>{GRAPH_KIND_LABEL[node.kind]}</span>
												<span className={`min-w-0 flex-1 truncate font-semibold ${node.kind === "topic" ? "capitalize" : ""}`}>{node.label}</span>
											</button>
										</li>
									))
								) : (
									<li className={`px-3 py-3 text-sm ${muted}`}>Nothing in your graph matches.</li>
								)}
							</ul>
						) : null}
					</div>

					<div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show in the graph">
						{FILTERS.filter((kind) => graph.counts[kind]).map((kind) => {
							const on = !hidden.has(kind);
							return (
								<button
									key={kind}
									type="button"
									aria-pressed={on}
									onClick={() =>
										setHidden((current) => {
											const next = new Set(current);
											if (next.has(kind)) next.delete(kind);
											else next.add(kind);
											return next;
										})
									}
									className={`${chip} ${on ? chipOn : chipOff}`}
								>
									{PLURAL[kind]}
								</button>
							);
						})}
					</div>

					<div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
						<div className="min-w-0">
							{visible ? <GraphCanvas nodes={visible.nodes} edges={visible.edges} selectedId={selectedId} focus={focus} onSelect={selectOnCanvas} centre={centre} /> : null}
							<Legend />
						</div>

						<div className="min-w-0 space-y-5">
							{selected ? (
								<GraphDetail
									graph={graph}
									node={selected}
									actions={{ onSelect: select, onAnswer: answer, onSuggest: (itemId) => void suggest(itemId), busy, canSuggest: (node) => !!node.itemId && suggestable.has(node.itemId) && studies > 1 }}
								/>
							) : (
								<p className={`${card} p-5 text-sm leading-6 ${muted}`}>Tap a passage, topic, note or study to see what it connects to and open it where it lives. Passages sit around the ring in Bible order, starting at the top.</p>
							)}

							<section aria-labelledby="graph-suggestions" className={`${card} p-5`}>
								<h2 id="graph-suggestions" className={eyebrow}>
									Suggested connections
								</h2>
								<p className={`mt-2 text-sm leading-6 ${muted}`}>
									Between your studies, from the topics and passages they share and the cross-references between them. Nothing is suggested until you ask.
								</p>
								<button
									type="button"
									disabled={busy !== null || studies < 2}
									onClick={() => void suggest()}
									className={`${chip} ${chipOn} mt-3 disabled:opacity-60`}
								>
									<Sparkles size={16} aria-hidden /> {busy === "suggest" ? "Looking…" : "Suggest connections"}
								</button>
								{studies < 2 ? <p className={`mt-2 text-sm ${muted}`}>Suggestions need at least two studies.</p> : null}
								{notice ? (
									<p className="mt-3 text-sm font-semibold" role="status">
										{notice}
									</p>
								) : null}
								{pending.length ? (
									<ul className="mt-4 space-y-3">
										{pending.map(({ edge, from, to }) => (
											<li key={edge.id} className="rounded-2xl border border-black/[.07] p-3 dark:border-white/[.07]">
												<p className="text-sm leading-6">{edge.reason}</p>
												<div className="mt-1 flex flex-wrap gap-x-3 text-sm">
													<button type="button" onClick={() => select(from.id, true)} className="min-h-11 font-bold underline decoration-amber-600/50 underline-offset-4">
														{from.label}
													</button>
													<button type="button" onClick={() => select(to.id, true)} className="min-h-11 font-bold underline decoration-amber-600/50 underline-offset-4">
														{to.label}
													</button>
												</div>
												{edge.linkId ? <SuggestionButtons linkId={edge.linkId} busy={busy} onAnswer={(id, action) => void answer(id, action)} /> : null}
											</li>
										))}
									</ul>
								) : null}
							</section>
						</div>
					</div>
				</>
			)}
		</main>
	);
}

function Legend() {
	const dot = "inline-block h-3 w-3 shrink-0 rounded-full";
	return (
		<ul className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs ${muted}`} aria-label="Legend">
			<li className="flex items-center gap-1.5">
				<span className={`${dot} bg-[#4a9dff]`} aria-hidden /> Passage (coloured by section)
			</li>
			<li className="flex items-center gap-1.5">
				<span className={`${dot} border-2 border-[#b98a2e] dark:border-[#e5b664]`} aria-hidden /> Topic
			</li>
			<li className="flex items-center gap-1.5">
				<span className={`${dot} bg-[#24281f] dark:bg-[#f1eadc]`} aria-hidden /> Note
			</li>
			<li className="flex items-center gap-1.5">
				<span className={`${dot} bg-[#e5b664]`} aria-hidden /> Study
			</li>
			<li className="flex items-center gap-1.5">
				<span className={`${dot} bg-[#5d6b74] dark:bg-[#9fb2bf]`} aria-hidden /> Chat
			</li>
			<li className="flex items-center gap-1.5">
				<span className={`${dot} bg-[#8a5a2b] dark:bg-[#d29a62]`} aria-hidden /> Sermon
			</li>
			<li className="flex items-center gap-1.5">
				<span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#b98a2e] dark:border-[#e5b664]" aria-hidden /> Suggested
			</li>
			<li className="flex items-center gap-1.5">
				<span className="inline-block h-0 w-5 border-t-2 border-teal-700/50 dark:border-teal-300/50" aria-hidden /> Cross-reference
			</li>
		</ul>
	);
}
