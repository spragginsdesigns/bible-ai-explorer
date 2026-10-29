"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useVoiceActionScope, useVoiceControls } from "../voice/VoiceControlProvider";
import { X } from "lucide-react";
import type { AppTarget } from "@/lib/onboarding-rules";
import { routeForTarget } from "@/lib/guide-cards";
import { trackOnboardingTour } from "@/lib/analytics/client";
import {
	SPOTLIGHT_ATTRIBUTE,
	advanceSpotlight,
	closeSpotlight,
	getServerSpotlight,
	getSpotlight,
	subscribeSpotlight,
} from "@/lib/spotlight";

/** How long to wait for a target to appear after navigating to its screen. */
const WAIT_FOR_TARGET_MS = 8000;
const POLL_MS = 120;
/** Room the ring leaves around the element. */
const RING_PAD = 6;
/** Below this much room on either side, the caption sits at the bottom of the screen. */
const BUBBLE_ROOM = 190;

interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

/**
 * The registered element for a key that is actually on screen. A key can sit
 * on two elements (the phone tab bar and the desktop sidebar), and the one
 * not showing has no size or is parked off to the side as a closed drawer.
 */
function findTarget(target: AppTarget): HTMLElement | null {
	const candidates = document.querySelectorAll<HTMLElement>(`[${SPOTLIGHT_ATTRIBUTE}="${target}"]`);
	for (const element of candidates) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
		if (getComputedStyle(element).visibility === "hidden") continue;
		return element;
	}
	return null;
}

