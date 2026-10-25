import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import type { QuizDepth, QuizQuestion } from "./quizContract";
import { DEPTH_LABELS, optionAccessibilityLabel, optionLetter } from "./quizView";

/**
 * The building blocks the quiz screens share. Ink on the gold button is a
 * fixed near-black: the accent is a light amber in dark mode and a deep amber
 * in light mode, and dark ink reads on both.
 */
const GOLD_INK = "#1a1206";

export function GoldButton({
	label,
	onPress,
	disabled = false,
	busy = false,
	accessibilityLabel,
	style,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	busy?: boolean;
	accessibilityLabel?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const styles = useThemedStyles(createStyles);
	const off = disabled || busy;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityState={{ disabled: off, busy }}
			disabled={off}
			onPress={onPress}
			style={({ pressed }) => [styles.gold, off && styles.goldDisabled, pressed && !off && styles.pressed, style]}
		>
			{busy ? <ActivityIndicator color={GOLD_INK} /> : <Text style={styles.goldLabel}>{label}</Text>}
		</Pressable>
	);
}

export function QuietButton({
	label,
	onPress,
	style,
}: {
	label: string;
	onPress: () => void;
	style?: StyleProp<ViewStyle>;
}) {
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			hitSlop={6}
			style={({ pressed }) => [styles.quiet, pressed && styles.pressed, style]}
		>
			<Text style={styles.quietLabel}>{label}</Text>
		</Pressable>
	);
}

export function OutlineButton({
	label,
	icon,
	onPress,
	tone = "plain",
	disabled = false,
	accessibilityLabel,
	style,
}: {
	label: string;
	icon?: React.ComponentProps<typeof Ionicons>["name"];
	onPress: () => void;
	tone?: "plain" | "gold";
	disabled?: boolean;
	accessibilityLabel?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const gold = tone === "gold";
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.outline,
				gold && { borderColor: colors.accent },
				disabled && styles.goldDisabled,
				pressed && !disabled && styles.pressed,
				style,
			]}
		>
			{icon ? <Ionicons name={icon} size={18} color={gold ? colors.accent : colors.text} /> : null}
			<Text numberOfLines={1} style={[styles.outlineLabel, gold && { color: colors.accent }]}>
				{label}
			</Text>
		</Pressable>
	);
}

/** Segmented progress: completed and current segments gold. */
export function ProgressSegments({ index, count, label }: { index: number; count: number; label: string }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			accessibilityValue={{ min: 1, max: count, now: index + 1 }}
			style={styles.segments}
		>
			{Array.from({ length: count }, (_, segment) => (
				<View
					key={segment}
					style={[styles.segment, { backgroundColor: segment <= index ? colors.accent : colors.surfacePressed }]}
				/>
			))}
		</View>
	);
}

