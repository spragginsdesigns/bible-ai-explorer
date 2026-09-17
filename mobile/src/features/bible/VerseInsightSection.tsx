import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { VerseInsightStatus } from "./useVerseInsight";

/**
 * The looping 0..1 value behind every skeleton in the verse sheet. Shared so
 * the Explain and Words tabs glow identically, and so the loop only runs while
 * something is actually pending.
 */
export function useSkeletonPulse(active: boolean): Animated.Value {
	const pulse = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (!active) return;
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1,
					duration: 1100,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(pulse, {
					toValue: 0,
					duration: 0,
					useNativeDriver: true,
				}),
			])
		);
		loop.start();
		return () => loop.stop();
	}, [active, pulse]);

	return pulse;
}

/** One softly glowing skeleton line; the shared pulse gives the group a wave. */
export function SkeletonBar({
	width,
	pulse,
	delay,
}: {
	width: number;
	pulse: Animated.Value;
	delay: number;
}) {
	const styles = useThemedStyles(createStyles);
	const opacity = pulse.interpolate({
		// Offset each bar along the pulse so the glow travels down the lines.
		inputRange: [0, delay, Math.min(delay + 0.5, 1), 1],
		outputRange: [0.35, 0.35, 0.9, 0.35],
	});
	return <Animated.View style={[styles.skeletonBar, { width: `${width}%`, opacity }]} />;
}

/**
 * The AI area of the Tap-a-verse sheet: glowing skeleton while the model
 * spins up, the streamed explanation once tokens arrive, or an error with a
 * retry. Mirrors the web panel in src/components/bible/ChapterReader.tsx.
 */
export function VerseInsightSection({
	status,
	text,
	error,
	onRetry,
}: {
	status: VerseInsightStatus;
	text: string;
	error: string | null;
	onRetry: () => void;
}) {
	const styles = useThemedStyles(createStyles);
	const pulse = useSkeletonPulse(status === "loading");

	if (status === "idle") return null;

	return (
		<View style={styles.container}>
			{status === "loading" ? (
				<View accessibilityLabel="Generating an explanation" style={styles.skeleton}>
					<SkeletonBar width={100} pulse={pulse} delay={0} />
					<SkeletonBar width={92} pulse={pulse} delay={0.18} />
					<SkeletonBar width={64} pulse={pulse} delay={0.36} />
				</View>
			) : status === "error" ? (
				<View style={styles.errorWrap}>
					<Text style={styles.errorText}>{error}</Text>
					<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={6}>
						<Text style={styles.retryLabel}>Try again</Text>
					</Pressable>
				</View>
			) : (
				<Text style={styles.insightText}>
					{text}
					{status === "streaming" ? <Text style={styles.caret}> ▍</Text> : null}
				</Text>
			)}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			minHeight: 64,
			justifyContent: "center",
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.md,
		},
		skeleton: { gap: spacing.sm },
		skeletonBar: {
			height: 13,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
		},
		insightText: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22 },
		caret: { color: c.accent },
		errorWrap: { gap: spacing.sm },
		errorText: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
		retryLabel: { color: c.accent, fontSize: 13.5, fontWeight: "600" },
	});
