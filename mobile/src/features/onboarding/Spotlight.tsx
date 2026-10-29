import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	useWindowDimensions,
	type ScrollViewProps,
	type StyleProp,
	type ViewStyle,
} from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import Animated, {
	cancelAnimation,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { track as trackEvent, ANALYTICS_EVENTS } from "@/lib/analytics";
import { hrefForTarget, isKnownTarget, SPOTLIGHT_NAVIGATION_OPTIONS } from "./spotlightRoutes";
import { useVoiceControls } from "@/features/voice/VoiceControlProvider";

/**
 * The gold spotlight (Walk with me): dims the app and rings one named place,
 * with a sentence from SureWord. "Show me" cards light up one place; the tour
 * lights up each stop in turn. Targets are registered by name with
 * `SpotlightAnchor`, measured in the window, and a target this build cannot
 * find is skipped silently rather than ringing nothing.
 */

export interface SpotlightStop {
	target: string;
	caption: string;
}

interface SpotlightState {
	stops: SpotlightStop[];
	index: number;
	/** "tour" or "show", for the funnel. */
	kind: "tour" | "show";
}

let state: SpotlightState | null = null;
const listeners = new Set<() => void>();
let onFinished: ((completed: boolean) => void) | null = null;

function emit() {
	listeners.forEach((listener) => listener());
}

function setState(next: SpotlightState | null) {
	state = next;
	emit();
}

/** Light up one place, or a whole tour. `done` runs once it closes. */
export function startSpotlight(stops: SpotlightStop[], kind: "tour" | "show", done?: (completed: boolean) => void) {
	const known = stops.filter((stop) => isKnownTarget(stop.target) && stop.target !== "tour");
	if (known.length === 0) {
		done?.(false);
		return;
	}
	onFinished = done ?? null;
	// Same property names as web and Apple, so the tour funnel is one series.
	if (kind === "tour") trackEvent(ANALYTICS_EVENTS.onboardingTour, { stage: "started", stops_seen: 0, stops: known.length });
	setState({ stops: known, index: 0, kind });
}

function finish(completed: boolean) {
	const current = state;
	setState(null);
	if (current?.kind === "tour") {
		trackEvent(ANALYTICS_EVENTS.onboardingTour, {
			stage: completed ? "finished" : "left",
			stops_seen: current.index + 1,
			stops: current.stops.length,
		});
	}
	const callback = onFinished;
	onFinished = null;
	callback?.(completed);
}

function advance() {
	if (!state) return;
	if (state.index + 1 >= state.stops.length) finish(true);
	else setState({ ...state, index: state.index + 1 });
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useSpotlightActive(): boolean {
	return useSyncExternalStore(subscribe, () => state !== null);
}

interface SpotlightScroll {
	ref: React.RefObject<ScrollView | null>;
	/** Last vertical offset reported by onScroll. */
	offset: React.RefObject<number>;
}

const registry = new Map<string, { node: View; scroll: SpotlightScroll | null }>();
const ScrollContext = createContext<SpotlightScroll | null>(null);

/**
 * A ScrollView whose anchors can be scrolled into view. Largest text and the
 * Getting started card push targets like today's cross below the fold, and a
 * ring drawn off screen leaves only a dimmed app.
 */
export function SpotlightScrollView({ onScroll, scrollEventThrottle, ...props }: ScrollViewProps) {
	const ref = useRef<ScrollView | null>(null);
	const offset = useRef(0);
	const value = useMemo(() => ({ ref, offset }), []);
	return (
		<ScrollContext.Provider value={value}>
			<ScrollView
				ref={ref}
				{...props}
				scrollEventThrottle={scrollEventThrottle ?? 32}
				onScroll={(event) => {
					offset.current = event.nativeEvent.contentOffset.y;
					onScroll?.(event);
				}}
			/>
		</ScrollContext.Provider>
	);
}

/**
 * Register a place the spotlight can ring. Wrap the real control; the View
 * is the measured box. Several anchors may share a name (the same tab on two
 * screens): the most recent mount wins, which is the one on screen.
 */
export function SpotlightAnchor({
	target,
	style,
	children,
}: {
	target: string;
	style?: StyleProp<ViewStyle>;
	children: React.ReactNode;
}) {
	const ref = useRef<View | null>(null);
	const scroll = useContext(ScrollContext);
	const attach = useCallback(
		(node: View | null) => {
			if (node) {
				ref.current = node;
				registry.set(target, { node, scroll });
			} else if (ref.current && registry.get(target)?.node === ref.current) {
				registry.delete(target);
				ref.current = null;
			}
		},
		[target, scroll]
	);
	return (
		<View ref={attach} collapsable={false} style={style}>
			{children}
		</View>
	);
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A target can take a moment to mount after navigating; wait for it this long. */
const FIND_TIMEOUT_MS = 6000;
const FIND_POLL_MS = 120;
const RING_PAD = 6;

type Measurable = Pick<View, "measureInWindow">;

function measureNode(node: Measurable): Promise<Rect | null> {
	return new Promise((resolve) => {
		node.measureInWindow((x, y, width, height) => {
			resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
		});
	});
}

function measure(target: string): Promise<Rect | null> {
	const node = registry.get(target)?.node;
	return node ? measureNode(node) : Promise.resolve(null);
}

function sameRect(a: Rect, b: Rect): boolean {
	return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * Scroll a target's ScrollView so it sits in the upper third. False when it has
 * none. Scrolling by d moves the target's window position by exactly d, so its
 * measured box and the last offset are enough. Nothing else is measured: the
 * content container can be flattened away on the new architecture, and
 * measuring the native scroll view never called back on device, which stalled
 * the whole stop with no ring.
 */
function reveal(target: string, box: Rect, viewportHeight: number, animated: boolean): boolean {
	const entry = registry.get(target);
	const scroll = entry?.scroll?.ref.current;
	if (!entry?.scroll || !scroll) return false;
	const y = entry.scroll.offset.current + box.y - viewportHeight * 0.3;
	scroll.scrollTo({ y: Math.max(0, y), animated });
	return true;
}

async function findTarget(target: string, isCurrent: () => boolean): Promise<Rect | null> {
	const started = Date.now();
	while (Date.now() - started < FIND_TIMEOUT_MS && isCurrent()) {
		const rect = await measure(target);
		if (rect) return rect;
		await new Promise((resolve) => setTimeout(resolve, FIND_POLL_MS));
	}
	return null;
}

/** Rendered once, above the tabs. Draws whatever the spotlight store says. */
export function SpotlightOverlay() {
	const current = useSyncExternalStore(subscribe, () => state);
	const voice = useVoiceControls();
	const registerCard = voice?.registerCard;
	const speak = voice?.speak;
	const voiceEnabled = voice?.enabled;
	const voicePath = usePathname();
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const { width: windowWidth, height: windowHeight } = useWindowDimensions();
	const reduceMotion = useReducedMotion();
	const [rect, setRect] = useState<Rect | null>(null);
	const pulse = useSharedValue(0);
	const stop = current ? current.stops[current.index] : null;
	useEffect(() => {
		if (!current || !stop || !registerCard) return;
		const next = current.index === current.stops.length - 1 ? "Got it" : "Next";
		const unregister = registerCard({ question: stop.caption, options: [next, "Close tour"], choose: (label) => { if (label === "Close tour") finish(false); else advance(); } });
		if (voiceEnabled) void speak?.(`${stop.caption} Option one. ${next}. Option two. Close tour.`);
		return unregister;
	}, [current, stop, registerCard, speak, voiceEnabled, voicePath]);
	const viewport = useRef({ height: windowHeight, reduceMotion });
	viewport.current = { height: windowHeight, reduceMotion };

	useEffect(() => {
		setRect(null);
		if (!current || !stop) return;
		let live = true;
		const href = hrefForTarget(stop.target);
		if (href) router.navigate(href as Href, SPOTLIGHT_NAVIGATION_OPTIONS);
		const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
		void (async () => {
			const found = await findTarget(stop.target, () => live);
			if (!live) return;
			// Not on this build or not on screen: move on instead of ringing nothing.
			if (!found) {
				advance();
				return;
			}
			const { height, reduceMotion: still } = viewport.current;
			const offscreen = (box: Rect) => box.y < spacing.xl || box.y + box.height > height - 140;
			let reveals = 0;
			if (offscreen(found) && reveal(stop.target, found, height, !still)) reveals = 1;
			else setRect(found);
			// Keep following the target while the stop is open: the reader jumps
			// itself to John 3:16 after mounting, and a screen that just navigated or
			// scrolled settles late, either of which would strand the ring. A tab
			// that was already mounted is first measured from its stale layout (the
			// cross button read y=616, then settled at 1006 in a 914 window under
			// Largest text), so an off-screen target is revealed whenever it is seen.
			while (live) {
				await settle();
				if (!live) return;
				const next = await measure(stop.target);
				if (!live || !next) continue;
				if (offscreen(next) && reveals < 4 && reveal(stop.target, next, height, !still)) {
					reveals += 1;
					continue;
				}
				setRect((prev) => (prev && sameRect(prev, next) ? prev : next));
			}
		})();
		return () => {
			live = false;
		};
	}, [current, stop, router]);

	useEffect(() => {
		if (!rect || reduceMotion) {
			cancelAnimation(pulse);
			pulse.value = 0;
			return;
		}
		pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true);
		return () => cancelAnimation(pulse);
	}, [rect, reduceMotion, pulse]);

	const ringStyle = useAnimatedStyle(() => ({
		opacity: 0.75 + pulse.value * 0.25,
		transform: [{ scale: 1 + pulse.value * 0.04 }],
	}));

	if (!current || !stop) return null;
	const last = current.index + 1 >= current.stops.length;
	const hole = rect
		? {
				x: rect.x - RING_PAD,
				y: rect.y - RING_PAD,
				width: rect.width + RING_PAD * 2,
				height: rect.height + RING_PAD * 2,
			}
		: null;
	// The sentence sits on whichever side has more room.
	const captionBelow = hole ? hole.y + hole.height / 2 < windowHeight / 2 : true;

	return (
		<Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => finish(false)}>
			{hole ? (
				<>
					<View style={[styles.dim, { left: 0, top: 0, width: windowWidth, height: Math.max(0, hole.y) }]} />
					<View style={[styles.dim, { left: 0, top: hole.y + hole.height, width: windowWidth, bottom: 0 }]} />
					<View style={[styles.dim, { left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.height }]} />
					<View style={[styles.dim, { left: hole.x + hole.width, top: hole.y, right: 0, height: hole.height }]} />
					<Animated.View
						pointerEvents="none"
						style={[styles.ring, { left: hole.x, top: hole.y, width: hole.width, height: hole.height }, ringStyle]}
					/>
					<View
						style={[
							styles.bubble,
							captionBelow
								? { top: Math.min(hole.y + hole.height + spacing.md, windowHeight - 220) }
								: { bottom: Math.max(windowHeight - hole.y + spacing.md, spacing.xl) },
						]}
					>
						<Text style={styles.caption}>{stop.caption}</Text>
						<View style={styles.bubbleActions}>
							{current.stops.length > 1 ? (
								<Text style={styles.count}>
									{current.index + 1} of {current.stops.length}
								</Text>
							) : null}
							{current.stops.length > 1 && !last ? (
								<Pressable accessibilityRole="button" onPress={() => finish(false)} style={styles.quiet}>
									<Text style={styles.quietText}>Close</Text>
								</Pressable>
							) : null}
							<Pressable
								accessibilityRole="button"
								onPress={advance}
								style={({ pressed }) => [styles.next, pressed && { opacity: 0.8 }]}
							>
								<Text style={styles.nextText}>{last ? "Got it" : "Next"}</Text>
							</Pressable>
						</View>
					</View>
				</>
			) : (
				<>
					<View style={[styles.dim, StyleSheet.absoluteFill]} />
					{/* While a slow place is still being found the dim swallows every
					    touch, so it always carries a way out. */}
					<View style={[styles.bubble, { bottom: spacing.xl * 3 }]}>
						<View style={styles.bubbleActions}>
							<Pressable accessibilityRole="button" onPress={() => finish(false)} style={styles.quiet}>
								<Text style={styles.quietText}>Close</Text>
							</Pressable>
						</View>
					</View>
				</>
			)}
		</Modal>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		dim: { position: "absolute", backgroundColor: "rgba(0, 0, 0, 0.62)" },
		ring: {
			position: "absolute",
			borderWidth: 3,
			borderColor: c.accent,
			borderRadius: radius.lg,
			shadowColor: c.accent,
			shadowOpacity: 0.9,
			shadowRadius: 12,
			elevation: 12,
		},
		bubble: {
			position: "absolute",
			left: spacing.lg,
			right: spacing.lg,
			gap: spacing.md,
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.bgElevated,
			borderWidth: 1,
			borderColor: c.accentBorder,
		},
		caption: { ...typography.body, color: c.text },
		bubbleActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		count: { ...typography.meta, color: c.textMuted, marginRight: "auto" },
		quiet: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, marginLeft: "auto" },
		quietText: { ...typography.meta, color: c.textSecondary },
		next: {
			minHeight: 48,
			minWidth: 96,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			borderRadius: radius.md,
			backgroundColor: c.accent,
		},
		nextText: { ...typography.control, color: c.bg, fontWeight: "700" },
	});
