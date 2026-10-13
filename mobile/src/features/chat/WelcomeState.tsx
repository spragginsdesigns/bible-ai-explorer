import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useSuggestedQuestions } from "./useSuggestedQuestions";
import { chatColors } from "./chatAppearance";
import { buildSuggestedQuestionItems, parseReferenceLabel, type SuggestedQuestionItem } from "./questionPresentation";

export const WELCOME_HEADLINE = "Come hungry for the Word.";
export const VISIBLE_QUESTION_COUNT = 4;

export function SanctuaryBackdrop() {
	const styles = useThemedStyles(createStyles);
	const { isDark } = useTheme();
	return <View pointerEvents="none" style={[styles.heroBackdrop, !isDark && styles.lightBackdrop]}>
		<Image source={isDark ? require("../../../assets/chat-home/sureword-sanctuary.png") : require("../../../assets/chat-home/sureword-sanctuary-light.png")} accessible={false} resizeMode="cover" resizeMethod="resize" style={styles.backdropImage} />
	</View>;
}

function QuestionTile({ item, onPress }: { item: SuggestedQuestionItem; onPress: () => void }) {
	const { colors: themeColors } = useTheme();
	const colors = chatColors(themeColors);
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={item.question}
			accessibilityHint={item.label ? `Ask this question, related to ${item.label}` : "Ask this question"}
			onPress={onPress}
			style={({ pressed }) => [styles.questionTile, pressed && styles.questionPressed]}
		>
			<Text style={styles.questionLabel}>{item.question}</Text>
			<View style={styles.tileFooter}>
				{item.label ? <Text style={styles.questionReference}>{parseReferenceLabel(item.label) ?? item.label}</Text> : <View style={styles.referenceSpace} />}
				<Feather name="arrow-up-right" size={18} color={colors.accent} style={{ lineHeight: 18, includeFontPadding: false }} />
			</View>
		</Pressable>
	);
}

/** Keep loading separate so native QA can exercise real controls with fixtures. */
export function WelcomeContent({
	items, loading = false, onSelectQuestion, bottomInset,
}: {
	items: SuggestedQuestionItem[];
	loading?: boolean;
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
}) {
	const styles = useThemedStyles(createStyles);
	const { width, fontScale } = useWindowDimensions();
	// Android transports its float setting as 1.299999952, so compare percent.
	const fontScalePercent = Math.round(fontScale * 100);
	const singleColumn = width < 350 || fontScalePercent >= 130;
	const [showAll, setShowAll] = useState(false);
	const hiddenCount = Math.max(0, items.length - VISIBLE_QUESTION_COUNT);
	const visibleItems = showAll || hiddenCount === 0 ? items : items.slice(0, VISIBLE_QUESTION_COUNT);
	const rows = useMemo(() => {
		const result: SuggestedQuestionItem[][] = [];
		const columns = singleColumn ? 1 : 2;
		for (let i = 0; i < visibleItems.length; i += columns) result.push(visibleItems.slice(i, i + columns));
		return result;
	}, [singleColumn, visibleItems]);

	return (
		<ScrollView
			style={styles.fill}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
		>
			<View style={styles.hero}>
				<SureWordGuideAvatar variant="hero" size={190} style={styles.heroCompanion} />
				<Text accessibilityRole="header" accessibilityLabel={WELCOME_HEADLINE} style={styles.headline}>{WELCOME_HEADLINE.replace(" for ", "\nfor ")}</Text>
			</View>
			<View style={styles.questionsSection}>
				<Text style={styles.sectionHeading}>CHOSEN FROM YOUR STUDY</Text>
				{loading ? (
					<View accessibilityLabel="Preparing your questions" accessibilityLiveRegion="polite">
						{[0, 1].map(row => <View key={row} style={styles.questionGridRow}>
							{[0, 1].map(column => <View key={column} style={styles.questionSkeleton}>
								<View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} />
							</View>)}
						</View>)}
					</View>
				) : rows.map((row, index) => (
					<View key={index} style={styles.questionGridRow}>
						{row.map(item => <QuestionTile key={item.key} item={item} onPress={() => onSelectQuestion(item.question)} />)}
						{!singleColumn && row.length === 1 ? <View style={styles.emptyTile} /> : null}
					</View>
				))}
				{!showAll && hiddenCount > 0 && !loading ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Show ${hiddenCount} more questions from your study`}
						onPress={() => setShowAll(true)}
						style={({ pressed }) => [styles.moreRow, pressed && styles.questionPressed]}
					>
						<Text style={styles.moreLabel}>{hiddenCount} more questions</Text>
						<Ionicons name="chevron-down" size={18} style={styles.moreIcon} />
					</Pressable>
				) : null}
			</View>
		</ScrollView>
	);
}

export function WelcomeState({ onSelectQuestion, bottomInset }: {
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
}) {
	const { questions, loading } = useSuggestedQuestions();
	const questionItems = useMemo(() => buildSuggestedQuestionItems(questions), [questions]);
	return <WelcomeContent items={questionItems} loading={loading} onSelectQuestion={onSelectQuestion} bottomInset={bottomInset} />;
}

const createStyles = (theme: Colors) => {
	const c = chatColors(theme);
	return StyleSheet.create({
		fill: { flex: 1 },
		content: { flexGrow: 1 },
		hero: { alignItems: "center", justifyContent: "center", paddingBottom: spacing.xl },
		heroCompanion: { marginTop: -18, marginBottom: -18 },
		heroBackdrop: { position: "absolute", top: 0, left: 0, right: 0, width: "100%", height: 344, opacity: 0.65 },
		backdropImage: { width: "100%", height: "100%" },
		lightBackdrop: { opacity: 0.18 },
		headline: { color: c.text, fontWeight: "700", fontSize: 28, lineHeight: 33, textAlign: "center", maxWidth: 310, marginTop: -8, paddingHorizontal: spacing.md },
		questionsSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
		sectionHeading: { ...typography.meta, color: c.textMuted, fontWeight: "700", letterSpacing: 1.7, marginBottom: spacing.md },
		questionGridRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginBottom: 10 },
		questionTile: { flex: 1, minWidth: 0, minHeight: 124, borderRadius: radius.lg, backgroundColor: c.surface, borderColor: c.accentBorder, borderWidth: StyleSheet.hairlineWidth, padding: 14, justifyContent: "space-between" },
		questionPressed: { backgroundColor: c.surfacePressed },
		questionLabel: { ...typography.body, lineHeight: 22, color: c.text, flexGrow: 1 },
		tileFooter: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-end", justifyContent: "space-between", marginTop: spacing.sm },
		questionReference: { ...typography.micro, color: c.accent, flex: 1 },
		referenceSpace: { flex: 1 },
		emptyTile: { flex: 1 },
		moreRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, marginTop: spacing.xs },
		moreLabel: { ...typography.support, color: c.accent, fontWeight: "700" },
		moreIcon: { color: c.accent },
		questionSkeleton: { flex: 1, minHeight: 124, padding: 14, borderRadius: radius.lg, backgroundColor: c.surface },
		skeletonLine: { height: 12, width: "85%", backgroundColor: c.borderStrong, borderRadius: 4, marginBottom: spacing.sm },
		skeletonLineShort: { height: 12, width: "60%", backgroundColor: c.borderStrong, borderRadius: 4 },
	});
};
