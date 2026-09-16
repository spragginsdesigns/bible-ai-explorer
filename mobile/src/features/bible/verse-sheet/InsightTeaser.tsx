import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { SkeletonBar } from "@/features/bible/VerseInsightSection";
import type { VerseInsightStatus } from "@/features/bible/useVerseInsight";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { spacing, typography, type Colors } from "@/theme";

export interface InsightTeaserProps {
	status: VerseInsightStatus;
	text: string;
	error: string | null;
	/** Expand to the study view. */
	onPress: () => void;
	onRetry: () => void;
}

const PULSE_MS = 1100;

/** The first two lines of the explanation, and the way into the study view. */
export function InsightTeaser({
	status,
	text,
	error,
	onPress,
	onRetry,
}: InsightTeaserProps): React.JSX.Element {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const pulse = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (status !== "loading") return;
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1,
					duration: PULSE_MS,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
			])
		);
		loop.start();
		return () => loop.stop();
	}, [status, pulse]);

	const affordance = (
		<View style={styles.affordance}>
			<Text style={styles.affordanceLabel}>Study</Text>
			<Ionicons name="chevron-up" size={14} color={colors.accent} />
		</View>
	);

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Open the study view"
			onPress={onPress}
			style={({ pressed }) => [styles.container, pressed && styles.pressed]}
		>
			{status === "loading" ? (
				<View accessibilityLabel="Generating an explanation" style={styles.skeleton}>
					<SkeletonBar width={100} pulse={pulse} delay={0} />
					<SkeletonBar width={72} pulse={pulse} delay={0.18} />
				</View>
			) : status === "error" ? (
				<View style={styles.errorWrap}>
					{error ? <Text style={styles.errorText}>{error}</Text> : null}
					{/* Its own pressable so retrying never also expands the sheet. */}
					<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={6}>
						<Text style={styles.retryLabel}>Try again</Text>
					</Pressable>
				</View>
			) : (
				<View style={styles.body}>
					{text ? (
						<Text numberOfLines={2} style={styles.text}>
							{text}
						</Text>
					) : null}
					{affordance}
				</View>
			)}
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
		},
		pressed: { backgroundColor: c.surfacePressed },
		skeleton: { gap: spacing.sm },
		body: { gap: spacing.xs },
		text: { color: c.textSecondary, ...typography.support },
		affordance: {
			flexDirection: "row",
			alignItems: "center",
			alignSelf: "flex-end",
			gap: 2,
		},
		affordanceLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		errorWrap: { gap: spacing.xs },
		errorText: { color: c.textMuted, ...typography.meta },
		retryLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
	});
