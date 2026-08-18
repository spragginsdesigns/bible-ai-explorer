import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Animated,
	Easing,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import { BOOKS } from "@/features/bible/books";
import {
	fetchTodayCross,
	type DailyCrossEntry,
	type DailyCrossStudyStep,
} from "@/features/notifications/api";
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
 * One stop on the guided timeline: an amber node on a vertical rail, with the
 * section content to its right. The rail connects the day into one walk.
 */
function TimelineStop({
	glyph,
	label,
	last = false,
	children,
}: {
	glyph: string;
	label?: string;
	last?: boolean;
	children: React.ReactNode;
}) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.tlRow}>
			<View style={styles.tlRail}>
				<View style={styles.tlNode}>
					<Text style={styles.tlNodeGlyph}>{glyph}</Text>
				</View>
				{!last ? <View style={styles.tlLine} /> : null}
			</View>
			<View style={[styles.tlContent, last && { paddingBottom: 0 }]}>
				{label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
				{children}
			</View>
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
	const tabBarSpace = useTabBarSpace();

	const load = useCallback(() => {
		setError(null);
		fetchTodayCross(getToken)
			.then(setEntry)
			.catch((err: unknown) => {
				setError(
					err instanceof Error
						? err.message
						: "Today's word could not be loaded. Check your connection and try again."
				);
			});
	}, [getToken]);

	useEffect(() => {
		load();
	}, [load]);

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

			<ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.lg }]}>
				<Text style={styles.date}>{today}</Text>

				{!entry && !error ? (
					<LoadingBars />
				) : error ? (
					<GlassCard style={styles.errorCard}>
						<Text style={styles.errorText}>{error}</Text>
						<Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
							<Text style={styles.retryLabel}>Try again</Text>
						</Pressable>
					</GlassCard>
				) : entry ? (
					<View style={styles.timeline}>
						<TimelineStop glyph="✝" label="TODAY'S VERSE">
							<GlassCard style={styles.verseCard}>
								<Text style={styles.reference}>{entry.reference}</Text>
								<Text style={styles.verseText}>{entry.text}</Text>
								<Text style={styles.reason}>{entry.reason}</Text>
							</GlassCard>
						</TimelineStop>

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
									<Text style={styles.studyReference}>
										{step.book} {step.chapter} ›
									</Text>
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
		tlRow: { flexDirection: "row", gap: spacing.md },
		tlRail: { width: 28, alignItems: "center" },
		tlNode: {
			width: 28,
			height: 28,
			borderRadius: 14,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
			// Subtle glow so the rail reads as lit, not drawn.
			shadowColor: c.accent,
			shadowOpacity: 0.5,
			shadowRadius: 6,
			shadowOffset: { width: 0, height: 0 },
			elevation: 2,
		},
		tlNodeGlyph: { color: c.accent, fontSize: 13, fontWeight: "700" },
		tlLine: {
			flex: 1,
			width: 2,
			marginVertical: 4,
			borderRadius: 1,
			backgroundColor: c.accentBorder,
		},
		tlContent: { flex: 1, gap: spacing.sm, paddingBottom: spacing.xl },
		sectionLabel: {
			color: c.accentDim,
			fontSize: 11.5,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: 6,
		},
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
		studyReference: { color: c.accent, fontSize: 14, fontWeight: "700" },
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
	});
