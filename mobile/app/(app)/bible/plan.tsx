import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import { BOOKS } from "@/features/bible/books";
import { useTabBarSpace } from "@/features/chat/layout";
import { useReadingPlan } from "@/features/plan/useReadingPlan";
import {
	currentPlanDay,
	dayHeadline,
	dayStateLabel,
	describeReadings,
	progressCaption,
	streakLabel,
} from "@/features/plan/planView";
import type { PlanDay, PlanReading, ReadingPlan } from "@/features/plan/types";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

/** The lengths a written plan is offered at, and the step the ± buttons take. */
const GOAL_DAY_CHOICES = [14, 30, 60, 90] as const;
const GOAL_DAY_STEP = 7;
const MIN_GOAL_DAYS = 7;
const MAX_GOAL_DAYS = 365;
const MAX_GOAL_LENGTH = 300;

type Row =
	| { key: string; kind: "empty" }
	| { key: string; kind: "day"; day: PlanDay };

/**
 * Reading plans: one plan at a time, with progress that fills itself in from
 * the chapters the user actually reads in the Bible reader.
 *
 * With no plan this is a chooser (four presets, or a goal to have one written
 * for). With a plan it is the day they are on, the chapters as chips that open
 * the reader, and the whole plan underneath it. Mirrors
 * src/app/bible/plan/page.tsx on web.
 */
