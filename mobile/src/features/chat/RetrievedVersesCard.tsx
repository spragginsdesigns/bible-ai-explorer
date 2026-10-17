import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useRouter } from "expo-router";
import { resolveReference } from "@/features/bible/books";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { passagePlainText, passagesSummary, type GroupedVerses, type VersePassage } from "@/lib/versePassages";
import { fonts, radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { ShareCardSheet } from "@/features/shareCards/ShareCardSheet";
import type { ShareCardTarget } from "@/features/shareCards/shareCards";
import { copyVerse, formatVerseForSharing, parseTranslationId, readerRouteParams, saveVerseToNote } from "./verseActions";

/** Chips shown inline before the rest collapse into "+N more". */
const INLINE_CHIP_LIMIT = 4;

/**
 * Search confidence, ported from the web. Only search hits carry a real score:
 * a getPassage lookup is exact, so it gets no badge and no percentage.
 */
function matchStrength(c: Colors, average: number): { label: string; color: string } {
	if (average > 0.75) return { label: "Strong match", color: c.accent };
	if (average > 0.6) return { label: "Moderate match", color: c.accentDim };
	return { label: "Broad match", color: c.textFaint };
}

/**
 * The answer's Scripture, summarised inline as one chip per passage. The full
 * text and the per-passage actions live in a sheet, so a long answer no longer
 * grows by a screen per verse (see src/lib/chat/versePassages.ts).
 */
export function RetrievedVersesCard({
	grouped,
	averageSimilarity,
	focusKey,
	onOpen,
	onClose,
}: {
	grouped: GroupedVerses;
	/** Mean cosine score of the scored search hits; absent when there are none. */
	averageSimilarity?: number;
	/** Passage the sheet is open on; null keeps the sheet closed. "" opens it at the top. */
	focusKey: string | null;
	onOpen: (key: string) => void;
	onClose: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const all = [...grouped.passages, ...grouped.searchHits];
	const shown = all.slice(0, INLINE_CHIP_LIMIT);
	const hidden = all.length - shown.length;

	return (
		<View style={styles.card}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Scripture in this answer, ${passagesSummary(grouped)}`}
				onPress={() => onOpen("")}
				style={({ pressed }) => [styles.header, pressed && { backgroundColor: colors.surfacePressed }]}
			>
				<Text style={styles.glyph}>📖</Text>
				<Text style={styles.title} numberOfLines={1}>
					{passagesSummary(grouped)}
				</Text>
				<Text style={styles.chevron}>›</Text>
			</Pressable>
			<View style={styles.chips}>
				{shown.map((passage) => (
					<Pressable
						key={passage.key}
						accessibilityRole="button"
						accessibilityLabel={`Open ${passage.reference}`}
						onPress={() => onOpen(passage.key)}
						style={({ pressed }) => [styles.refChip, pressed && { backgroundColor: colors.surfacePressed }]}
					>
						<Text style={styles.refChipLabel} numberOfLines={1}>
							{passage.reference}
						</Text>
					</Pressable>
				))}
				{hidden > 0 && (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Show all ${all.length}`}
						onPress={() => onOpen("")}
						style={({ pressed }) => [styles.refChip, pressed && { backgroundColor: colors.surfacePressed }]}
					>
						<Text style={styles.moreLabel}>+{hidden} more</Text>
					</Pressable>
				)}
			</View>
			<VersesSheet
				grouped={grouped}
				averageSimilarity={averageSimilarity}
				focusKey={focusKey}
				onClose={onClose}
			/>
		</View>
	);
}

function VersesSheet({
	grouped,
	averageSimilarity,
	focusKey,
	onClose,
}: {
	grouped: GroupedVerses;
	/** Mean cosine score of the scored search hits; absent when there are none. */
	averageSimilarity?: number;
	focusKey: string | null;
	onClose: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const scrollRef = useRef<ScrollView>(null);
	const offsets = useRef(new Map<string, number>());
	const [laidOut, setLaidOut] = useState(0);
	const scrolledFor = useRef<string | null>(null);
	const visible = focusKey !== null;

	useEffect(() => {
		// Modal drops its children on close, so the next open lays out a new
		// ScrollView; positions from the last one would scroll before it exists.
		if (!visible) {
			scrolledFor.current = null;
			offsets.current.clear();
		}
	}, [visible]);

	// Scroll once per opening, as soon as the focused passage has a position.
	useEffect(() => {
		if (!focusKey || scrolledFor.current === focusKey) return;
		const y = offsets.current.get(focusKey);
		if (y === undefined) return;
		scrolledFor.current = focusKey;
		scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: false });
	}, [focusKey, laidOut]);

	const onLayoutFor = useCallback(
		(key: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
			offsets.current.set(key, event.nativeEvent.layout.y);
			setLaidOut((count) => count + 1);
		},
		[]
	);

	const badge = averageSimilarity !== undefined && grouped.searchHits.length > 0 ? matchStrength(colors, averageSimilarity) : null;

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Scripture in this answer" heightRatio={0.85}>
			<ScrollView
				ref={scrollRef}
				style={styles.sheetScroll}
				contentContainerStyle={styles.sheetContent}
				showsVerticalScrollIndicator
			>
				{grouped.passages.map((passage) => (
					<View key={passage.key} onLayout={onLayoutFor(passage.key)}>
						<PassageBlock passage={passage} focused={passage.key === focusKey} onNavigate={onClose} />
					</View>
				))}
				{grouped.searchHits.length > 0 && (
					<View style={styles.sectionHeader}>
						<Text style={styles.sectionTitle}>Found by search</Text>
						{badge && (
							<View style={[styles.badge, { borderColor: badge.color }]}>
								<Text style={[styles.badgeLabel, { color: badge.color }]}>{badge.label}</Text>
							</View>
						)}
					</View>
				)}
				{grouped.searchHits.map((passage) => (
					<View key={passage.key} onLayout={onLayoutFor(passage.key)}>
						<PassageBlock passage={passage} focused={passage.key === focusKey} onNavigate={onClose} />
					</View>
				))}
			</ScrollView>
		</BottomSheet>
	);
}

