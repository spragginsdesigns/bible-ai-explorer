import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { ApiError, apiJson, type GetToken } from "@/lib/api";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";
import { deviceTimezone, reflectionAge, type ReflectionResponse } from "./readingOverview";

type CardState =
	| { kind: "loading" }
	| { kind: "consent" }
	| { kind: "error" }
	| { kind: "hidden" }
	| Extract<ReflectionResponse, { status: "ready" }> & { kind: "ready" };

/**
 * "Your walk": the AI reflection at the top of the reading log
 * (GET /api/reading-log/reflection). The server caches it per change in
 * reading, so this is usually one row read. Without AI consent the card offers
 * to write one instead of asking on open; nothing personal is sent until the
 * person taps.
 */
export function WalkCard({ getToken, refreshKey }: { getToken: GetToken; refreshKey: number }) {
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [state, setState] = useState<CardState>({ kind: "loading" });
	const request = useRef(0);

	const load = useCallback(
		async (ask: boolean) => {
			const id = ++request.current;
			setState((old) => (old.kind === "ready" && !ask ? old : { kind: "loading" }));
			const tz = deviceTimezone();
			try {
				const result = await apiJson<ReflectionResponse>(
					getToken,
					`/api/reading-log/reflection${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`,
					undefined,
					{ timeoutMs: 60_000, consentAsk: ask },
				);
				if (id !== request.current) return;
				if (result.status === "ready") setState({ ...result, kind: "ready" });
				else if (result.status === "consent-required") setState({ kind: "consent" });
				else if (result.status === "empty") setState({ kind: "hidden" });
				else setState({ kind: "error" });
			} catch (error) {
				if (id !== request.current) return;
				setState(error instanceof ApiError && error.status === 403 ? { kind: "consent" } : { kind: "error" });
			}
		},
		[getToken],
	);

	useEffect(() => {
		void load(false);
		return () => {
			request.current++;
		};
	}, [load, refreshKey]);

	// KJV, because the card quotes the KJV text.
	const openChapter = (book: number, chapter: number, verse = 1) =>
		router.push({
			pathname: "/bible/chapter",
			params: { book: String(book), chapter: String(chapter), verse: String(verse), translation: "KJV" },
		});

	if (state.kind === "hidden") return null;

	return (
		<View style={styles.card}>
			<Text style={styles.eyebrow}>YOUR WALK</Text>
			{state.kind === "loading" ? (
				<View style={styles.row} accessibilityLiveRegion="polite">
					<ActivityIndicator color={colors.accent} />
					<Text style={styles.muted}>Reflecting on your reading…</Text>
				</View>
			) : state.kind === "consent" ? (
				<>
					<Text style={styles.body}>
						SureWord can write a short reflection on what you have been reading, connected to your
						questions, notes and memories, with a verse to carry and where to read next.
					</Text>
					<Pressable accessibilityRole="button" onPress={() => void load(true)}>
						<Text style={styles.link}>Write my reflection →</Text>
					</Pressable>
				</>
			) : state.kind === "error" ? (
				<>
					<Text accessibilityLiveRegion="polite" style={styles.muted}>
						Your reflection could not be written right now.
					</Text>
					<Pressable accessibilityRole="button" onPress={() => void load(false)}>
						<Text style={styles.link}>Try again</Text>
					</Pressable>
				</>
			) : (
				<>
					<Text style={styles.title}>{state.reflection.title}</Text>
					<Text style={styles.body}>{state.reflection.reflection}</Text>
					{state.reflection.verse ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Open ${state.reflection.verse.bookName} ${state.reflection.verse.chapter}:${state.reflection.verse.verse}`}
							onPress={() =>
								openChapter(
									state.reflection.verse!.book,
									state.reflection.verse!.chapter,
									state.reflection.verse!.verse,
								)
							}
							style={({ pressed }) => [styles.verse, pressed && { backgroundColor: colors.accentPressed }]}
						>
							<Text style={styles.verseText}>“{state.reflection.verse.text}”</Text>
							<Text style={styles.verseRef}>
								{state.reflection.verse.bookName} {state.reflection.verse.chapter}:
								{state.reflection.verse.verse}
							</Text>
							{state.reflection.verse.note ? (
								<Text style={styles.muted}>{state.reflection.verse.note}</Text>
							) : null}
						</Pressable>
					) : null}
					{state.reflection.next ? (
						<Pressable
							accessibilityRole="button"
							onPress={() => openChapter(state.reflection.next!.book, state.reflection.next!.chapter)}
							style={({ pressed }) => [styles.next, pressed && { backgroundColor: colors.surfacePressed }]}
						>
							<Text style={styles.nextLabel}>
								Read next: {state.reflection.next.bookName} {state.reflection.next.chapter} →
							</Text>
							<Text style={styles.muted}>{state.reflection.next.reason}</Text>
						</Pressable>
					) : null}
					<View style={styles.footer}>
						<Text style={styles.age}>{reflectionAge(state.generatedAt, new Date())}</Text>
						<Pressable
							accessibilityRole="button"
							onPress={() =>
								router.push({
									pathname: "/",
									params: { prompt: "Help me go deeper in what I have been reading lately." },
								})
							}
						>
							<Text style={styles.link}>Talk it over →</Text>
						</Pressable>
					</View>
				</>
			)}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.md,
		},
		eyebrow: { color: c.accent, ...typography.micro, fontWeight: "700", letterSpacing: 1.2 },
		title: { color: c.text, ...typography.sectionTitle, fontWeight: "700" },
		body: { color: c.textSecondary, ...typography.body },
		muted: { color: c.textMuted, ...typography.support },
		row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		link: { color: c.accent, ...typography.support, fontWeight: "600", paddingVertical: spacing.xs },
		verse: {
			borderLeftWidth: 3,
			borderLeftColor: c.accent,
			paddingLeft: spacing.md,
			paddingVertical: spacing.xs,
			gap: spacing.xs,
			borderRadius: radius.sm,
		},
		verseText: { color: c.text, ...typography.body, fontStyle: "italic" },
		verseRef: { color: c.accent, ...typography.meta, fontWeight: "600" },
		next: {
			padding: spacing.md,
			borderRadius: radius.md,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: spacing.xs,
		},
		nextLabel: { color: c.text, ...typography.control, fontWeight: "600" },
		footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
		age: { color: c.textFaint, ...typography.micro, flexShrink: 1 },
	});
