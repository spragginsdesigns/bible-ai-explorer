"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Copy, Loader2, PencilLine, ScanSearch, Trash2, X } from "lucide-react";
import { checkConceptMap, focusBranch, MAP_SUMMARY_MAX, MAP_TITLE_MAX, normalizeMapTopics, type ConceptMap } from "@/lib/beta/maps/map-rules";
import { MAP_BOOKS } from "@/lib/beta/maps/passages";
import ConceptMapCanvas, { type MapTarget } from "./ConceptMapCanvas";
import MapOutline from "./MapOutline";
import MapSheet from "./MapSheet";
import NodeEditor from "./NodeEditor";
import { draftStorageKey, readDraft, writeDraft, type StoredDraft } from "./draftStorage";

export type MapScreenMode = "library" | "saved" | "draft";

interface Props {
	mode: MapScreenMode;
	/** Null only for a draft, which is read from this tab's session storage. */
	initialMap: ConceptMap | null;
	itemId?: string;
}

const VIEW_KEY = "sureword:beta-maps:view";
const pill = "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold";
const field = "w-full rounded-2xl border border-black/15 bg-white/80 px-3.5 py-2 outline-none focus:border-amber-700/50 dark:border-white/15 dark:bg-white/[.04] dark:focus:border-amber-300/50";

function originLine(map: ConceptMap, mode: MapScreenMode): string {
	if (mode === "library") return "Ready-made map";
	if (map.origin.kind === "generated") return `Built from the verses for “${map.origin.theme}”`;
	if (map.origin.kind === "library") return "Your copy of a ready-made map";
	return "Your map";
}

export default function MapScreen(props: Props) {
	const { userId } = useAuth();
	// A different account must never see the previous one's draft, even briefly.
	return <MapScreenContent key={userId ?? "guest"} userId={userId ?? null} {...props} />;
}

