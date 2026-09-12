import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { HIGHLIGHT_PRESETS } from "@/features/bible/highlights";
import {
	HIGHLIGHT_LABEL_IDS,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	type HighlightLabelId,
	type HighlightLabels,
} from "./preferences";
import { hydratePreferences, saveHighlightLabelEdits } from "./preferencesSync";
import { getSettings, useSettings, useTheme, useThemedStyles } from "./settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

type LabelDraft = Record<HighlightLabelId, string>;

function draftFromLabels(labels: HighlightLabels | null): LabelDraft {
	return Object.fromEntries(HIGHLIGHT_LABEL_IDS.map((id) => [id, labels?.[id] ?? ""])) as LabelDraft;
}

export function HighlightLabelsSection() {
	const labels = useSettings().highlightLabels;
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [draft, setDraft] = useState<LabelDraft>(() => draftFromLabels(labels));
	const draftRef = useRef(draft);
	const [dirtyIds, setDirtyIds] = useState<HighlightLabelId[]>([]);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (labels === null) return;
		setLoadFailed(false);
		setDraft((current) => {
			const next = { ...current };
			for (const id of HIGHLIGHT_LABEL_IDS) {
				if (!dirtyIds.includes(id)) next[id] = labels[id] ?? "";
			}
			draftRef.current = next;
			return next;
		});
	}, [dirtyIds, labels]);

	useEffect(() => {
		if (labels !== null) return;
		let active = true;
		void hydratePreferences(true).then(() => {
			if (active && getSettings().highlightLabels === null) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [labels]);

	const changeLabel = (id: HighlightLabelId, value: string) => {
		setSaved(false);
		setError(null);
		const next = { ...draftRef.current, [id]: value };
		draftRef.current = next;
		setDraft(next);
		setDirtyIds((current) => (current.includes(id) ? current : [...current, id]));
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		await hydratePreferences(true);
		if (getSettings().highlightLabels === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || dirtyIds.length === 0) return;
		const submittedIds = [...dirtyIds];
		const submittedDraft = { ...draftRef.current };
		const edits: Partial<Record<HighlightLabelId, string>> = {};
		for (const id of submittedIds) edits[id] = submittedDraft[id];

		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveHighlightLabelEdits(edits);
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}

		const currentDraft = draftRef.current;
		const nextDraft = { ...currentDraft };
		for (const id of submittedIds) {
			if (currentDraft[id] === submittedDraft[id]) nextDraft[id] = result.labels[id] ?? "";
		}
		draftRef.current = nextDraft;
		setDraft(nextDraft);
		setDirtyIds((current) =>
			current.filter(
				(id) => !submittedIds.includes(id) || currentDraft[id] !== submittedDraft[id]
			)
		);
		setSaved(true);
	};

	const status = error
		? error
		: saving
			? "Saving to your account…"
			: dirtyIds.length > 0
				? "Unsaved changes"
				: saved
					? "Saved to your account"
					: `${MAX_HIGHLIGHT_LABEL_LENGTH} characters maximum`;

	return (
		<>
			<Text style={styles.sectionLabel}>HIGHLIGHT LABELS</Text>
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>
					Name each color for the way you study, such as Promises or Prayer. A blank label uses
					the color name.
				</Text>

				{labels === null ? (
					<View style={styles.loadingRow}>
						<Text style={styles.hint}>
							{loadFailed ? "Couldn't load your highlight labels." : "Loading highlight labels…"}
						</Text>
						{loadFailed ? (
							<Pressable
								accessibilityRole="button"
								onPress={() => void retryLoad()}
								style={({ pressed }) => [
									styles.retryButton,
									pressed && { backgroundColor: colors.surfacePressed },
								]}
							>
								<Text style={styles.retryLabel}>Retry</Text>
							</Pressable>
						) : null}
					</View>
				) : (
					<>
						{HIGHLIGHT_PRESETS.map(({ name, color }) => {
							const id = name.toLowerCase() as HighlightLabelId;
							return (
								<View key={id} style={styles.labelRow}>
									<View style={[styles.swatch, { backgroundColor: color }]} />
									<TextInput
										value={draft[id]}
										onChangeText={(value) => changeLabel(id, value)}
										maxLength={MAX_HIGHLIGHT_LABEL_LENGTH}
										placeholder={name}
										placeholderTextColor={colors.textFaint}
										selectionColor={colors.accent}
										accessibilityLabel={`${name} highlight label`}
										returnKeyType="done"
										style={styles.input}
									/>
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`Reset ${name} highlight label`}
										disabled={!draft[id]}
										onPress={() => changeLabel(id, "")}
										style={({ pressed }) => [
											styles.resetButton,
											!draft[id] && styles.buttonDisabled,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<Text style={styles.resetLabel}>Reset</Text>
									</Pressable>
								</View>
							);
						})}

						<View style={styles.saveRow}>
							<Text
								accessibilityLiveRegion="polite"
								style={[styles.status, error ? styles.error : null]}
							>
								{status}
							</Text>
							<Pressable
								accessibilityRole="button"
								disabled={saving || dirtyIds.length === 0}
								onPress={() => void save()}
								style={({ pressed }) => [
									styles.saveButton,
									(saving || dirtyIds.length === 0) && styles.buttonDisabled,
									pressed && { opacity: 0.82 },
								]}
							>
								<Text style={styles.saveLabel}>{saving ? "Saving…" : "Save labels"}</Text>
							</Pressable>
						</View>
					</>
				)}
			</GlassCard>
		</>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		sectionLabel: {
			color: c.textFaint,
			...typography.sectionTitle,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
		},
		card: { padding: spacing.lg, gap: spacing.md },
		hint: { flex: 1, color: c.textFaint, ...typography.support },
		loadingRow: {
			minHeight: 72,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
		},
		retryButton: {
			minWidth: 64,
			minHeight: 44,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		retryLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		labelRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			padding: spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
		},
		swatch: {
			width: 28,
			height: 28,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: "rgba(0,0,0,0.2)",
		},
		input: {
			flex: 1,
			minWidth: 0,
			height: 44,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			borderRadius: radius.md,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			color: c.text,
			...typography.control,
		},
		resetButton: {
			minWidth: 54,
			minHeight: 44,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		resetLabel: { color: c.textMuted, ...typography.micro, fontWeight: "700" },
		saveRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingTop: spacing.sm,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		status: { flex: 1, color: c.textFaint, ...typography.micro },
		error: { color: c.danger },
		saveButton: {
			minHeight: 46,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			backgroundColor: c.accent,
		},
		saveLabel: { color: "#171717", ...typography.meta, fontWeight: "700" },
		buttonDisabled: { opacity: 0.4 },
	});
