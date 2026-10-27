"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { BASEMAP } from "@/lib/beta/atlas/basemap";
import {
	clampCamera,
	declutter,
	fitPoints,
	interpolateCamera,
	labelBox,
	MAP_HEIGHT,
	MAP_WIDTH,
	toScreen,
	viewBoxFor,
	zoomAround,
	type Camera,
	type MapPoint,
	type Viewport,
} from "@/lib/beta/atlas/atlas-rules";
import type { AtlasMapPlace } from "@/lib/beta/atlas/types";

export interface AtlasRoute {
	points: MapPoint[];
	/** Per point after the first: true when Scripture says that leg was sailed. */
	sea: boolean[];
	/** The leg ending at this point index is the last one walked so far. */
	reached: number;
}

export interface AtlasFocus {
	/** A new key flies the camera, even to the same points. */
	key: string;
	points: MapPoint[];
	maxScale?: number;
}

interface AtlasMapProps {
	places: readonly AtlasMapPlace[];
	/** Markers drawn emphasised and always labelled (a journey's stops, an event's places). */
	emphasis: ReadonlySet<string>;
	/** The marker of the current stop or open card. */
	current: string | null;
	route: AtlasRoute | null;
	focus: AtlasFocus | null;
	onSelect: (id: string) => void;
	label: string;
}

/** Below this many map units per pixel only rank-1 names are written, and so on. */
const LABEL_SCALE: Record<1 | 2 | 3, number> = { 1: 0, 2: 0.05, 3: 0.16 };
const FLY_MS = 950;
const TAP_SLOP = 6;

function reducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The atlas's map (LC-17655, docs/beta/atlas.md): Natural Earth land, lakes
 * and rivers as one SVG whose viewBox is the camera, with the places as real
 * buttons laid over it. Pan with a finger or the mouse, pinch or scroll to
 * zoom, double-tap to zoom in, arrow keys and +/- from the keyboard.
 *
 * The camera lives in a ref and every frame writes the viewBox and the marker
 * transforms straight to the DOM, so dragging never re-renders React. Which
 * markers are drawn (no two tap targets on top of each other) is worked out
 * once the camera settles.
 */
