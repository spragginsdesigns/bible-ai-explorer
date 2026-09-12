import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
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
import { apiJson } from "@/lib/api";
import { type ReadingEntry } from "@/features/reading/readingLogCore";
import {
	retryBlockedReadings,
	useReadingLogStatus,
} from "@/features/reading/readingLogStore";
import { bookByOrder } from "@/features/bible/books";
import { radius, spacing, typography, type Colors } from "@/theme";
type ServerReadingEntry = Omit<ReadingEntry, "occurredAt"> & {
	occurredAt: string | null;
};
interface HistoryPage {
	entries: ServerReadingEntry[];
	nextCursor: string | null;
	stats: {
		sessions: number;
		chapterReadings: number;
		partialReadings: number;
		uniqueChapters: number;
		activeDays: number;
		lastReadAt: string | null;
		historicalBackfillPending?: boolean;
	};
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
	const [entries, setEntries] = useState<ServerReadingEntry[]>([]);
	const [stats, setStats] = useState<HistoryPage["stats"] | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const load = useCallback(
		async (next?: string) => {
			const id = ++request.current;
			const account = owner.current;
			setBusy(true);
			setError(null);
			try {
				const page = await apiJson<HistoryPage>(
					getToken,
					`/api/reading-log?limit=30${next ? "&cursor=" + encodeURIComponent(next) : ""}`
				);
				if (id !== request.current || owner.current !== account) return;
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
				setStats(page.stats);
			} catch (e) {
				if (id === request.current)
					setError(
						e instanceof Error
							? e.message
							: "Reading history could not be loaded."
					);
			} finally {
				if (id === request.current) setBusy(false);
			}
		},
		[getToken]
	);
	const previousPending = useRef(status.pending);
	useEffect(() => {
		if (previousPending.current > 0 && status.pending === 0) void load();
		previousPending.current = status.pending;
	}, [status.pending, load]);
	useFocusEffect(
		useCallback(() => {
			setEntries([]);
			setStats(null);
			void load();
			return () => {
				request.current++;
			};
		}, [load, userId])
	);
	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()}>
					<Text style={styles.link}>‹ Bible</Text>
				</Pressable>
				<Text style={styles.title}>Reading log</Text>
			</View>
			<FlatList
				data={entries}
				keyExtractor={(entry) => entry.eventId}
				contentContainerStyle={{
					padding: spacing.lg,
					paddingBottom: bottom + spacing.xxl,
				}}
				ListHeaderComponent={
					<View style={styles.intro}>
						<Text style={styles.body}>
							Your reading, over a lifetime. Returning to a chapter in a later
							session counts again.
						</Text>
						{stats ? (
							<View style={styles.card}>
								<Text style={styles.title}>
									{stats.uniqueChapters.toLocaleString()}{" "}
									{stats.uniqueChapters === 1 ? "chapter" : "chapters"} covered
								</Text>
								<Text style={styles.body}>
									{stats.chapterReadings.toLocaleString()}{" "}
									{stats.chapterReadings === 1
										? "chapter reading"
										: "chapter readings"}{" "}
									· {stats.sessions.toLocaleString()}{" "}
									{stats.sessions === 1 ? "session" : "sessions"} ·{" "}
									{stats.activeDays.toLocaleString()}{" "}
									{stats.activeDays === 1 ? "day" : "days"}
								</Text>
							</View>
						) : null}
						{stats?.historicalBackfillPending ? (
							<Text style={styles.body}>
								Your earlier reading history is still being added. Lifetime
								totals will update when it finishes.
							</Text>
						) : null}
						<View style={styles.card}>
							<Text style={styles.body}>
								The reader logs verses you spend time viewing. A chapter is
								complete when all its verses have been covered in that session.
								For your physical Bible, tell SureWord what you read.
							</Text>
							<Pressable
								accessibilityRole="button"
								onPress={() => router.push("/")}
							>
								<Text style={styles.link}>Talk to SureWord →</Text>
							</Pressable>
						</View>
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
						<Pressable
							accessibilityRole="button"
							disabled={busy}
							onPress={() => void load()}
						>
							<Text style={styles.link}>Refresh history</Text>
						</Pressable>
					</View>
				}
				renderItem={({ item, index }) => {
					const book = item.bookName ?? bookByOrder(item.book)?.name ?? "Bible";
					const previous = entries[index - 1];
					const range = item.completed
						? ""
						: ":" +
							item.verseRanges
								.map((r) =>
									r.start === r.end ? r.start : `${r.start}–${r.end}`
								)
								.join(", ");
					const when =
						item.precision === "exact" && item.occurredAt
							? new Date(item.occurredAt).toLocaleString()
							: `${item.localDate ?? item.occurredAt?.slice(0, 10) ?? "Date unspecified"} · ${item.precision === "day" ? "time unspecified" : item.precision}`;
					return (
						<View>
							<Text style={styles.session}>
								{previous?.sessionId !== item.sessionId ? when : ""}
							</Text>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Open ${book} ${item.chapter}${range}`}
								onPress={() =>
									router.push({
										pathname: "/bible/chapter",
										params: {
											book: String(item.book),
											chapter: String(item.chapter),
											verse: String(item.verseRanges[0]?.start ?? 1),
											translation: item.translation,
										},
									})
								}
								style={styles.card}
							>
								<Text style={styles.title}>
									{book} {item.chapter}
									{range}
								</Text>
								<Text style={styles.body}>
									{item.completed ? "Chapter complete" : "Partial reading"} ·{" "}
									{item.source === "reader"
										? "SureWord reader"
										: item.source === "physical"
											? "Physical Bible"
											: item.source === "legacy"
												? "Earlier tracking"
												: "Reported reading"}
								</Text>
							</Pressable>
						</View>
					);
				}}
				ListEmptyComponent={
					!busy && !error ? (
						<Text style={styles.body}>
							No readings yet. Start with a chapter, or tell SureWord what you
							read in your physical Bible.
						</Text>
					) : null
				}
				ListFooterComponent={
					<View style={styles.intro}>
						{busy ? <ActivityIndicator color={colors.accent} /> : null}
						{error ? (
							<>
								<Text accessibilityRole="alert" style={styles.body}>
									{error}
								</Text>
								<Pressable
									accessibilityRole="button"
									onPress={() =>
										void load(
											entries.length ? (cursor ?? undefined) : undefined
										)
									}
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
						<Text style={styles.body}>
							Need to correct or remove a reading? Ask SureWord to find the
							entry and make the change.
						</Text>
					</View>
				}
			/>
		</Screen>
	);
}
const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: { padding: spacing.lg, gap: spacing.sm },
		intro: { gap: spacing.md, paddingBottom: spacing.lg },
		title: { color: c.text, ...typography.control, fontWeight: "600" },
		link: {
			color: c.accent,
			...typography.support,
			paddingVertical: spacing.sm,
		},
		body: { color: c.textSecondary, ...typography.support },
		session: {
			color: c.textMuted,
			...typography.meta,
			marginTop: spacing.md,
			marginBottom: spacing.xs,
		},
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.sm,
		},
	});
