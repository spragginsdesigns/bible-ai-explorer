import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Animated,
	AppState,
	ActivityIndicator,
	Easing,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import { BOOKS } from "@/features/bible/books";
import {
	fetchTodayCross,
	replaceTodayCross,
	type DailyCrossEntry,
	type DailyCrossStudyStep,
} from "@/features/notifications/api";
import { ListenCard } from "@/features/cross/ListenCard";
import { isTodaysPlanReading } from "@/features/plan/planView";
import { useReadingPlan } from "@/features/plan/useReadingPlan";
import { TimelineStop } from "@/features/cross/TimelineStop";
import { useTabBarSpace } from "@/features/chat/layout";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

/** Softly glowing placeholder bars while the day is being prepared. */
function LoadingBars() {
	const styles = useThemedStyles(createStyles);
	const pulse = useRef(new Animated.Value(0)).current;

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
		<View accessibilityLabel="Preparing your day" style={styles.skeleton}>
			{[100, 88, 94, 62].map((width, index) => (
				<Animated.View
					key={index}
					style={[styles.skeletonBar, { width: `${width}%`, opacity: pulse }]}
				/>
			))}
			<Text style={styles.skeletonHint}>Preparing your day in the Word…</Text>
		</View>
	);
}

/**
 * "Pick Up Your Cross" (Luke 9:23) — the guided daily walk as a timeline:
 * today's verse, why it was chosen from the user's actual week, how it
 * applies, a short study path, and one question to carry. Opened from the
 * morning notification, or any time from the Bible tab. Mirrors
 * src/app/cross/page.tsx on web.
 */