/** Foundations / Going deeper. Describes the questions, never the person. */
export function DepthSwitch({
	value,
	onChange,
}: {
	value: QuizDepth;
	onChange: (depth: QuizDepth) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View accessibilityRole="radiogroup" accessibilityLabel="Question depth" style={styles.depth}>
			{(["seeking", "growing"] as const).map((depth) => {
				const selected = depth === value;
				return (
					<Pressable
						key={depth}
						accessibilityRole="radio"
						accessibilityState={{ selected, checked: selected }}
						onPress={() => {
							if (!selected) onChange(depth);
						}}
						style={[styles.depthSegment, selected && styles.depthSelected]}
					>
						<Text style={[styles.depthLabel, selected && { color: colors.accent }]}>
							{DEPTH_LABELS[depth]}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

export type OptionState = "idle" | "selected" | "right" | "wrong" | "answer" | "dimmed";

/**
 * One answer choice. Before checking: idle or selected. After: the chosen row
 * is right or wrong, the correct row (when the choice was wrong) is the
 * answer, and the rest dim.
 */
export function OptionRow({
	index,
	text,
	state,
	onPress,
}: {
	index: number;
	text: string;
	state: OptionState;
	onPress?: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const answered = state === "right" || state === "wrong" || state === "answer" || state === "dimmed";
	const gold = state === "selected" || state === "right" || state === "answer";
	const status =
		state === "right" ? "Right" : state === "wrong" ? "Not quite" : state === "answer" ? "Correct answer" : null;
	return (
		<Pressable
			accessibilityRole="button"
			// The result rides in the label so a screen reader says it with the row.
			accessibilityLabel={status ? `${optionAccessibilityLabel(index, text)}, ${status}` : optionAccessibilityLabel(index, text)}
			accessibilityState={{ selected: state === "selected" || state === "right" || state === "wrong", disabled: answered }}
			disabled={answered || !onPress}
			onPress={onPress}
			style={[
				styles.option,
				state === "selected" && styles.optionSelected,
				(state === "right" || state === "answer") && styles.optionRight,
				state === "wrong" && styles.optionWrong,
				state === "dimmed" && styles.optionDimmed,
			]}
		>
			<View
				style={[
					styles.letter,
					state === "selected" && { backgroundColor: colors.accent, borderColor: colors.accent },
					answered && styles.letterBare,
				]}
			>
				<Text
					style={[
						styles.letterLabel,
						state === "selected" && { color: GOLD_INK },
						answered && gold && { color: colors.accent },
						state === "wrong" && { color: colors.danger },
					]}
				>
					{optionLetter(index)}
				</Text>
			</View>
			<Text style={[styles.optionText, state === "dimmed" && { color: colors.textMuted }]}>{text}</Text>
			{state === "right" || state === "answer" ? (
				<View style={styles.optionStatus}>
					<Ionicons name="checkmark-circle" size={22} color={colors.accent} />
					{state === "right" ? <Text style={[styles.statusLabel, { color: colors.accent }]}>Right</Text> : null}
				</View>
			) : state === "wrong" ? (
				<Text style={[styles.statusLabel, { color: colors.danger }]}>Not quite</Text>
			) : null}
		</Pressable>
	);
}

/** The verse behind an answer: gold rule, reference, Scripture, the why. */
export function VerseCard({
	question,
	children,
}: {
	question: Pick<QuizQuestion, "reference" | "verseText" | "note">;
	children?: React.ReactNode;
}) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.verseCard}>
			<View style={styles.verseRule} />
			<View style={styles.verseBody}>
				<Text style={styles.reference}>{question.reference}</Text>
				<Text style={styles.scripture}>{question.verseText}</Text>
				{question.note ? <Text style={styles.note}>{question.note}</Text> : null}
				{children}
			</View>
		</View>
	);
}

export const createStyles = (c: Colors) =>
	StyleSheet.create({
		pressed: { opacity: 0.8 },
		gold: {
			minHeight: 52,
			borderRadius: radius.lg,
			backgroundColor: c.accent,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
		},
		goldDisabled: { opacity: 0.4 },
		goldLabel: { color: GOLD_INK, fontSize: 17, lineHeight: 24, fontFamily: fonts.bodyBold, fontWeight: "700" },
		quiet: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
		quietLabel: { color: c.textMuted, ...typography.control },
		outline: {
			flex: 1,
			minHeight: 48,
			flexDirection: "row",
			gap: spacing.sm,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
		},
		outlineLabel: { color: c.text, ...typography.control },
		segments: { flexDirection: "row", gap: 6 },
		segment: { flex: 1, height: 5, borderRadius: 3 },
		depth: {
			flexDirection: "row",
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surface,
			padding: 3,
		},
		depthSegment: { flex: 1, minHeight: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
		depthSelected: { backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accentBorder },
		depthLabel: { color: c.textMuted, ...typography.support, fontWeight: "600" },
		option: {
			minHeight: 56,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: spacing.md,
			paddingHorizontal: spacing.lg,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surface,
		},
		optionSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
		optionRight: { borderColor: c.accent },
		optionWrong: { borderColor: c.dangerBorder, backgroundColor: c.dangerSoft },
		optionDimmed: { opacity: 0.6 },
		letter: {
			width: 36,
			height: 36,
			borderRadius: 18,
			borderWidth: 1,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		letterBare: { borderWidth: 0, width: 24 },
		letterLabel: { color: c.textSecondary, fontSize: 16, fontFamily: fonts.bodyBold, fontWeight: "700" },
		optionText: { flex: 1, color: c.text, ...typography.body, fontSize: 17 },
		optionStatus: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
		statusLabel: { ...typography.support, fontWeight: "600" },
		verseCard: {
			flexDirection: "row",
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surfaceStrong,
			overflow: "hidden",
		},
		verseRule: { width: 4, backgroundColor: c.accent },
		verseBody: { flex: 1, padding: spacing.lg, gap: spacing.md },
		reference: { color: c.accent, ...typography.meta, letterSpacing: 2.5, textTransform: "uppercase", fontWeight: "600" },
		scripture: { color: c.text, fontFamily: fonts.verse, fontSize: 24, lineHeight: 33 },
		note: { color: c.textMuted, ...typography.support },
	});