export default function AtlasMap({ places, emphasis, current, route, focus, onSelect, label }: AtlasMapProps) {
	const frameRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const markerRefs = useRef(new Map<string, HTMLButtonElement>());
	const cameraRef = useRef<Camera | null>(null);
	const viewportRef = useRef<Viewport>({ width: 0, height: 0 });
	const animationRef = useRef<number | null>(null);
	const settleRef = useRef<number | null>(null);
	// The first measurement jumps straight to the focus the page opened with.
	const lastFocusRef = useRef<AtlasFocus | null>(focus);
	const appliedFocusRef = useRef<string | null>(null);
	const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
	const [scale, setScale] = useState(0);
	const [ready, setReady] = useState(false);

	const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);

	const draw = useCallback(() => {
		const camera = cameraRef.current;
		const viewport = viewportRef.current;
		if (!camera || viewport.width === 0) return;
		svgRef.current?.setAttribute("viewBox", viewBoxFor(camera, viewport));
		for (const [id, element] of markerRefs.current) {
			const place = byId.get(id);
			if (!place) continue;
			const { x, y } = toScreen(place, camera, viewport);
			element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
		}
	}, [byId]);

	/** Recompute which markers fit, once the camera has stopped moving. */
	const settle = useCallback(() => {
		if (settleRef.current !== null) window.clearTimeout(settleRef.current);
		settleRef.current = window.setTimeout(() => {
			settleRef.current = null;
			const camera = cameraRef.current;
			const viewport = viewportRef.current;
			if (!camera) return;
			const candidates = places.map((place) => {
				const point = toScreen(place, camera, viewport);
				const isCurrent = place.id === current;
				const isEmphasis = emphasis.has(place.id);
				// Within a rank, the place with more events and stops wins (Jerusalem over Bethlehem).
				const priority = isCurrent ? 0 : isEmphasis ? 1 - Math.min(place.importance, 99) / 100 : 2 + place.rank - Math.min(place.importance, 99) / 100;
				const labelled = isCurrent || isEmphasis || camera.scale >= LABEL_SCALE[place.rank];
				const area = place.feature === "region" || place.feature === "water";
				const box = labelled || area ? labelBox(area ? place.name.toUpperCase() : place.name, area ? "area" : "point") : undefined;
				return { id: place.id, x: point.x, y: point.y, priority, box };
			});
			const next = declutter(candidates, viewport, 34);
			setShown((previous) => (previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next));
			setScale(camera.scale);
		}, 60);
	}, [places, emphasis, current]);

	const stopAnimation = () => {
		if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
		animationRef.current = null;
	};

	const setCamera = useCallback(
		(next: Camera) => {
			cameraRef.current = clampCamera(next, viewportRef.current);
			draw();
		},
		[draw]
	);

	const flyTo = useCallback(
		(target: Camera) => {
			stopAnimation();
			const from = cameraRef.current;
			if (!from || reducedMotion()) {
				setCamera(target);
				settle();
				return;
			}
			const started = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - started) / FLY_MS);
				setCamera(interpolateCamera(from, target, t));
				if (t < 1) animationRef.current = requestAnimationFrame(step);
				else {
					animationRef.current = null;
					settle();
				}
			};
			animationRef.current = requestAnimationFrame(step);
		},
		[setCamera, settle]
	);

	const focusCamera = useCallback(
		(target: AtlasFocus | null) => {
			const viewport = viewportRef.current;
			if (viewport.width === 0) return null;
			const points = target?.points.length ? target.points : places.map((place) => ({ x: place.x, y: place.y }));
			// Labels hang right of their dots, the zoom buttons sit top right, the credit bottom left.
			const edge = Math.min(40, viewport.width / 9);
			return fitPoints(points, viewport, { left: edge, top: edge, right: edge + Math.min(96, viewport.width / 4), bottom: edge + 18 }, target?.maxScale ?? 0.12);
		},
		[places]
	);

	// Track the frame's size; the first measurement places the camera.
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const measure = () => {
			const rect = frame.getBoundingClientRect();
			viewportRef.current = { width: rect.width, height: rect.height };
			if (!cameraRef.current && viewportRef.current.width > 0) {
				const start = focusCamera(lastFocusRef.current);
				if (start) cameraRef.current = start;
				appliedFocusRef.current = lastFocusRef.current?.key ?? null;
				setReady(true);
			}
			setCamera(cameraRef.current ?? { cx: 0, cy: 0, scale: 0 });
			settle();
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(frame);
		return () => observer.disconnect();
	}, [focusCamera, setCamera, settle]);

	// A new focus flies there.
	useEffect(() => {
		lastFocusRef.current = focus;
		if (!focus || !cameraRef.current || appliedFocusRef.current === focus.key) return;
		appliedFocusRef.current = focus.key;
		const target = focusCamera(focus);
		if (target) flyTo(target);
	}, [focus, focusCamera, flyTo]);

	// Markers that just mounted need their position written.
	useEffect(() => {
		draw();
	}, [draw, shown, ready]);

	// Different places, emphasis or selection: work out again which markers fit.
	useEffect(() => {
		settle();
	}, [settle]);

	useEffect(
		() => () => {
			stopAnimation();
			if (settleRef.current !== null) window.clearTimeout(settleRef.current);
		},
		[]
	);

	/* --------------------------------------------------------- gestures */

	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const gesture = useRef<{ moved: boolean; startX: number; startY: number; lastTap: number }>({ moved: false, startX: 0, startY: 0, lastTap: 0 });

	const local = (event: { clientX: number; clientY: number }) => {
		const rect = frameRef.current?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	};

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 && event.pointerType === "mouse") return;
		stopAnimation();
		pointers.current.set(event.pointerId, local(event));
		if (pointers.current.size === 1) gesture.current = { ...gesture.current, moved: false, startX: event.clientX, startY: event.clientY };
	};

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const previous = pointers.current.get(event.pointerId);
		const camera = cameraRef.current;
		if (!previous || !camera) return;
		const point = local(event);
		if (!gesture.current.moved) {
			if (Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) < TAP_SLOP && pointers.current.size < 2) return;
			gesture.current.moved = true;
			frameRef.current?.setPointerCapture(event.pointerId);
		}
		if (pointers.current.size >= 2) {
			const [a, b] = [...pointers.current.entries()];
			const other = a[0] === event.pointerId ? b[1] : a[1];
			const before = Math.hypot(previous.x - other.x, previous.y - other.y);
			const after = Math.hypot(point.x - other.x, point.y - other.y);
			const mid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
			const prevMid = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
			let next = before > 0 ? zoomAround(camera, viewportRef.current, after / before, mid) : camera;
			next = { ...next, cx: next.cx - (mid.x - prevMid.x) / next.scale, cy: next.cy - (mid.y - prevMid.y) / next.scale };
			setCamera(next);
		} else {
			setCamera({ ...camera, cx: camera.cx - (point.x - previous.x) / camera.scale, cy: camera.cy - (point.y - previous.y) / camera.scale });
		}
		pointers.current.set(event.pointerId, point);
	};

	const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
		const wasDrag = gesture.current.moved;
		pointers.current.delete(event.pointerId);
		if (frameRef.current?.hasPointerCapture(event.pointerId)) frameRef.current.releasePointerCapture(event.pointerId);
		if (pointers.current.size === 0) {
			if (wasDrag) settle();
			else if (event.type === "pointerup" && !(event.target as HTMLElement).closest("button")) {
				// Double-tap (or double-click) on the map zooms in there.
				const now = performance.now();
				if (now - gesture.current.lastTap < 320 && cameraRef.current) {
					flyTo(zoomAround(cameraRef.current, viewportRef.current, 2, local(event)));
					gesture.current.lastTap = 0;
				} else gesture.current.lastTap = now;
			}
		}
	};

	// A drag that began on a marker must not also open it.
	const onClickCapture = (event: React.MouseEvent) => {
		if (gesture.current.moved) {
			event.preventDefault();
			event.stopPropagation();
			gesture.current.moved = false;
		}
	};

	// Wheel zoom needs a non-passive listener to keep the page from scrolling.
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const onWheel = (event: WheelEvent) => {
			const camera = cameraRef.current;
			if (!camera) return;
			event.preventDefault();
			stopAnimation();
			const rect = frame.getBoundingClientRect();
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			setCamera(zoomAround(camera, viewportRef.current, Math.exp(-delta * 0.0018), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
			settle();
		};
		frame.addEventListener("wheel", onWheel, { passive: false });
		return () => frame.removeEventListener("wheel", onWheel);
	}, [setCamera, settle]);

	const zoomBy = (factor: number) => {
		const camera = cameraRef.current;
		const viewport = viewportRef.current;
		if (camera) flyTo(zoomAround(camera, viewport, factor, { x: viewport.width / 2, y: viewport.height / 2 }));
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		const camera = cameraRef.current;
		if (!camera) return;
		const step = 80 / camera.scale;
		const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		if (moves[event.key]) {
			event.preventDefault();
			const [dx, dy] = moves[event.key];
			setCamera({ ...camera, cx: camera.cx + dx, cy: camera.cy + dy });
			settle();
		} else if (event.key === "+" || event.key === "=") {
			event.preventDefault();
			zoomBy(1.6);
		} else if (event.key === "-" || event.key === "_") {
			event.preventDefault();
			zoomBy(1 / 1.6);
		}
	};

	/* ---------------------------------------------------------- drawing */

	const routeLegs = useMemo(() => {
		if (!route || route.points.length < 2) return [];
		return route.points.slice(1).map((to, index) => ({
			from: route.points[index],
			to,
			sea: route.sea[index] ?? false,
			walked: index + 1 <= route.reached,
		}));
	}, [route]);

	const drawn = places.filter((place) => shown.has(place.id) || place.id === current);

	return (
		<div
			ref={frameRef}
			role="region"
			aria-label={label}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerEnd}
			onPointerCancel={onPointerEnd}
			onClickCapture={onClickCapture}
			onKeyDown={onKeyDown}
			className="atlas-map relative h-full w-full touch-none select-none overflow-hidden bg-[#e6dcc6] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600 dark:bg-[#151913]"
		>
			<svg ref={svgRef} aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
				{/* The map is a sheet: the sea inside it, the parchment table around it. */}
				<rect x={0} y={0} width={MAP_WIDTH} height={MAP_HEIGHT} vectorEffect="non-scaling-stroke" strokeWidth={1} className="fill-[#cbd8d3] stroke-[#a7987a] dark:fill-[#0f1a1b] dark:stroke-[#4a4c3c]" />
				<path d={BASEMAP.land} fillRule="evenodd" vectorEffect="non-scaling-stroke" strokeWidth={0.9} className="fill-[#efe6d2] stroke-[#a7987a] dark:fill-[#20251d] dark:stroke-[#4a4c3c]" />
				<path d={BASEMAP.lakes} vectorEffect="non-scaling-stroke" strokeWidth={0.8} className="fill-[#cbd8d3] stroke-[#8fa7a0] dark:fill-[#0f1a1b] dark:stroke-[#36504f]" />
				<path d={BASEMAP.rivers} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" className="stroke-[#86a6b2] dark:stroke-[#3b5d66]" />
				{routeLegs.map((leg, index) => (
					<line
						key={index}
						x1={leg.from.x}
						y1={leg.from.y}
						x2={leg.to.x}
						y2={leg.to.y}
						vectorEffect="non-scaling-stroke"
						strokeLinecap="round"
						strokeWidth={leg.walked ? 3 : 2}
						strokeDasharray={leg.sea ? "7 6" : undefined}
						className={leg.walked ? "stroke-[#a86f12] dark:stroke-[#e5b664]" : "stroke-[#a86f12]/35 dark:stroke-[#e5b664]/30"}
					/>
				))}
			</svg>

			{ready &&
				drawn.map((place) => {
					const isCurrent = place.id === current;
					const isEmphasis = emphasis.has(place.id);
					const showLabel = isCurrent || isEmphasis || scale >= LABEL_SCALE[place.rank];
					const area = place.feature === "region" || place.feature === "water";
					const names = [place.name, ...place.alsoHere.map((entry) => entry.name)].join(" / ");
					return (
						<button
							key={place.id}
							ref={(element) => {
								if (element) markerRefs.current.set(place.id, element);
								else markerRefs.current.delete(place.id);
							}}
							type="button"
							onClick={() => onSelect(place.id)}
							aria-label={`${names}${isCurrent ? ", selected" : ""}`}
							aria-pressed={isCurrent}
							data-place={place.id}
							className={`group absolute left-0 top-0 -ml-[22px] -mt-[22px] flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${isCurrent ? "z-30" : isEmphasis ? "z-20" : "z-10"}`}
						>
							{area ? null : (
								<span
									aria-hidden
									className={`block rounded-full border-2 ${
										isCurrent
											? "h-4 w-4 border-white bg-[#a86f12] shadow-[0_0_0_3px_rgba(168,111,18,0.35)] dark:border-[#0d100d] dark:bg-[#e5b664] dark:shadow-[0_0_0_3px_rgba(229,182,100,0.35)]"
											: isEmphasis
												? "h-3.5 w-3.5 border-white bg-[#a86f12] dark:border-[#0d100d] dark:bg-[#e5b664]"
												: place.certainty === "uncertain"
													? "h-3 w-3 border-dashed border-[#6b5d43] bg-transparent dark:border-[#c8bba0]"
													: place.certainty === "traditional"
														? "h-3 w-3 border-[#6b5d43] bg-[#efe6d2] dark:border-[#c8bba0] dark:bg-[#20251d]"
														: "h-3 w-3 border-[#efe6d2] bg-[#5b4a2c] dark:border-[#20251d] dark:bg-[#d9c9a6]"
									}`}
								/>
							)}
							{showLabel ? (
								<span
									aria-hidden
									className={`pointer-events-none absolute whitespace-nowrap rounded-md px-1.5 py-0.5 leading-tight ${
										area
											? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[.16em] text-[#6b5d43]/90 dark:text-[#c8bba0]/85"
											: `left-[30px] top-1/2 -translate-y-1/2 text-metadata font-semibold ${
													isCurrent || isEmphasis
														? "bg-[#fbf7ee]/95 text-[#24281f] ring-1 ring-[#a86f12]/40 dark:bg-[#151a14]/95 dark:text-[#f1eadc] dark:ring-[#e5b664]/40"
														: "bg-[#fbf7ee]/80 text-[#3f3a2c] dark:bg-[#151a14]/80 dark:text-[#ddd3c0]"
												}`
									} ${isCurrent && area ? "rounded-full bg-[#fbf7ee]/95 text-[#24281f] ring-1 ring-[#a86f12]/50 dark:bg-[#151a14]/95 dark:text-[#f1eadc]" : ""}`}
								>
									{place.name}
								</span>
							) : null}
						</button>
					);
				})}

			<div className="absolute right-2 top-2 z-40 flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-[#fbf7ee]/95 dark:border-white/10 dark:bg-[#151a14]/95">
				<button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" className="flex h-11 w-11 items-center justify-center text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
					<Plus size={19} aria-hidden />
				</button>
				<button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" className="flex h-11 w-11 items-center justify-center border-t border-black/10 text-neutral-700 hover:bg-black/5 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5">
					<Minus size={19} aria-hidden />
				</button>
				<button
					type="button"
					onClick={() => {
						const target = focusCamera(lastFocusRef.current);
						if (target) flyTo(target);
					}}
					aria-label="Fit the map to what is shown"
					className="flex h-11 w-11 items-center justify-center border-t border-black/10 text-neutral-700 hover:bg-black/5 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/5"
				>
					<Maximize2 size={17} aria-hidden />
				</button>
			</div>

			<p className="pointer-events-none absolute bottom-1.5 left-2 z-40 whitespace-nowrap rounded bg-[#fbf7ee]/90 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-[#151a14]/90 dark:text-neutral-400">
				Map: <span className="pointer-events-auto"><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">Natural Earth</a></span> (public domain)<span className="hidden sm:inline"> · modern coastlines</span>
			</p>
		</div>
	);
}
