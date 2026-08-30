import React, { useEffect, useMemo, useRef } from "react";
import {
	Animated,
	Easing,
	ImageBackground,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import { fonts, radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import { buildSuggestedQuestionItems } from "./questionPresentation";

export const WELCOME_HEADLINE = "Come hungry for the Word.";
export const WELCOME_SUBHEAD =
	"SureWord is your personal Bible study companion, shaped by your reading, questions, notes, and daily walk—helping you go deeper in Scripture every day.";
export const WELCOME_VERSE =
	"“As newborn babes, desire the sincere milk of the word, that ye may grow thereby:”";
export const WELCOME_VERSE_CITATION = "— 1 Peter 2:2, KJV";
export const WELCOME_TRUST =
	"Scripture comes first. Every answer is grounded in God's inerrant, infallible Word.";

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
			<View style={styles.featuredQuestion}>
				<Animated.View style={[styles.skeletonReference, { opacity: pulse }]} />
				<Animated.View style={[styles.skeletonFeaturedLine, { opacity: pulse }]} />
				<Animated.View style={[styles.skeletonFeaturedLineShort, { opacity: pulse }]} />
			</View>
			{(["84%", "71%", "88%"] as const).map((width) => (
				<View key={width} style={styles.questionRow}>
					<Animated.View style={[styles.skeletonRowLine, { width, opacity: pulse }]} />
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

export function WelcomeState({
	onSelectQuestion,
	bottomInset,
	composer,
}: {
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
	composer: React.ReactNode;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { questions, loading } = useSuggestedQuestions();
	const questionItems = useMemo(() => buildSuggestedQuestionItems(questions), [questions]);
	const [featured, ...remaining] = questionItems;

	return (
		<ScrollView
			style={styles.fill}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			showsVerticalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
		>
			<ImageBackground
				source={require("../../../assets/sureword-welcome-stained-glass.webp")}
				style={styles.art}
				imageStyle={styles.artImage}
				resizeMode="cover"
				accessibilityIgnoresInvertColors
			>
				<SureWordGuideAvatar variant="hero" size={154} />
			</ImageBackground>

			<View style={styles.scriptureBlock}>
				<Text style={styles.headline}>{WELCOME_HEADLINE}</Text>
				<Text style={styles.subhead}>{WELCOME_SUBHEAD}</Text>
				<View
					style={styles.verseBlock}
					accessible
					accessibilityRole="text"
					accessibilityLabel={`${WELCOME_VERSE} ${WELCOME_VERSE_CITATION}`}
				>
					<Text style={styles.verse}>{WELCOME_VERSE}</Text>
					<Text style={styles.citation}>{WELCOME_VERSE_CITATION}</Text>
				</View>
				<Text style={styles.trust}>{WELCOME_TRUST}</Text>
			</View>

			<View style={styles.composer}>{composer}</View>

			{loading ? (
				<QuestionSkeleton />
			) : featured ? (
				<View style={styles.questionsSection}>
					<SectionHeading />
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={featured.question}
						onPress={() => onSelectQuestion(featured.question)}
						style={({ pressed }) => [
							styles.featuredQuestion,
							pressed && {
								backgroundColor: colors.accentPressed,
								borderColor: colors.accent,
							},
						]}
					>
						{featured.label ? (
							<Text style={styles.featuredReference}>{featured.label}</Text>
						) : null}
						<View style={styles.featuredBody}>
							<Text style={styles.featuredLabel}>{featured.question}</Text>
							<Ionicons name="chevron-forward" size={23} color={colors.accent} />
						</View>
					</Pressable>

					{remaining.map((item) => (
						<Pressable
							key={item.key}
							accessibilityRole="button"
							accessibilityLabel={item.question}
							onPress={() => onSelectQuestion(item.question)}
							style={({ pressed }) => [
								styles.questionRow,
								pressed && { backgroundColor: colors.accentPressed },
							]}
						>
							{item.label ? (
								<Text style={styles.questionReference}>{item.label}</Text>
							) : null}
							<Text style={styles.questionLabel}>{item.question}</Text>
							<Ionicons name="chevron-forward" size={19} color={colors.accentDim} />
						</Pressable>
					))}
				</View>
			) : null}
		</ScrollView>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		content: {
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.xs,
		},
		art: {
			height: 214,
			alignItems: "center",
			justifyContent: "center",
			marginHorizontal: -spacing.xs,
		},
		artImage: { borderRadius: radius.sm },
		scriptureBlock: {
			marginTop: -spacing.sm,
			paddingHorizontal: spacing.lg,
		},
		headline: {
			color: c.accent,
			fontFamily: fonts.brand,
			fontSize: 32,
			lineHeight: 38,
			textAlign: "center",
		},
		subhead: {
			...typography.chat,
			color: c.parchmentInk,
			marginTop: spacing.sm,
			textAlign: "center",
		},
		verseBlock: {
			borderTopColor: c.accentBorder,
			borderTopWidth: StyleSheet.hairlineWidth,
			marginTop: spacing.sm,
			paddingTop: spacing.sm,
		},
		verse: {
			color: c.parchmentInk,
			fontFamily: fonts.verse,
			fontSize: 19,
			lineHeight: 28,
			textAlign: "center",
		},
		citation: {
			...typography.meta,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xs,
			textAlign: "center",
		},
		trust: {
			...typography.support,
			color: c.textSecondary,
			marginTop: spacing.md,
			textAlign: "center",
		},
		composer: { marginTop: spacing.lg },
		questionsSection: { marginTop: spacing.xl },
		sectionHeading: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginBottom: spacing.md,
		},
		sectionHeadingText: {
			...typography.meta,
			color: c.accent,
			fontWeight: "600",
			letterSpacing: 2,
		},
		sectionRule: { flex: 1, height: 1, backgroundColor: c.accentBorder },
		sectionSpark: { color: c.accentDim },
		featuredQuestion: {
			minHeight: 116,
			justifyContent: "center",
			padding: spacing.lg,
			backgroundColor: c.glass,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
		},
		featuredReference: {
			...typography.meta,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 1.5,
			marginBottom: spacing.sm,
		},
		featuredBody: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		featuredLabel: {
			...typography.chat,
			flex: 1,
			color: c.parchmentInk,
		},
		questionRow: {
			minHeight: 64,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.md,
			borderBottomColor: c.accentBorder,
			borderBottomWidth: StyleSheet.hairlineWidth,
		},
		questionReference: {
			...typography.meta,
			// Wide enough for the longest kind label ("TODAY'S VERSE") on one line;
			// the column only stays a column if every row reserves the same width.
			width: 96,
			color: c.accent,
			fontWeight: "700",
			letterSpacing: 1,
		},
		questionLabel: { flex: 1, color: c.textSecondary, ...typography.body },
		skeletonReference: {
			width: 74,
			height: 10,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			marginBottom: spacing.md,
		},
		skeletonFeaturedLine: {
			width: "88%",
			height: 18,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
		},
		skeletonFeaturedLineShort: {
			width: "62%",
			height: 18,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			marginTop: spacing.sm,
		},
		skeletonRowLine: {
			height: 13,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
		},
	});
