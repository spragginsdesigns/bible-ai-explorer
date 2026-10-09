import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	RefreshControl,
	StyleSheet,
	View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTabBarSpace } from "@/features/chat/layout";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fetchReadingHistory } from "@/features/reading/readingLogApi";
import {
	retryBlockedReadings,
	useReadingLogStatus,
} from "@/features/reading/readingLogStore";
import {
	dayHeading,
	deviceTimezone,
	groupByDay,
	localDateKey,
	partialPercent,
	percentOfBible,
	streakNote,
	type DayChapter,
	type LogDay,
	type LogEntry,
	type ReadingOverview,
} from "@/features/reading/readingOverview";
import { WalkCard } from "@/features/reading/WalkCard";
import { BibleMap } from "@/features/reading/BibleMap";
import { bookByOrder } from "@/features/bible/books";
import { radius, spacing, typography, type Colors } from "@/theme";

interface HistoryPage {
	entries: LogEntry[];
	nextCursor: string | null;
}

export default function ReadingHistoryScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const { userId } = useAuth();
	const owner = useRef(userId);
	owner.current = userId;
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const bottom = useTabBarSpace();
	const status = useReadingLogStatus();
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [overview, setOverview] = useState<ReadingOverview | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	// Starts busy so the empty state never flashes before the first load.
	const [busy, setBusy] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showHelp, setShowHelp] = useState(false);
	const [reflectionKey, setReflectionKey] = useState(0);
	const request = useRef(0);

	// The request "Try again" repeats: undefined is a full refresh, a string is
	// the older page that failed. Never the next page by accident.
	const failedCursor = useRef<string | undefined>(undefined);
	const load = useCallback(
		async (next?: string) => {
			const id = ++request.current;
			const account = owner.current;
			const live = () => !!account && id === request.current && owner.current === account;
			setBusy(true);
			setError(null);
			const tz = deviceTimezone();
			// Stats and the map are a bonus over the history: their failure must
			// never blank the log, so they load on their own.
			if (!next)
				void fetchReadingHistory<ReadingOverview>(
					getToken,
					`/api/reading-log/overview${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`,
					live
				)
					.then((summary) => {
						if (live()) setOverview(summary);
					})
					.catch(() => undefined);
			try {
				const page = await fetchReadingHistory<HistoryPage>(
					getToken,
					`/api/reading-log?limit=30${next ? "&cursor=" + encodeURIComponent(next) : ""}`,
					live
				);
				if (!live()) return;
				setEntries((old) =>
					next
						? [
								...old,
								...page.entries.filter(
									(e) => !old.some((o) => o.eventId === e.eventId)
								),
							]
						: page.entries
				);
				setCursor(page.nextCursor);
			} catch (e) {
				if (id === request.current) {
					failedCursor.current = next;
					setError(
						e instanceof Error
							? e.message
							: "Reading history could not be loaded."
					);
				}
			} finally {
				if (id === request.current) {
					setBusy(false);
					setRefreshing(false);
				}
			}
		},
		[getToken]
	);
	const previousPending = useRef(status.pending);
	useEffect(() => {
		if (previousPending.current > 0 && status.pending === 0) {
			void load();
			setReflectionKey((key) => key + 1);
		}
		previousPending.current = status.pending;
	}, [status.pending, load]);
	// Another account's log must never flash on screen, but returning to the
	// same account keeps what it showed while the refresh runs.
	const shownFor = useRef(userId);
	useFocusEffect(
		useCallback(() => {
			if (shownFor.current !== userId) {
				shownFor.current = userId;
				setEntries([]);
				setOverview(null);
				setCursor(null);
				setReflectionKey((key) => key + 1);
			}
			void load();
			return () => {
				request.current++;
			};
		}, [load, userId])
	);

	const refresh = () => {
		setRefreshing(true);
		retryBlockedReadings();
		void load();
		setReflectionKey((key) => key + 1);
	};
	const days = useMemo(
		() => groupByDay(entries, (order) => bookByOrder(order)?.name ?? "Bible"),
		[entries]
	);
	const today = localDateKey(new Date());
	const openChapter = (row: DayChapter) =>
		router.push({
			pathname: "/bible/chapter",
			params: {
				book: String(row.book),
				chapter: String(row.chapter),
				verse: String(row.firstVerse),
				translation: row.translation,
			},
		});
	const hasReading = (overview?.totals.chapterReadings ?? 0) > 0 || entries.length > 0;

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()}>
					<Text style={styles.link}>‹ Bible</Text>
				</Pressable>
				<View style={styles.titleRow}>
					<Text accessibilityRole="header" style={styles.screenTitle}>
						Reading log
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Refresh reading log"
						disabled={busy}
						onPress={refresh}
						hitSlop={8}
					>
						<Text style={[styles.link, busy && { opacity: 0.5 }]}>Refresh</Text>
					</Pressable>
				</View>
			</View>
			<FlatList
				data={days}
				keyExtractor={(day: LogDay) => day.date}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						tintColor={colors.accent}
						colors={[colors.accent]}
						onRefresh={refresh}
					/>
				}
				contentContainerStyle={{
					padding: spacing.lg,
					paddingBottom: bottom + spacing.xxl,
				}}
				ListHeaderComponent={
					<View style={styles.intro}>
						{hasReading ? (
							<WalkCard key={userId ?? "signed-out"} getToken={getToken} refreshKey={reflectionKey} />
						) : null}
						{overview && hasReading ? <Stats overview={overview} styles={styles} /> : null}
						{overview?.historicalBackfillPending ? (
							<Text style={styles.body}>
								Your earlier reading history is still being added. Totals will
								update when it finishes.
							</Text>
						) : null}
						{status.pending > 0 || status.error ? (
							<View style={styles.card}>
								<Text accessibilityLiveRegion="polite" style={styles.body}>
									{status.error ??
										`${status.pending} reading ${status.pending === 1 ? "entry is" : "entries are"} saved on this device, waiting to sync.`}
								</Text>
								<Pressable
									accessibilityRole="button"
									onPress={() => {
										retryBlockedReadings();
										void load();
									}}
								>
									<Text style={styles.link}>Retry sync and refresh</Text>
								</Pressable>
							</View>
						) : null}
						{overview && hasReading ? <BibleMap coverage={overview.books} /> : null}
						{days.length ? (
							<Text accessibilityRole="header" style={styles.sectionTitle}>
								History
							</Text>
						) : null}
					</View>
				}
				renderItem={({ item }) => (
					<View style={styles.day}>
						<Text accessibilityRole="header" style={styles.dayHeading}>
							{dayHeading(item.date, today)}
						</Text>
						<View style={styles.dayCard}>
							{item.chapters.map((row, index) => (
								<Pressable
									key={row.key}
									accessibilityRole="button"
									accessibilityLabel={`Open ${row.bookName} ${row.chapter}, ${row.completed ? "read" : `${Math.round(row.fraction * 100)} percent read`}`}
									onPress={() => openChapter(row)}
									style={({ pressed }) => [
										styles.entry,
										index > 0 && styles.entryDivider,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<View style={styles.entryText}>
										<Text style={styles.entryTitle}>
											{row.bookName} {row.chapter}
										</Text>
										{row.physical || row.legacy || row.readings > 1 ? (
											<Text style={styles.entryMeta}>
												{[
													row.physical ? "Physical Bible" : null,
													row.legacy ? "Earlier tracking" : null,
													row.readings > 1 ? `${row.readings} times` : null,
												]
													.filter(Boolean)
													.join(" · ")}
											</Text>
										) : null}
									</View>
									{row.completed ? (
										<Text style={styles.done}>✓ Read</Text>
									) : (
										<View style={styles.partial}>
											<View style={styles.partialBar}>
												<View
													style={[
														styles.partialFill,
														{ width: `${partialPercent(row.fraction)}%` },
													]}
												/>
											</View>
											<Text style={styles.entryMeta}>Part</Text>
										</View>
									)}
								</Pressable>
							))}
						</View>
					</View>
				)}
				ListEmptyComponent={
					!busy && !error ? (
						<View style={styles.card}>
							<Text style={styles.body}>
								No readings yet. Open any chapter in the Bible tab and SureWord
								keeps track as you read. Reading a paper Bible? Tell SureWord
								what you read.
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={() => router.push("/")}
							>
								<Text style={styles.link}>Talk to SureWord →</Text>
							</Pressable>
						</View>
					) : null
				}
				ListFooterComponent={
					<View style={styles.intro}>
						{busy && !refreshing ? <ActivityIndicator color={colors.accent} /> : null}
						{error ? (
							<>
								<Text accessibilityRole="alert" style={styles.body}>
									{error}
								</Text>
								<Pressable
									accessibilityRole="button"
									onPress={() => void load(failedCursor.current)}
								>
									<Text style={styles.link}>Try again</Text>
								</Pressable>
							</>
						) : null}
						{cursor && !busy ? (
							<Pressable
								accessibilityRole="button"
								onPress={() => void load(cursor)}
							>
								<Text style={styles.link}>Load older readings</Text>
							</Pressable>
						) : null}
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ expanded: showHelp }}
							onPress={() => setShowHelp((open) => !open)}
						>
							<Text style={styles.link}>
								{showHelp ? "Hide how the log works" : "How the log works"}
							</Text>
						</Pressable>
						{showHelp ? (
							<Text style={styles.body}>
								The reader counts a verse once it has been on screen for a few
								seconds. A chapter is marked read when you cover every verse in
								one sitting; coming back to it later counts again. For a paper
								Bible, tell SureWord what you read, and ask SureWord if an entry
								needs correcting or removing.
							</Text>
						) : null}
					</View>
				}
			/>
		</Screen>
	);
}

