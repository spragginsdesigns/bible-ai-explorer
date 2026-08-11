import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { GlassCard, Screen } from "@/components/ui";
import { radius, spacing, type Colors } from "@/theme";
import { useThemedStyles, useTheme } from "@/features/settings/settingsStore";
import { relativeTime } from "@/features/notes/utils";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import {
	addMemory,
	clearMemories,
	deleteMemory,
	fetchMemories,
	generateMemorySummary,
	type MemoryRecord,
	type MemorySummary,
} from "@/features/memories/api";
import { groupMemoriesByCategory } from "@/features/memories/utils";

type SummaryState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "loaded"; summary: MemorySummary | null; generatedAt: string | null }
	| { status: "error" };

function serverMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Manage screen for the ChatGPT-style memory feature: the AI-written summary
 * of what SureWord remembers, plus adding, deleting, and clearing individual
 * memories. Push-only, reached from Settings.
 *
 * The summary endpoint is an LLM call, so it never fires on focus — only when
 * the user asks for it, once per screen visit unless they regenerate.
 */
export default function MemoriesScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const getToken = useStableGetToken();

	const [memories, setMemories] = useState<MemoryRecord[]>([]);
	const [hasLoaded, setHasLoaded] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [summaryState, setSummaryState] = useState<SummaryState>({ status: "idle" });
	const [addText, setAddText] = useState("");
	const [isAdding, setIsAdding] = useState(false);

	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const load = useCallback(async () => {
		try {
			const data = await fetchMemories(getToken);
			if (!mounted.current) return;
			setMemories(data.memories);
			setLoadError(null);
		} catch (err) {
			if (!mounted.current) return;
			setLoadError(serverMessage(err, "Could not load your memories."));
		} finally {
			if (!mounted.current) return;
			setHasLoaded(true);
		}
	}, [getToken]);

	useFocusEffect(
		useCallback(() => {
			void load();
		}, [load])
	);

	const groups = useMemo(() => groupMemoriesByCategory(memories), [memories]);

	const generateSummary = useCallback(async () => {
		setSummaryState({ status: "loading" });
		try {
			const data = await generateMemorySummary(getToken);
			if (!mounted.current) return;
			setSummaryState(
				data.summary
					? { status: "loaded", summary: data.summary, generatedAt: data.generatedAt }
					: { status: "loaded", summary: null, generatedAt: null }
			);
		} catch (err) {
			if (!mounted.current) return;
			Alert.alert("Could not write the summary", serverMessage(err, "Try again in a moment."));
			setSummaryState({ status: "error" });
		}
	}, [getToken]);

	const handleAdd = useCallback(async () => {
		const content = addText.trim();
		if (!content || isAdding) return;
		setIsAdding(true);
		try {
			const memory = await addMemory(getToken, content);
			if (!mounted.current) return;
			setAddText("");
			setMemories((current) => [memory, ...current]);
			setSummaryState({ status: "idle" });
		} catch (err) {
			if (!mounted.current) return;
			Alert.alert("Could not save that memory", serverMessage(err, "Try again in a moment."));
		} finally {
			if (!mounted.current) return;
			setIsAdding(false);
		}
	}, [addText, isAdding, getToken, load]);

	const confirmDelete = useCallback(
		(memory: MemoryRecord) => {
			Alert.alert("Delete this memory?", `"${memory.content}"`, [
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () => {
						void (async () => {
							try {
								await deleteMemory(getToken, memory.id);
								if (!mounted.current) return;
								setMemories((current) => current.filter((item) => item.id !== memory.id));
								setSummaryState({ status: "idle" });
							} catch (err) {
								if (!mounted.current) return;
								Alert.alert(
									"Could not delete that memory",
									serverMessage(err, "Try again in a moment.")
								);
							}
						})();
					},
				},
			]);
		},
		[getToken]
	);

	const confirmClearAll = useCallback(() => {
		Alert.alert("Clear all memories?", "SureWord will forget everything it has learned about you.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Clear all",
				style: "destructive",
				onPress: () => {
					void (async () => {
						try {
							await clearMemories(getToken);
							if (!mounted.current) return;
							setMemories([]);
							setSummaryState({ status: "idle" });
						} catch (err) {
							if (!mounted.current) return;
							Alert.alert(
								"Could not clear your memories",
								serverMessage(err, "Try again in a moment.")
							);
						}
					})();
				},
			},
		]);
	}, [getToken]);

	const isSummaryBusy = summaryState.status === "loading";
	const summaryButtonLabel =
		summaryState.status === "loaded" && summaryState.summary ? "Regenerate" : "Generate summary";

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Back"
					onPress={() => router.back()}
					hitSlop={8}
					style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
				>
					<Text style={styles.backGlyph}>‹</Text>
				</Pressable>
				<Text style={styles.title}>Memory</Text>
				<View style={styles.backButton} />
			</View>

			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<Text style={styles.sectionLabel}>SUMMARY</Text>
				<GlassCard style={styles.card}>
					{summaryState.status === "loaded" && summaryState.summary ? (
						<>
							<Text style={styles.summaryOverview}>{summaryState.summary.overview}</Text>
							{summaryState.summary.sections.map((section) => (
								<View key={section.title} style={styles.summarySection}>
									<Text style={styles.summaryHeading}>{section.title}</Text>
									<Text style={styles.summaryText}>{section.content}</Text>
								</View>
							))}
							{summaryState.generatedAt ? (
								<Text style={styles.hint}>Updated {relativeTime(summaryState.generatedAt)}</Text>
							) : null}
						</>
					) : summaryState.status === "loaded" ? (
						<Text style={styles.hint}>
							Nothing remembered yet — SureWord learns about you as you chat.
						</Text>
					) : (
						<Text style={styles.hint}>
							SureWord can write a short summary of everything it remembers about you.
						</Text>
					)}
					<Pressable
						accessibilityRole="button"
						disabled={isSummaryBusy}
						onPress={() => void generateSummary()}
						style={({ pressed }) => [
							styles.summaryButton,
							pressed && { backgroundColor: colors.accentPressed },
							isSummaryBusy && { opacity: 0.6 },
						]}
					>
						{isSummaryBusy ? (
							<View style={styles.summaryBusyRow}>
								<ActivityIndicator size="small" color={colors.accent} />
								<Text style={styles.summaryButtonLabel}>Writing your summary…</Text>
							</View>
						) : (
							<Text style={styles.summaryButtonLabel}>{summaryButtonLabel}</Text>
						)}
					</Pressable>
				</GlassCard>

				<Text style={styles.sectionLabel}>ADD A MEMORY</Text>
				<GlassCard style={styles.card}>
					<View style={styles.addRow}>
						<TextInput
							style={styles.addInput}
							placeholder="Add a memory…"
							placeholderTextColor={colors.textFaint}
							value={addText}
							onChangeText={setAddText}
							maxLength={500}
							onSubmitEditing={() => void handleAdd()}
							returnKeyType="done"
							editable={!isAdding}
						/>
						<Pressable
							accessibilityRole="button"
							disabled={!addText.trim() || isAdding}
							onPress={() => void handleAdd()}
							style={({ pressed }) => [
								styles.addButton,
								pressed && { backgroundColor: colors.accentPressed },
								(!addText.trim() || isAdding) && { opacity: 0.4 },
							]}
						>
							<Text style={styles.addButtonLabel}>{isAdding ? "…" : "Add"}</Text>
						</Pressable>
					</View>
				</GlassCard>

				<Text style={styles.sectionLabel}>SAVED MEMORIES · {memories.length}</Text>
				<GlassCard style={styles.card}>
					{loadError ? (
						<View style={styles.errorRow}>
							<Text style={styles.errorText}>{loadError}</Text>
							<Pressable
								accessibilityRole="button"
								onPress={() => void load()}
								hitSlop={8}
								style={({ pressed }) => [pressed && { opacity: 0.6 }]}
							>
								<Text style={styles.retryLabel}>Retry</Text>
							</Pressable>
						</View>
					) : !hasLoaded ? (
						<ActivityIndicator size="small" color={colors.accent} />
					) : memories.length === 0 ? (
						<Text style={styles.hint}>
							Nothing saved yet. Add one above, or just chat — SureWord remembers what matters.
						</Text>
					) : (
						groups.map((group, groupIndex) => (
							<View key={group.category} style={groupIndex > 0 ? styles.groupGap : undefined}>
								<Text style={styles.groupLabel}>{group.label}</Text>
								{group.items.map((memory) => (
									<View key={memory.id} style={styles.memoryRow}>
										<Text style={styles.memoryText}>{memory.content}</Text>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel={`Delete memory: ${memory.content}`}
											onPress={() => confirmDelete(memory)}
											hitSlop={8}
											style={({ pressed }) => [
												styles.deleteButton,
												pressed && { backgroundColor: colors.dangerSoft },
											]}
										>
											<Text style={styles.deleteGlyph}>✕</Text>
										</Pressable>
									</View>
								))}
							</View>
						))
					)}
				</GlassCard>

				{memories.length > 0 ? (
					<Pressable
						accessibilityRole="button"
						onPress={confirmClearAll}
						style={({ pressed }) => [
							styles.clearButton,
							pressed && { backgroundColor: "rgba(248, 113, 113, 0.18)" },
						]}
					>
						<Text style={styles.clearLabel}>Clear all memories</Text>
					</Pressable>
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
		backButton: {
			width: 38,
			height: 38,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		backButtonPressed: { backgroundColor: c.surfacePressed },
		backGlyph: { color: c.textMuted, fontSize: 22, marginTop: -2 },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 17,
			fontWeight: "700",
			textAlign: "center",
		},
		content: {
			paddingHorizontal: spacing.lg,
			paddingBottom: 120,
		},
		sectionLabel: {
			color: c.textFaint,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
			marginLeft: spacing.xs,
		},
		card: { padding: spacing.lg, gap: spacing.md },
		hint: { color: c.textFaint, fontSize: 12, lineHeight: 17 },
		summaryOverview: { color: c.text, fontSize: 14, lineHeight: 21 },
		summarySection: { gap: 4 },
		summaryHeading: { color: c.text, fontSize: 14, fontWeight: "700" },
		summaryText: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
		summaryButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		summaryBusyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		summaryButtonLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },
		addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		addInput: {
			flex: 1,
			minHeight: 44,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.md,
			color: c.text,
			fontSize: 14,
		},
		addButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		addButtonLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },
		errorRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		errorText: { flex: 1, color: c.danger, fontSize: 13, lineHeight: 18 },
		retryLabel: { color: c.accent, fontSize: 13, fontWeight: "700" },
		groupGap: { marginTop: spacing.md },
		groupLabel: {
			color: c.textFaint,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 0.8,
			marginBottom: spacing.xs,
		},
		memoryRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingVertical: spacing.sm,
		},
		memoryText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 20 },
		deleteButton: {
			width: 32,
			height: 32,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		deleteGlyph: { color: c.danger, fontSize: 13 },
		clearButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			marginTop: spacing.xl,
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
		},
		clearLabel: { color: c.danger, fontSize: 14, fontWeight: "700" },
	});
