"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Maximize2, Minimize2, Minus, Plus, Scan } from "lucide-react";
import {
	fitView,
	initialView,
	layoutConceptMap,
	neighbourNode,
	panToReveal,
	zoomAround,
	type ConceptMap,
	type MapNode,
	type MapView,
} from "@/lib/beta/maps/map-rules";

/** How far a pointer may travel before a press becomes a pan instead of a tap. */
const TAP_SLOP = 7;
/** Room a revealed node keeps above the bottom edge: the zoom toolbar (52px) sits 12px up from it. */
const TOOLBAR_CLEARANCE = 84;

export type MapTarget = { kind: "node" | "link" | "connection"; id: string };

interface Props {
	map: ConceptMap;
	/** Changing it re-frames the view (a new map, or a branch focused); edits keep the view. */
	frameKey: string;
	selected: MapTarget | null;
	onOpen: (target: MapTarget) => void;
	label: string;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
}

function nodeTone(node: MapNode, depth: number): string {
	if (depth === 0) return "border-transparent bg-[#24281f] text-[#f6f2e9] dark:bg-[#e5b664] dark:text-[#1c2118]";
	if (node.kind === "question") return "border-amber-700/45 bg-[#fbf3df] dark:border-amber-300/40 dark:bg-[#1d1a10]";
	if (node.kind === "reading") return "border-dashed border-amber-700/50 bg-white/80 dark:border-amber-300/45 dark:bg-[#151913]";
	if (depth === 1) return "border-black/[.14] bg-white dark:border-white/[.14] dark:bg-[#1a1f18]";
	return "border-black/[.09] bg-white/70 dark:border-white/[.09] dark:bg-[#141813]";
}

/**
 * The pannable, zoomable map (LC-17654). Nodes are real buttons laid out by
 * `layoutConceptMap` on one transformed layer, with the connections drawn in
 * SVG beneath them. Drag or swipe to pan, pinch or Ctrl+wheel (a trackpad
 * pinch) to zoom, wheel to pan; tap a node to read it. With the keyboard, Tab
 * reaches every node in reading order, arrows travel the tree (right to the
 * first child, left to the parent, up and down between siblings), and + / - /
 * 0 zoom and fit. No blur, glow or animation on the repeating nodes.
 */