export default function ReadingPlanScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const { plan, presets, loading, busy, error, reload, startPreset, startGoal, setDayDone, archive } =
		useReadingPlan();

	const [goal, setGoal] = useState("");
	const [goalDays, setGoalDays] = useState(30);
	const [confirmingArchive, setConfirmingArchive] = useState(false);

	const openChapter = useCallback(
		(reading: PlanReading) => {
			const book = BOOKS.find((candidate) => candidate.name === reading.book);
			if (!book) return;
			router.push({
				pathname: "/bible/chapter",
				params: { book: String(book.order), chapter: String(reading.chapter), verse: "" },
			});
		},
		[router]
	);

	const adjustDays = (delta: number) =>
		setGoalDays((previous) =>
			Math.min(Math.max(previous + delta, MIN_GOAL_DAYS), MAX_GOAL_DAYS)
		);

	const submitGoal = () => {
		const described = goal.trim();
		if (!described) return;
		setGoal("");
		void startGoal(described, goalDays);
	};

	const today = currentPlanDay(plan);

	const rows: Row[] = useMemo(() => {
		if (!plan) return [{ key: "empty", kind: "empty" }];
		return plan.days.map((day) => ({ key: `day-${day.day}`, kind: "day" as const, day }));
	}, [plan]);

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					Reading plan
				</Text>
				{plan ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Plan options"
						onPress={() => setConfirmingArchive((previous) => !previous)}
						hitSlop={8}
						style={styles.overflow}
					>
						<Text style={styles.overflowGlyph}>⋯</Text>
					</Pressable>
				) : (
					<View style={styles.topBarSpacer} />
				)}
			</View>

			<FlatList
				data={rows}
				keyExtractor={(row) => row.key}
				contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.lg }]}
				ListHeaderComponent={
					<View style={styles.header}>
						{error ? (
							<GlassCard style={styles.errorCard}>
								<Text style={styles.errorText}>{error}</Text>
								<Pressable accessibilityRole="button" onPress={reload} style={styles.retry}>
									<Text style={styles.retryLabel}>Try again</Text>
								</Pressable>
							</GlassCard>
						) : null}

						{loading ? <Text style={styles.hint}>Loading your plan…</Text> : null}

						{plan && confirmingArchive ? (
							<GlassCard style={styles.archiveCard}>
								<Text style={styles.archivePrompt}>
									Put &ldquo;{plan.title}&rdquo; away? Your progress is kept, and you can start
									another plan.
								</Text>
								<View style={styles.archiveButtons}>
									<Pressable
										accessibilityRole="button"
										disabled={busy}
										onPress={() => {
											setConfirmingArchive(false);
											void archive();
										}}
										style={({ pressed }) => [
											styles.archiveConfirm,
											pressed && { backgroundColor: colors.dangerSoft },
										]}
									>
										<Text style={styles.archiveConfirmLabel}>Archive plan</Text>
									</Pressable>
									<Pressable
										accessibilityRole="button"
										onPress={() => setConfirmingArchive(false)}
										style={({ pressed }) => [
											styles.archiveCancel,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<Text style={styles.archiveCancelLabel}>Keep it</Text>
									</Pressable>
								</View>
							</GlassCard>
						) : null}

						{plan ? (
							<PlanHeader
								plan={plan}
								today={today}
								busy={busy}
								onOpenChapter={openChapter}
								onToggleToday={(done) => today && void setDayDone(today.day, done)}
							/>
						) : null}

						{!plan && !loading ? (
							<View style={styles.chooser}>
								<Text style={styles.lead}>
									Pick a plan and read straight through. Chapters you read in SureWord tick
									themselves off - there is nothing to remember.
								</Text>

								{presets.map((preset) => (
									<Pressable
										key={preset.key}
										accessibilityRole="button"
										accessibilityLabel={`Start ${preset.title}`}
										disabled={busy}
										onPress={() => void startPreset(preset.key)}
										style={({ pressed }) => [
											styles.presetCard,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<View style={styles.presetHead}>
											<Text style={styles.presetTitle}>{preset.title}</Text>
											<Text style={styles.presetDays}>{preset.dayCount} days</Text>
										</View>
										<Text style={styles.presetDescription}>{preset.description}</Text>
									</Pressable>
								))}

								<Text style={styles.sectionLabel}>BUILD MY OWN</Text>
								<GlassCard style={styles.builder}>
									<TextInput
										value={goal}
										onChangeText={setGoal}
										maxLength={MAX_GOAL_LENGTH}
										multiline
										placeholder="What should it walk you through? e.g. everything Jesus said about prayer"
										placeholderTextColor={colors.textFaint}
										accessibilityLabel="What the plan should walk you through"
										style={styles.goalInput}
									/>
									<View style={styles.stepper}>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="Fewer days"
											onPress={() => adjustDays(-GOAL_DAY_STEP)}
											style={({ pressed }) => [
												styles.stepButton,
												pressed && { backgroundColor: colors.surfacePressed },
											]}
										>
											<Text style={styles.stepGlyph}>−</Text>
										</Pressable>
										<Text style={styles.stepValue}>{goalDays} days</Text>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="More days"
											onPress={() => adjustDays(GOAL_DAY_STEP)}
											style={({ pressed }) => [
												styles.stepButton,
												pressed && { backgroundColor: colors.surfacePressed },
											]}
										>
											<Text style={styles.stepGlyph}>+</Text>
										</Pressable>
									</View>
									<View style={styles.dayChips}>
										{GOAL_DAY_CHOICES.map((choice) => (
											<Pressable
												key={choice}
												accessibilityRole="button"
												onPress={() => setGoalDays(choice)}
												style={({ pressed }) => [
													styles.dayChip,
													goalDays === choice && styles.dayChipActive,
													pressed && { backgroundColor: colors.surfacePressed },
												]}
											>
												<Text
													style={[
														styles.dayChipLabel,
														goalDays === choice && styles.dayChipLabelActive,
													]}
												>
													{choice}
												</Text>
											</Pressable>
										))}
									</View>
									<Pressable
										accessibilityRole="button"
										disabled={busy || !goal.trim()}
										onPress={submitGoal}
										style={({ pressed }) => [
											styles.buildButton,
											(busy || !goal.trim()) && styles.buildButtonDisabled,
											pressed && { backgroundColor: colors.accentPressed },
										]}
									>
										<Text style={styles.buildButtonLabel}>
											{busy ? "Writing your plan…" : "✦ Build my plan"}
										</Text>
									</Pressable>
								</GlassCard>
							</View>
						) : null}

						{plan ? <Text style={styles.sectionLabel}>THE WHOLE PLAN</Text> : null}
					</View>
				}
				renderItem={({ item }) => {
					if (item.kind === "empty") return null;
					const day = item.day;
					return (
						<View
							style={[
								styles.dayRow,
								day.state === "today" && styles.dayRowToday,
								day.done && styles.dayRowDone,
							]}
						>
							<Text style={styles.dayNumber}>{day.day}</Text>
							<View style={styles.dayCopy}>
								<Text style={styles.dayReference}>{describeReadings(day.readings)}</Text>
								<Text style={styles.dayState}>
									{dayStateLabel(day.state)}
									{day.doneSource === "read" ? " · read in SureWord" : ""}
								</Text>
							</View>
							<Pressable
								accessibilityRole="checkbox"
								accessibilityState={{ checked: day.done }}
								accessibilityLabel={`Mark day ${day.day} ${day.done ? "unread" : "read"}`}
								disabled={busy}
								onPress={() => void setDayDone(day.day, !day.done)}
								hitSlop={8}
								style={({ pressed }) => [
									styles.tick,
									day.done && styles.tickDone,
									pressed && { backgroundColor: colors.surfacePressed },
								]}
							>
								<Text style={[styles.tickGlyph, day.done && styles.tickGlyphDone]}>✓</Text>
							</Pressable>
						</View>
					);
				}}
			/>
		</Screen>
	);
}

/** The plan itself: where they are, and the day in front of them. */
function PlanHeader({
	plan,
	today,
	busy,
	onOpenChapter,
	onToggleToday,
}: {
	plan: ReadingPlan;
	today: PlanDay | null;
	busy: boolean;
	onOpenChapter: (reading: PlanReading) => void;
	onToggleToday: (done: boolean) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	return (
		<View style={styles.planHeader}>
			<GlassCard style={styles.summaryCard}>
				<Text style={styles.planTitle}>{plan.title}</Text>
				<Text style={styles.planDescription}>{plan.description}</Text>
				<View style={styles.barTrack}>
					<View style={[styles.barFill, { width: `${Math.min(plan.percent, 100)}%` }]} />
				</View>
				<View style={styles.summaryMeta}>
					<Text style={styles.percent}>{plan.percent}%</Text>
					<Text style={styles.summaryCaption}>{progressCaption(plan)}</Text>
				</View>
				<Text style={styles.streak}>🔥 {streakLabel(plan.streak)}</Text>
			</GlassCard>

			{plan.status === "completed" ? (
				<GlassCard style={styles.doneCard}>
					<Text style={styles.doneTitle}>You finished it.</Text>
					<Text style={styles.doneBody}>
						Every day of {plan.title} is read. Archive it from ⋯ above to start another.
					</Text>
				</GlassCard>
			) : today ? (
				<GlassCard style={styles.todayCard}>
					<Text style={styles.todayLabel}>{dayHeadline(plan)}</Text>
					<View style={styles.chips}>
						{today.readings.map((reading) => (
							<Pressable
								key={`${reading.book}-${reading.chapter}`}
								accessibilityRole="button"
								accessibilityLabel={`Read ${reading.book} ${reading.chapter}`}
								onPress={() => onOpenChapter(reading)}
								style={({ pressed }) => [
									styles.chip,
									pressed && { backgroundColor: colors.accentPressed },
								]}
							>
								<Text style={styles.chipLabel}>
									{reading.book} {reading.chapter} ›
								</Text>
							</Pressable>
						))}
					</View>
					{today.focus ? <Text style={styles.todayFocus}>{today.focus}</Text> : null}
					<Pressable
						accessibilityRole="checkbox"
						accessibilityState={{ checked: today.done }}
						disabled={busy}
						onPress={() => onToggleToday(!today.done)}
						style={({ pressed }) => [
							styles.markButton,
							today.done && styles.markButtonDone,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<Text style={[styles.markLabel, today.done && styles.markLabelDone]}>
							{today.done ? "✓ Read" : "Mark this day read"}
						</Text>
					</Pressable>
					{today.done ? null : (
						<Text style={styles.markHint}>
							Reading these chapters in SureWord marks the day on its own.
						</Text>
					)}
				</GlassCard>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		topBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: { flex: 1, color: c.text, fontSize: 15, fontWeight: "600", textAlign: "center" },
		topBarSpacer: { width: 44 },
		overflow: { width: 44, alignItems: "flex-end" },
		overflowGlyph: { color: c.textMuted, fontSize: 20, fontWeight: "700" },
		content: { paddingHorizontal: spacing.lg },
		header: { gap: spacing.md },
		hint: { color: c.textFaint, fontSize: 13, textAlign: "center", paddingVertical: spacing.lg },
		errorCard: { padding: spacing.lg, alignItems: "center", gap: spacing.md },
		errorText: { color: c.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
		retry: {
			borderRadius: radius.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			paddingHorizontal: spacing.xl,
			paddingVertical: spacing.sm,
		},
		retryLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },

		archiveCard: { padding: spacing.lg, gap: spacing.md },
		archivePrompt: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },
		archiveButtons: { flexDirection: "row", gap: spacing.sm },
		archiveConfirm: {
			flex: 1,
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.dangerBorder,
			alignItems: "center",
			justifyContent: "center",
		},
		archiveConfirmLabel: { color: c.danger, fontSize: 14, fontWeight: "700" },
		archiveCancel: {
			flex: 1,
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		archiveCancelLabel: { color: c.textSecondary, fontSize: 14, fontWeight: "600" },

		planHeader: { gap: spacing.md },
		summaryCard: { padding: spacing.lg, gap: spacing.sm },
		planTitle: { fontFamily: fonts.brand, fontSize: 24, color: c.text },
		planDescription: { color: c.textMuted, fontSize: 13.5, lineHeight: 19 },
		barTrack: {
			marginTop: spacing.xs,
			height: 8,
			borderRadius: radius.full,
			backgroundColor: c.surfaceStrong,
			overflow: "hidden",
		},
		barFill: { height: 8, borderRadius: radius.full, backgroundColor: c.accent },
		summaryMeta: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
		percent: {
			color: c.accent,
			fontSize: 22,
			fontWeight: "700",
			fontVariant: ["tabular-nums"],
		},
		summaryCaption: { flex: 1, color: c.textFaint, fontSize: 12.5 },
		streak: { color: c.textMuted, fontSize: 13, fontWeight: "600" },

		doneCard: { padding: spacing.lg, gap: spacing.sm, borderColor: c.accentBorder },
		doneTitle: { color: c.accent, fontSize: 16, fontWeight: "700" },
		doneBody: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },

		todayCard: {
			padding: spacing.lg,
			gap: spacing.md,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		todayLabel: {
			color: c.accent,
			fontSize: 12,
			fontWeight: "700",
			letterSpacing: 1.1,
			textTransform: "uppercase",
		},
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		chip: {
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
			paddingVertical: 8,
		},
		chipLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },
		todayFocus: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
		markButton: {
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		markButtonDone: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		markLabel: { color: c.textMuted, fontSize: 14, fontWeight: "600" },
		markLabelDone: { color: c.accent },
		markHint: { color: c.textGhost, fontSize: 11.5, lineHeight: 16 },

		chooser: { gap: spacing.md },
		lead: { color: c.textMuted, fontSize: 14, lineHeight: 21 },
		presetCard: {
			gap: 6,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		presetHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		presetTitle: { flex: 1, color: c.text, fontSize: 15, fontWeight: "700" },
		presetDays: { color: c.accent, fontSize: 12.5, fontVariant: ["tabular-nums"] },
		presetDescription: { color: c.textMuted, fontSize: 13, lineHeight: 19 },

		sectionLabel: {
			marginTop: spacing.lg,
			marginBottom: spacing.xs,
			color: c.textFaint,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 1.2,
			textTransform: "uppercase",
		},
		builder: { padding: spacing.lg, gap: spacing.md },
		goalInput: {
			minHeight: 72,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			color: c.text,
			fontSize: 14,
			textAlignVertical: "top",
		},
		stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		stepButton: {
			width: 44,
			height: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		stepGlyph: { color: c.textSecondary, fontSize: 20, fontWeight: "700" },
		stepValue: {
			flex: 1,
			textAlign: "center",
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			fontVariant: ["tabular-nums"],
		},
		dayChips: { flexDirection: "row", gap: spacing.sm },
		dayChip: {
			flex: 1,
			minHeight: 36,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		dayChipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		dayChipLabel: { color: c.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
		dayChipLabelActive: { color: c.accent, fontWeight: "700" },
		buildButton: {
			minHeight: 48,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		buildButtonDisabled: { opacity: 0.5 },
		buildButtonLabel: { color: c.accent, fontSize: 15, fontWeight: "700" },

		dayRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: 12,
			marginBottom: spacing.sm,
		},
		dayRowToday: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		dayRowDone: { opacity: 0.7 },
		dayNumber: {
			width: 32,
			color: c.textFaint,
			fontSize: 13,
			fontWeight: "700",
			fontVariant: ["tabular-nums"],
		},
		dayCopy: { flex: 1, gap: 2 },
		dayReference: { color: c.textSecondary, fontSize: 14, fontWeight: "600" },
		dayState: { color: c.textGhost, fontSize: 11.5 },
		tick: {
			width: 32,
			height: 32,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		tickDone: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		tickGlyph: { color: c.textGhost, fontSize: 14, fontWeight: "700" },
		tickGlyphDone: { color: c.accent },
	});
