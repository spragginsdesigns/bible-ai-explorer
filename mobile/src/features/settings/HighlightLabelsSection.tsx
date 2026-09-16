import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { HIGHLIGHT_PRESETS } from "@/features/bible/highlights";
import {
	HIGHLIGHT_LABEL_IDS,
	HIGHLIGHT_LABEL_PRESETS,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	MAX_HIGHLIGHT_MEANING_LENGTH,
	type HighlightLabelId,
	type HighlightTextMap,
} from "./preferences";
import { hydratePreferences, saveHighlightLabelEdits } from "./preferencesSync";
import { getSettings, useSettings, useTheme, useThemedStyles } from "./settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

/** Every colour, always present, so an untouched row is "" rather than absent. */
type ColorDraft = Record<HighlightLabelId, string>;

interface Draft {
	labels: ColorDraft;
	meanings: ColorDraft;
}

function draftFromMap(map: HighlightTextMap | null): ColorDraft {
	return Object.fromEntries(HIGHLIGHT_LABEL_IDS.map((id) => [id, map?.[id] ?? ""])) as ColorDraft;
}

const PRESET_BY_ID = new Map(HIGHLIGHT_LABEL_PRESETS.map((preset) => [preset.id, preset]));

/** The rows of a draft whose id is listed, which is what one save carries. */
function editsFor(draft: ColorDraft, ids: readonly HighlightLabelId[]): HighlightTextMap {
	const edits: HighlightTextMap = {};
	for (const id of ids) edits[id] = draft[id];
	return edits;
}

