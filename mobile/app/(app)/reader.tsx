import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { GlassCard, Screen } from "@/components/ui";
import { apiJson, isOfflineMessage } from "@/lib/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { colors, fonts, radius, spacing } from "@/theme";

interface PassageVerse {
	book: string;
	chapter: number;
	verse: number;
	text: string;
}

interface PassageResponse {
	reference: string;
	text: string;
	verses: PassageVerse[];
	translation: string;
	error?: string;
}

const FONT_STEPS = [17, 20, 24, 28] as const;

/**
 * Full-screen passage reading mode. Opened from retrieved-verse cards
 * ("Read") with ?reference=..., fetches the exact KJV text via /api/get-verse,
 * and offers adjustable type size plus copy/share of the whole passage.
 */
export default function ReaderScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const params = useLocalSearchParams<{ reference?: string; text?: string }>();
	const reference = typeof params.reference === "string" ? params.reference : "";
	const seedText = typeof params.text === "string" ? params.text : "";

	const [passage, setPassage] = useState<PassageResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [fontStep, setFontStep] = useState(1);
	const [copied, setCopied] = useState(false);

	const load = useCallback(async () => {
		if (!reference) {
			setError("No passage reference was provided.");
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const data = await apiJson<PassageResponse>(getToken, "/api/get-verse", {
				method: "POST",
				body: { reference },
			});
			if (data.error || (!data.text && data.verses.length === 0)) {
				setError(data.error ?? "That passage could not be found in the KJV.");
			} else {
				setPassage(data);
			}
		} catch (err) {
			setError(
				isOfflineMessage(err)
					? (err as Error).message
					: "Something went wrong opening this passage. Pull down your connection and try again."
			);
		} finally {
			setLoading(false);
		}
	}, [getToken, reference]);

	useEffect(() => {
		load();
	}, [load]);

	const fullText = useMemo(() => {
		if (passage) {
			const body = passage.verses.length
				? passage.verses.map((v) => `${v.verse} ${v.text}`).join("\n")
				: passage.text;
			return `${passage.reference} (KJV)\n\n${body}`;
		}
		return seedText ? `${reference} (KJV)\n\n${seedText}` : "";
	}, [passage, reference, seedText]);

	const onCopy = useCallback(async () => {
		if (!fullText) return;
		await Clipboard.setStringAsync(fullText);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [fullText]);

	const onShare = useCallback(() => {
		if (fullText) Share.share({ message: fullText }).catch(() => {});
	}, [fullText]);

	const fontSize = FONT_STEPS[fontStep];
	const lineHeight = Math.round(fontSize * 1.55);

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					{passage?.reference ?? reference}
				</Text>
				<View style={styles.fontControls}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Decrease text size"
						disabled={fontStep === 0}
						onPress={() => setFontStep((s) => Math.max(0, s - 1))}
						style={[styles.fontButton, fontStep === 0 && { opacity: 0.35 }]}
					>
						<Text style={styles.fontButtonLabel}>A−</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Increase text size"
						disabled={fontStep === FONT_STEPS.length - 1}
						onPress={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
						style={[styles.fontButton, fontStep === FONT_STEPS.length - 1 && { opacity: 0.35 }]}
					>
						<Text style={[styles.fontButtonLabel, { fontSize: 16 }]}>A+</Text>
					</Pressable>
				</View>
			</View>

			{loading ? (
				<View style={styles.center}>
					<ActivityIndicator color={colors.accent} />
					<Text style={styles.loadingLabel}>Opening the passage…</Text>
				</View>
			) : error ? (
				<View style={styles.center}>
					<GlassCard style={styles.errorCard}>
						<Text style={styles.errorText}>{error}</Text>
						<Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
							<Text style={styles.retryLabel}>Try again</Text>
						</Pressable>
					</GlassCard>
				</View>
			) : (
				<>
					<ScrollView contentContainerStyle={styles.content}>
						{passage && passage.verses.length > 0 ? (
							passage.verses.map((v) => (
								<Text key={`${v.chapter}:${v.verse}`} style={[styles.verseText, { fontSize, lineHeight }]}>
									<Text style={styles.verseNumber}>{v.verse} </Text>
									{v.text}
								</Text>
							))
						) : (
							<Text style={[styles.verseText, { fontSize, lineHeight }]}>
								{passage?.text ?? seedText}
							</Text>
						)}
						<Text style={styles.translation}>{passage?.translation ?? "King James Version"}</Text>
					</ScrollView>
					<View style={styles.bottomBar}>
						<Pressable accessibilityRole="button" onPress={onCopy} style={styles.bottomChip}>
							<Text style={styles.bottomChipLabel}>{copied ? "Copied ✓" : "Copy passage"}</Text>
						</Pressable>
						<Pressable accessibilityRole="button" onPress={onShare} style={[styles.bottomChip, styles.bottomChipAccent]}>
							<Text style={[styles.bottomChipLabel, { color: colors.accent }]}>Share</Text>
						</Pressable>
					</View>
				</>
			)}
		</Screen>
	);
}

const styles = StyleSheet.create({
	topBar: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
	},
	back: { color: colors.accent, fontSize: 15, fontWeight: "600" },
	title: {
		flex: 1,
		color: colors.text,
		fontSize: 15,
		fontWeight: "600",
		textAlign: "center",
	},
	fontControls: { flexDirection: "row", gap: spacing.sm },
	fontButton: {
		borderRadius: radius.md,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
	},
	fontButtonLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
	loadingLabel: { marginTop: spacing.md, color: colors.textFaint, fontSize: 13 },
	errorCard: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
	errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
	retry: {
		borderRadius: radius.md,
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
		borderWidth: 1,
		paddingHorizontal: spacing.xl,
		paddingVertical: spacing.sm,
	},
	retryLabel: { color: colors.accent, fontSize: 14, fontWeight: "600" },
	content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
	verseText: {
		color: colors.textSecondary,
		fontFamily: fonts.verse,
		marginBottom: spacing.md,
	},
	verseNumber: { color: colors.accentDim, fontSize: 12, fontFamily: fonts.sans, fontWeight: "700" },
	translation: {
		marginTop: spacing.lg,
		color: colors.textGhost,
		fontSize: 12,
		textAlign: "center",
		fontStyle: "italic",
	},
	bottomBar: {
		flexDirection: "row",
		gap: spacing.md,
		paddingHorizontal: spacing.xl,
		paddingVertical: spacing.md,
	},
	bottomChip: {
		flex: 1,
		minHeight: 44,
		borderRadius: radius.lg,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		alignItems: "center",
		justifyContent: "center",
	},
	bottomChipAccent: {
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	bottomChipLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
});
