import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	BackHandler,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	type LayoutChangeEvent,
} from "react-native";
import Animated, {
	Easing,
	cancelAnimation,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { AppText as Text } from "@/components/AppText";
import { GlyphButton } from "@/features/notes/components/primitives";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

export type VerseSheetTier = "peek" | "expanded";

export interface VerseSheetProps {
	open: boolean;
	tier: VerseSheetTier;
	onTierChange: (tier: VerseSheetTier) => void;
	onClose: () => void;
	title: string;
	subtitle?: string;
	/** Distance from the bottom of the parent to keep clear (the floating tab bar). */
	bottomOffset: number;
	/** Rendered in the peek tier only, between the header and the footer. */
	peek: React.ReactNode;
	/** Rendered in the expanded tier only, inside a vertical ScrollView between header and footer. */
	children: React.ReactNode;
	/** Pinned at the bottom of the sheet in BOTH tiers (the action bar). */
	footer: React.ReactNode;
}

const SHEET_SPRING = { damping: 26, stiffness: 280, overshootClamping: true } as const;
const OPEN_MS = 240;
const CLOSE_MS = 220;
const BACKDROP_MS = 180;
/** Fraction of the parent the expanded tier occupies. */
const EXPANDED_RATIO = 0.9;
/** Travel allowed past the expanded height, and how much of a drag reaches it. */
const OVERDRAG_MAX = 24;
const OVERDRAG_RESISTANCE = 0.25;
/** Release thresholds: a fast flick wins, otherwise the nearer snap point does. */
const DISMISS_VELOCITY = 900;
const EXPAND_VELOCITY = -700;
const DISMISS_HEIGHT_RATIO = 0.6;
const MIN_DRAG_RATIO = 0.5;
/** A tap must not be read as a drag; only a real vertical move activates the pan. */
const PAN_ACTIVATION = 8;

/** Layout height of a subtree, rounded up so a subpixel row never clips. */
function useMeasuredHeight(): [number, (event: LayoutChangeEvent) => void] {
	const [height, setHeight] = useState(0);
	const onLayout = useCallback((event: LayoutChangeEvent) => {
		const next = Math.ceil(event.nativeEvent.layout.height);
		setHeight((current) => (Math.abs(current - next) < 1 ? current : next));
	}, []);
	return [height, onLayout];
}

/**
 * Two-tier reader sheet. Non-modal on purpose: the chapter stays tappable
 * behind the peek tier so multi-verse selection keeps working while the sheet
 * is up, which a Modal (its own window, its own touch target) cannot do.
 */
export function VerseSheet({
	open,
	tier,
	onTierChange,
	onClose,
	title,
	subtitle,
	bottomOffset,
	peek,
	children,
	footer,
}: VerseSheetProps): React.JSX.Element | null {
	const styles = useThemedStyles(createStyles);
	const [mounted, setMounted] = useState(open);
	const [available, onAvailableLayout] = useMeasuredHeight();
	const [headerHeight, onHeaderLayout] = useMeasuredHeight();
	const [peekBodyHeight, onPeekBodyLayout] = useMeasuredHeight();
	const [footerHeight, onFooterLayout] = useMeasuredHeight();

	const height = useSharedValue(0);
	const translateY = useSharedValue(0);
	const backdropOpacity = useSharedValue(0);
	const dragStart = useSharedValue(0);
	// The gesture runs on the UI thread, so its snap points have to live in
	// shared values rather than in the closure over this render's numbers.
	const peekTarget = useSharedValue(0);
	const expandedTarget = useSharedValue(0);

	const peekHeight = Math.max(headerHeight + peekBodyHeight + footerHeight, 1);
	const expandedHeight =
		available > 0 ? Math.max(Math.round(available * EXPANDED_RATIO), peekHeight) : peekHeight;
	const targetHeight = tier === "expanded" ? expandedHeight : peekHeight;

	// Callbacks reached from the UI thread and from the back handler must be
	// stable, so they read the newest props through a ref instead of closing
	// over them.
	const latest = useRef({ open, tier, onClose, onTierChange });
	useEffect(() => {
		latest.current = { open, tier, onClose, onTierChange };
	});

	const requestClose = useCallback(() => {
		latest.current.onClose();
	}, []);
	const requestTier = useCallback((next: VerseSheetTier) => {
		if (latest.current.tier !== next) latest.current.onTierChange(next);
	}, []);
	const finishClose = useCallback(() => {
		// A reopen mid-close must survive the outgoing animation's callback.
		if (!latest.current.open) setMounted(false);
	}, []);

	useEffect(() => {
		peekTarget.value = peekHeight;
	}, [peekHeight, peekTarget]);
	useEffect(() => {
		expandedTarget.value = expandedHeight;
	}, [expandedHeight, expandedTarget]);

	useEffect(() => {
		if (open) setMounted(true);
	}, [open]);

	// The first real header measurement is the cue to slide in: before it the
	// sheet has no height to travel, and animating from zero reads as a grow.
	const opened = useRef(false);
	useEffect(() => {
		if (!open) {
			opened.current = false;
			return;
		}
		// A reopen arrives one render before the sheet is back on screen; the
		// slide must not start until it is, or its first frames are lost.
		if (!mounted || opened.current || headerHeight === 0) return;
		opened.current = true;
		height.value = targetHeight;
		translateY.value = targetHeight;
		translateY.value = withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
	}, [open, mounted, headerHeight, targetHeight, height, translateY]);

	useEffect(() => {
		if (open || !mounted) return;
		translateY.value = withTiming(
			height.value + OVERDRAG_MAX,
			{ duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
			(finished) => {
				"worklet";
				if (finished) scheduleOnRN(finishClose);
			}
		);
	}, [open, mounted, translateY, height, finishClose]);

	// The parent owns the tier, so a tap elsewhere (the teaser, the backdrop)
	// animates through exactly the same path as a drag.
	useEffect(() => {
		// A closing sheet keeps its geometry: its content may shrink as the
		// parent tears state down, and re-snapping mid-slide reads as a jolt.
		if (!mounted || !open || height.value === 0) return;
		height.value = withSpring(targetHeight, SHEET_SPRING);
	}, [mounted, open, targetHeight, height]);

	useEffect(() => {
		if (!mounted) return;
		backdropOpacity.value = withTiming(open && tier === "expanded" ? 1 : 0, {
			duration: BACKDROP_MS,
		});
	}, [mounted, open, tier, backdropOpacity]);

	useEffect(() => {
		if (!open) return;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			if (latest.current.tier === "expanded") latest.current.onTierChange("peek");
			else latest.current.onClose();
			return true;
		});
		return () => subscription.remove();
	}, [open]);

	const makePan = useCallback(
		() =>
			Gesture.Pan()
				.activeOffsetY([-PAN_ACTIVATION, PAN_ACTIVATION])
				.onStart(() => {
					"worklet";
					cancelAnimation(height);
					dragStart.value = height.value;
				})
				.onUpdate((event) => {
					"worklet";
					const raw = dragStart.value - event.translationY;
					const ceiling = expandedTarget.value;
					const next =
						raw > ceiling
							? ceiling + Math.min((raw - ceiling) * OVERDRAG_RESISTANCE, OVERDRAG_MAX)
							: raw;
					height.value = Math.max(next, peekTarget.value * MIN_DRAG_RATIO);
				})
				.onEnd((event, success) => {
					"worklet";
					const peekAt = peekTarget.value;
					const expandedAt = expandedTarget.value;
					if (!success) {
						// A cancelled or failed pan (another recognizer won, the OS
						// interrupted) must not dismiss; settle back on the current tier.
						height.value = withSpring(
							height.value > (peekAt + expandedAt) / 2 ? expandedAt : peekAt,
							SHEET_SPRING
						);
						return;
					}
					if (
						event.velocityY > DISMISS_VELOCITY ||
						height.value < peekAt * DISMISS_HEIGHT_RATIO
					) {
						scheduleOnRN(requestClose);
						return;
					}
					const expand =
						event.velocityY < EXPAND_VELOCITY || height.value > (peekAt + expandedAt) / 2;
					height.value = withSpring(expand ? expandedAt : peekAt, SHEET_SPRING);
					scheduleOnRN(requestTier, expand ? "expanded" : "peek");
				}),
		[dragStart, expandedTarget, height, peekTarget, requestClose, requestTier]
	);

	// One gesture instance cannot drive two detectors, so the header and the
	// peek body each get their own copy of the same behavior.
	const headerPan = useMemo(makePan, [makePan]);
	const peekPan = useMemo(makePan, [makePan]);

	const toggleTier = useCallback(() => {
		onTierChange(tier === "expanded" ? "peek" : "expanded");
	}, [onTierChange, tier]);

	const collapse = useCallback(() => onTierChange("peek"), [onTierChange]);

	const sheetStyle = useAnimatedStyle(() => ({
		// Until the first measurement the sheet takes its natural height,
		// invisible: a fixed 0 with overflow hidden would clip every child out of
		// existence before their layout events fired, and the peek height they
		// report is what the open animation needs.
		height: height.value > 0 ? height.value : undefined,
		opacity: height.value > 0 ? 1 : 0,
		transform: [{ translateY: translateY.value }],
	}));
	const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

	if (!mounted) return null;

	const expanded = tier === "expanded";

	return (
		<View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onAvailableLayout}>
			<Animated.View
				pointerEvents={expanded ? "auto" : "none"}
				// pointerEvents stops touches but not TalkBack; a hidden full-screen
				// button over the chapter must leave the tree with them.
				importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
				style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
			>
				{expanded ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Collapse details"
						onPress={collapse}
						style={styles.backdropFill}
					/>
				) : null}
			</Animated.View>

			<Animated.View
				accessibilityViewIsModal={false}
				style={[styles.sheet, { bottom: bottomOffset }, sheetStyle]}
			>
				<GestureDetector gesture={headerPan}>
					<View collapsable={false} onLayout={onHeaderLayout}>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={expanded ? "Collapse details" : "Expand details"}
							onPress={toggleTier}
							style={styles.grabberHit}
						>
							<View style={styles.grabber} />
						</Pressable>
						<View style={styles.header}>
							<View style={styles.headerText}>
								<Text style={styles.title} numberOfLines={1}>
									{title}
								</Text>
								{subtitle ? (
									<Text style={styles.subtitle} numberOfLines={1}>
										{subtitle}
									</Text>
								) : null}
							</View>
							<GlyphButton icon="close" accessibilityLabel="Close" onPress={onClose} size={32} />
						</View>
					</View>
				</GestureDetector>

				{expanded ? (
					<ScrollView
						style={styles.scroll}
						contentContainerStyle={styles.scrollContent}
						keyboardShouldPersistTaps="handled"
					>
						{children}
					</ScrollView>
				) : (
					<GestureDetector gesture={peekPan}>
						<View style={styles.peekWrap}>
							<View collapsable={false} onLayout={onPeekBodyLayout}>
								{peek}
							</View>
						</View>
					</GestureDetector>
				)}

				<View collapsable={false} style={styles.footer} onLayout={onFooterLayout}>
					{footer}
				</View>
			</Animated.View>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		backdrop: { backgroundColor: "rgba(0, 0, 0, 0.35)" },
		backdropFill: { flex: 1 },
		sheet: {
			position: "absolute",
			left: 0,
			right: 0,
			overflow: "hidden",
			// Content overflows off the top while the sheet is dragged below its
			// peek height, which keeps the action bar in place as it leaves.
			justifyContent: "flex-end",
			backgroundColor: c.bgElevated,
			borderTopLeftRadius: radius.xl,
			borderTopRightRadius: radius.xl,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			elevation: 12,
			shadowColor: "#000000",
			shadowOpacity: 0.35,
			shadowRadius: 18,
			shadowOffset: { width: 0, height: -6 },
		},
		grabberHit: {
			alignSelf: "center",
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.xl,
		},
		grabber: {
			width: 36,
			height: 4,
			borderRadius: radius.full,
			backgroundColor: c.borderStrong,
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.sm,
		},
		headerText: { flex: 1, gap: 2 },
		title: { color: c.text, ...typography.control, fontWeight: "700" },
		subtitle: { color: c.textFaint, ...typography.meta },
		scroll: { flex: 1 },
		scrollContent: { paddingBottom: spacing.md },
		// Absorbs the extra space of an upward drag, so the peek body nested
		// inside it keeps the natural height the peek snap point is measured from.
		peekWrap: { flexGrow: 1 },
		footer: { paddingBottom: spacing.md },
	});
