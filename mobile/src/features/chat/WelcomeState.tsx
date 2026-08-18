import React, { useEffect, useRef } from "react";
import {
	Animated,
	Easing,
	Image,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { BrandTitle } from "@/components/ui";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { useSuggestedQuestions } from "./useSuggestedQuestions";

/** Chip-shaped placeholders while this user's own questions are being drawn. */
const SKELETON_WIDTHS = ["82%", "68%", "90%", "74%", "61%", "86%"] as const;

function QuestionSkeleton() {
	const styles = useThemedStyles(createStyles);
	const pulse = useRef(new Animated.Value(0.35)).current;

	useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1,
					duration: 1100,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(pulse, { toValue: 0.35, duration: 1100, useNativeDriver: true }),
			])
		);
		loop.start();
		return () => loop.stop();
	}, [pulse]);

	return (
		<View accessibilityLabel="Preparing your questions" style={styles.chips}>
			{SKELETON_WIDTHS.map((width, index) => (
				<View key={index} style={styles.chip}>
					<Animated.View style={[styles.skeletonBar, { width, opacity: pulse }]} />
				</View>
			))}
		</View>
	);
}

export function WelcomeState({
	onSelectQuestion,
	bottomInset,
}: {
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { questions, loading } = useSuggestedQuestions();
	return (
		<ScrollView
			style={styles.fill}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			showsVerticalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
		>
			<View style={styles.halo}>
				<Image
					source={require("../../../assets/icon.png")}
					style={styles.haloMark}
					resizeMode="cover"
					accessibilityIgnoresInvertColors
				/>
			</View>
			<BrandTitle size={52} style={styles.brand} />
			<Text style={styles.tagline}>
				Ask anything about the Bible — answered by an AI that actually believes it. Every answer
				stands on the King James Scriptures as God&apos;s inerrant, final authority.
			</Text>

			{loading ? (
				<QuestionSkeleton />
			) : (
				<View style={styles.chips}>
					{questions.map((question) => (
						<Pressable
							key={question}
							accessibilityRole="button"
							onPress={() => onSelectQuestion(question)}
							style={({ pressed }) => [
								styles.chip,
								pressed && {
									backgroundColor: colors.surfacePressed,
									borderColor: colors.accentBorder,
								},
							]}
						>
							<Text style={styles.chipLabel}>{question}</Text>
							<Text style={styles.chipGlyph}>↗</Text>
						</Pressable>
					))}
				</View>
			)}
		</ScrollView>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		content: {
			flexGrow: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: spacing.xl,
			paddingTop: spacing.xxl,
		},
		halo: {
			width: 72,
			height: 72,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			marginBottom: spacing.lg,
		},
		// Slightly oversized inside the halo so the mark's own padding does not
		// read as a gap between the artwork and the ring.
		haloMark: { width: "100%", height: "100%", borderRadius: radius.full, transform: [{ scale: 1.1 }] },
		brand: { color: c.accent },
		tagline: {
			marginTop: spacing.sm,
			color: c.textMuted,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
			maxWidth: 320,
		},
		chips: { alignSelf: "stretch", marginTop: spacing.xxl, gap: spacing.sm },
		chip: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		chipLabel: { flex: 1, color: c.textSecondary, fontSize: 14, lineHeight: 20 },
		skeletonBar: { height: 14, borderRadius: radius.full, backgroundColor: c.accentSoft },
		chipGlyph: { color: c.textGhost, fontSize: 13 },
	});
