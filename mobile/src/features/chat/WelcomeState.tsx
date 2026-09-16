import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import { fonts, radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import { buildSuggestedQuestionItems, type SuggestedQuestionItem } from "./questionPresentation";

export const WELCOME_HEADLINE = "Come hungry for the Word.";

/**
 * How many opening questions show before the reveal row. Four rows plus the
 * hero fit above the docked composer on a phone without scrolling; the server
 * still sends six, and the reveal keeps every one of them reachable.
 */
export const VISIBLE_QUESTION_COUNT = 4;

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
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [pulse]);

	return (
		<View accessibilityLabel="Preparing your questions" style={styles.questionsSection}>
			<SectionHeading />
			{(["16%", "29%", "12%", "24%"] as const).map((trailing) => (
				<View key={trailing} style={styles.questionRow}>
					<Animated.View style={[styles.skeletonReference, { opacity: pulse }]} />
					<Animated.View
						style={[styles.skeletonRowLine, { marginRight: trailing, opacity: pulse }]}
					/>
				</View>
			))}
		</View>
	);
}

function SectionHeading() {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.sectionHeading}>
			<Text style={styles.sectionHeadingText}>CHOSEN FROM YOUR STUDY</Text>
			<View style={styles.sectionRule} />
			<Ionicons name="sparkles" size={12} style={styles.sectionSpark} />
		</View>
	);
}

function QuestionRow({
	item,
	onPress,
}: {
	item: SuggestedQuestionItem;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={item.question}
			onPress={onPress}
			style={({ pressed }) => [
				styles.questionRow,
				pressed && { backgroundColor: colors.accentPressed },
			]}
		>
			{item.label ? <Text style={styles.questionReference}>{item.label}</Text> : null}
			<Text style={styles.questionLabel}>{item.question}</Text>
			<Ionicons name="chevron-forward" size={19} color={colors.accentDim} />
		</Pressable>
	);
}

/**
 * The empty Chat tab. The composer is not rendered here: `index.tsx` docks it
 * at the bottom in every state, so it never moves when the first answer
 * arrives. This screen owns what sits above it - the mark and the headline,
 * centred in whatever room the keyboard leaves, and the opening questions
 * gathered just above the composer where the thumb already is.
 */
export function WelcomeState({
	onSelectQuestion,
	bottomInset,
}: {
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
}) {
	const styles = useThemedStyles(createStyles);
	const { questions, loading } = useSuggestedQuestions();
	const questionItems = useMemo(() => buildSuggestedQuestionItems(questions), [questions]);
	const [showAll, setShowAll] = useState(false);
	const hiddenCount = Math.max(0, questionItems.length - VISIBLE_QUESTION_COUNT);
	const visibleItems =
		showAll || hiddenCount === 0 ? questionItems : questionItems.slice(0, VISIBLE_QUESTION_COUNT);

	return (
		<ScrollView
			style={styles.fill}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			showsVerticalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
		>
			<View style={styles.hero}>
				<SureWordGuideAvatar variant="hero" size={96} />
				<Text style={styles.headline}>{WELCOME_HEADLINE}</Text>
			</View>

			{loading ? (
				<QuestionSkeleton />
			) : visibleItems.length > 0 ? (
				<View style={styles.questionsSection}>
					<SectionHeading />
					{visibleItems.map((item) => (
						<QuestionRow
							key={item.key}
							item={item}
							onPress={() => onSelectQuestion(item.question)}
						/>
					))}
					{!showAll && hiddenCount > 0 ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Show ${hiddenCount} more ${hiddenCount === 1 ? "question" : "questions"} from your study`}
							onPress={() => setShowAll(true)}
							style={({ pressed }) => [styles.moreRow, pressed && styles.moreRowPressed]}
						>
							<Text style={styles.moreLabel}>
								+{hiddenCount} more from your study
							</Text>
							<Ionicons name="chevron-down" size={16} style={styles.moreIcon} />
						</Pressable>
					) : null}
				</View>
			) : null}
		</ScrollView>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		content: {
			flexGrow: 1,
			paddingHorizontal: spacing.lg,
		},
		// Grows to take whatever the questions leave, so the mark floats in the
		// middle of the free space on a tall screen. It keeps its own height
		// (flexShrink stays 0), so with the keyboard up it scrolls out of the
		// way rather than squashing the mark. No minHeight on purpose.
		hero: {
			flexGrow: 1,
			alignItems: "center",
			justifyContent: "center",
			paddingVertical: spacing.xl,
		},
		headline: {
			color: c.accent,
			fontFamily: fonts.brand,
			fontSize: 28,
			lineHeight: 34,
			marginTop: spacing.md,
			textAlign: "center",
		},
		questionsSection: { paddingBottom: spacing.md },
		sectionHeading: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginBottom: spacing.xs,
		},
		sectionHeadingText: {
			...typography.meta,
			color: c.accent,
			fontWeight: "600",
			letterSpacing: 2,
		},
		sectionRule: { flex: 1, height: 1, backgroundColor: c.accentBorder },
		sectionSpark: { color: c.accentDim },
		questionRow: {
			minHeight: 56,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.sm,
			borderBottomColor: c.accentBorder,
			borderBottomWidth: StyleSheet.hairlineWidth,
		},
		questionReference: {
			// Micro rather than meta, with tighter tracking: the labels are
			// upper-case book names, and the longest single word in the canon
			// ("THESSALONIANS", 13 characters) has to fit the column on one line
			// or the row breaks a book name mid-word. The column only stays a
			// column if every row reserves the same width, so the width is fixed
			// to that worst case rather than sized to each label.
			...typography.micro,
			width: 120,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 0.4,
		},
		questionLabel: { flex: 1, color: c.textSecondary, ...typography.body },
		moreRow: {
			minHeight: 44,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.xs,
			borderRadius: radius.md,
		},
		moreRowPressed: { backgroundColor: c.accentPressed },
		moreLabel: { ...typography.support, color: c.accentDim, fontWeight: "600" },
		moreIcon: { color: c.accentDim },
		skeletonReference: {
			width: 74,
			height: 10,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
		},
		skeletonRowLine: {
			flex: 1,
			height: 13,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
		},
	});
