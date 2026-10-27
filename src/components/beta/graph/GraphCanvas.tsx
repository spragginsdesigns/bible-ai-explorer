"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { connectionSectionOf } from "@/lib/bible/connectionsMap";
import { GRAPH_KIND_LABEL, GRAPH_RADIUS, type GraphEdge, type GraphNode } from "@/lib/beta/graph/graph-rules";

/**
 * The graph itself: one SVG, passages around the ring in Bible order (the
 * Connections ring's palette), everything studied inside. Pan with a drag,
 * zoom with a pinch, the wheel or the buttons; arrows and +/- from the
 * keyboard. During a gesture only the group's transform attribute changes
 * (no React render per frame), so several hundred nodes stay smooth on a
 * phone. Nothing repeating blurs, glows or animates.
 */

const VIEW = GRAPH_RADIUS * 1.24;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const LABEL_ZOOM = 1.7;

interface View {
	x: number;
	y: number;
	k: number;
}

const EDGE_CLASS: Record<GraphEdge["kind"], string> = {
	passage: "stroke-black/[.14] dark:stroke-white/[.13]",
	topic: "stroke-amber-700/25 dark:stroke-amber-200/20",
	wikilink: "stroke-[#24281f]/60 dark:stroke-[#f1eadc]/55",
	link: "stroke-[#b98a2e] dark:stroke-[#e5b664]",
	suggested: "stroke-[#b98a2e] dark:stroke-[#e5b664]",
	crossref: "stroke-teal-700/35 dark:stroke-teal-300/30",
	contains: "stroke-black/30 dark:stroke-white/30",
};

const NODE_CLASS: Record<Exclude<GraphNode["kind"], "passage">, string> = {
	topic: "fill-[#f6f2e9] stroke-[#b98a2e] dark:fill-[#0d100d] dark:stroke-[#e5b664]",
	note: "fill-[#24281f] stroke-[#f6f2e9] dark:fill-[#f1eadc] dark:stroke-[#0d100d]",
	chat: "fill-[#5d6b74] stroke-[#f6f2e9] dark:fill-[#9fb2bf] dark:stroke-[#0d100d]",
	sermon: "fill-[#8a5a2b] stroke-[#f6f2e9] dark:fill-[#d29a62] dark:stroke-[#0d100d]",
	study: "fill-[#e5b664] stroke-[#24281f] dark:fill-[#e5b664] dark:stroke-[#0d100d]",
};

/** A node's radius in screen pixels at zoom 1. */
function radiusPx(node: GraphNode): number {
	const base = node.kind === "passage" ? 6 : node.kind === "topic" ? 5.5 : 4.5;
	return Math.min(base + Math.sqrt(node.degree) * 1.1, base * 2.4);
}
/** Passages and topics labelled at every zoom: the best-connected few. */
const PROMINENT = 24;

function describe(node: GraphNode): string {
	return `${node.label}, ${GRAPH_KIND_LABEL[node.kind].toLowerCase()}, ${node.degree} connection${node.degree === 1 ? "" : "s"}`;
}

interface Props {
	nodes: GraphNode[];
	edges: GraphEdge[];
	selectedId: string | null;
	/** Selected node and its neighbours; everything else dims. */
	focus: Set<string> | null;
	onSelect: (id: string | null) => void;
	/** A request to centre the view on a node (search, a connection tapped, a link); a new key each time. */
	centre: { id: string; key: number } | null;
}