export function HighlightLabelsSection() {
	const { highlightLabels: labels, highlightMeanings: meanings } = useSettings();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [draft, setDraft] = useState<Draft>(() => ({
		labels: draftFromMap(labels),
		meanings: draftFromMap(meanings),
	}));
	const draftRef = useRef(draft);
	const [dirtyLabels, setDirtyLabels] = useState<HighlightLabelId[]>([]);
	const [dirtyMeanings, setDirtyMeanings] = useState<HighlightLabelId[]>([]);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Both maps arrive in the same document, so either one missing means this
	// build is talking to a deploy that has neither.
	const loaded = labels !== null && meanings !== null;
	const dirtyCount = dirtyLabels.length + dirtyMeanings.length;

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (labels === null || meanings === null) return;
		setLoadFailed(false);
		setDraft((current) => {
			const next: Draft = { labels: { ...current.labels }, meanings: { ...current.meanings } };
			for (const id of HIGHLIGHT_LABEL_IDS) {
				if (!dirtyLabels.includes(id)) next.labels[id] = labels[id] ?? "";
				if (!dirtyMeanings.includes(id)) next.meanings[id] = meanings[id] ?? "";
			}
			draftRef.current = next;
			return next;
		});
	}, [dirtyLabels, dirtyMeanings, labels, meanings]);

	useEffect(() => {
		if (loaded) return;
		let active = true;
		void hydratePreferences(true).then(() => {
			if (active && getSettings().highlightLabels === null) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [loaded]);

	const change = (field: keyof Draft, id: HighlightLabelId, value: string) => {
		setSaved(false);
		setError(null);
		const next: Draft = { ...draftRef.current, [field]: { ...draftRef.current[field], [id]: value } };
		draftRef.current = next;
		setDraft(next);
		const markDirty = field === "labels" ? setDirtyLabels : setDirtyMeanings;
		markDirty((current) => (current.includes(id) ? current : [...current, id]));
	};

	/**
	 * Fill every row from the starter set. It only stages the draft: the user
	 * still reads what it suggests and taps Save, so this can never overwrite
	 * their account from a mis-tap.
	 */
	const applyPresets = () => {
		setSaved(false);
		setError(null);
		const next: Draft = { labels: draftFromMap(null), meanings: draftFromMap(null) };
		for (const id of HIGHLIGHT_LABEL_IDS) {
			const preset = PRESET_BY_ID.get(id);
			if (!preset) continue;
			next.labels[id] = preset.label;
			next.meanings[id] = preset.meaning;
		}
		draftRef.current = next;
		setDraft(next);
		setDirtyLabels([...HIGHLIGHT_LABEL_IDS]);
		setDirtyMeanings([...HIGHLIGHT_LABEL_IDS]);
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		await hydratePreferences(true);
		if (getSettings().highlightLabels === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || dirtyCount === 0) return;
		const submittedLabelIds = [...dirtyLabels];
		const submittedMeaningIds = [...dirtyMeanings];
		const submitted: Draft = {
			labels: { ...draftRef.current.labels },
			meanings: { ...draftRef.current.meanings },
		};

		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveHighlightLabelEdits({
			labels: editsFor(submitted.labels, submittedLabelIds),
			meanings: editsFor(submitted.meanings, submittedMeaningIds),
		});
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}

		// Only the rows the user has not typed into since are replaced with what
		// the server confirmed; a row edited mid-flight stays dirty and theirs.
		const current = draftRef.current;
		const next: Draft = { labels: { ...current.labels }, meanings: { ...current.meanings } };
		for (const id of submittedLabelIds) {
			if (current.labels[id] === submitted.labels[id]) next.labels[id] = result.labels[id] ?? "";
		}
		for (const id of submittedMeaningIds) {
			if (current.meanings[id] === submitted.meanings[id]) {
				next.meanings[id] = result.meanings[id] ?? "";
			}
		}
		draftRef.current = next;
		setDraft(next);
		setDirtyLabels((ids) =>
			ids.filter((id) => !submittedLabelIds.includes(id) || current.labels[id] !== submitted.labels[id])
		);
		setDirtyMeanings((ids) =>
			ids.filter(
				(id) => !submittedMeaningIds.includes(id) || current.meanings[id] !== submitted.meanings[id]
			)
		);
		setSaved(true);
	};

	const status = error
		? error
		: saving
			? "Saving to your account…"
			: dirtyCount > 0
				? "Unsaved changes"
				: saved
					? "Saved to your account"
					: `${MAX_HIGHLIGHT_LABEL_LENGTH} characters for a label, ${MAX_HIGHLIGHT_MEANING_LENGTH} for a meaning`;

	return (
		<>
			<Text style={styles.sectionLabel}>HIGHLIGHT LABELS</Text>
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>
					Name each colour for why you reach for it, and tell SureWord what it means to you. Yellow
					might be a favourite verse, blue a promise you lean on, red a warning or the words of
					Christ. The assistant reads these meanings, so a marked verse carries your reasons into
					chat. A blank label uses the colour name.
				</Text>

				{!loaded ? (
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
									<View style={styles.labelLine}>
										<View style={[styles.swatch, { backgroundColor: color }]} />
										<TextInput
											value={draft.labels[id]}
											onChangeText={(value) => change("labels", id, value)}
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
											disabled={!draft.labels[id] && !draft.meanings[id]}
											onPress={() => {
												// Reset clears the whole row, as on web: a meaning
												// left behind a cleared label would still reach
												// the assistant's legend.
												change("labels", id, "");
												change("meanings", id, "");
											}}
											style={({ pressed }) => [
												styles.resetButton,
												!draft.labels[id] && styles.buttonDisabled,
												pressed && { backgroundColor: colors.surfacePressed },
											]}
										>
											<Text style={styles.resetLabel}>Reset</Text>
										</Pressable>
									</View>
									<TextInput
										value={draft.meanings[id]}
										onChangeText={(value) => change("meanings", id, value)}
										maxLength={MAX_HIGHLIGHT_MEANING_LENGTH}
										placeholder="What this colour means to you"
										placeholderTextColor={colors.textFaint}
										selectionColor={colors.accent}
										accessibilityLabel={`What ${name} means to you`}
										returnKeyType="done"
										style={styles.meaningInput}
									/>
								</View>
							);
						})}

						{/*
						 * The status sits above the buttons rather than beside them:
						 * two buttons and a live status line do not fit on one row at
						 * phone width without squeezing the status into a column of
						 * single words.
						 */}
						<View style={styles.saveRow}>
							<Text
								accessibilityLiveRegion="polite"
								style={[styles.status, error ? styles.error : null]}
							>
								{status}
							</Text>
							<View style={styles.buttonRow}>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Use suggested labels"
									disabled={saving}
									onPress={applyPresets}
									style={({ pressed }) => [
										styles.suggestButton,
										saving && styles.buttonDisabled,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.suggestLabel}>Use suggested labels</Text>
								</Pressable>
								<Pressable
									accessibilityRole="button"
									disabled={saving || dirtyCount === 0}
									onPress={() => void save()}
									style={({ pressed }) => [
										styles.saveButton,
										(saving || dirtyCount === 0) && styles.buttonDisabled,
										pressed && { opacity: 0.82 },
									]}
								>
									<Text style={styles.saveLabel}>{saving ? "Saving…" : "Save labels"}</Text>
								</Pressable>
							</View>
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
			gap: spacing.sm,
			padding: spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
		},
		labelLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
		// Aligned with the label input rather than the swatch, so the two boxes
		// read as one row of the same colour.
		meaningInput: {
			minHeight: 44,
			marginLeft: 28 + spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			color: c.textSecondary,
			...typography.meta,
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
			gap: spacing.sm,
			paddingTop: spacing.sm,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		buttonRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: spacing.sm,
		},
		status: { color: c.textFaint, ...typography.micro },
		error: { color: c.danger },
		suggestButton: {
			minHeight: 46,
			paddingHorizontal: spacing.md,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		suggestLabel: { color: c.textSecondary, ...typography.meta, fontWeight: "700" },
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
