import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useRouter } from "expo-router";
import type { RetrievedVerse } from "@/lib/chatView";
import { resolveReference } from "@/features/bible/books";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { fonts, radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { Collapsible } from "./Collapsible";
import { copyVerse, saveVerseToNote, shareVerse } from "./verseActions";

/**
 * Retrieval confidence, ported from the web's RetrievedVersesCollapsible. The
 * palette stays inside the monochrome + amber system: amber for a strong hit,
 * dimmed amber for a moderate one, grey for a broad topical sweep.
 */
function matchStrength(c: Colors, average: number): { label: string; color: string } {
	if (average > 0.75) return { label: "Strong match", color: c.accent };
	if (average > 0.6) return { label: "Moderate match", color: c.accentDim };
	return { label: "Broad match", color: c.textFaint };
}

type ActionStatus = "idle" | "busy" | "done" | "error";

function VerseActions({ verse }: { verse: RetrievedVerse }) {
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();
	const [copyStatus, setCopyStatus] = useState<ActionStatus>("idle");
	const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");

	const flash = useCallback((set: (s: ActionStatus) => void, next: ActionStatus) => {
		set(next);
		if (next === "done" || next === "error") {
			setTimeout(() => set("idle"), 2000);
		}
	}, []);

	const onCopy = useCallback(async () => {
		try {
			await copyVerse(verse);
			flash(setCopyStatus, "done");
		} catch {
			flash(setCopyStatus, "error");
		}
	}, [verse, flash]);

	const onShare = useCallback(() => {
		shareVerse(verse).catch(() => {});
	}, [verse]);

	const onSave = useCallback(async () => {
		if (saveStatus === "busy") return;
		setSaveStatus("busy");
		try {
			const noteId = await saveVerseToNote(getToken, verse);
			flash(setSaveStatus, "done");
			router.push({ pathname: "/notes/[id]", params: { id: noteId } });
		} catch {
			flash(setSaveStatus, "error");
		}
	}, [getToken, verse, saveStatus, flash, router]);

	const onRead = useCallback(() => {
		const target = resolveReference(verse.reference);
		// Unresolvable references (unexpected formats) simply do nothing rather
		// than crashing or pushing a broken route.
		if (!target) return;
		router.push({
			pathname: "/bible/chapter",
			params: {
				book: String(target.order),
				chapter: String(target.chapter),
				...(target.verse ? { verse: String(target.verse) } : {}),
			},
		});
	}, [router, verse.reference]);

	return (
		<View style={styles.actions}>
			<ActionChip label={copyStatus === "done" ? "Copied ✓" : "Copy"} onPress={onCopy} />
			<ActionChip label="Share" onPress={onShare} />
			<ActionChip
				label={
					saveStatus === "busy"
						? "Saving…"
						: saveStatus === "done"
							? "Saved ✓"
							: saveStatus === "error"
								? "Failed"
								: "Save to note"
				}
				accent
				disabled={saveStatus === "busy"}
				onPress={onSave}
			/>
			<ActionChip label="Read" onPress={onRead} />
		</View>
	);
}

function ActionChip({
	label,
	onPress,
	accent = false,
	disabled = false,
}: {
	label: string;
	onPress: () => void;
	accent?: boolean;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.chip,
				accent && styles.chipAccent,
				pressed && { backgroundColor: colors.surfacePressed },
				disabled && { opacity: 0.5 },
			]}
		>
			<Text style={[styles.chipLabel, accent && { color: colors.accent }]}>{label}</Text>
		</Pressable>
	);
}

export function RetrievedVersesCard({
	verses,
	averageSimilarity,
}: {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Collapsible
			glyph="📖"
			title={`Retrieved Verses (${verses.length})`}
			badge={matchStrength(colors, averageSimilarity)}
		>
			{verses.map((verse, index) => (
				<View key={`${verse.reference}-${index}`} style={styles.row}>
					<View style={styles.referenceRow}>
						<Text style={styles.reference}>{verse.reference}</Text>
						<Text style={styles.percent}>{Math.round(verse.similarity * 100)}%</Text>
					</View>
					{verse.text && <Text style={styles.verse}>{verse.text}</Text>}
					<VerseActions verse={verse} />
				</View>
			))}
		</Collapsible>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		row: { paddingVertical: spacing.md },
		referenceRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.sm,
		},
		reference: { flexShrink: 1, color: c.accent, fontSize: 13, fontWeight: "600" },
		percent: { ...typography.micro, color: c.textGhost, fontVariant: ["tabular-nums"] },
		verse: {
			marginTop: spacing.xs,
			color: c.textSecondary,
			fontFamily: fonts.verse,
			...typography.longForm,
		},
		actions: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			marginTop: spacing.sm,
		},
		chip: {
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
			paddingVertical: 6,
		},
		chipAccent: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		chipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "600" },
	});
