import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { RetrievedVerse } from "@/lib/chatView";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { colors, fonts, radius, spacing } from "@/theme";
import { Collapsible } from "./Collapsible";
import { copyVerse, saveVerseToNote, shareVerse } from "./verseActions";

/**
 * Retrieval confidence, ported from the web's RetrievedVersesCollapsible. The
 * palette stays inside the monochrome + amber system: amber for a strong hit,
 * dimmed amber for a moderate one, grey for a broad topical sweep.
 */
function matchStrength(average: number): { label: string; color: string } {
	if (average > 0.75) return { label: "Strong match", color: colors.accent };
	if (average > 0.6) return { label: "Moderate match", color: colors.accentDim };
	return { label: "Broad match", color: colors.textFaint };
}

type ActionStatus = "idle" | "busy" | "done" | "error";

function VerseActions({ verse }: { verse: RetrievedVerse }) {
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
		router.push({ pathname: "/reader", params: { reference: verse.reference } });
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
	return (
		<Collapsible
			glyph="📖"
			title={`Retrieved Verses (${verses.length})`}
			badge={matchStrength(averageSimilarity)}
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

const styles = StyleSheet.create({
	row: { paddingVertical: spacing.md },
	referenceRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: spacing.sm,
	},
	reference: { flexShrink: 1, color: colors.accent, fontSize: 13, fontWeight: "600" },
	percent: { color: colors.textGhost, fontSize: 11, fontVariant: ["tabular-nums"] },
	verse: {
		marginTop: spacing.xs,
		color: colors.textSecondary,
		fontFamily: fonts.verse,
		fontSize: 17,
		lineHeight: 25,
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
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		paddingHorizontal: spacing.md,
		paddingVertical: 6,
	},
	chipAccent: {
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	chipLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
});