type ActionStatus = "idle" | "busy" | "done" | "error";

function PassageBlock({
	passage,
	focused,
	onNavigate,
}: {
	passage: VersePassage;
	focused: boolean;
	/** Closes the sheet before a push, or the route opens under the modal. */
	onNavigate: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const getToken = useStableGetToken();
	const [copyStatus, setCopyStatus] = useState<ActionStatus>("idle");
	const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");
	const [shareTarget, setShareTarget] = useState<ShareCardTarget | null>(null);
	const translation = parseTranslationId(passage.translation) ?? undefined;
	const source = { reference: passage.reference, text: passagePlainText(passage), translation };
	// A passage with no known translation shares as text only: a card would
	// otherwise draw the KJV under words the reader saw in another version.
	const openShare = () =>
		setShareTarget({ kind: "verse", reference: passage.reference, translation: translation ?? "" });

	const flash = useCallback((set: (s: ActionStatus) => void, next: ActionStatus) => {
		set(next);
		if (next === "done" || next === "error") setTimeout(() => set("idle"), 2000);
	}, []);

	const onCopy = async () => {
		try {
			await copyVerse(source);
			flash(setCopyStatus, "done");
		} catch {
			flash(setCopyStatus, "error");
		}
	};

	const onSave = async () => {
		if (saveStatus === "busy") return;
		setSaveStatus("busy");
		try {
			const noteId = await saveVerseToNote(getToken, source);
			flash(setSaveStatus, "done");
			onNavigate();
			router.push({ pathname: "/notes/[id]", params: { id: noteId } });
		} catch {
			flash(setSaveStatus, "error");
		}
	};

	const onRead = () => {
		// Unresolvable references (unexpected formats) do nothing rather than
		// pushing a broken route.
		const target = resolveReference(passage.firstReference);
		if (!target) return;
		onNavigate();
		router.push({ pathname: "/bible/chapter", params: readerRouteParams(target, translation) });
	};

	const multi = passage.verses.length > 1;
	return (
		<View style={[styles.passage, focused && { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft }]}>
			<View style={styles.referenceRow}>
				<Text style={styles.reference}>{passage.reference}</Text>
				<Text style={styles.meta}>
					{passage.similarity !== null
						? `${Math.round(passage.similarity * 100)}%`
						: (passage.translation ?? "")}
				</Text>
			</View>
			<Text style={styles.verse}>
				{passage.verses.map((entry, index) => (
					<React.Fragment key={`${entry.verse}-${index}`}>
						{multi && <Text style={styles.verseNumber}>{`${index > 0 ? " " : ""}${entry.verse} `}</Text>}
						{entry.text ?? ""}
					</React.Fragment>
				))}
			</Text>
			<View style={styles.actions}>
				<ActionChip label={copyStatus === "done" ? "Copied ✓" : "Copy"} onPress={onCopy} />
				<ActionChip label="Share" onPress={openShare} />
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
				<ActionChip label="Read in context" onPress={onRead} />
			</View>
			<ShareCardSheet
				target={shareTarget}
				shareText={formatVerseForSharing(source)}
				onClose={() => setShareTarget(null)}
			/>
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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			marginTop: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			overflow: "hidden",
			paddingBottom: spacing.md,
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingTop: spacing.md,
			paddingBottom: spacing.sm,
		},
		glyph: { fontSize: 13 },
		title: { flexShrink: 1, color: c.textSecondary, fontSize: 13, fontWeight: "600" },
		chevron: { marginLeft: "auto", color: c.textFaint, fontSize: 20, lineHeight: 20 },
		chips: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
		},
		refChip: {
			maxWidth: "100%",
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.md,
			paddingVertical: 6,
		},
		refChipLabel: { ...typography.meta, color: c.accent, fontWeight: "600" },
		moreLabel: { ...typography.meta, color: c.textMuted, fontWeight: "600" },
		sheetScroll: { flex: 1 },
		sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
		sectionHeader: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.sm,
		},
		sectionTitle: { ...typography.meta, color: c.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
		badge: {
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.full,
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
		},
		badgeLabel: { ...typography.micro, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
		passage: {
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			padding: spacing.md,
		},
		referenceRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.sm,
		},
		reference: { flexShrink: 1, color: c.accent, fontSize: 15, fontWeight: "700" },
		meta: { ...typography.micro, color: c.textGhost, fontVariant: ["tabular-nums"] },
		verse: {
			marginTop: spacing.xs,
			color: c.textSecondary,
			fontFamily: fonts.verse,
			...typography.longForm,
		},
		// No lineHeight: a nested Text with its own would break the verse line box.
		verseNumber: { fontSize: 12, color: c.accentDim, fontWeight: "700" },
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
		chipAccent: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		chipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "600" },
	});
