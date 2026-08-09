import React from "react";
import {
	Modal,
	Pressable,
	StyleSheet,
	Text,
	View,
	type StyleProp,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";

/**
 * Round glyph button. Icons across the notes feature are text glyphs, not an
 * icon font, so this is a Text inside a circular pressable.
 */
export function GlyphButton({
	glyph,
	onPress,
	accessibilityLabel,
	active = false,
	danger = false,
	disabled = false,
	size = 38,
	style,
}: {
	glyph: string;
	onPress: () => void;
	accessibilityLabel: string;
	active?: boolean;
	danger?: boolean;
	disabled?: boolean;
	size?: number;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ selected: active, disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={6}
			style={({ pressed }) => [
				styles.glyphButton,
				{ width: size, height: size, borderRadius: size / 2 },
				active && styles.glyphButtonActive,
				pressed && !disabled && styles.glyphButtonPressed,
				disabled && { opacity: 0.35 },
				style,
			]}
		>
			<Text
				style={[
					styles.glyph,
					{ fontSize: Math.round(size * 0.45) },
					active && { color: colors.accent },
					danger && { color: colors.danger },
				]}
			>
				{glyph}
			</Text>
		</Pressable>
	);
}

/** Pill used for folder/tag filters and tag toggles. */
export function Chip({
	label,
	active,
	onPress,
	dotColor,
	style,
	labelStyle,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
	dotColor?: string;
	style?: StyleProp<ViewStyle>;
	labelStyle?: StyleProp<TextStyle>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={({ pressed }) => [
				styles.chip,
				active && styles.chipActive,
				pressed && !active && styles.chipPressed,
				style,
			]}
		>
			{dotColor ? <View style={[styles.chipDot, { backgroundColor: dotColor }]} /> : null}
			<Text
				numberOfLines={1}
				style={[styles.chipLabel, active && styles.chipLabelActive, labelStyle]}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/** Dark glass sheet that slides up from the bottom of the screen. */
export function BottomSheet({
	visible,
	onClose,
	title,
	children,
	heightRatio,
}: {
	visible: boolean;
	onClose: () => void;
	title?: string;
	children: React.ReactNode;
	/** Fraction of screen height; omit to size to content. */
	heightRatio?: number;
}) {
	const insets = useSafeAreaInsets();
	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			statusBarTranslucent
			onRequestClose={onClose}
		>
			<Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
			<View
				style={[
					styles.sheet,
					heightRatio ? { height: `${Math.round(heightRatio * 100)}%` } : undefined,
					{ paddingBottom: Math.max(insets.bottom, spacing.md) },
				]}
			>
				<View style={styles.grabber} />
				{title ? (
					<View style={styles.sheetHeader}>
						<Text style={styles.sheetTitle}>{title}</Text>
						<GlyphButton glyph="✕" accessibilityLabel="Close" onPress={onClose} size={32} />
					</View>
				) : null}
				{children}
			</View>
		</Modal>
	);
}

/** Full-width row inside a BottomSheet. */
export function SheetRow({
	label,
	glyph,
	onPress,
	danger = false,
	selected = false,
}: {
	label: string;
	glyph?: string;
	onPress: () => void;
	danger?: boolean;
	selected?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
		>
			{glyph ? (
				<Text style={[styles.sheetRowGlyph, danger && { color: colors.danger }]}>{glyph}</Text>
			) : null}
			<Text style={[styles.sheetRowLabel, danger && { color: colors.danger }]} numberOfLines={1}>
				{label}
			</Text>
			{selected ? <Text style={styles.sheetRowCheck}>✓</Text> : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	glyphButton: {
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
	},
	glyphButtonActive: {
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
	},
	glyphButtonPressed: { backgroundColor: colors.surfacePressed },
	glyph: { color: colors.textMuted },

	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: spacing.md,
		paddingVertical: 7,
		borderRadius: radius.full,
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
	},
	chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
	chipPressed: { backgroundColor: colors.surfacePressed },
	chipDot: { width: 7, height: 7, borderRadius: 4 },
	chipLabel: { color: colors.textMuted, fontSize: 12.5, fontWeight: "500", maxWidth: 150 },
	chipLabelActive: { color: colors.accent },

	backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)" },
	sheet: {
		backgroundColor: colors.bgElevated,
		borderTopLeftRadius: radius.xl,
		borderTopRightRadius: radius.xl,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.sm,
	},
	grabber: {
		alignSelf: "center",
		width: 38,
		height: 4,
		borderRadius: 2,
		backgroundColor: colors.surfacePressed,
		marginBottom: spacing.md,
	},
	sheetHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: spacing.sm,
	},
	sheetTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },

	sheetRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		paddingVertical: 14,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
	},
	sheetRowPressed: { backgroundColor: colors.surfacePressed },
	sheetRowGlyph: { color: colors.textMuted, fontSize: 15, width: 20, textAlign: "center" },
	sheetRowLabel: { color: colors.textSecondary, fontSize: 15, flex: 1 },
	sheetRowCheck: { color: colors.accent, fontSize: 15 },
});
