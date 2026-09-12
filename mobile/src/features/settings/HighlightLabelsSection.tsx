import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { GetToken } from "@/lib/api";
import { HIGHLIGHT_PRESETS } from "@/features/bible/highlights";
import {
	hydrateHighlightLabels,
	readHighlightLabels,
	saveHighlightLabels,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	type HighlightLabels,
} from "@/features/bible/highlightLabels";

/**
 * B6 Settings section (parity with web Settings -> HIGHLIGHT NAMES): name
 * each highlight colour ("Yellow" -> "Promises") so the reader, the
 * assistant and the daily cross can say "you marked this as a promise".
 * Blank keeps the hue's name. Writes the whole `highlightLabels` map per
 * save, because PATCH replaces it. Renders its own heading, like MY CHURCH.
 */
export function HighlightLabelsSection({ getToken }: { getToken: GetToken }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [labels, setLabels] = useState<HighlightLabels>({});
	const [drafts, setDrafts] = useState<HighlightLabels>({});
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void hydrateHighlightLabels(getToken).then((hydrated) => {
			if (!cancelled) setLabels(hydrated);
		});
		return () => {
			cancelled = true;
		};
	}, [getToken]);

	const save = useCallback(
		async (colorId: string, rawValue: string) => {
			const value = rawValue.trim().slice(0, MAX_HIGHLIGHT_LABEL_LENGTH);
			const previous = labels;
			const next = { ...labels };
			if (value) next[colorId] = value;
			else delete next[colorId];
			setLabels(next);
			setError(null);
			try {
				await saveHighlightLabels(getToken, next);
			} catch {
				setLabels(previous);
				void readHighlightLabels();
				setError("Couldn't save the name. Try again.");
			}
		},
		[getToken, labels]
	);

	return (
		<View>
			<Text style={styles.sectionLabel}>HIGHLIGHT NAMES</Text>
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>
					Name a colour for what you mark with it — “Promises”, “Commands”. SureWord uses
					your names when it talks about your highlights. Leave blank to keep the colour’s
					name.
				</Text>
				{HIGHLIGHT_PRESETS.map((preset) => {
					const id = preset.name.toLowerCase();
					const shown = drafts[id] ?? labels[id] ?? "";
					return (
						<View key={preset.color} style={styles.row}>
							<View style={[styles.swatch, { backgroundColor: preset.color }]} />
							<TextInput
								value={shown}
								maxLength={MAX_HIGHLIGHT_LABEL_LENGTH}
								placeholder={preset.name}
								placeholderTextColor={colors.textGhost}
								accessibilityLabel={`Name for the ${preset.name} highlight`}
								onChangeText={(text) => setDrafts((prev) => ({ ...prev, [id]: text }))}
								onBlur={() => {
									if ((drafts[id] ?? labels[id] ?? "") !== (labels[id] ?? "")) {
										void save(id, drafts[id] ?? "");
									}
									setDrafts((prev) => {
										const next = { ...prev };
										delete next[id];
										return next;
									});
								}}
								onSubmitEditing={({ nativeEvent }) => void save(id, nativeEvent.text)}
								returnKeyType="done"
								style={styles.input}
							/>
						</View>
					);
				})}
				{error ? <Text style={styles.error}>{error}</Text> : null}
			</GlassCard>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		sectionLabel: {
			color: c.textFaint,
			...typography.sectionTitle,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingHorizontal: spacing.xs,
			paddingTop: spacing.lg,
			paddingBottom: spacing.sm,
		},
		card: { gap: spacing.md },
		hint: { color: c.textGhost, ...typography.meta, lineHeight: 18 },
		row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		swatch: {
			width: 24,
			height: 24,
			borderRadius: 12,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		input: {
			flex: 1,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 9,
			color: c.text,
			fontSize: 14,
		},
		error: { color: c.danger, ...typography.meta },
	});
