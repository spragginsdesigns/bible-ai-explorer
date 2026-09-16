import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { HIGHLIGHT_PRESETS } from "@/features/bible/highlights";
import type { IoniconName } from "@/features/notes/components/primitives";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

export interface VerseAction {
	key: string;
	icon: IoniconName;
	label: string;
	onPress: () => void;
	disabled?: boolean;
	/** Draws the icon and label in the accent. */
	active?: boolean;
}

export interface VerseActionBarProps {
	/** Highlight color shared by the whole selection, or undefined. */
	color: string | undefined;
	/**
	 * Some verse in the selection carries a highlight even though they do not
	 * all share one, so the custom dot becomes the way to clear them.
	 */
	canRemove?: boolean;
	onHighlight: (color: string) => void;
	onRemoveHighlight: () => void;
	/** The parent owns the picker modal. */
	onCustomColor: () => void;
	labelForPreset: (presetName: string) => string;
	actions: VerseAction[];
	/** One line under the chips (errors, "Added to Learn"). */
	message?: string;
	messageTone?: "muted" | "danger";
}

const DOT_SIZE = 30;
/** Dark enough to read on every preset, which are all mid-tone or lighter. */
const DOT_GLYPH = "rgba(0, 0, 0, 0.65)";

/** The dots and chips pinned to the bottom of the verse sheet in both tiers. */
export function VerseActionBar({
	color,
	canRemove = false,
	onHighlight,
	onRemoveHighlight,
	onCustomColor,
	labelForPreset,
	actions,
	message,
	messageTone = "muted",
}: VerseActionBarProps): React.JSX.Element {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	const current = color && color.trim() ? color.trim().toLowerCase() : undefined;
	const customActive =
		current !== undefined && !HIGHLIGHT_PRESETS.some((preset) => preset.color.toLowerCase() === current);
	// A mixed range has no single color to ring, so the last dot offers the
	// clear instead of the picker.
	const mixedRemove = current === undefined && canRemove;

	return (
		<View style={styles.container}>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.row}
			>
				{HIGHLIGHT_PRESETS.map((preset) => {
					const selected = current === preset.color.toLowerCase();
					const label = labelForPreset(preset.name);
					return (
						<Pressable
							key={preset.color}
							accessibilityRole="button"
							accessibilityState={{ selected }}
							accessibilityLabel={selected ? `Remove ${label} highlight` : `Highlight ${label}`}
							// Re-tapping the color already on the selection removes it.
							onPress={() => (selected ? onRemoveHighlight() : onHighlight(preset.color))}
							style={({ pressed }) => [
								styles.dot,
								{ backgroundColor: preset.color },
								selected && styles.dotSelected,
								pressed && styles.dotPressed,
							]}
						>
							{selected ? <Ionicons name="close" size={14} color={DOT_GLYPH} /> : null}
						</Pressable>
					);
				})}

				<Pressable
					accessibilityRole="button"
					accessibilityState={{ selected: customActive || mixedRemove }}
					accessibilityLabel={
						customActive
							? "Remove custom highlight"
							: mixedRemove
								? "Remove highlights"
								: "Custom highlight color"
					}
					onPress={() =>
						customActive || mixedRemove ? onRemoveHighlight() : onCustomColor()
					}
					style={({ pressed }) => [
						styles.dot,
						customActive ? { backgroundColor: color } : styles.dotCustom,
						(customActive || mixedRemove) && styles.dotSelected,
						pressed && styles.dotPressed,
					]}
				>
					{customActive ? (
						<Ionicons name="close" size={14} color={DOT_GLYPH} />
					) : mixedRemove ? (
						<Ionicons name="close" size={14} color={colors.textMuted} />
					) : (
						<Ionicons name="add" size={16} color={colors.textMuted} />
					)}
				</Pressable>
			</ScrollView>

			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.row}
			>
				{actions.map((action) => {
					const tint = action.active ? colors.accent : colors.text;
					return (
						<Pressable
							key={action.key}
							accessibilityRole="button"
							accessibilityLabel={action.label}
							accessibilityState={{ disabled: action.disabled === true, selected: action.active === true }}
							disabled={action.disabled}
							onPress={action.onPress}
							style={({ pressed }) => [
								styles.chip,
								pressed && !action.disabled && styles.chipPressed,
								action.disabled && styles.chipDisabled,
							]}
						>
							<Ionicons name={action.icon} size={22} color={tint} />
							<Text style={[styles.chipLabel, action.active && styles.chipLabelActive]} numberOfLines={1}>
								{action.label}
							</Text>
						</Pressable>
					);
				})}
			</ScrollView>

			{message ? (
				<Text
					accessibilityLiveRegion="polite"
					style={[styles.message, messageTone === "danger" && styles.messageDanger]}
				>
					{message}
				</Text>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: { gap: spacing.sm },
		row: {
			paddingHorizontal: spacing.lg,
			gap: spacing.sm,
			alignItems: "center",
		},
		dot: {
			width: DOT_SIZE,
			height: DOT_SIZE,
			borderRadius: DOT_SIZE / 2,
			alignItems: "center",
			justifyContent: "center",
		},
		dotSelected: { borderWidth: 2, borderColor: c.text },
		dotCustom: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		dotPressed: { opacity: 0.7 },
		chip: {
			minWidth: 64,
			minHeight: 56,
			borderRadius: radius.md,
			alignItems: "center",
			justifyContent: "center",
			gap: 4,
			paddingHorizontal: spacing.sm,
		},
		chipPressed: { backgroundColor: c.surfacePressed },
		chipDisabled: { opacity: 0.4 },
		chipLabel: { color: c.textMuted, ...typography.micro },
		chipLabelActive: { color: c.accent },
		message: {
			paddingHorizontal: spacing.lg,
			color: c.textMuted,
			...typography.meta,
		},
		messageDanger: { color: c.danger },
	});