function Stats({
	overview,
	styles,
}: {
	overview: ReadingOverview;
	styles: ReturnType<typeof createStyles>;
}) {
	const { totals, streak } = overview;
	const tiles = [
		{
			value: streak.current.toLocaleString(),
			label: "day streak",
			sub: streakNote(streak),
		},
		{
			value: totals.chaptersComplete.toLocaleString(),
			label: totals.chaptersComplete === 1 ? "chapter read" : "chapters read",
			sub: `${percentOfBible(totals.chaptersComplete, totals.totalChapters)} of the Bible`,
		},
		{
			value: totals.booksStarted.toLocaleString(),
			label: totals.booksStarted === 1 ? "book opened" : "books opened",
			sub: "of 66",
		},
	];
	return (
		<View style={styles.stats}>
			{tiles.map((tile) => (
				<View
					key={tile.label}
					style={styles.stat}
					accessible
					accessibilityLabel={`${tile.value} ${tile.label}, ${tile.sub}`}
				>
					<Text style={styles.statValue}>{tile.value}</Text>
					<Text style={styles.statLabel}>{tile.label}</Text>
					<Text style={styles.statSub}>{tile.sub}</Text>
				</View>
			))}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: { padding: spacing.lg, gap: spacing.sm },
		titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
		intro: { gap: spacing.lg, paddingBottom: spacing.lg },
		screenTitle: { color: c.text, ...typography.screenTitle, fontWeight: "700" },
		sectionTitle: { color: c.text, ...typography.sectionTitle, fontWeight: "700", marginTop: spacing.sm },
		link: {
			color: c.accent,
			...typography.support,
			paddingVertical: spacing.sm,
		},
		body: { color: c.textSecondary, ...typography.support },
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.sm,
		},
		stats: { flexDirection: "row", gap: spacing.sm },
		stat: {
			flex: 1,
			padding: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
		},
		statValue: { color: c.text, fontSize: 26, lineHeight: 32, fontWeight: "700" },
		statLabel: { color: c.textSecondary, ...typography.meta },
		statSub: { color: c.textFaint, ...typography.micro, marginTop: 2 },
		day: { marginBottom: spacing.lg, gap: spacing.sm },
		dayHeading: { color: c.textMuted, ...typography.meta, fontWeight: "600" },
		dayCard: {
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			overflow: "hidden",
		},
		entry: {
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			gap: spacing.md,
		},
		entryDivider: { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
		entryText: { flex: 1, gap: 2 },
		entryTitle: { color: c.text, ...typography.control, fontWeight: "600" },
		entryMeta: { color: c.textFaint, ...typography.micro },
		done: { color: c.accent, ...typography.meta, fontWeight: "600" },
		partial: { alignItems: "flex-end", gap: 4, width: 72 },
		partialBar: { width: 72, height: 4, borderRadius: 2, backgroundColor: c.border, overflow: "hidden" },
		partialFill: { height: 4, backgroundColor: c.accentDim },
	});