export default function DailyCrossScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();

	const [entry, setEntry] = useState<DailyCrossEntry | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingReplace, setConfirmingReplace] = useState(false);
	const [replacing, setReplacing] = useState(false);
	const [focus, setFocus] = useState("");
	const requestVersion = useRef(0);
	const loadInFlight = useRef(false);
	const scrollRef = useRef<ScrollView>(null);
	// The day's study path is built out of the reading plan when one is
	// running; this is how the user sees that it was.
	const { plan } = useReadingPlan();

	const showFailure = useCallback((err: unknown) => {
		setError(
			err instanceof Error
				? err.message
				: "Today's word could not be loaded. Check your connection and try again."
		);
	}, []);

	const tabBarSpace = useTabBarSpace();

	const load = useCallback(() => {
		if (loadInFlight.current) return;
		loadInFlight.current = true;
		const version = ++requestVersion.current;
		setError(null);
		fetchTodayCross(getToken)
			.then((next) => {
				if (version === requestVersion.current) setEntry(next);
			})
			.catch((err: unknown) => {
				if (version === requestVersion.current) showFailure(err);
			})
			.finally(() => {
				loadInFlight.current = false;
			});
	}, [getToken, showFailure]);

	/** Replace today's word — the same route the assistant's setDailyCross tool uses. */
	const replaceToday = useCallback(() => {
		if (replacing) return;
		const steer = focus.trim();
		setConfirmingReplace(false);
		setFocus("");
		setError(null);
		setReplacing(true);
		const version = ++requestVersion.current;
		replaceTodayCross(getToken, steer || undefined)
			.then((next) => {
				if (version !== requestVersion.current) return;
				setEntry(next);
				requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
			})
			.catch((err: unknown) => {
				if (version === requestVersion.current) showFailure(err);
			})
			.finally(() => {
				if (version === requestVersion.current) setReplacing(false);
			});
	}, [focus, getToken, replacing, showFailure]);


	useFocusEffect(
		useCallback(() => {
			load();
			const subscription = AppState.addEventListener("change", (state) => {
				if (state === "active") load();
			});
			return () => subscription.remove();
		}, [load])
	);

	const openStudyStep = useCallback(
		(step: DailyCrossStudyStep) => {
			const book = BOOKS.find((candidate) => candidate.name === step.book);
			if (!book) return;
			router.push({
				pathname: "/bible/chapter",
				params: { book: String(book.order), chapter: String(step.chapter), verse: "" },
			});
		},
		[router]
	);

	const goDeeper = useCallback(() => {
		if (!entry) return;
		router.push({
			pathname: "/",
			params: {
				attachRef: entry.reference,
				attachText: entry.text,
				attachTranslation: "KJV",
				verseOfDayId: entry.id,
			},
		});
	}, [router, entry]);

	const today = new Date().toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	});

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					Pick Up Your Cross
				</Text>
				<View style={styles.topBarSpacer} />
			</View>

			<ScrollView
				ref={scrollRef}
				contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.lg }]}
			>
				<Text style={styles.date}>{today}</Text>

				{!entry && !error ? (
					<LoadingBars />
				) : !entry && error ? (
					<GlassCard style={styles.errorCard}>
						<Text style={styles.errorText}>{error}</Text>
						<Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
							<Text style={styles.retryLabel}>Try again</Text>
						</Pressable>
					</GlassCard>
				) : entry ? (
					<View style={styles.timeline}>
						{error ? (
							<GlassCard style={styles.errorCard}>
								<Text style={styles.errorText}>{error}</Text>
								<Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
									<Text style={styles.retryLabel}>Refresh today&apos;s word</Text>
								</Pressable>
							</GlassCard>
						) : null}
						<TimelineStop glyph="✝" label="TODAY'S VERSE">
							<GlassCard style={styles.verseCard}>
								<Text style={styles.reference}>{entry.reference}</Text>
								<Text style={styles.verseText}>{entry.text}</Text>
								<Text style={styles.reason}>{entry.reason}</Text>
							</GlassCard>
						</TimelineStop>

						<ListenCard key={entry.id} reference={entry.reference} />

						{entry.whyToday ? (
							<TimelineStop glyph="✦" label="WHY THIS VERSE TODAY">
								<Text style={styles.body}>{entry.whyToday}</Text>
							</TimelineStop>
						) : null}

						{entry.application ? (
							<TimelineStop glyph="◆" label="FOR YOU">
								<Text style={styles.body}>{entry.application}</Text>
							</TimelineStop>
						) : null}

						{entry.studyPath.map((step, index) => (
							<TimelineStop
								key={`${step.book}-${step.chapter}-${index}`}
								glyph={String(index + 1)}
								label={index === 0 ? "TODAY'S STUDY" : undefined}
							>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={`Read ${step.book} ${step.chapter}`}
									onPress={() => openStudyStep(step)}
									style={({ pressed }) => [
										styles.studyRow,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<View style={styles.studyHead}>
										<Text style={styles.studyReference}>
											{step.book} {step.chapter} ›
										</Text>
										{isTodaysPlanReading(plan, step.book, step.chapter) ? (
											<Text style={styles.planTag}>FROM YOUR PLAN</Text>
										) : null}
									</View>
									<Text style={styles.studyFocus}>{step.focus}</Text>
								</Pressable>
							</TimelineStop>
						))}

						{entry.question ? (
							<TimelineStop glyph="?" label="CARRY THIS">
								<GlassCard style={styles.questionCard}>
									<Text style={styles.questionText}>{entry.question}</Text>
								</GlassCard>
							</TimelineStop>
						) : null}

						<TimelineStop glyph="➜" last>
							<Pressable
								accessibilityRole="button"
								onPress={goDeeper}
								style={({ pressed }) => [
									styles.chatButton,
									pressed && { backgroundColor: colors.accentPressed },
								]}
							>
								<Text style={styles.chatButtonLabel}>✦ Go deeper in chat</Text>
							</Pressable>

							{replacing ? (
								<View style={styles.replacePanel}>
									<View style={styles.replaceProgress}>
										<ActivityIndicator color={colors.accent} />
										<Text style={styles.replacePrompt}>
											Preparing a fresh word. You can keep reading this one while SureWord searches.
										</Text>
									</View>
								</View>
							) : confirmingReplace ? (
								<View style={styles.replacePanel}>
									<Text style={styles.replacePrompt}>
										Replace today&apos;s word with a new one? {entry.reference} won&apos;t come
										back.
									</Text>
									<TextInput
										value={focus}
										onChangeText={setFocus}
										maxLength={200}
										placeholder="Anything it should centre on? (optional)"
										placeholderTextColor={colors.textFaint}
										accessibilityLabel="What today's new word should centre on"
										returnKeyType="done"
										onSubmitEditing={replaceToday}
										style={styles.focusInput}
									/>
									<View style={styles.replaceButtons}>
										<Pressable
											accessibilityRole="button"
											onPress={replaceToday}
											style={({ pressed }) => [
												styles.replaceConfirm,
												pressed && { backgroundColor: colors.accentPressed },
											]}
										>
											<Text style={styles.replaceConfirmLabel}>Replace</Text>
										</Pressable>
										<Pressable
											accessibilityRole="button"
											onPress={() => {
												setConfirmingReplace(false);
												setFocus("");
											}}
											style={({ pressed }) => [
												styles.replaceCancel,
												pressed && { backgroundColor: colors.surfacePressed },
											]}
										>
											<Text style={styles.replaceCancelLabel}>Cancel</Text>
										</Pressable>
									</View>
								</View>
							) : (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Ask for a different word for today"
									onPress={() => setConfirmingReplace(true)}
									style={({ pressed }) => [
										styles.replaceButton,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.replaceButtonLabel}>↻ A different word for today</Text>
								</Pressable>
							)}
						</TimelineStop>
					</View>
				) : null}
			</ScrollView>
		</Screen>
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
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		topBarSpacer: { width: 44 },
		content: { paddingHorizontal: spacing.xl },
		date: {
			color: c.textFaint,
			fontSize: 13,
			textAlign: "center",
			marginBottom: spacing.lg,
		},
		skeleton: { gap: spacing.md, paddingVertical: spacing.xl },
		skeletonBar: {
			height: 14,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
		},
		skeletonHint: {
			marginTop: spacing.md,
			color: c.textFaint,
			fontSize: 13,
			textAlign: "center",
		},
		errorCard: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
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
		verseCard: { padding: spacing.lg, gap: spacing.md },
		reference: { color: c.accent, fontSize: 15, fontWeight: "700" },
		verseText: {
			color: c.text,
			fontFamily: fonts.verse,
			fontSize: 19,
			lineHeight: 30,
		},
		reason: { color: c.textMuted, fontSize: 13.5, lineHeight: 19, fontStyle: "italic" },
		timeline: { marginTop: spacing.sm },
		body: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22 },
		studyRow: {
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
			gap: 4,
		},
		studyHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		studyReference: { color: c.accent, fontSize: 14, fontWeight: "700" },
		planTag: {
			color: c.textFaint,
			fontSize: 9.5,
			fontWeight: "700",
			letterSpacing: 0.8,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: 6,
			paddingVertical: 2,
			overflow: "hidden",
		},
		studyFocus: { color: c.textSecondary, fontSize: 13.5, lineHeight: 19 },
		questionCard: {
			padding: spacing.lg,
			gap: spacing.sm,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		questionText: { color: c.text, fontSize: 14.5, lineHeight: 22, fontWeight: "500" },
		chatButton: {
			minHeight: 48,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		chatButtonLabel: { color: c.accent, fontSize: 15, fontWeight: "700" },
		replaceButton: {
			marginTop: spacing.sm,
			minHeight: 44,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		replaceButtonLabel: { color: c.textFaint, fontSize: 14, fontWeight: "600" },
		replacePanel: {
			marginTop: spacing.sm,
			gap: spacing.md,
			padding: spacing.lg,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		replacePrompt: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },
		replaceProgress: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		focusInput: {
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			color: c.text,
			fontSize: 14,
		},
		replaceButtons: { flexDirection: "row", gap: spacing.sm },
		replaceConfirm: {
			flex: 1,
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		replaceConfirmLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },
		replaceCancel: {
			flex: 1,
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			alignItems: "center",
			justifyContent: "center",
		},
		replaceCancelLabel: { color: c.textSecondary, fontSize: 14, fontWeight: "600" },
	});