function isAt(route: string): boolean {
	const url = new URL(route, window.location.origin);
	// Settings opens one pane at a time from the hash, so a pane target counts it.
	return (
		url.pathname === window.location.pathname &&
		url.search === window.location.search &&
		(!url.hash || url.hash === window.location.hash)
	);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sameBox(a: Box | null, b: Box): boolean {
	return Boolean(a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

/**
 * The spotlight itself (docs/onboarding/PLAN.md): a dim layer with a cutout
 * around the target, a gold ring on the shared pulse-glow class (static for
 * reduced motion), and a caption in SureWord's voice with Next / Done.
 *
 * Mounted once in the root layout. It never blocks: the dim layer lets taps
 * through, so the tabs keep working the whole time, and tapping the lit
 * element itself counts as Next. A target that is not on this screen is
 * reached by navigating to its route; one that never appears (no church, so
 * no sermon studies) is skipped silently.
 */
export default function SpotlightOverlay() {
	const router = useRouter();
	const voice = useVoiceControls();
	const state = useSyncExternalStore(subscribeSpotlight, getSpotlight, getServerSpotlight);
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [box, setBox] = useState<Box | null>(null);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const startedTourSeq = useRef<number | null>(null);

	const stop = state.kind === "single" ? { target: state.target, caption: state.caption } : state.kind === "tour" ? state.stops[state.index] : null;
	const seq = state.kind === "idle" ? 0 : state.seq;
	const isTour = state.kind === "tour";
	const isLastStop = state.kind !== "tour" || state.index === state.stops.length - 1;

	// A tour is counted once, on its first stop.
	useEffect(() => {
		if (state.kind !== "tour" || state.index !== 0 || startedTourSeq.current === state.seq) return;
		startedTourSeq.current = state.seq;
		trackOnboardingTour("started", 0, state.stops.length);
	}, [state]);

	const next = useCallback(() => {
		const current = getSpotlight();
		if (current.kind === "tour" && current.index === current.stops.length - 1) {
			trackOnboardingTour("finished", current.stops.length, current.stops.length);
		}
		advanceSpotlight();
	}, []);

	const close = useCallback(() => {
		const current = getSpotlight();
		if (current.kind === "tour") trackOnboardingTour("left", current.index + 1, current.stops.length);
		closeSpotlight();
	}, []);

	// A tour started from the welcome ends on another screen, so once it is
	// finished or left, take them back to the welcome and SureWord's reply.
	const returnTo = useRef<string | null>(null);
	useEffect(() => {
		if (state.kind === "tour") {
			returnTo.current = state.returnTo ?? null;
			return;
		}
		const href = returnTo.current;
		returnTo.current = null;
		if (state.kind === "idle" && href && !isAt(href)) router.push(href);
	}, [state, router]);

	// Find (or travel to) the element for the current stop.
	const target = stop?.target ?? null;
	useEffect(() => {
		setElement(null);
		setBox(null);
		if (!target) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let navigated = false;
		const startedAt = Date.now();
		const skip = () => {
			if (getSpotlight().kind === "tour") next();
			else closeSpotlight();
		};
		const look = () => {
			if (cancelled) return;
			const found = findTarget(target);
			if (found) {
				found.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
				setElement(found);
				return;
			}
			if (!navigated) {
				const route = routeForTarget(target);
				if (!route) {
					skip();
					return;
				}
				navigated = true;
				if (!isAt(route)) router.push(route);
			}
			if (Date.now() - startedAt > WAIT_FOR_TARGET_MS) {
				skip();
				return;
			}
			timer = setTimeout(look, POLL_MS);
		};
		look();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
		// Keyed on seq as well as the target: the same target twice in a row is
		// still a new stop.
	}, [seq, target, router, next]);

	// Follow the element as the page scrolls, resizes or reflows underneath.
	useEffect(() => {
		if (!element) return;
		let frame = 0;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			if (!element.isConnected) {
				// A re-render can replace the node, so look for it again. If it
				// is gone for good (they tapped away), end the run as left rather
				// than leave an invisible spotlight holding Escape.
				setBox(null);
				const lostAt = Date.now();
				const relook = () => {
					if (cancelled) return;
					const found = target ? findTarget(target) : null;
					if (found) {
						setElement(found);
						return;
					}
					if (Date.now() - lostAt > WAIT_FOR_TARGET_MS) {
						close();
						return;
					}
					timer = setTimeout(relook, POLL_MS);
				};
				relook();
				return;
			}
			const rect = element.getBoundingClientRect();
			const next: Box = {
				top: Math.round(rect.top - RING_PAD),
				left: Math.round(rect.left - RING_PAD),
				width: Math.round(rect.width + RING_PAD * 2),
				height: Math.round(rect.height + RING_PAD * 2),
			};
			setBox((current) => (sameBox(current, next) ? current : next));
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
			if (timer) clearTimeout(timer);
		};
	}, [element, target, close]);

	// Tapping the lit thing is the most natural "Next" there is. The tap still
	// does what it does (opens the tab, explains the verse).
	useEffect(() => {
		if (!element) return;
		const onTap = () => next();
		element.addEventListener("click", onTap);
		return () => element.removeEventListener("click", onTap);
	}, [element, next]);

	const open = stop !== null;
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, close]);

	// Focus moves to the caption's button when a stop first appears, not on
	// every scroll frame that moves the box.
	const shown = box !== null;
	useEffect(() => {
		if (shown) primaryRef.current?.focus({ preventScroll: true });
	}, [element, shown]);

	const nextLabel = isTour && !isLastStop ? "Next" : isTour ? "Done" : "Got it";
	useVoiceActionScope(stop && shown ? {
		key: `spotlight:${seq}:${target}`,
		priority: 100,
		narrateQuestion: true,
		question: stop.caption,
		actions: [
			{ label: nextLabel, run: () => {
				const current = getSpotlight();
				if (current.kind === "idle" || current.seq !== seq) return voice?.speak("The tour step changed. Say read options to hear the current step.");
				next();
			} },
			{ label: "Close", run: () => {
				const current = getSpotlight();
				if (current.kind === "idle" || current.seq !== seq) return voice?.speak("The tour step changed. Say read options to hear the current step.");
				close();
			} },
		],
	} : null);

	if (!stop || !box || typeof document === "undefined") return null;

	const viewportHeight = window.innerHeight;
	const below = viewportHeight - (box.top + box.height);
	const placement: React.CSSProperties =
		below >= BUBBLE_ROOM
			? { top: box.top + box.height + 12 }
			: box.top >= BUBBLE_ROOM
				? { bottom: viewportHeight - box.top + 12 }
				: { bottom: 16 };
	const bubbleLeft = Math.min(Math.max(16, box.left), Math.max(16, window.innerWidth - 16 - 352));

	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-[70]">
			{/* The cutout: one box whose enormous shadow is the dim layer. */}
			<div
				aria-hidden
				className="absolute rounded-2xl"
				style={{ ...box, boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)" }}
			/>
			<div aria-hidden className="spotlight-ring animate-pulse-glow absolute rounded-2xl" style={box} />
			<div
				role="dialog"
				aria-label="SureWord is showing you around"
				className="pointer-events-auto absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-amber-500/30 bg-white p-4 text-neutral-900 shadow-2xl dark:border-amber-300/25 dark:bg-neutral-900 dark:text-neutral-100"
				style={{ ...placement, left: bubbleLeft }}
			>
				<div className="flex items-start gap-3">
					<p aria-live="polite" className="flex-1 text-base leading-relaxed">
						{stop.caption}
					</p>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-neutral-200"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
				<div className="mt-3 flex items-center justify-between gap-3">
					<span className="text-sm text-neutral-500 dark:text-neutral-400">
						{state.kind === "tour" ? `${state.index + 1} of ${state.stops.length}` : ""}
					</span>
					<button
						ref={primaryRef}
						type="button"
						onClick={next}
						className="min-h-12 rounded-xl bg-[#e5b664] px-5 font-bold text-[#1c2118] transition-colors hover:bg-[#f0c77f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600"
					>
						{nextLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body
	);
}