export default function GraphCanvas({ nodes, edges, selectedId, focus, onSelect, centre }: Props) {
	const svgRef = useRef<SVGSVGElement>(null);
	const groupRef = useRef<SVGGElement>(null);
	const view = useRef<View>({ x: 0, y: 0, k: 1 });
	const [zoom, setZoom] = useState(1);
	// SVG units per screen pixel, so dots, labels and tap targets keep a size a finger can use.
	const [unitPx, setUnitPx] = useState(6);
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const gesture = useRef<{ moved: boolean; startDist: number; startK: number; last: { x: number; y: number } | null; node: string | null }>({
		moved: false,
		startDist: 0,
		startK: 1,
		last: null,
		node: null,
	});
	const settle = useRef<number | null>(null);

	const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
	const prominent = useMemo(
		() =>
			new Set(
				nodes
					.filter((node) => node.kind === "passage" || node.kind === "topic")
					.sort((a, b) => b.degree - a.degree)
					.slice(0, PROMINENT)
					.map((node) => node.id),
			),
		[nodes],
	);

	const apply = useCallback(() => {
		const { x, y, k } = view.current;
		groupRef.current?.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)})`);
		// Labels follow the zoom once a gesture rests, not every frame.
		if (settle.current) window.clearTimeout(settle.current);
		settle.current = window.setTimeout(() => setZoom(view.current.k), 120);
	}, []);

	/** SVG units per screen pixel. */
	const unit = useCallback(() => {
		const rect = svgRef.current?.getBoundingClientRect();
		return rect && rect.width ? (VIEW * 2) / Math.min(rect.width, rect.height) : 1;
	}, []);

	/** A screen point in the SVG's (untransformed) coordinates. */
	const toView = useCallback(
		(clientX: number, clientY: number) => {
			const rect = svgRef.current!.getBoundingClientRect();
			const u = unit();
			return { x: (clientX - rect.left - rect.width / 2) * u, y: (clientY - rect.top - rect.height / 2) * u };
		},
		[unit],
	);

	const zoomAt = useCallback(
		(factor: number, at = { x: 0, y: 0 }) => {
			const v = view.current;
			const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
			const ratio = k / v.k;
			view.current = { k, x: at.x - (at.x - v.x) * ratio, y: at.y - (at.y - v.y) * ratio };
			apply();
		},
		[apply],
	);

	const reset = useCallback(() => {
		view.current = { x: 0, y: 0, k: 1 };
		apply();
	}, [apply]);

	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const measure = () => setUnitPx(unit());
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(svg);
		return () => observer.disconnect();
	}, [unit]);

	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		// React's wheel listener is passive; zooming must stop the page from scrolling.
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			zoomAt(Math.exp(-event.deltaY * 0.0015), toView(event.clientX, event.clientY));
		};
		svg.addEventListener("wheel", onWheel, { passive: false });
		return () => svg.removeEventListener("wheel", onWheel);
	}, [toView, zoomAt]);

	useEffect(() => {
		const node = centre ? byId.get(centre.id) : undefined;
		if (!node) return;
		const k = Math.max(view.current.k, 2.2);
		view.current = { k, x: -node.x * k, y: -node.y * k };
		apply();
		// Only a new request to centre moves the view; selecting by tap leaves it alone.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [centre?.key, centre?.id]);

	useEffect(() => () => {
		if (settle.current) window.clearTimeout(settle.current);
	}, []);

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		// Captured pointers report the SVG as their target, so the node under a tap is read here.
		const node = (event.target as Element).closest("[data-node]")?.getAttribute("data-node") ?? null;
		event.currentTarget.setPointerCapture(event.pointerId);
		const points = [...pointers.current.values()];
		gesture.current = {
			moved: points.length > 1,
			startDist: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
			startK: view.current.k,
			last: points.length === 1 ? { x: event.clientX, y: event.clientY } : null,
			node: points.length === 1 ? node : null,
		};
	};

	const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
		if (!pointers.current.has(event.pointerId)) return;
		pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const points = [...pointers.current.values()];
		const g = gesture.current;
		if (points.length >= 2 && g.startDist > 0) {
			const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
			const mid = toView((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
			zoomAt((g.startK * (dist / g.startDist)) / view.current.k, mid);
			g.moved = true;
			return;
		}
		if (!g.last) return;
		const dx = event.clientX - g.last.x;
		const dy = event.clientY - g.last.y;
		if (!g.moved && Math.hypot(dx, dy) < 6) return;
		g.moved = true;
		const u = unit();
		view.current = { ...view.current, x: view.current.x + dx * u, y: view.current.y + dy * u };
		g.last = { x: event.clientX, y: event.clientY };
		apply();
	};

	const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
		pointers.current.delete(event.pointerId);
		const remaining = [...pointers.current.values()];
		if (remaining.length === 1) gesture.current = { ...gesture.current, startDist: 0, last: remaining[0] };
		if (remaining.length) return;
		// A tap: the node under it, or nothing (clears the selection).
		if (!gesture.current.moved) onSelect(gesture.current.node);
	};

	const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
		const step = 60 * unit();
		const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
		if (event.target !== event.currentTarget && event.key.startsWith("Arrow")) return;
		if (moves[event.key]) {
			event.preventDefault();
			const [dx, dy] = moves[event.key];
			view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy };
			apply();
		} else if (event.key === "+" || event.key === "=") {
			event.preventDefault();
			zoomAt(1.3);
		} else if (event.key === "-" || event.key === "_") {
			event.preventDefault();
			zoomAt(1 / 1.3);
		} else if (event.key === "0") {
			event.preventDefault();
			reset();
		} else if (event.key === "Escape") {
			onSelect(null);
		}
	};

	return (
		<div className="relative overflow-hidden rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]">
			<svg
				ref={svgRef}
				viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
				className="block aspect-square w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600"
				role="application"
				aria-roledescription="study graph"
				aria-label="Your study graph. Drag to pan, pinch or use plus and minus to zoom, arrow keys to move, Tab to reach each node, Enter to select it."
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onKeyDown={onKeyDown}
			>
				<circle r={GRAPH_RADIUS} className="fill-none stroke-black/[.07] dark:stroke-white/[.07]" strokeWidth={1} vectorEffect="non-scaling-stroke" />
				<g ref={groupRef}>
					<GraphEdges edges={edges} byId={byId} focus={focus} />
					<GraphNodes nodes={nodes} selectedId={selectedId} focus={focus} zoom={zoom} unitPx={unitPx} prominent={prominent} onSelect={onSelect} />
				</g>
			</svg>
			<div className="absolute bottom-3 right-3 flex flex-col gap-2">
				<CanvasButton label="Zoom in" onClick={() => zoomAt(1.4)}>
					<Plus size={20} aria-hidden />
				</CanvasButton>
				<CanvasButton label="Zoom out" onClick={() => zoomAt(1 / 1.4)}>
					<Minus size={20} aria-hidden />
				</CanvasButton>
				<CanvasButton label="Show the whole graph" onClick={reset}>
					<RotateCcw size={18} aria-hidden />
				</CanvasButton>
			</div>
		</div>
	);
}

function CanvasButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-[#fbf8f1] text-neutral-800 shadow-sm hover:border-amber-700/30 dark:border-white/10 dark:bg-[#161a15] dark:text-[#e6dfd1]"
		>
			{children}
		</button>
	);
}

const GraphEdges = memo(function GraphEdges({ edges, byId, focus }: { edges: GraphEdge[]; byId: Map<string, GraphNode>; focus: Set<string> | null }) {
	return (
		<g strokeLinecap="round">
			{edges.map((edge) => {
				const a = byId.get(edge.source);
				const b = byId.get(edge.target);
				if (!a || !b) return null;
				const lit = !focus || (focus.has(edge.source) && focus.has(edge.target));
				const strong = edge.kind === "link" || edge.kind === "suggested" || edge.kind === "wikilink";
				return (
					<line
						key={edge.id}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						className={EDGE_CLASS[edge.kind]}
						strokeWidth={strong ? 2.5 : edge.kind === "crossref" ? 1.5 : 1}
						strokeDasharray={edge.kind === "suggested" ? "6 5" : edge.kind === "contains" ? "2 4" : undefined}
						opacity={lit ? 1 : 0.12}
						vectorEffect="non-scaling-stroke"
					/>
				);
			})}
		</g>
	);
});

const GraphNodes = memo(function GraphNodes({
	nodes,
	selectedId,
	focus,
	zoom,
	unitPx,
	prominent,
	onSelect,
}: {
	nodes: GraphNode[];
	selectedId: string | null;
	focus: Set<string> | null;
	zoom: number;
	unitPx: number;
	prominent: Set<string>;
	onSelect: (id: string | null) => void;
}) {
	// Dots grow a little as you zoom in; labels stay a readable 12px; tap discs stay 44px across.
	const toUnits = (px: number) => (px * unitPx) / Math.sqrt(zoom);
	const labelUnits = (px: number) => (px * unitPx) / zoom;
	return (
		<g>
			{/* Tap discs first, under every dot, so a visible dot always wins its own tap. */}
			<g>
				{nodes.map((node) => (
					<circle key={node.id} data-node={node.id} cx={node.x} cy={node.y} r={Math.max(toUnits(radiusPx(node)), labelUnits(22))} fill="transparent" className="cursor-pointer" />
				))}
			</g>
			{nodes.map((node) => {
				const r = toUnits(radiusPx(node));
				const lit = !focus || focus.has(node.id);
				const selected = node.id === selectedId;
				const showLabel = prominent.has(node.id) || selected || (focus?.has(node.id) ?? false) || zoom >= LABEL_ZOOM;
				const color = node.kind === "passage" ? connectionSectionOf(node.book ?? 1).color : null;
				// Passage labels sit outside the ring; everything else under its dot.
				const angle = node.kind === "passage" ? Math.atan2(node.y, node.x) : 0;
				const gap = labelUnits(5);
				const lx = node.kind === "passage" ? Math.cos(angle) * (r + gap) : 0;
				const ly = node.kind === "passage" ? Math.sin(angle) * (r + gap) : r + gap * 0.6;
				const anchor = node.kind === "passage" ? (Math.cos(angle) > 0.2 ? "start" : Math.cos(angle) < -0.2 ? "end" : "middle") : "middle";
				return (
					<g
						key={node.id}
						data-node={node.id}
						role="button"
						tabIndex={0}
						aria-label={describe(node)}
						aria-pressed={selected}
						transform={`translate(${node.x} ${node.y})`}
						opacity={lit ? 1 : 0.22}
						className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[#d97706] [&:focus-visible>circle]:[stroke-width:3]"
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								event.stopPropagation();
								onSelect(node.id);
							}
						}}
					>
						<circle
							r={r}
							className={node.kind === "passage" ? "stroke-[#f6f2e9] dark:stroke-[#0d100d]" : NODE_CLASS[node.kind]}
							style={color ? { fill: color } : undefined}
							strokeWidth={node.kind === "topic" ? 2 : 1.25}
							vectorEffect="non-scaling-stroke"
						/>
						{selected ? <circle r={r + labelUnits(4)} className="fill-none stroke-[#24281f] dark:stroke-[#f1eadc]" strokeWidth={3} vectorEffect="non-scaling-stroke" /> : null}
						{showLabel ? (
							<text
								x={lx}
								y={ly}
								textAnchor={anchor}
								dominantBaseline={node.kind === "passage" ? "middle" : "hanging"}
								className={`pointer-events-none fill-neutral-800 dark:fill-[#e6dfd1] ${node.kind === "topic" ? "font-bold italic" : node.kind === "passage" ? "font-semibold" : ""}`}
								style={{ fontSize: `${labelUnits(node.kind === "passage" || node.kind === "topic" ? 12 : 11)}px` }}
							>
								{node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label}
							</text>
						) : null}
					</g>
				);
			})}
		</g>
	);
});
