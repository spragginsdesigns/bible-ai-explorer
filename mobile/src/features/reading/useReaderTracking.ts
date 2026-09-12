import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AppState, type ViewToken } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@clerk/expo";
import { recordVisibleReading, touchReadingSession } from "./readingLogStore";
import { VerseDwellTracker, SESSION_IDLE_MS } from "./readingLogCore";

/** Event-driven visibility tracking: one next-dwell timer, never a polling interval. */
export function useReaderTracking(input: {
	book: number;
	chapter: number;
	translation: string;
	verseCount: number;
	ready: boolean;
	obscured: boolean;
}) {
	const { userId } = useAuth();
	const config = useRef({ ...input, userId });
	config.current = { ...input, userId };
	const visible = useRef<number[]>([]);
	const focused = useRef(false);
	const active = useRef(AppState.currentState === "active");
	const dwell = useRef(new VerseDwellTracker());
	const lastActivity = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancel = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	}, []);
	const pause = useCallback(() => {
		cancel();
		dwell.current.pause();
	}, [cancel]);
	const arm = useCallback(
		function scheduleDwell() {
			cancel();
			const at = config.current;
			if (
				!focused.current ||
				!active.current ||
				!at.ready ||
				at.obscured ||
				!at.userId ||
				!visible.current.length
			)
				return;
			const now = performance.now();
			if (now - lastActivity.current >= SESSION_IDLE_MS) dwell.current.reset();
			lastActivity.current = now;
			dwell.current.update(visible.current, now);
			const delay = dwell.current.nextDelay(now);
			if (delay === null) return;
			const owner = at.userId;
			timer.current = setTimeout(() => {
				timer.current = null;
				if (
					!focused.current ||
					!active.current ||
					config.current.obscured ||
					config.current.userId !== owner ||
					!config.current.ready ||
					config.current.book !== at.book ||
					config.current.chapter !== at.chapter ||
					config.current.translation !== at.translation
				)
					return;
				const verses = dwell.current.due(performance.now());
				if (verses.length)
					void recordVisibleReading(owner, {
						book: at.book,
						chapter: at.chapter,
						translation: at.translation,
						verseCount: at.verseCount,
						verses,
						now: Date.now(),
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
					}).catch(() => {
						dwell.current.reset();
					});
				scheduleDwell();
			}, delay);
		},
		[cancel]
	);
	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			arm();
			return () => {
				focused.current = false;
				pause();
			};
		}, [arm, pause])
	);
	useEffect(() => {
		const change = AppState.addEventListener("change", (state) => {
			active.current = state === "active";
			if (active.current) arm();
			else pause();
		});
		const blur = AppState.addEventListener("blur", () => {
			active.current = false;
			pause();
		});
		const focus = AppState.addEventListener("focus", () => {
			active.current = AppState.currentState === "active";
			arm();
		});
		return () => {
			change.remove();
			blur.remove();
			focus.remove();
			pause();
		};
	}, [arm, pause]);
	useLayoutEffect(() => {
		visible.current = [];
		dwell.current.reset();
		cancel();
	}, [input.book, input.chapter, input.translation, cancel]);
	useLayoutEffect(() => {
		dwell.current.reset();
		arm();
		return pause;
	}, [userId, arm, pause]);
	useEffect(() => {
		if (input.obscured) pause();
		else arm();
		return pause;
	}, [input.ready, input.obscured, userId, arm, pause]);
	const onViewableItemsChanged = useCallback(
		({ viewableItems }: { viewableItems: ViewToken<string>[] }) => {
			const next = viewableItems
				.filter((v) => v.isViewable && v.index !== null)
				.map((v) => v.index! + 1);
			if (next.join(",") === visible.current.join(",")) return;
			visible.current = next;
			arm();
			if (
				config.current.userId &&
				active.current &&
				focused.current &&
				!config.current.obscured
			)
				touchReadingSession(config.current.userId);
		},
		[arm]
	);
	const onScrollBeginDrag = useCallback(() => {
		arm();
		if (
			config.current.userId &&
			focused.current &&
			active.current &&
			!config.current.obscured
		)
			touchReadingSession(config.current.userId);
	}, [arm]);
	// Small verses qualify when fully visible; very long verses also qualify when
	// occupying a substantial portion of the viewport, regardless of font size.
	return {
		onViewableItemsChanged,
		onScrollBeginDrag,
		viewabilityConfig: useRef({ viewAreaCoveragePercentThreshold: 35 }).current,
	};
}