export default function ConceptMapCanvas({ map, frameKey, selected, onOpen, label, fullscreen, onToggleFullscreen }: Props) {
	const layout = useMemo(() => layoutConceptMap(map), [map]);
	const viewportRef = useRef<HTMLDivElement>(null);
	const layerRef = useRef<HTMLDivElement>(null);
	const view = useRef<MapView>({ x: 0, y: 0, scale: 1 });
	const [zoom, setZoom] = useState(100);
	const size = useRef({ width: 0, height: 0 });
	const framed = useRef<string | null>(null);
	const moved = useRef(false);
	/** Until the reader pans or zooms, a resize re-frames the map (the phone height settles after first paint). */
	const interacted = useRef(false);

	const apply = useCallback((next: MapView, commit = true, byReader = true) => {
		if (byReader) interacted.current = true;
		view.current = next;
		const layer = layerRef.current;
		if (layer) layer.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
		if (commit) setZoom(Math.round(next.scale * 100));
	}, []);

	const frame = useCallback(() => {
		const { width, height } = size.current;
		if (!width || !height) return;
		apply(initialView(layout, { width, height }, map.nodes[0]?.id ?? ""), true, false);
		framed.current = frameKey;
		interacted.current = false;
	}, [apply, layout, map.nodes, frameKey]);

	// Track the viewport, and frame the map the first time it has a size (and on every new frame key).
	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const measure = () => {
			const rect = viewport.getBoundingClientRect();
			const changed = rect.width !== size.current.width || rect.height !== size.current.height;
			size.current = { width: rect.width, height: rect.height };
			if (framed.current !== frameKey || (changed && !interacted.current)) frame();
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [frame, frameKey]);

	// Edits re-lay the map without moving the view; only re-apply the transform.
	useLayoutEffect(() => {
		apply(view.current, false, false);
	}, [layout, apply]);

	const zoomBy = useCallback((factor: number) => {
		const { width, height } = size.current;
		apply(zoomAround(view.current, factor, width / 2, height / 2));
	}, [apply]);
	const fit = useCallback(() => {
		apply(fitView(layout, size.current));
	}, [apply, layout]);

	// Focusing a node off screen (Tab) makes the browser scroll this overflow-hidden box to it, before
	// the focus event in some browsers and after it in others. Turn that scroll into a pan, so the
	// transform stays the one source of where the map is.
	const absorbScroll = useCallback(() => {
		const viewport = viewportRef.current;
		if (!viewport || (!viewport.scrollLeft && !viewport.scrollTop)) return;
		const { scrollLeft, scrollTop } = viewport;
		viewport.scrollLeft = 0;
		viewport.scrollTop = 0;
		apply({ ...view.current, x: view.current.x - scrollLeft, y: view.current.y - scrollTop }, false);
	}, [apply]);

	// Pointer pan and pinch. Window listeners, not pointer capture, so a tap still clicks the node under it.
	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const pointers = new Map<number, { x: number; y: number }>();
		let start = { x: 0, y: 0 };
		let pinch: { distance: number; mid: { x: number; y: number } } | null = null;
		const local = (event: PointerEvent) => {
			const rect = viewport.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		};
		const pinchState = () => {
			const [a, b] = [...pointers.values()];
			return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
		};
		const onMove = (event: PointerEvent) => {
			const previous = pointers.get(event.pointerId);
			if (!previous) return;
			const point = local(event);
			pointers.set(event.pointerId, point);
			if (pointers.size >= 2) {
				const next = pinchState();
				if (pinch) {
					const zoomed = zoomAround(view.current, next.distance / pinch.distance, next.mid.x, next.mid.y);
					apply({ ...zoomed, x: zoomed.x + next.mid.x - pinch.mid.x, y: zoomed.y + next.mid.y - pinch.mid.y }, false);
				}
				pinch = next;
				moved.current = true;
				return;
			}
			if (!moved.current && Math.hypot(point.x - start.x, point.y - start.y) < TAP_SLOP) return;
			moved.current = true;
			apply({ ...view.current, x: view.current.x + point.x - previous.x, y: view.current.y + point.y - previous.y }, false);
		};
		const onUp = (event: PointerEvent) => {
			pointers.delete(event.pointerId);
			pinch = pointers.size >= 2 ? pinchState() : null;
			if (pointers.size === 0) {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				window.removeEventListener("pointercancel", onUp);
				setZoom(Math.round(view.current.scale * 100));
			}
		};
		const onDown = (event: PointerEvent) => {
			if (event.pointerType === "mouse" && event.button !== 0) return;
			if ((event.target as Element | null)?.closest("[data-map-toolbar]")) {
				// A toolbar press is never a pan, and must not inherit the last gesture's "moved".
				moved.current = false;
				return;
			}
			if (pointers.size === 0) {
				moved.current = false;
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
			}
			const point = local(event);
			pointers.set(event.pointerId, point);
			start = point;
			pinch = pointers.size >= 2 ? pinchState() : null;
		};
		// A trackpad pinch arrives as a wheel event with ctrlKey; a plain wheel pans, as on a whiteboard.
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = viewport.getBoundingClientRect();
			if (event.ctrlKey || event.metaKey) {
				apply(zoomAround(view.current, Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top));
			} else {
				apply({ ...view.current, x: view.current.x - event.deltaX, y: view.current.y - event.deltaY }, false);
			}
		};
		const onScroll = absorbScroll;
		viewport.addEventListener("pointerdown", onDown);
		viewport.addEventListener("wheel", onWheel, { passive: false });
		viewport.addEventListener("scroll", onScroll);
		return () => {
			viewport.removeEventListener("pointerdown", onDown);
			viewport.removeEventListener("wheel", onWheel);
			viewport.removeEventListener("scroll", onScroll);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [apply, absorbScroll]);

	// A focused node comes fully into view, clear of the zoom toolbar along the bottom. Any scroll
	// the browser already made to reach it is folded into the view first, so it is not counted twice.
	const reveal = useCallback((id: string) => {
		absorbScroll();
		const placed = layout.nodes.get(id);
		if (placed) apply(panToReveal(view.current, placed, size.current, 24, TOOLBAR_CLEARANCE));
	}, [absorbScroll, apply, layout]);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.altKey || event.metaKey || event.ctrlKey) return;
		const nodeId = (event.target as HTMLElement).dataset.nodeId;
		const arrow = event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "ArrowDown";
		if (arrow && nodeId) {
			event.preventDefault();
			const next = neighbourNode(map, nodeId, event.key as "ArrowRight");
			if (next) viewportRef.current?.querySelector<HTMLElement>(`[data-node-id="${next}"]`)?.focus();
			return;
		}
		if (arrow && event.target === viewportRef.current) {
			event.preventDefault();
			const step = 80;
			const dx = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
			const dy = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
			apply({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
			return;
		}
		if (event.key === "+" || event.key === "=") {
			event.preventDefault();
			zoomBy(1.25);
		} else if (event.key === "-" || event.key === "_") {
			event.preventDefault();
			zoomBy(0.8);
		} else if (event.key === "0") {
			event.preventDefault();
			fit();
		}
	};

	// A drag that started on a node must not also open it.
	const onClickCapture = (event: React.MouseEvent) => {
		if (moved.current) {
			event.preventDefault();
			event.stopPropagation();
			moved.current = false;
		}
	};

	const depthOf = (id: string) => layout.nodes.get(id)?.depth ?? 0;
	const nodeById = useMemo(() => new Map(map.nodes.map((node) => [node.id, node])), [map.nodes]);
	const isSelected = (kind: MapTarget["kind"], id: string) => selected?.kind === kind && selected.id === id;

	return (
		<div
			ref={viewportRef}
			role="group"
			aria-label={label}
			aria-roledescription="concept map"
			tabIndex={0}
			onKeyDown={onKeyDown}
			onClickCapture={onClickCapture}
			className="relative h-full w-full touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600"
		>
			<div ref={layerRef} className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: layout.width, height: layout.height }}>
				<svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
					{layout.groups.map((group) => (
						<rect key={group.questionId} x={group.x} y={group.y} width={group.width} height={group.height} rx={22} className="fill-amber-500/[.05] stroke-amber-700/35 dark:fill-amber-300/[.04] dark:stroke-amber-300/30" strokeWidth={1.5} strokeDasharray="6 6" />
					))}
					{layout.edges.map((edge) => (
						<path
							key={edge.id}
							d={edge.path}
							fill="none"
							strokeWidth={edge.kind === "link" ? 1.75 : 1.5}
							strokeDasharray={edge.kind === "link" ? "7 6" : undefined}
							className={edge.kind === "link" ? "stroke-amber-700/60 dark:stroke-amber-300/55" : "stroke-black/[.38] dark:stroke-white/[.32]"}
						/>
					))}
				</svg>

				{layout.groups.map((group) => (
					<p key={group.questionId} className="absolute whitespace-nowrap text-xs font-bold uppercase tracking-[.16em] text-amber-900/80 dark:text-amber-200/80" style={{ left: group.x + 14, top: group.y + 10 }}>
						Interpretations, side by side · none settled
					</p>
				))}

				{layout.edges.map((edge) => {
					if (edge.kind === "group") return null;
					const text = edge.kind === "link" ? map.links.find((link) => link.id === edge.id)?.label : nodeById.get(edge.to)?.via?.label;
					if (!text) return null;
					const kind: MapTarget["kind"] = edge.kind === "link" ? "link" : "connection";
					const target = edge.kind === "link" ? edge.id : edge.to;
					return (
						<button
							key={`label-${edge.id}`}
							type="button"
							tabIndex={-1}
							onClick={() => onOpen({ kind, id: target })}
							title={text}
							style={{ left: edge.labelX, top: edge.labelY, transform: edge.labelAnchor === "end" ? "translate(-100%, -50%)" : edge.labelAnchor === "start" ? "translate(0, -50%)" : "translate(-50%, -50%)" }}
							className={`absolute max-w-[146px] truncate rounded-full border px-2.5 py-1 text-xs font-bold leading-tight before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${
								edge.kind === "link"
									? "border-dashed border-amber-700/50 bg-[#fbf3df] text-amber-900 dark:border-amber-300/45 dark:bg-[#1d1a10] dark:text-amber-200"
									: "border-black/10 bg-[#f6f2e9] text-neutral-600 dark:border-white/10 dark:bg-[#0d100d] dark:text-[#bbb3a7]"
							} ${isSelected(kind, target) ? "ring-2 ring-[#e5b664]" : ""}`}
						>
							{text}
						</button>
					);
				})}

				{map.nodes.map((node) => {
					const placed = layout.nodes.get(node.id);
					if (!placed) return null;
					const depth = depthOf(node.id);
					const chip = node.kind === "question" ? "Christians differ" : node.kind === "reading" ? "Interpretation" : null;
					const more = node.refs.length > 1 ? ` +${node.refs.length - 1}` : "";
					return (
						<button
							key={node.id}
							type="button"
							data-node-id={node.id}
							onClick={() => onOpen({ kind: "node", id: node.id })}
							onFocus={() => reveal(node.id)}
							aria-label={`${node.label}${chip ? `, ${chip.toLowerCase()}` : ""}. ${node.refs.join(", ")}`}
							aria-haspopup="dialog"
							style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
							className={`absolute flex flex-col justify-center overflow-hidden rounded-[18px] border px-4 text-left transition-colors hover:border-amber-700/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:hover:border-amber-300/50 ${nodeTone(node, depth)} ${
								isSelected("node", node.id) ? "ring-2 ring-[#e5b664] ring-offset-2 ring-offset-[#f6f2e9] dark:ring-offset-[#0d100d]" : ""
							}`}
						>
							{chip && <span className="mb-0.5 text-xs font-bold uppercase tracking-[.14em] text-amber-800 dark:text-amber-200">{chip}</span>}
							<span className={`line-clamp-2 font-[family-name:var(--font-cormorant)] font-semibold leading-[1.12] ${depth === 0 ? "text-[22px]" : "text-[19px]"}`}>{node.label}</span>
							<span className={`mt-1 truncate text-xs font-bold ${depth === 0 ? "text-[#e5d7b8] dark:text-[#3a3424]" : "text-amber-800/90 dark:text-[#e5b664]/90"}`}>
								{node.refs[0]}
								{more}
							</span>
						</button>
					);
				})}
			</div>

			<div data-map-toolbar className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center lg:left-auto lg:right-3 lg:translate-x-0 rounded-full border border-black/10 bg-[#f6f2e9] p-1 dark:border-white/10 dark:bg-[#141813]">
				<button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
					<Minus size={19} aria-hidden />
				</button>
				<span className="w-12 text-center text-xs font-bold tabular-nums text-neutral-600 dark:text-[#bbb3a7]" aria-live="polite">{zoom}%</span>
				<button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
					<Plus size={19} aria-hidden />
				</button>
				<span className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/10" aria-hidden />
				<button type="button" onClick={fit} aria-label="Fit the whole map" className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
					<Scan size={18} aria-hidden />
				</button>
				<button type="button" onClick={onToggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
					{fullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
				</button>
			</div>
		</div>
	);
}