function MapScreenContent({ mode, initialMap, itemId, userId }: Props & { userId: string | null }) {
	const router = useRouter();
	const [map, setMap] = useState<ConceptMap | null>(initialMap);
	const [saved, setSaved] = useState<ConceptMap | null>(initialMap);
	const [draftInfo, setDraftInfo] = useState<StoredDraft["retrieval"] | null>(null);
	const [draftLoaded, setDraftLoaded] = useState(mode !== "draft");
	const [editing, setEditing] = useState(mode === "draft");
	const [view, setView] = useState<"map" | "outline">("map");
	const [target, setTarget] = useState<MapTarget | null>(null);
	const [editId, setEditId] = useState<string | null>(null);
	const [focusId, setFocusId] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "copy" | "delete" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [topicsText, setTopicsText] = useState(initialMap?.topics.join(", ") ?? "");
	const [fullscreen, setFullscreen] = useState(false);
	const [summaryOpen, setSummaryOpen] = useState(false);
	const canvasBox = useRef<HTMLDivElement>(null);
	const [phoneHeight, setPhoneHeight] = useState<number | null>(null);

	useEffect(() => {
		const stored = window.localStorage.getItem(VIEW_KEY);
		if (stored === "outline" || stored === "map") setView(stored);
	}, []);

	// A draft lives in this tab's session storage until it is saved, so a reload keeps it.
	useEffect(() => {
		if (mode !== "draft" || !userId) return;
		const draft = readDraft(userId);
		if (draft) {
			setMap(draft.map);
			setTopicsText(draft.map.topics.join(", "));
			setDraftInfo(draft.retrieval);
		}
		setDraftLoaded(true);
	}, [mode, userId]);
	useEffect(() => {
		if (mode !== "draft" || !userId || !map || !draftLoaded) return;
		writeDraft(userId, { map, retrieval: draftInfo });
	}, [map, mode, userId, draftLoaded, draftInfo]);

	const dirty = editing && (mode === "draft" || JSON.stringify(map) !== JSON.stringify(saved));
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	// On a phone the canvas takes every drag for itself, so it must fit above the tab bar
	// when the page first opens: a canvas running off the screen could never be scrolled into view.
	useLayoutEffect(() => {
		const measure = () => {
			const box = canvasBox.current;
			if (!box || window.innerWidth >= 1024) {
				setPhoneHeight(null);
				return;
			}
			const tabTop = [...document.querySelectorAll("nav")]
				.map((nav) => nav.getBoundingClientRect())
				.filter((rect) => rect.height > 0 && rect.top > window.innerHeight / 2 && rect.bottom >= window.innerHeight - 2)
				.reduce((top, rect) => Math.min(top, rect.top), window.innerHeight);
			const top = box.getBoundingClientRect().top + window.scrollY;
			setPhoneHeight(Math.max(320, Math.round(tabTop - top - 10)));
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [view, editing, focusId, error, notice, draftLoaded, summaryOpen]);
	useEffect(() => {
		if (!fullscreen) return;
		const exit = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) setFullscreen(false);
		};
		window.addEventListener("keydown", exit);
		return () => window.removeEventListener("keydown", exit);
	}, [fullscreen]);

	const shown = useMemo(() => (map && focusId ? focusBranch(map, focusId) : map), [map, focusId]);
	const focusedNode = focusId ? map?.nodes.find((node) => node.id === focusId) : undefined;

	const setViewMode = (next: "map" | "outline") => {
		setView(next);
		window.localStorage.setItem(VIEW_KEY, next);
	};

	const open = useCallback((next: MapTarget) => {
		if (!map) return;
		if (editing) {
			// In the editor, a connection or link edits from the node it belongs to.
			const nodeId = next.kind === "link" ? map.links.find((link) => link.id === next.id)?.from : next.id;
			setTarget(null);
			setEditId(nodeId ?? null);
			return;
		}
		setEditId(null);
		setTarget(next);
	}, [editing, map]);

	if (!map) {
		return (
			<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
				<Link href="/beta/study/maps" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5"><ArrowLeft size={18} aria-hidden /> Concept Maps</Link>
				{draftLoaded ? (
					<div className="mt-6 rounded-[22px] border border-black/[.09] bg-white/35 p-6 dark:border-white/[.09] dark:bg-white/[.025]">
						<h1 className="font-[family-name:var(--font-cormorant)] text-[32px] font-semibold leading-tight">No draft here</h1>
						<p className="mt-2 leading-7 text-neutral-700 dark:text-[#d9d1c3]">A map you build stays in this tab until you save it. Build one from Concept Maps.</p>
						<Link href="/beta/study/maps" className={`${pill} mt-4 bg-[#24281f] text-white dark:bg-[#e5b664] dark:text-[#1c2118]`}>Build a map</Link>
					</div>
				) : (
					<p className="mt-8 flex items-center gap-2 text-sm text-neutral-600"><Loader2 size={16} className="animate-spin" aria-hidden /> Opening your draft…</p>
				)}
			</main>
		);
	}

	const patchMap = (change: Partial<ConceptMap>) => setMap((current) => (current ? { ...current, ...change } : current));

	const persist = async () => {
		const candidate = { ...map, topics: normalizeMapTopics(topicsText.split(",")) };
		const checked = checkConceptMap(candidate, { books: MAP_BOOKS });
		if (!checked.ok) {
			setError(checked.error.charAt(0).toUpperCase() + checked.error.slice(1) + ".");
			return;
		}
		setBusy("save");
		setError(null);
		try {
			const response = await fetch(mode === "saved" && itemId ? `/api/beta/maps/${itemId}` : "/api/beta/maps", {
				method: mode === "saved" ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ map: checked.value }),
			});
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(body?.error ?? "The map could not be saved.");
			if (mode === "draft") {
				if (userId) window.sessionStorage.removeItem(draftStorageKey(userId));
				router.replace(`/beta/study/maps/${body.map.id}`);
				return;
			}
			setMap(body.map.map);
			setSaved(body.map.map);
			setEditing(false);
			setEditId(null);
			setNotice("Saved. It is in your maps and your Library.");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The map could not be saved.");
		} finally {
			setBusy(null);
		}
	};

	const saveCopy = async () => {
		setBusy("copy");
		setError(null);
		try {
			const response = await fetch("/api/beta/maps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ map }) });
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(body?.error ?? "The copy could not be saved.");
			router.push(`/beta/study/maps/${body.map.id}`);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The copy could not be saved.");
			setBusy(null);
		}
	};

	const remove = async () => {
		if (!itemId) return;
		setBusy("delete");
		const response = await fetch(`/api/beta/maps/${itemId}`, { method: "DELETE" }).catch(() => null);
		if (response?.ok) {
			router.push("/beta/study/maps");
			return;
		}
		setBusy(null);
		setError("The map could not be deleted. Please try again.");
	};

	const cancel = () => {
		if (mode === "draft") {
			if (userId) window.sessionStorage.removeItem(draftStorageKey(userId));
			router.push("/beta/study/maps");
			return;
		}
		setMap(saved);
		setTopicsText(saved?.topics.join(", ") ?? "");
		setEditing(false);
		setEditId(null);
		setError(null);
	};

	const nodeCount = map.nodes.length;
	const questions = map.nodes.filter((node) => node.kind === "question").length;

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-8">
			<Link href="/beta/study/maps" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Concept Maps
			</Link>

			<header className="mt-2">
				<p className="truncate text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">
					{originLine(map, mode)}
					{mode === "library" && <span className="hidden lg:inline"> · reviewed for doctrinal care</span>}
				</p>
				{editing ? (
					<div className="mt-2 space-y-2">
						<label htmlFor="map-title" className="sr-only">Map title</label>
						<input id="map-title" value={map.title} maxLength={MAP_TITLE_MAX} onChange={(event) => patchMap({ title: event.target.value })} className={`${field} font-[family-name:var(--font-cormorant)] text-[28px] font-semibold`} />
						<label htmlFor="map-summary" className="sr-only">Summary</label>
						<textarea id="map-summary" value={map.summary} maxLength={MAP_SUMMARY_MAX} rows={2} onChange={(event) => patchMap({ summary: event.target.value })} placeholder="One or two sentences on what the map shows" className={`${field} resize-y leading-6`} />
						<label htmlFor="map-topics" className="block text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Topics, separated by commas</label>
						<input id="map-topics" value={topicsText} onChange={(event) => setTopicsText(event.target.value)} className={`${field} min-h-11`} />
					</div>
				) : (
					<>
						<h1 className="mt-1 font-[family-name:var(--font-cormorant)] text-[clamp(2rem,7.5vw,3rem)] font-semibold leading-[1.02]">{map.title}</h1>
						{/* On a phone the map leads: the summary keeps to two lines until tapped open. */}
						{map.summary && (
							<>
								<p className="mt-2 hidden max-w-3xl text-[17px] leading-7 text-neutral-700 dark:text-[#d9d1c3] lg:block">{map.summary}</p>
								<button type="button" onClick={() => setSummaryOpen((open) => !open)} aria-expanded={summaryOpen} className="mt-1 block min-h-11 w-full text-left lg:hidden">
									<span className={`text-[16px] leading-6 text-neutral-700 dark:text-[#d9d1c3] ${summaryOpen ? "" : "line-clamp-2"}`}>{map.summary}</span>
									<span className="sr-only">{summaryOpen ? " Show less" : " Show more"}</span>
								</button>
							</>
						)}
						<p className="mt-1 hidden text-sm text-neutral-600 dark:text-[#bbb3a7] lg:block">
							{nodeCount} ideas{questions ? ` · ${questions} ${questions === 1 ? "question" : "questions"} Christians read differently` : ""}
							{draftInfo ? ` · from ${draftInfo.verses} verses retrieved${draftInfo.books.length ? ` in ${draftInfo.books.join(", ")} and beyond` : ""}` : ""}
						</p>
					</>
				)}
			</header>

			<div className="mt-3 flex flex-wrap items-center gap-2 lg:mt-4">
				<div className="flex rounded-full border border-black/10 p-1 dark:border-white/10" role="group" aria-label="Show as">
					{(["map", "outline"] as const).map((item) => (
						<button key={item} type="button" aria-pressed={view === item} onClick={() => setViewMode(item)} className={`min-h-11 rounded-full px-4 text-sm font-bold ${view === item ? "bg-[#24281f] text-white dark:bg-[#f1eadc] dark:text-[#1c2118]" : "text-neutral-600 hover:text-neutral-900 dark:text-[#bbb3a7] dark:hover:text-white"}`}>
							{item === "map" ? "Map" : "Outline"}
						</button>
					))}
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{mode === "library" && (
						<button type="button" onClick={saveCopy} disabled={busy !== null} className={`${pill} bg-[#e5b664] text-[#1c2118] disabled:opacity-60`}>
							{busy === "copy" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Copy size={17} aria-hidden />} Save a copy<span className="hidden sm:inline">&nbsp;to edit</span>
						</button>
					)}
					{mode === "saved" && !editing && (
						<>
							<button type="button" onClick={() => { setEditing(true); setTarget(null); setNotice(null); }} className={`${pill} border border-black/15 hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.04]`}>
								<PencilLine size={17} aria-hidden /> Edit
							</button>
							{confirmDelete ? (
								<button type="button" onClick={remove} disabled={busy !== null} className={`${pill} border border-red-700/40 text-red-800 dark:text-red-300`}>
									{busy === "delete" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Trash2 size={17} aria-hidden />} Delete this map
								</button>
							) : (
								<button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete map" className="flex h-11 w-11 items-center justify-center rounded-full border border-black/15 hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.04]">
									<Trash2 size={17} aria-hidden />
								</button>
							)}
						</>
					)}
					{editing && (
						<>
							<button type="button" onClick={cancel} className={`${pill} border border-black/15 hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.04]`}>
								{mode === "draft" ? "Discard" : "Cancel"}
							</button>
							<button type="button" onClick={persist} disabled={busy !== null} className={`${pill} bg-[#e5b664] text-[#1c2118] disabled:opacity-60`}>
								{busy === "save" && <Loader2 size={17} className="animate-spin" aria-hidden />} Save map
							</button>
						</>
					)}
				</div>
			</div>

			{editing && <p className="mt-3 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-950 dark:bg-amber-300/10 dark:text-amber-100">Editing. Tap any node to change its words, passages and links, or to add nodes under it. Nothing is saved until you press Save map.</p>}
			{error && <p role="alert" className="mt-3 rounded-2xl border border-red-700/30 px-4 py-2.5 text-sm text-red-800 dark:text-red-200">{error}</p>}
			{notice && <p role="status" className="mt-3 rounded-2xl border border-black/10 px-4 py-2.5 text-sm dark:border-white/10">{notice}</p>}

			{focusedNode && (
				<div className="mt-3 flex items-center gap-2 rounded-full border border-amber-700/30 bg-[#fbf3df] py-1 pl-4 pr-1 text-sm dark:border-amber-300/30 dark:bg-[#1d1a10]">
					<ScanSearch size={17} aria-hidden className="shrink-0 text-amber-800 dark:text-amber-200" />
					<span className="min-w-0 flex-1 truncate">Focused on <strong>{focusedNode.label}</strong></span>
					<button type="button" onClick={() => setFocusId(null)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-bold hover:bg-black/5 dark:hover:bg-white/5">
						<X size={16} aria-hidden /> Whole map
					</button>
				</div>
			)}

			<section aria-label="The map" className="mt-4">
				{view === "map" && shown ? (
					<div
						ref={canvasBox}
						style={!fullscreen && phoneHeight ? { height: phoneHeight } : undefined}
						className={`bg-[radial-gradient(circle,rgba(36,40,31,.11)_1px,transparent_1.2px)] [background-size:22px_22px] dark:bg-[radial-gradient(circle,rgba(241,234,220,.09)_1px,transparent_1.2px)] ${
							fullscreen
								? "fixed inset-0 z-[65] flex flex-col bg-[#f6f2e9] dark:bg-[#0d100d]"
								: "-mx-5 h-[66dvh] min-h-[320px] border-y border-black/[.09] dark:border-white/[.09] lg:mx-0 lg:h-[min(72vh,780px)] lg:rounded-[22px] lg:border"
						}`}
					>
						{fullscreen && (
							<div className="flex items-center gap-3 border-b border-black/10 bg-[#f6f2e9] px-4 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] dark:border-white/10 dark:bg-[#0d100d]">
								<p className="min-w-0 flex-1 truncate font-[family-name:var(--font-cormorant)] text-[22px] font-semibold">{focusedNode ? `${map.title} · ${focusedNode.label}` : map.title}</p>
								<button type="button" onClick={() => setFullscreen(false)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
									<X size={17} aria-hidden /> Close
								</button>
							</div>
						)}
						<div className={fullscreen ? "min-h-0 flex-1" : "h-full"}>
							<ConceptMapCanvas
								map={shown}
								frameKey={`${itemId ?? "map"}:${focusId ?? "all"}:${fullscreen ? "full" : "inline"}`}
								selected={target}
								onOpen={open}
								fullscreen={fullscreen}
								onToggleFullscreen={() => setFullscreen((value) => !value)}
								label={`${map.title}. Use Tab to move between ideas and Enter to read one.`}
							/>
						</div>
					</div>
				) : shown ? (
					<MapOutline map={shown} onOpen={open} />
				) : null}
				<p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
					{view === "map" ? "Drag to move, pinch or use the buttons to zoom. Tap any idea, line label or reading to open its verses." : "Tap any idea to open its verses."} Notes are SureWord&rsquo;s summary; the verses are the KJV.
				</p>
			</section>

			{target && !editing && (
				<MapSheet
					map={map}
					target={target}
					focusedId={focusId}
					onClose={() => setTarget(null)}
					onOpen={setTarget}
					onFocusBranch={(id) => {
						setFocusId(id);
						setTarget(null);
						setViewMode("map");
					}}
				/>
			)}
			{editId && editing && <NodeEditor key={editId} map={map} nodeId={editId} onChange={setMap} onClose={() => setEditId(null)} onEdit={setEditId} />}
		</main>
	);
}
